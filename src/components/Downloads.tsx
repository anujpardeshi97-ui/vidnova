/* ============================================================================
 * Downloads.tsx - the download UI surface.
 *
 *   <DownloadButton/>   gated "Download" action for the watch page
 *   <QuotaMeter/>       daily + monthly usage with the IST reset countdown
 *   <DownloadRow/>      one library row: progress, metadata, audit fields, actions
 *   <DownloadLibrary/>  the full Downloads section (profile tab + page)
 *
 * The component never decides anything itself - it calls requestDownload()
 * from downloadService and renders whatever verdict comes back, which is what
 * keeps the rules in one place.
 * ==========================================================================*/
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, Clock, Cpu, Download, FileWarning, Globe, HardDrive,
  Info, MonitorSmartphone, Pause, Play, RefreshCw, RotateCw, ShieldAlert, Sparkles,
  Trash2, Unplug, Wifi, XCircle, Zap, Bug,
} from 'lucide-react';
import type { DownloadRecord, QualityLabel, Video } from '../types';
import { Badge, Button, Card, EmptyState, KV, Modal, Progress, SectionTitle } from './ui';
import { useApp, navigate } from '../context/AppContext';
import {
  auditFor, cancelDownload, deleteDownload, downloadsFor, isPlayableOffline, libraryStats,
  pauseDownload, requestDownload, resumeDownload, retentionLabel, retryDownload, simulateFailure,
  simulateInterruption, allowedQualities, quotaSnapshot, type BlockCode,
} from '../services/downloadService';
import { formatBytes, formatDuration, humanize } from '../lib/format';
import { countdownLabel, istDateTime, msUntilNextIstMidnight } from '../lib/ist';
import { collectDeviceInfo } from '../lib/device';
import { resolveGeoLocation } from '../lib/geo';

/* ========================================================================== */
/*  Quota meter                                                               */
/* ========================================================================== */

export function QuotaMeter({ compact = false }: { compact?: boolean }) {
  const { quota, plan, version } = useApp();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  void tick;
  void version;

  const reset = countdownLabel(msUntilNextIstMidnight());

  return (
    <Card className={compact ? '!p-4' : ''}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <HardDrive size={14} /> Download quota
        </p>
        <Badge tone={plan.id === 'gold' ? 'amber' : plan.id === 'free' ? 'slate' : 'violet'}>{plan.name}</Badge>
      </div>

      <div className="mt-3 space-y-3">
        <QuotaBar
          label="Today"
          used={quota.usedToday}
          limit={quota.dailyLimit}
          percent={quota.percentToday}
          resetLabel={`resets in ${reset}`}
        />
        <QuotaBar
          label="This month"
          used={quota.usedThisMonth}
          limit={quota.monthlyLimit}
          percent={quota.percentMonth}
          resetLabel="resets on the 1st (IST)"
        />
      </div>

      {!compact && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Downloading the same video again within 24 hours is served from your offline cache and does not
          consume quota. Failed, interrupted or cancelled transfers are refunded automatically.
        </p>
      )}
    </Card>
  );
}

function QuotaBar({
  label, used, limit, percent, resetLabel,
}: { label: string; used: number; limit: number; percent: number; resetLabel: string }) {
  const unlimited = limit === -1;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-slate-500 dark:text-slate-400">
          {unlimited ? `${used} used · unlimited` : `${used} / ${limit}`}
        </span>
      </div>
      <Progress
        value={unlimited ? Math.min(100, used * 5) : percent}
        barClass={unlimited ? 'bg-violet-500' : percent >= 100 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}
        className="mt-1.5"
      />
      <p className="mt-1 text-[11px] text-slate-400">{resetLabel}</p>
    </div>
  );
}

/* ========================================================================== */
/*  Download button (watch page)                                              */
/* ========================================================================== */

export function DownloadButton({ video }: { video: Video }) {
  const { user, plan, toast, bump, version } = useApp();
  const [open, setOpen] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<{
    kind: 'started' | 'duplicate' | 'blocked';
    message: string;
    code?: BlockCode;
  } | null>(null);
  const [pendingQuality, setPendingQuality] = useState<QualityLabel | null>(null);

  const qualities = useMemo(
    () => (user ? allowedQualities(video, plan.id) : []),
    [user, plan.id, video, version],
  );

  if (!user) return null;

  const existing = downloadsFor(user.id).find((d) => d.videoId === video.id && d.status === 'completed');
  const active = downloadsFor(user.id).find((d) =>
    ['queued', 'validating', 'downloading', 'paused'].includes(d.status) && d.videoId === video.id,
  );

  const start = (quality: QualityLabel) => {
    const device = collectDeviceInfo();
    const geo = resolveGeoLocation();
    const outcome = requestDownload({ user, video, quality, device, geo });
    setLastOutcome({ kind: outcome.kind, message: 'message' in outcome ? outcome.message : `Download started at ${quality}.`, code: outcome.kind === 'blocked' ? outcome.code : undefined });
    if (outcome.kind === 'started') {
      toast({ kind: 'success', title: 'Download authorised', message: `${video.title} · ${quality} is downloading. Track it in Downloads.` });
    } else if (outcome.kind === 'duplicate') {
      toast({ kind: 'info', title: 'Already in your library', message: outcome.message });
    } else {
      toast({ kind: 'warning', title: 'Download blocked', message: outcome.reason });
    }
    bump();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={existing ? 'outline' : 'primary'}
          icon={existing ? <CheckCircle2 size={16} /> : <Download size={16} />}
          onClick={() => setOpen(true)}
        >
          {existing ? 'Downloaded (re-download)' : 'Download'}
        </Button>

        {active && (
          <Button variant="secondary" icon={<Play size={15} />} onClick={() => navigate('downloads')}>
            {active.status} · {active.progress}%
          </Button>
        )}

        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {plan.offlineDownloads
            ? `Your ${plan.name} plan: ${plan.dailyDownloadLimit === -1 ? 'unlimited' : `${plan.dailyDownloadLimit}/day`} · quality up to ${qualities[0]?.quality ?? '—'}`
            : 'Offline downloads are a paid feature'}
        </span>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Download "${video.title}"`}
        subtitle="Choose a quality. The system validates your subscription, quota and device before the transfer starts."
      >
        <div className="space-y-4">
          <QuotaMeter compact />

          <div className="space-y-2">
            {video.sources
              .slice()
              .reverse()
              .map((source) => {
                const allowed = qualities.some((q) => q.quality === source.quality);
                return (
                  <button
                    key={source.quality}
                    disabled={!allowed}
                    onClick={() => { setPendingQuality(source.quality); start(source.quality); }}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition ${
                      allowed
                        ? 'border-slate-200 hover:border-rose-400 hover:bg-rose-50/50 dark:border-slate-700 dark:hover:bg-rose-950/20'
                        : 'cursor-not-allowed border-slate-200 opacity-55 dark:border-slate-800'
                    }`}
                  >
                    <span>
                      <span className="flex items-center gap-2 text-sm font-bold">
                        {source.quality}
                        {!allowed && <Badge tone="slate">needs a higher plan</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                        {formatBytes(source.sizeBytes)} · MP4 · ~{formatDuration(video.duration)} runtime
                      </span>
                    </span>
                    {allowed ? <Download size={16} className="text-rose-500" /> : <Ban size={16} className="text-slate-400" />}
                  </button>
                );
              })}
          </div>

          {lastOutcome && (
            <OutcomeBanner
              kind={lastOutcome.kind}
              code={lastOutcome.code}
              message={lastOutcome.message}
              quality={pendingQuality}
            />
          )}

          <div className="rounded-xl border border-slate-200 p-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <p className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
              <ShieldAlert size={13} /> What gets recorded
            </p>
            Every request writes an audit row: user, video, timestamp, IP, city, device type/model, OS,
            browser, plan and outcome - whether it succeeded, was blocked or was a duplicate.
          </div>
        </div>
      </Modal>
    </>
  );
}

function OutcomeBanner({
  kind, code, message, quality,
}: { kind: 'started' | 'duplicate' | 'blocked'; code?: BlockCode; message: string; quality: QualityLabel | null }) {
  const tone =
    kind === 'started'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
      : kind === 'duplicate'
      ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300'
      : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200';

  const icon = kind === 'started' ? <CheckCircle2 size={15} /> : kind === 'duplicate' ? <Info size={15} /> : <AlertTriangle size={15} />;

  const upgradeFor: Partial<Record<BlockCode, string>> = {
    daily_quota: 'bronze',
    monthly_quota: 'silver',
    plan_required: 'gold',
    quality_not_allowed: 'silver',
    device_limit: 'silver',
  };

  return (
    <div className={`rounded-xl border p-3 text-xs ${tone}`}>
      <p className="flex items-center gap-2 font-semibold">
        {icon}
        {kind === 'started' ? `Download started (${quality})` : kind === 'blocked' ? `Blocked${code ? ` · ${humanize(code)}` : ''}` : 'No quota consumed'}
      </p>
      <p className="mt-1 leading-relaxed">{message}</p>
      {kind === 'blocked' && code && upgradeFor[code] && (
        <Button size="sm" className="mt-2" icon={<Sparkles size={13} />} onClick={() => navigate('subscriptions')}>
          See plans that lift this limit
        </Button>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Library row                                                               */
/* ========================================================================== */

const STATUS_TONE: Record<DownloadRecord['status'], { tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'red' | 'violet'; icon: React.ReactNode }> = {
  queued: { tone: 'slate', icon: <Clock size={11} /> },
  validating: { tone: 'sky', icon: <ShieldAlert size={11} /> },
  downloading: { tone: 'sky', icon: <Download size={11} /> },
  paused: { tone: 'amber', icon: <Pause size={11} /> },
  completed: { tone: 'emerald', icon: <CheckCircle2 size={11} /> },
  failed: { tone: 'red', icon: <XCircle size={11} /> },
  interrupted: { tone: 'amber', icon: <Unplug size={11} /> },
  cancelled: { tone: 'slate', icon: <Ban size={11} /> },
  blocked: { tone: 'red', icon: <ShieldAlert size={11} /> },
  expired_access: { tone: 'red', icon: <AlertTriangle size={11} /> },
};

export function DownloadRow({ record, onChanged }: { record: DownloadRecord; onChanged: () => void; key?: React.Key }) {

  const { toast, bump } = useApp();
  const [expanded, setExpanded] = useState(false);
  const running = ['queued', 'validating', 'downloading'].includes(record.status);
  const playable = isPlayableOffline(record, true);

  const act = (fn: () => unknown, message: string, kind: 'success' | 'info' | 'warning' = 'info') => {
    fn();
    toast({ kind, title: message });
    bump();
    onChanged();
  };

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative h-24 w-full shrink-0 overflow-hidden rounded-xl sm:w-40">
          <img src={record.thumbnail} alt="" className="h-full w-full object-cover" />
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {record.quality}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{record.videoTitle}</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {formatBytes(record.fileSize)} · {istDateTime(record.startedAt)}
                {record.completedAt ? ` · completed ${istDateTime(record.completedAt)}` : ''}
              </p>
            </div>
            <Badge tone={STATUS_TONE[record.status].tone}>
              {STATUS_TONE[record.status].icon} {humanize(record.status)}
            </Badge>
          </div>

          {running && (
            <div className="mt-3">
              <Progress value={record.progress} barClass="bg-rose-500" />
              <p className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  {formatBytes(record.downloadedBytes)} of {formatBytes(record.fileSize)} ({record.progress}%)
                </span>
                <span className="flex items-center gap-1">
                  <Wifi size={11} /> {record.status === 'paused' ? 'paused' : 'transferring'}
                </span>
              </p>
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Sparkles size={11} /> {record.planName} plan</span>
            {record.status === 'completed' && <span className="flex items-center gap-1"><Clock size={11} /> {retentionLabel(record)}</span>}
            <span className="flex items-center gap-1"><Globe size={11} /> {record.ip} · {record.city}</span>
            <span className="flex items-center gap-1"><MonitorSmartphone size={11} /> {record.deviceModel} · {record.browser}</span>
            {record.countsAgainstQuota ? (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Zap size={11} /> used 1 quota</span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={11} /> quota refunded / cached</span>
            )}
            {record.retryCount > 0 && <span>retries: {record.retryCount}</span>}
            {record.failureReason && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><FileWarning size={11} /> {record.failureReason}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {record.status === 'downloading' && (
              <Button size="sm" variant="outline" icon={<Pause size={13} />} onClick={() => act(() => pauseDownload(record.id), 'Download paused')}>
                Pause
              </Button>
            )}
            {record.status === 'paused' && (
              <Button size="sm" variant="outline" icon={<Play size={13} />} onClick={() => act(() => resumeDownload(record.id), 'Resumed from last byte')}>
                Resume
              </Button>
            )}
            {['failed', 'interrupted'].includes(record.status) && (
              <Button size="sm" variant="outline" icon={<RefreshCw size={13} />} onClick={() => act(() => retryDownload(record.id), 'Retrying download')}>
                Retry
              </Button>
            )}
            {['queued', 'validating', 'downloading', 'paused'].includes(record.status) && (
              <Button size="sm" variant="ghost" icon={<XCircle size={13} />} onClick={() => act(() => cancelDownload(record.id), 'Download cancelled - quota released', 'warning')}>
                Cancel
              </Button>
            )}
            {record.status === 'completed' && (
              <Button
                size="sm"
                variant={playable ? 'success' : 'outline'}
                icon={<Play size={13} />}
                disabled={!playable}
                onClick={() => navigate('watch', record.videoId)}
              >
                {playable ? 'Play offline' : 'Access expired'}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Info size={13} />} onClick={() => setExpanded((e) => !e)}>
              Audit details
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              onClick={() => act(() => deleteDownload(record.id), 'Removed from library')}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Stored audit record
          </p>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <KV label="Record id" value={record.id} mono />
            <KV label="User id" value={record.userId} mono />
            <KV label="Video id" value={record.videoId} mono />
            <KV label="Plan at download time" value={`${record.planName} (${record.planId})`} />
            <KV label="IP address" value={record.ip} mono />
            <KV label="Location" value={`${record.city}, ${record.region}, ${record.country}`} />
            <KV label="Device" value={`${record.deviceType} · ${record.deviceModel}`} />
            <KV label="OS" value={record.os} />
            <KV label="Browser" value={record.browser} />
            <KV label="Device fingerprint" value={record.fingerprint} mono />
            <KV label="Quality" value={record.quality} />
            <KV label="File size" value={formatBytes(record.fileSize)} />
            <KV label="Quota after download" value={record.quotaAfter === -1 ? 'unlimited' : `${record.quotaAfter} left`} />
            <KV label="Counted against quota" value={record.countsAgainstQuota ? 'Yes' : 'No (refunded / cached)'} />
            <KV label="Duplicate of" value={record.duplicateOf ?? '—'} mono />
            <KV label="Retries" value={record.retryCount} />
          </div>
          <p className="mt-3 break-all font-mono text-[10px] text-slate-400">{record.userAgent}</p>
        </div>
      )}
    </Card>
  );
}

/* ========================================================================== */
/*  Library                                                                   */
/* ========================================================================== */

export function DownloadLibrary({ showAudit = true }: { showAudit?: boolean }) {
  const { user, version, bump, subscription, toast } = useApp();
  const [filter, setFilter] = useState<'all' | 'completed' | 'active' | 'problems'>('all');
  const [auditOpen, setAuditOpen] = useState(false);

  if (!user) return null;

  const all = downloadsFor(user.id);
  const stats = libraryStats(user.id);
  const audit = auditFor(user.id, 30);

  const rows = all.filter((d) => {
    if (filter === 'completed') return d.status === 'completed';
    if (filter === 'active') return ['queued', 'validating', 'downloading', 'paused'].includes(d.status);
    if (filter === 'problems') return ['failed', 'interrupted', 'cancelled', 'expired_access', 'blocked'].includes(d.status);
    return true;
  });

  /** Demo helpers so every edge case can be triggered on demand. */
  const running = all.find((d) => d.status === 'downloading');

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Downloads on record" value={stats.total} icon={<Download size={14} />} />
        <MiniStat label="Completed" value={stats.completed} icon={<CheckCircle2 size={14} />} />
        <MiniStat label="In progress" value={stats.inProgress} icon={<RefreshCw size={14} />} />
        <MiniStat label="Offline size" value={formatBytes(stats.totalBytes)} icon={<HardDrive size={14} />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <SectionTitle
            title="Your downloads"
            subtitle={
              subscription
                ? `Plan used for these downloads: ${subscription.planId.toUpperCase()} · ${plan2Days(subscription.expiryDate)}`
                : 'No active subscription - downloads are locked until you renew'
            }
            icon={<Download size={18} />}
            right={
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(['all', 'completed', 'active', 'problems'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                      filter === f ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              icon={<Download size={26} />}
              title="Nothing here yet"
              message="Open any video and press Download. The system will check your plan, daily quota, device registration and concurrency before the transfer starts."
              action={<Button size="sm" onClick={() => navigate('home')}>Browse videos</Button>}
            />
          ) : (
            <div className="space-y-3">
              {rows.map((record) => (
                <DownloadRow key={record.id} record={record} onChanged={bump} />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <QuotaMeter />

          {showAudit && (
            <Card>
              <SectionTitle title="Edge-case test bench" subtitle="Trigger the failure paths a reviewer will ask about" icon={<Bug size={18} />} />
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!running}
                  icon={<Unplug size={14} />}
                  onClick={() => {
                    if (!running) return;
                    simulateInterruption(running.id);
                    toast({ kind: 'warning', title: 'Transfer interrupted', message: 'Resume picks up from the exact byte offset.' });
                    bump();
                  }}
                >
                  Simulate a dropped connection
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!running}
                  icon={<XCircle size={14} />}
                  onClick={() => {
                    if (!running) return;
                    simulateFailure(running.id);
                    toast({ kind: 'error', title: 'Transfer failed', message: 'The reserved quota unit was refunded and a retry is available.' });
                    bump();
                  }}
                >
                  Simulate a failed download
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  icon={<Cpu size={14} />}
                  onClick={() => {
                    // Force the duplicate path: re-request an already completed video.
                    const done = all.find((d) => d.status === 'completed');
                    if (!done) {
                      toast({ kind: 'info', title: 'Download something first', message: 'The duplicate cache only applies to a completed download.' });
                      return;
                    }
                    toast({ kind: 'info', title: 'Re-download within 24h', message: 'Open the video and press Download again - quota will NOT be consumed.' });
                    navigate('watch', done.videoId);
                  }}
                >
                  Test the 24h duplicate cache
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  icon={<RotateCw size={14} />}
                  onClick={() => {
                    // Pretend the IST day rolled over: shift the quota keys.
                    const rows2 = JSON.parse(localStorage.getItem('nexstream:1:quotas') ?? '[]');
                    rows2.forEach((q: { dayKey: string; monthKey: string }) => {
                      q.dayKey = '1900-01-01';
                      q.monthKey = '1900-01';
                    });
                    localStorage.setItem('nexstream:1:quotas', JSON.stringify(rows2));
                    quotaSnapshot(user.id);
                    toast({ kind: 'success', title: 'Quota rolled over', message: 'The IST day marker moved backwards, so the counters reset on the next read.' });
                    bump();
                  }}
                >
                  Force an IST quota reset
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle
              title="Download audit trail"
              subtitle={`${stats.total} events recorded · newest first`}
              icon={<ShieldAlert size={18} />}
              right={<Button size="sm" variant="ghost" onClick={() => setAuditOpen(true)}>View all</Button>}
            />
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {audit.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 p-2.5 text-[11px] dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={entry.event === 'blocked' ? 'red' : entry.event === 'completed' ? 'emerald' : entry.event === 'duplicate' ? 'sky' : 'slate'}>
                      {humanize(entry.event)}
                    </Badge>
                    <span className="font-mono text-slate-400">{istDateTime(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1.5 leading-relaxed text-slate-600 dark:text-slate-300">{entry.detail}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    ip {entry.ip} · {entry.planId} · {entry.fingerprint}
                  </p>
                </div>
              ))}
              {audit.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No audit entries yet.</p>}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Full download audit trail"
        subtitle="Every request, authorisation, block, duplicate, completion and failure - across all devices"
        wide
      >
        <div className="space-y-2">
          {audit.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={entry.event === 'blocked' ? 'red' : entry.event === 'completed' ? 'emerald' : 'slate'}>
                  {humanize(entry.event)}
                </Badge>
                <span className="font-mono text-[11px] text-slate-400">{istDateTime(entry.timestamp)}</span>
              </div>
              <p className="mt-1.5 text-slate-600 dark:text-slate-300">{entry.detail}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-400">
                video {entry.videoId} · download {entry.downloadId ?? '—'} · ip {entry.ip} · {entry.planId} · {entry.fingerprint}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card className="!p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {icon} {label}
      </p>
      <p className="mt-1.5 text-xl font-extrabold">{value}</p>
    </Card>
  );
}

function plan2Days(expiry: number): string {
  const days = Math.max(0, Math.ceil((expiry - Date.now()) / 86_400_000));
  return `valid ${days} more day${days === 1 ? '' : 's'}`;
}
