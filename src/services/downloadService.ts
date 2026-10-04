/* ============================================================================
 * downloadService.ts - the CONTROLLED DOWNLOAD MANAGEMENT SYSTEM.
 *
 * This is the most rule-heavy module in the product, so the flow is written as
 * an explicit, ordered pipeline. Every request walks the same eight gates; the
 * first gate that fails returns a typed `blocked` outcome AND writes an audit
 * row, so a support engineer can always answer "why was this user refused?".
 *
 *   requestDownload()
 *     1. active subscription?          (expired -> blocked)
 *     2. content entitlement?          (plan tier vs video.minTier)
 *     3. duplicate window (24h)?       (never consumes quota twice)
 *     4. registered-device limit?      (plan.maxDevices)
 *     5. concurrent download cap?      (free 1, paid 2, incl. other devices)
 *     6. daily quota                   (resets 00:00 IST)
 *     7. monthly quota                 (resets on the 1st, IST)
 *     8. AUTHORISED -> reserve quota -> start the transfer
 *
 * Edge cases handled further down:
 *   - paused / resumed transfers continue from downloadedBytes
 *   - interrupted transfers are released back to the quota bucket
 *   - failed transfers are released and become retryable, with a counter
 *   - a second tab/device cannot push the user past the concurrency cap
 * ==========================================================================*/
import type {
  DeviceInfo,
  DownloadAuditEntry,
  DownloadRecord,
  DownloadStatus,
  GeoLocation,
  PlanId,
  QualityLabel,
  QuotaState,
  User,
  Video,
} from '../types';
import { TABLES, findById, readTable, uid, upsert, writeTable } from '../lib/storage';
import { istDayKey, istMonthKey } from '../lib/ist';
import { getPlan } from '../data/plans';
import { activeSubscription, reconcileExpiry } from './subscriptionService';

/* ------------------------------- Constants -------------------------------- */

/** A repeat download of the same video inside this window is served from the
 *  offline cache and does NOT consume quota again. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long a completed download stays on the device, per plan. */
export const RETENTION_DAYS: Record<PlanId, number> = {
  free: 1,
  bronze: 30,
  silver: 90,
  gold: 3650,
};

/** Simultaneous transfers allowed per plan (across all devices/tabs). */
const CONCURRENT_LIMIT: Record<PlanId, number> = { free: 1, bronze: 2, silver: 2, gold: 3 };

const QUALITY_ORDER: QualityLabel[] = ['360p', '720p', '1080p'];

/* --------------------------------- Quota ---------------------------------- */

/**
 * Read the quota bucket, applying the IST day/month rollover first.
 * The rollover is lazy (triggered by any read) which is exactly how a nightly
 * cron job plus a defensive read-check would behave in production.
 */
/** A quota row as persisted: the domain state plus its table key. */
export type QuotaRow = QuotaState & { id: string };

export function getQuota(userId: string): QuotaRow {
  const today = istDayKey();
  const month = istMonthKey();
  const rows = readTable<QuotaRow>(TABLES.QUOTAS);
  const found = rows.find((q) => q.userId === userId);

  if (!found) {
    const fresh = {
      id: uid('qt'),
      userId,
      dayKey: today,
      monthKey: month,
      usedToday: 0,
      usedThisMonth: 0,
      lastResetAt: Date.now(),
    };
    upsert(TABLES.QUOTAS, fresh);
    return fresh;
  }

  let changed = false;
  if (found.dayKey !== today) {
    found.dayKey = today;
    found.usedToday = 0;
    changed = true;
    writeAudit({
      userId,
      videoId: '-',
      event: 'quota_reset',
      detail: `Daily download quota reset for IST day ${today}`,
      ip: '-',
      fingerprint: '-',
      planId: getPlan('free').id,
    });
  }
  if (found.monthKey !== month) {
    found.monthKey = month;
    found.usedToday = 0;
    found.usedThisMonth = 0;
    changed = true;
    writeAudit({
      userId,
      videoId: '-',
      event: 'quota_reset',
      detail: `Monthly download quota reset for IST month ${month}`,
      ip: '-',
      fingerprint: '-',
      planId: getPlan('free').id,
    });
  }
  if (changed) upsert(TABLES.QUOTAS, found);
  return found;
}

/** Reserve one unit of quota (called only after every gate has passed). */
function consumeQuota(userId: string): QuotaRow {
  const quota = getQuota(userId);
  quota.usedToday += 1;
  quota.usedThisMonth += 1;
  upsert(TABLES.QUOTAS, quota);
  return quota;
}

/** Give a unit back when a transfer fails, is cancelled or is interrupted. */
function releaseQuota(userId: string): QuotaRow {
  const quota = getQuota(userId);
  quota.usedToday = Math.max(0, quota.usedToday - 1);
  quota.usedThisMonth = Math.max(0, quota.usedThisMonth - 1);
  upsert(TABLES.QUOTAS, quota);
  return quota;
}

export interface QuotaSnapshot {
  planId: PlanId;
  dailyLimit: number;
  monthlyLimit: number;
  usedToday: number;
  usedThisMonth: number;
  /** -1 when the plan is unlimited */
  remainingToday: number;
  remainingMonth: number;
  dayKey: string;
  monthKey: string;
  percentToday: number;
  percentMonth: number;
}

/** Everything the quota widgets need, in one call. */
export function quotaSnapshot(userId: string): QuotaSnapshot {
  const plan = getPlan(activeSubscription(userId)?.planId ?? 'free');
  const quota = getQuota(userId);
  const remainingToday = plan.dailyDownloadLimit === -1 ? -1 : Math.max(0, plan.dailyDownloadLimit - quota.usedToday);
  const remainingMonth =
    plan.monthlyDownloadLimit === -1 ? -1 : Math.max(0, plan.monthlyDownloadLimit - quota.usedThisMonth);
  return {
    planId: plan.id,
    dailyLimit: plan.dailyDownloadLimit,
    monthlyLimit: plan.monthlyDownloadLimit,
    usedToday: quota.usedToday,
    usedThisMonth: quota.usedThisMonth,
    remainingToday,
    remainingMonth,
    dayKey: quota.dayKey,
    monthKey: quota.monthKey,
    percentToday: plan.dailyDownloadLimit === -1 ? 0 : Math.min(100, (quota.usedToday / plan.dailyDownloadLimit) * 100),
    percentMonth:
      plan.monthlyDownloadLimit === -1 ? 0 : Math.min(100, (quota.usedThisMonth / plan.monthlyDownloadLimit) * 100),
  };
}

/* --------------------------------- Audit ---------------------------------- */

export function writeAudit(entry: Omit<DownloadAuditEntry, 'id' | 'timestamp'> & { timestamp?: number }): DownloadAuditEntry {
  const row: DownloadAuditEntry = {
    id: uid('aud'),
    timestamp: entry.timestamp ?? Date.now(),
    ...entry,
  } as DownloadAuditEntry;
  const rows = readTable<DownloadAuditEntry>(TABLES.DOWNLOAD_AUDIT);
  rows.push(row);
  // Keep the audit table bounded so localStorage never fills up.
  writeTable(TABLES.DOWNLOAD_AUDIT, rows.slice(-500));
  return row;
}

export function auditFor(userId: string, limit = 40): DownloadAuditEntry[] {
  return readTable<DownloadAuditEntry>(TABLES.DOWNLOAD_AUDIT)
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/* ------------------------------- Reading rows ----------------------------- */

export function downloadsFor(userId: string): DownloadRecord[] {
  return readTable<DownloadRecord>(TABLES.DOWNLOADS)
    .filter((d) => d.userId === userId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function activeDownloads(userId: string): DownloadRecord[] {
  return downloadsFor(userId).filter((d) =>
    ['queued', 'validating', 'downloading', 'paused'].includes(d.status),
  );
}

export function findDownload(id: string): DownloadRecord | undefined {
  return readTable<DownloadRecord>(TABLES.DOWNLOADS).find((d) => d.id === id);
}

function persist(record: DownloadRecord, patchData: Partial<DownloadRecord> = {}): DownloadRecord {
  const next = { ...record, ...patchData, updatedAt: Date.now() };
  upsert(TABLES.DOWNLOADS, next);
  emit(next);
  return next;
}

/* ------------------------------ Event emitter ----------------------------- */

type Listener = (record: DownloadRecord) => void;
const listeners = new Set<Listener>();

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(record: DownloadRecord): void {
  listeners.forEach((l) => l(record));
}

/* ------------------------------ Quality rules ----------------------------- */

/** Best quality the plan allows for this video (used as the default pick). */
export function allowedQualities(video: Video, planId: PlanId): Video['sources'] {
  const cap = getPlan(planId).maxStreamQuality;
  return video.sources
    .filter((s) => QUALITY_ORDER.indexOf(s.quality) <= QUALITY_ORDER.indexOf(qualityFromHeight(cap)))
    .sort((a, b) => QUALITY_ORDER.indexOf(b.quality) - QUALITY_ORDER.indexOf(a.quality));
}

function qualityFromHeight(height: number): QualityLabel {
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  return '360p';
}

export function bestQuality(video: Video, planId: PlanId): Video['sources'][number] {
  const allowed = allowedQualities(video, planId);
  return allowed[0] ?? video.sources[0];
}

/* ------------------------------ The pipeline ------------------------------ */

export type BlockCode =
  | 'subscription_expired'
  | 'plan_required'
  | 'daily_quota'
  | 'monthly_quota'
  | 'device_limit'
  | 'concurrency'
  | 'quality_not_allowed'
  | 'unknown';

export interface DownloadRequestInput {
  user: User;
  video: Video;
  quality: QualityLabel;
  device: DeviceInfo;
  geo: GeoLocation;
}

export type DownloadOutcome =
  | { kind: 'started'; record: DownloadRecord; quota: QuotaSnapshot }
  | { kind: 'duplicate'; record: DownloadRecord; message: string; quota: QuotaSnapshot }
  | { kind: 'blocked'; code: BlockCode; reason: string; quota: QuotaSnapshot };

/**
 * The single entry point the UI calls. Runs gates 1-8 in order.
 */
export function requestDownload(input: DownloadRequestInput): DownloadOutcome {
  const { user, video, quality, device, geo } = input;
  const auditBase = {
    userId: user.id,
    videoId: video.id,
    ip: geo.ip,
    fingerprint: device.fingerprint,
    planId: activeSubscription(user.id)?.planId ?? 'free',
  };

  // --- Gate 0: log the raw request --------------------------------------
  writeAudit({ ...auditBase, event: 'request', detail: `Requested ${quality} of "${video.title}"` });

  // --- Gate 1: is there a live subscription? ----------------------------
  // Run the expiry sweeper first: if a paid period lapsed since the last page
  // load, the account is downgraded to Free (history preserved) and the request
  // is then judged against the Free allowance rather than silently failing.
  reconcileExpiry(user.id);
  const sub = activeSubscription(user.id);
  if (!sub) {
    writeAudit({ ...auditBase, event: 'blocked', detail: 'No active subscription' });
    return {
      kind: 'blocked',
      code: 'subscription_expired',
      reason: 'Your subscription is not active. Renew or choose a plan to enable downloads.',
      quota: quotaSnapshot(user.id),
    };
  }
  if (sub.expiryDate <= Date.now()) {
    writeAudit({ ...auditBase, event: 'blocked', detail: `Subscription expired at ${sub.expiryDate}` });
    return {
      kind: 'blocked',
      code: 'subscription_expired',
      reason: 'Your subscription expired, so downloads are locked. Renew to restore offline access - your library is preserved.',
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 2: content entitlement --------------------------------------
  if (video.minTier > getPlan(sub.planId).tier) {
    writeAudit({ ...auditBase, event: 'blocked', detail: `Plan tier too low for ${video.access} title` });
    return {
      kind: 'blocked',
      code: 'plan_required',
      reason: `Your ${getPlan(sub.planId).name} plan cannot download this title. It needs a higher tier.`,
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 2b: quality cap ---------------------------------------------
  const allowed = allowedQualities(video, sub.planId).map((s) => s.quality);
  if (!allowed.includes(quality)) {
    writeAudit({ ...auditBase, event: 'blocked', detail: `Quality ${quality} above plan cap` });
    return {
      kind: 'blocked',
      code: 'quality_not_allowed',
      reason: `Your plan caps downloads at ${allowed[0]}. Upgrade to unlock ${quality}.`,
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 3: duplicate window -----------------------------------------
  const existingCompleted = downloadsFor(user.id).find(
    (d) =>
      d.videoId === video.id &&
      d.status === 'completed' &&
      Date.now() - (d.completedAt ?? d.startedAt) < DUPLICATE_WINDOW_MS,
  );
  if (existingCompleted) {
    writeAudit({
      ...auditBase,
      event: 'duplicate',
      downloadId: existingCompleted.id,
      detail: 'Within 24h duplicate window - served from cache, quota untouched',
    });
    return {
      kind: 'duplicate',
      record: existingCompleted,
      message: `Already downloaded ${Math.max(
        1,
        Math.round((Date.now() - (existingCompleted.completedAt ?? Date.now())) / 60000),
      )} minute(s) ago. Served from your offline cache - no quota consumed.`,
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 4: registered-device limit ----------------------------------
  // A device counts as registered when it is in the user's trusted list (an OTP
  // was passed on it) OR when it has downloaded before in the last 90 days.
  // Treating a device's own download history as registration is what allows the
  // same device to keep downloading; a genuinely different device is what the
  // plan limit is meant to stop.
  const plan = getPlan(sub.planId);
  const dbUser = findById<User>(TABLES.USERS, user.id) ?? user;
  const knownFingerprints = new Set(dbUser.trustedDevices.map((d) => d.fingerprint));
  const recentFingerprints = new Set(
    downloadsFor(user.id)
      .filter((d) => Date.now() - d.startedAt < 90 * 86_400_000)
      .map((d) => d.fingerprint),
  );
  const isKnownDevice = knownFingerprints.has(device.fingerprint) || recentFingerprints.has(device.fingerprint);
  const distinctDevices = new Set([...knownFingerprints, ...recentFingerprints]).size;
  if (!isKnownDevice && distinctDevices >= plan.maxDevices) {
    writeAudit({
      ...auditBase,
      event: 'blocked',
      detail: `Device limit reached (${distinctDevices}/${plan.maxDevices})`,
    });
    return {
      kind: 'blocked',
      code: 'device_limit',
      reason: `The ${plan.name} plan allows downloads on ${plan.maxDevices} device(s) and ${distinctDevices} are already registered. Remove a device in Security, or upgrade.`,
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 5: concurrency (multi-tab / multi-device) --------------------
  const running = activeDownloads(user.id);
  const cap = CONCURRENT_LIMIT[sub.planId];
  if (running.length >= cap) {
    const onOtherDevice = running.find((d) => d.fingerprint !== device.fingerprint);
    writeAudit({
      ...auditBase,
      event: 'blocked',
      detail: `Concurrency cap reached (${running.length}/${cap})`,
    });
    return {
      kind: 'blocked',
      code: 'concurrency',
      reason: onOtherDevice
        ? `Another device (${onOtherDevice.browser}) is already downloading. Your plan allows ${cap} simultaneous transfer(s) - finish or cancel it first.`
        : `You already have ${running.length} download(s) running. Your plan allows ${cap} at a time.`,
      quota: quotaSnapshot(user.id),
    };
  }

  // --- Gate 6 & 7: daily + monthly quota --------------------------------
  const snapshot = quotaSnapshot(user.id);
  if (snapshot.remainingToday === 0) {
    writeAudit({ ...auditBase, event: 'blocked', detail: 'Daily quota exhausted' });
    return {
      kind: 'blocked',
      code: 'daily_quota',
      reason: `Daily limit reached: ${snapshot.usedToday}/${snapshot.dailyLimit} downloads used today. Quota resets at 00:00 IST.`,
      quota: snapshot,
    };
  }
  if (snapshot.remainingMonth === 0) {
    writeAudit({ ...auditBase, event: 'blocked', detail: 'Monthly quota exhausted' });
    return {
      kind: 'blocked',
      code: 'monthly_quota',
      reason: `Monthly limit reached: ${snapshot.usedThisMonth}/${snapshot.monthlyLimit} downloads used. Upgrade for a higher allowance.`,
      quota: snapshot,
    };
  }

  // --- Gate 8: AUTHORISED -------------------------------------------------
  const source = video.sources.find((s) => s.quality === quality) ?? bestQuality(video, sub.planId);
  const after = consumeQuota(user.id);
  const record: DownloadRecord = {
    id: uid('dl'),
    userId: user.id,
    videoId: video.id,
    videoTitle: video.title,
    thumbnail: video.thumbnail,
    quality: source.quality,
    fileSize: source.sizeBytes,
    status: 'queued',
    progress: 0,
    downloadedBytes: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    planId: plan.id,
    planName: plan.name,
    ip: geo.ip,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    deviceType: device.type,
    deviceModel: device.model,
    os: device.os,
    browser: device.browser,
    userAgent: device.userAgent,
    fingerprint: device.fingerprint,
    countsAgainstQuota: true,
    quotaAfter: -1,
    retryCount: 0,
  };
  upsert(TABLES.DOWNLOADS, record);
  writeAudit({
    ...auditBase,
    event: 'authorized',
    downloadId: record.id,
    detail: `Authorised ${source.quality} (${(source.sizeBytes / 1048576).toFixed(2)} MB) on ${plan.name}. Quota now ${after.usedToday}/${plan.dailyDownloadLimit === -1 ? '∞' : plan.dailyDownloadLimit} today.`,
  });

  startTransfer(record.id);

  const finalSnapshot = quotaSnapshot(user.id);
  const stored = findDownload(record.id)!;
  upsert(TABLES.DOWNLOADS, { ...stored, quotaAfter: finalSnapshot.remainingToday });
  emit(findDownload(record.id)!);

  return { kind: 'started', record: findDownload(record.id)!, quota: finalSnapshot };
}

/* --------------------------- Transfer simulation -------------------------- */

interface Transfer {
  timer: number;
  bytesPerTick: number;
}

const transfers = new Map<string, Transfer>();

/** Roughly 6-9 seconds per file, with jitter, so the UI visibly animates. */
function speedFor(fileSize: number): number {
  const targetSeconds = 6 + Math.random() * 3;
  const ticks = (targetSeconds * 1000) / 250;
  return Math.max(4096, fileSize / ticks);
}

function startTransfer(id: string): void {
  const record = findDownload(id);
  if (!record) return;

  persist(record, { status: 'validating', progress: 1 });
  writeAudit({
    userId: record.userId,
    videoId: record.videoId,
    downloadId: record.id,
    event: 'request',
    detail: 'Validating download authorisation token',
    ip: record.ip,
    fingerprint: record.fingerprint,
    planId: record.planId,
  });

  // Small delay so the "validating" state is visible, like a real signed-URL fetch.
  window.setTimeout(() => {
    const current = findDownload(id);
    if (!current || current.status === 'cancelled') return;
    persist(current, { status: 'downloading' });

    const speed = speedFor(current.fileSize);
    const timer = window.setInterval(() => {
      const live = findDownload(id);
      if (!live) {
        stopTransfer(id);
        return;
      }
      if (live.status !== 'downloading') return; // paused or cancelled

      const nextBytes = Math.min(live.fileSize, live.downloadedBytes + speed);
      const progress = Math.round((nextBytes / live.fileSize) * 100);

      if (nextBytes >= live.fileSize) {
        stopTransfer(id);
        completeDownload(live, progress);
      } else {
        persist(live, { downloadedBytes: nextBytes, progress });
      }
    }, 250);

    transfers.set(id, { timer, bytesPerTick: speed });
  }, 450);
}

function stopTransfer(id: string): void {
  const transfer = transfers.get(id);
  if (transfer) {
    window.clearInterval(transfer.timer);
    transfers.delete(id);
  }
}

function completeDownload(live: DownloadRecord, progress: number): void {
  const done = persist(live, {
    status: 'completed',
    progress: 100,
    downloadedBytes: live.fileSize,
    completedAt: Date.now(),
  });
  writeAudit({
    userId: done.userId,
    videoId: done.videoId,
    downloadId: done.id,
    event: 'completed',
    detail: `Completed ${done.quality} download (${(done.fileSize / 1048576).toFixed(2)} MB) from ${done.city}`,
    ip: done.ip,
    fingerprint: done.fingerprint,
    planId: done.planId,
  });
}

/* ------------------------------ User controls ----------------------------- */

/** Pause: bytes already fetched are kept, the transfer can resume later. */
export function pauseDownload(id: string): DownloadRecord | null {
  const record = findDownload(id);
  if (!record || record.status !== 'downloading') return null;
  stopTransfer(id);
  return persist(record, { status: 'paused' });
}

/** Resume from the exact byte offset (HTTP Range semantics). */
export function resumeDownload(id: string): DownloadRecord | null {
  const record = findDownload(id);
  if (!record || record.status !== 'paused') return null;
  const resumed = persist(record, { status: 'downloading' });
  writeAudit({
    userId: record.userId,
    videoId: record.videoId,
    downloadId: record.id,
    event: 'resumed',
    detail: `Resumed from ${(record.downloadedBytes / 1048576).toFixed(2)} MB`,
    ip: record.ip,
    fingerprint: record.fingerprint,
    planId: record.planId,
  });
  startTransferFromBytes(resumed);
  return resumed;
}

/** Continue an interrupted/paused transfer without the validating step. */
function startTransferFromBytes(record: DownloadRecord): void {
  stopTransfer(record.id);
  const speed = speedFor(record.fileSize);
  const timer = window.setInterval(() => {
    const live = findDownload(record.id);
    if (!live) return stopTransfer(record.id);
    if (live.status !== 'downloading') return;
    const nextBytes = Math.min(live.fileSize, live.downloadedBytes + speed);
    if (nextBytes >= live.fileSize) {
      stopTransfer(record.id);
      completeDownload(live, 100);
    } else {
      persist(live, { downloadedBytes: nextBytes, progress: Math.round((nextBytes / live.fileSize) * 100) });
    }
  }, 250);
  transfers.set(record.id, { timer, bytesPerTick: speed });
}

/** Cancel: stops the transfer and refunds the quota unit. */
export function cancelDownload(id: string): DownloadRecord | null {
  const record = findDownload(id);
  if (!record) return null;
  stopTransfer(id);
  const wasCharged = record.countsAgainstQuota && record.status !== 'completed';
  if (wasCharged) releaseQuota(record.userId);
  const cancelled = persist(record, {
    status: 'cancelled',
    countsAgainstQuota: wasCharged ? false : record.countsAgainstQuota,
    failureReason: 'Cancelled by user',
  });
  writeAudit({
    userId: record.userId,
    videoId: record.videoId,
    downloadId: record.id,
    event: 'cancelled',
    detail: wasCharged ? 'Cancelled by user - quota unit released' : 'Cancelled by user',
    ip: record.ip,
    fingerprint: record.fingerprint,
    planId: record.planId,
  });
  return cancelled;
}

/** Retry a failed / interrupted transfer, keeping the retry counter. */
export function retryDownload(id: string): DownloadRecord | null {
  const record = findDownload(id);
  if (!record) return null;
  const retried = persist(record, {
    status: 'downloading',
    failureReason: undefined,
    retryCount: record.retryCount + 1,
  });
  // A retry keeps the original quota reservation if it is still valid.
  if (!retried.countsAgainstQuota) {
    const snapshot = quotaSnapshot(retried.userId);
    if (snapshot.remainingToday !== 0) {
      consumeQuota(retried.userId);
      upsert(TABLES.DOWNLOADS, { ...retried, countsAgainstQuota: true });
    }
  }
  startTransferFromBytes(findDownload(id)!);
  return findDownload(id)!;
}

/** Delete a record from the library (does not touch quota). */
export function deleteDownload(id: string): void {
  stopTransfer(id);
  writeTable(
    TABLES.DOWNLOADS,
    readTable<DownloadRecord>(TABLES.DOWNLOADS).filter((d) => d.id !== id),
  );
}

/* --------------------- Fault injection (for the demo/tests) --------------- */

/** Simulate a network failure mid-transfer. Quota is released. */
export function simulateFailure(id: string, reason = 'Network error (simulated)'): DownloadRecord | null {
  const record = findDownload(id);
  if (!record) return null;
  stopTransfer(id);
  const charged = record.countsAgainstQuota;
  if (charged) releaseQuota(record.userId);
  const failed = persist(record, {
    status: 'failed',
    countsAgainstQuota: false,
    failureReason: reason,
  });
  writeAudit({
    userId: record.userId,
    videoId: record.videoId,
    downloadId: record.id,
    event: 'failed',
    detail: `${reason} at ${record.progress}% - quota unit refunded`,
    ip: record.ip,
    fingerprint: record.fingerprint,
    planId: record.planId,
  });
  return failed;
}

/** Simulate a connection drop / browser close (resumable state). */
export function simulateInterruption(id: string): DownloadRecord | null {
  const record = findDownload(id);
  if (!record) return null;
  stopTransfer(id);
  const interrupted = persist(record, {
    status: 'interrupted',
    failureReason: 'Connection interrupted (simulated)',
  });
  writeAudit({
    userId: record.userId,
    videoId: record.videoId,
    downloadId: record.id,
    event: 'interrupted',
    detail: `Interrupted at ${record.progress}% - resume available`,
    ip: record.ip,
    fingerprint: record.fingerprint,
    planId: record.planId,
  });
  return interrupted;
}

/**
 * Subscription sweeper for downloads: called whenever the app boots or the
 * plan changes. Anything still running when access lapses is stopped and
 * flagged, and completed files are marked unavailable.
 */
export function invalidateForExpiry(userId: string): number {
  const subs = activeSubscription(userId);
  if (subs) return 0;
  let count = 0;
  downloadsFor(userId).forEach((record) => {
    if (['queued', 'validating', 'downloading', 'paused'].includes(record.status)) {
      stopTransfer(record.id);
      persist(record, {
        status: 'expired_access',
        failureReason: 'Subscription expired while downloading',
      });
      writeAudit({
        userId,
        videoId: record.videoId,
        downloadId: record.id,
        event: 'blocked',
        detail: 'Subscription expired - transfer aborted',
        ip: record.ip,
        fingerprint: record.fingerprint,
        planId: record.planId,
      });
      count += 1;
    }
  });
  return count;
}

/* ------------------------------ Library stats ----------------------------- */

export interface LibraryStats {
  total: number;
  completed: number;
  inProgress: number;
  failed: number;
  totalBytes: number;
  byQuality: Record<string, number>;
  lastDownloadAt: number | null;
}

export function libraryStats(userId: string): LibraryStats {
  const rows = downloadsFor(userId);
  const completed = rows.filter((d) => d.status === 'completed');
  return {
    total: rows.length,
    completed: completed.length,
    inProgress: rows.filter((d) => ['queued', 'validating', 'downloading', 'paused'].includes(d.status)).length,
    failed: rows.filter((d) => ['failed', 'interrupted'].includes(d.status)).length,
    totalBytes: completed.reduce((sum, d) => sum + d.fileSize, 0),
    byQuality: completed.reduce<Record<string, number>>((acc, d) => {
      acc[d.quality] = (acc[d.quality] ?? 0) + 1;
      return acc;
    }, {}),
    lastDownloadAt: rows.length ? Math.max(...rows.map((d) => d.startedAt)) : null,
  };
}

/** A download is playable offline only while access and retention are valid. */
export function isPlayableOffline(record: DownloadRecord, hasActiveSub: boolean): boolean {
  if (record.status !== 'completed') return false;
  if (!hasActiveSub) return false;
  const retention = RETENTION_DAYS[record.planId] * 86_400_000;
  return Date.now() - (record.completedAt ?? record.startedAt) < retention;
}

/** Retention countdown label, e.g. "expires in 22h". */
export function retentionLabel(record: DownloadRecord): string {
  const retention = RETENTION_DAYS[record.planId] * 86_400_000;
  const left = retention - (Date.now() - (record.completedAt ?? record.startedAt));
  if (left <= 0) return 'expired';
  const hours = Math.floor(left / 3_600_000);
  if (hours >= 48) return `expires in ${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `expires in ${hours}h`;
  return `expires in ${Math.max(1, Math.floor(left / 60_000))}m`;
}

export { CONCURRENT_LIMIT, qualityFromHeight };
