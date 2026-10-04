/* ============================================================================
 * verify-rules.ts - headless verification of the platform's business rules.
 *
 *   npx tsx scripts/verify-rules.ts
 *
 * Boots the real service layer against a stubbed browser (localStorage,
 * sessionStorage, navigator, crypto) and asserts the behaviours the spec calls
 * out: quota gates, the 24h duplicate window, quota refunds on failure,
 * signature verification before activation, idempotent orders, OTP step-up for
 * new devices and the IST auto-theme rule.
 * ==========================================================================*/

/* ------------------------- minimal browser shims -------------------------- */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
(globalThis as Record<string, unknown>).localStorage = local;
(globalThis as Record<string, unknown>).sessionStorage = session;
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).navigator = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  language: 'en-IN',
  maxTouchPoints: 0,
  mediaDevices: undefined,
};
(globalThis as Record<string, unknown>).screen = { width: 1920, height: 1080 };
(globalThis as Record<string, unknown>).devicePixelRatio = 1;
if (!(globalThis as Record<string, unknown>).crypto) {
  const { webcrypto } = await import('node:crypto');
  (globalThis as Record<string, unknown>).crypto = webcrypto;
}
// The services schedule timers for the transfer simulation; keep them alive.
(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = setTimeout;

/* ------------------------------- imports ---------------------------------- */
const { seedDatabase, DEMO_ACCOUNTS } = await import('../src/services/db');
const { attemptLogin, verifyOtp } = await import('../src/services/securityService');
const { requestDownload, quotaSnapshot, downloadsFor, findDownload, simulateFailure, getQuota } =
  await import('../src/services/downloadService');
const { activeSubscription, effectivePlan, cancelSubscription, reconcileExpiry } =
  await import('../src/services/subscriptionService');
const { createOrder, processCheckout, reconcile } = await import('../src/services/paymentService');
const { inbox } = await import('../src/services/mailService');
const { VIDEOS } = await import('../src/data/videos');
const { collectDeviceInfo, resetFingerprint } = await import('../src/lib/device');
const { resolveGeoLocation, simulateLocation, geoOptions } = await import('../src/lib/geo');
const { themeForIstLogin, istHour, istDayKey } = await import('../src/lib/ist');
const { TABLES, readTable } = await import('../src/lib/storage');
const { hashPassword } = await import('../src/lib/security');
const { PLANS } = await import('../src/data/plans');
import type { User } from '../src/types';

/* ------------------------------ test runner -------------------------------- */
let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.log(`  \u2717 ${name} ${detail ? `\n      -> ${detail}` : ''}`);
  }
}
function section(title: string) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

/* --------------------------------- boot ------------------------------------ */
seedDatabase();

/**
 * Test helper: a synthetic account always needs a matching subscription row,
 * otherwise the entitlement engine (correctly) refuses it. `ageDays` lets a
 * test create an already-expired period.
 */
async function makeUser(
  id: string,
  planId: 'free' | 'bronze' | 'silver' | 'gold',
  status: 'active' | 'expired' = 'active',
  ageDays = 0,
) {
  const { upsert: up } = await import('../src/lib/storage');
  const { getPlan } = await import('../src/data/plans');
  const now = Date.now();
  const start = now - ageDays * 86_400_000;
  const expiry = status === 'expired' ? start - 86_400_000 : start + 30 * 86_400_000;
  const user: User = {
    id, name: `Test ${id}`, email: `${id}@test.local`, phone: '+910000000000',
    password: hashPassword('x'), avatarColor: '#000', createdAt: now, theme: 'dark',
    themeLockedByUser: true, autoThemeOnLogin: false, planId, trustedDevices: [], trustDurationDays: 30,
  };
  up(TABLES.USERS, user);
  up(TABLES.SUBSCRIPTIONS, {
    id: `sub_${id}`, userId: id, planId, status, cycle: 'monthly', startDate: start,
    expiryDate: expiry, autoRenew: true, creditCarried: 0, createdAt: now, action: 'new',
    pricePaid: getPlan(planId).monthlyPrice * 100, currency: 'INR', invoiceNumber: `NS-T-${id}`,
  });
  return user;
}

const { writeTable: _wt } = await import('../src/lib/storage');

/** Force a transfer to "completed" so tests can move past the concurrency gate. */
function finish(recordId: string) {
  _wt(TABLES.DOWNLOADS, readTable<Record<string, unknown>>(TABLES.DOWNLOADS).map((r) =>
    r.id === recordId ? { ...r, status: 'completed', completedAt: Date.now(), progress: 100, downloadedBytes: r.fileSize } : r,
  ));
}

const users = readTable<User>(TABLES.USERS);
const priya = users.find((u) => u.email === DEMO_ACCOUNTS[0].email)!;
const arjun = users.find((u) => u.email === DEMO_ACCOUNTS[1].email)!;

section('1. Seeding and accounts');
check('two demo accounts seeded', users.length === 2, `found ${users.length}`);
check('passwords are stored hashed, never in clear text',
  priya.password !== 'Demo@1234' && priya.password === hashPassword('Demo@1234'));
check('Free account starts on the free tier', effectivePlan(priya.id).id === 'free');
check('Gold account has an active subscription', activeSubscription(arjun.id)?.planId === 'gold');

section('2. IST time-based theming (05:00-12:00 light, otherwise dark)');
// IST = UTC + 5:30, so build the instant by subtracting that offset.
const at = (hourIst: number, minuteIst = 0) =>
  new Date(Date.UTC(2026, 9, 3, hourIst, minuteIst) - 5.5 * 3600 * 1000);
check('04:59 IST -> dark', themeForIstLogin(at(4, 59)) === 'dark');
check('05:00 IST -> light', themeForIstLogin(at(5, 0)) === 'light');
check('09:30 IST -> light', themeForIstLogin(at(9, 30)) === 'light');
check('11:59 IST -> light', themeForIstLogin(at(11, 59)) === 'light');
check('12:00 IST -> dark', themeForIstLogin(at(12, 0)) === 'dark');
check('23:30 IST -> dark', themeForIstLogin(at(23)) === 'dark');
check('istHour() is IST-shifted', istHour(new Date(Date.UTC(2026, 9, 3, 9, 30))) === 15);

section('3. Login audit + OTP step-up on a new device');
const firstLogin = attemptLogin(priya.email, 'Demo@1234');
check('unknown context demands an OTP', firstLogin.status === 'otp_required', firstLogin.status);
check('a pending OTP row was created', readTable(TABLES.OTP_CODES).length === 1);
check('an OTP e-mail was queued', inbox(priya.id).some((m) => m.kind === 'otp'));
check('the login attempt itself is audited', readTable(TABLES.LOGIN_RECORDS).length === 1);
check('wrong password is rejected with one generic message',
  attemptLogin(priya.email, 'wrong-password').status === 'blocked');
check('wrong password never reveals whether the account exists',
  attemptLogin('nobody@nowhere.test', 'x').message === attemptLogin(priya.email, 'x').message);

const otpRow = readTable<{ id: string; code: string }>(TABLES.OTP_CODES)[0];
const badOtp = verifyOtp(otpRow.id, '000000');
check('an incorrect OTP is rejected', !badOtp.ok);
const goodOtp = verifyOtp(otpRow.id, otpRow.code);
check('the correct OTP succeeds', goodOtp.ok, goodOtp.message);
check('verification trusts the device for 30 days',
  (goodOtp.user?.trustedDevices.length ?? 0) === 1);
const secondLogin = attemptLogin(priya.email, 'Demo@1234');
check('a trusted device skips the OTP on the next login', secondLogin.status === 'success', secondLogin.status);

section('4. Free plan download quota (1 per day)');
const freeVideo = VIDEOS[0];
const device = collectDeviceInfo();
const geo = resolveGeoLocation();

const first = requestDownload({ user: priya, video: freeVideo, quality: '360p', device, geo });
check('the first download of the day is authorised', first.kind === 'started', JSON.stringify(first).slice(0, 160));
check('quota now shows 1 used today', quotaSnapshot(priya.id).usedToday === 1);
check('record stores the full audit trail (ip/device/plan)',
  first.kind === 'started' && Boolean(first.record.ip && first.record.browser && first.record.planId));

// Free allows ONE simultaneous transfer, so an overlapping request is blocked
// by the concurrency gate before the quota gate is even reached.
const overlapping = requestDownload({ user: priya, video: VIDEOS[1], quality: '360p', device, geo });
check('a concurrent second transfer is BLOCKED for a free member',
  overlapping.kind === 'blocked' && overlapping.code === 'concurrency', JSON.stringify(overlapping).slice(0, 120));

// Complete the first transfer, then the daily quota becomes the binding limit.
if (first.kind === 'started') finish(first.record.id);
const second = requestDownload({ user: priya, video: VIDEOS[1], quality: '360p', device, geo });
check('a second free download the same day is BLOCKED', second.kind === 'blocked', second.kind);
check('the block is reported as daily_quota', second.kind === 'blocked' && second.code === 'daily_quota',
  second.kind === 'blocked' ? second.code : second.kind);
check('the block is recorded in the audit log',
  readTable<{ event: string }>(TABLES.DOWNLOAD_AUDIT).some((a) => a.event === 'blocked'));

section('5. Quality caps by plan');
const hdRequest = requestDownload({ user: arjun, video: VIDEOS[0], quality: '1080p', device, geo });
check('Gold may download 1080p', hdRequest.kind === 'started', hdRequest.kind);
const bronzeUser = await makeUser('test-bronze', 'bronze');
const bronzeHd = requestDownload({ user: bronzeUser, video: VIDEOS[0], quality: '1080p', device, geo });
check('a plan whose cap is 720p cannot download 1080p',
  bronzeHd.kind === 'blocked' && bronzeHd.code === 'quality_not_allowed',
  JSON.stringify(bronzeHd).slice(0, 140));

section('6. Tier gating (exclusive content)');
const goldOnly = VIDEOS.find((v) => v.minTier === 3)!;
const freeTriesExclusive = requestDownload({ user: priya, video: goldOnly, quality: '360p', device, geo });
check('a Free member cannot download a Gold-exclusive title',
  freeTriesExclusive.kind === 'blocked' && freeTriesExclusive.code === 'plan_required',
  JSON.stringify(freeTriesExclusive).slice(0, 140));

section('7. Edge cases: duplicate window + failure refunds');
const quota2 = { ...getQuota(arjun.id) };
// Force the gold download to complete instantly, then re-request the same video.
const goldRecord = hdRequest.kind === 'started' ? hdRequest.record : findDownload('missing')!;
const { writeTable } = await import('../src/lib/storage');
const rowsAll = readTable<Record<string, unknown>>(TABLES.DOWNLOADS).map((r) =>
  r.id === goldRecord.id ? { ...r, status: 'completed', completedAt: Date.now(), progress: 100 } : r,
);
writeTable(TABLES.DOWNLOADS, rowsAll);
const usedBefore = quotaSnapshot(arjun.id).usedToday;
const requeue = requestDownload({ user: arjun, video: VIDEOS[0], quality: '1080p', device, geo });
check('re-downloading inside 24h is served from cache', requeue.kind === 'duplicate', requeue.kind);
check('the duplicate does NOT consume quota again', quotaSnapshot(arjun.id).usedToday === usedBefore);

const refundUser = await makeUser('test-refund', 'free');
const freshFree = requestDownload({ user: refundUser, video: VIDEOS[0], quality: '360p', device, geo });
check('a fresh user gets a download slot', freshFree.kind === 'started', freshFree.kind);
const beforeFail = quotaSnapshot('test-refund').usedToday;
simulateFailure(freshFree.kind === 'started' ? freshFree.record.id : '', 'Network error (test)');
check('a failed transfer refunds its quota unit', quotaSnapshot('test-refund').usedToday === beforeFail - 1,
  `before=${beforeFail} after=${quotaSnapshot('test-refund').usedToday}`);

section('8. Subscription expiry blocks downloads');
// A subscription that is still marked `active` but whose expiry has passed -
// exactly the state a nightly sweeper has to catch.
const expired = await makeUser('test-expired', 'silver', 'active', 45);
// Contract: a lapsed PAID period is downgraded to Free (data preserved), and
// the next request is then judged against the Free allowance - one per day.
const expiredAttempt = requestDownload({ user: expired, video: VIDEOS[0], quality: '360p', device, geo });
check('a lapsed paid subscriber falls back to the Free allowance',
  expiredAttempt.kind === 'started' && (expiredAttempt as { record: { planId: string } }).record.planId === 'free',
  JSON.stringify(expiredAttempt).slice(0, 140));
check('the downgrade is preserved as history, not deleted',
  readTable<{ userId: string; status: string }>(TABLES.SUBSCRIPTIONS)
    .some((r) => r.userId === 'test-expired' && r.status === 'expired'));
check('the account now resolves to Free', effectivePlan('test-expired').id === 'free');
const expiredSecond = requestDownload({ user: expired, video: VIDEOS[1], quality: '360p', device, geo });
check('the downgraded account is limited to the Free daily quota',
  expiredSecond.kind === 'blocked' && ['daily_quota', 'concurrency'].includes(expiredSecond.code),
  expiredSecond.kind === 'blocked' ? expiredSecond.code : expiredSecond.kind);

// An in-flight transfer must be aborted the moment the plan lapses.
const inFlightUser = await makeUser('test-inflight', 'silver');
const live = requestDownload({ user: inFlightUser, video: VIDEOS[0], quality: '720p', device, geo });
const { invalidateForExpiry } = await import('../src/services/downloadService');
_wt(TABLES.SUBSCRIPTIONS, readTable<Record<string, unknown>>(TABLES.SUBSCRIPTIONS).map((r) =>
  r.userId === 'test-inflight' ? { ...r, expiryDate: Date.now() - 1000 } : r,
));
const aborted = invalidateForExpiry('test-inflight');
const liveRecord = live.kind === 'started' ? readTable<{ id: string; status: string }>(TABLES.DOWNLOADS).find((d) => d.id === live.record.id) : undefined;
check('an in-flight download is aborted when the plan lapses',
  aborted >= 1 && liveRecord?.status === 'expired_access',
  `aborted=${aborted} status=${liveRecord?.status}`);

section('9. Payments: idempotency, signature verification, activation');
const beforePlan = effectivePlan(priya.id).id;
const orderA = createOrder({ user: priya, planId: 'bronze', cycle: 'monthly' });
const orderB = createOrder({ user: priya, planId: 'bronze', cycle: 'monthly' });
check('double-clicking pay reuses the same order id', orderA.order.orderId === orderB.order.orderId,
  `${orderA.order.orderId} vs ${orderB.order.orderId}`);
check('the reuse is reported to the caller', orderB.reused === true);

const tampered = await processCheckout({
  user: priya, order: orderA.order, method: 'card', cardNumber: '4111111111111111',
  simulateFailure: 'tampered_signature',
});
check('a tampered signature is rejected', tampered.status === 'verification_failed', tampered.status);
check('a tampered signature never activates the plan', effectivePlan(priya.id).id === beforePlan);

const declined = await processCheckout({
  user: priya, order: createOrder({ user: priya, planId: 'silver', cycle: 'monthly' }).order,
  method: 'card', cardNumber: '5104060000000008', simulateFailure: 'declined',
});
check('a declined card records a failed transaction', declined.status === 'failed');
check('a declined card leaves the plan untouched', effectivePlan(priya.id).id === beforePlan);

const good = await processCheckout({ user: priya, order: orderA.order, method: 'card', cardNumber: '4111111111111111' });
check('a valid signature captures the payment', good.status === 'captured', good.status);
check('the subscription is activated after verification', effectivePlan(priya.id).id === 'bronze');
check('an invoice e-mail was sent', inbox(priya.id).some((m) => m.kind === 'invoice'));
check('the transaction keeps payment id, order id and invoice number',
  Boolean(good.transaction?.paymentId && good.transaction?.orderId && good.transaction?.invoiceNumber));
check('the credit/price is recorded in paise', (good.transaction?.amount ?? 0) === PLANS.bronze.monthlyPrice * 100);

const replay = await processCheckout({ user: priya, order: orderA.order, method: 'card', cardNumber: '4111111111111111' });
check('replaying a captured payment is treated as a duplicate', replay.status === 'duplicate', replay.status);
check('the replay does not double-charge or re-activate', replay.activated === false);

section('10. Network drop -> webhook reconciliation');
const dropped = await processCheckout({
  user: priya,
  order: createOrder({ user: priya, planId: 'gold', cycle: 'yearly' }).order,
  method: 'upi',
  simulateFailure: 'network',
});
check('a dropped connection reports an unknown status', dropped.status === 'network_error', dropped.status);
await new Promise((r) => setTimeout(r, 4200));
const report = reconcile(priya.id);
check('the webhook settles the pending payment', report.settled.length === 1, JSON.stringify(report));
check('the plan is activated by the webhook path', effectivePlan(priya.id).id === 'gold');

section('11. Cancellation keeps access until expiry');
const cancelled = cancelSubscription(priya.id, 'test');
check('cancelling flips the status and turns off auto-renew',
  cancelled?.status === 'cancelled' && cancelled?.autoRenew === false);
check('access survives until the paid period ends', effectivePlan(priya.id).id === 'gold');
check('the entitlement check still sees an active period', activeSubscription(priya.id) !== null);

section('12. Cross-device / new-city detection');
simulateLocation(geoOptions().find((g) => g.city === 'Bengaluru')!);
resetFingerprint();
const newContext = attemptLogin(arjun.email, 'Demo@1234');
check('a new city + new device triggers an OTP', newContext.status === 'otp_required', newContext.status);
check('the reasons list names the cause',
  Boolean(newContext.reasons?.some((r) => ['new_city', 'new_device', 'new_ip'].includes(r))),
  (newContext.reasons ?? []).join(','));
check('the new location is recorded in the audit row',
  Boolean(newContext.record.city && newContext.record.ip));

section('13. Quota rollover at the IST midnight boundary');
const quotaBefore = getQuota(priya.id);
const { writeTable: wt } = await import('../src/lib/storage');
wt(TABLES.QUOTAS, readTable<Record<string, unknown>>(TABLES.QUOTAS).map((q) =>
  q.userId === priya.id ? { ...q, dayKey: '1900-01-01', monthKey: '1900-01' } : q,
));
const rolled = getQuota(priya.id);
check('a stale day key resets the daily counter', rolled.usedToday === 0, `before=${quotaBefore.usedToday}`);
check('the day key advances to today in IST', rolled.dayKey === istDayKey(), rolled.dayKey);
check('the rollover is written to the audit trail',
  readTable<{ event: string }>(TABLES.DOWNLOAD_AUDIT).some((a) => a.event === 'quota_reset'));

/* ------------------------------- summary ---------------------------------- */
console.log(`\n${'='.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(58)}\n`);
process.exit(failed === 0 ? 0 : 1);
