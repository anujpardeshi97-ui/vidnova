/* ============================================================================
 * ist.ts - India Standard Time helpers.
 *
 * The whole product is specified in IST: the auto-theming window is
 * 05:00-12:00 IST and download quotas reset at 00:00 IST. Because the browser
 * may run in any timezone we never use the local clock for business rules -
 * we convert the absolute instant into IST and read the fields from there.
 * ==========================================================================*/

/** IST is UTC+05:30 with no daylight saving, so a fixed offset is exact. */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

/** Shift a timestamp so that its *UTC* getters return IST wall-clock values. */
function toIstShifted(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** Current IST hour (0-23). */
export function istHour(date: Date = new Date()): number {
  return toIstShifted(date).getUTCHours();
}

/** Current IST minute (0-59). */
export function istMinute(date: Date = new Date()): number {
  return toIstShifted(date).getUTCMinutes();
}

/** Decimal IST time, e.g. 9.5 for 09:30 - handy for range comparisons. */
export function istDecimalTime(date: Date = new Date()): number {
  return istHour(date) + istMinute(date) / 60;
}

/** "14:07:33" in IST regardless of the machine timezone. */
export function istClock(date: Date = new Date()): string {
  const d = toIstShifted(date);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** "03 Oct 2026, 14:07 IST" */
export function istDateTime(ts: number | Date): string {
  const d = toIstShifted(ts instanceof Date ? ts : new Date(ts));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} IST`;
}

/** IST calendar day key "2026-10-03" - the key a daily quota resets on. */
export function istDayKey(date: Date = new Date()): string {
  const d = toIstShifted(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** IST month key "2026-10" - the key a monthly quota resets on. */
export function istMonthKey(date: Date = new Date()): string {
  const d = toIstShifted(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Milliseconds remaining until the next 00:00 IST (quota reset countdown). */
export function msUntilNextIstMidnight(from: Date = new Date()): number {
  const shifted = toIstShifted(from);
  const next = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  return next - shifted.getTime();
}

/** "6h 12m 40s" countdown string for the quota reset timer. */
export function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Add N days to an instant, preserving the IST wall clock across DST-free IST. */
export function addDays(ts: number, days: number): number {
  return ts + days * 24 * 60 * 60 * 1000;
}

/** Add N calendar months, clamping the day-of-month (31 Jan + 1m -> 28 Feb). */
export function addMonths(ts: number, months: number): number {
  const d = toIstShifted(new Date(ts));
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.getTime() - IST_OFFSET_MS;
}

/**
 * THE AUTO-THEME RULE.
 * Logins between 05:00 (inclusive) and 12:00 (exclusive) IST => light theme.
 * Every other IST time => dark theme.
 */
export function themeForIstLogin(date: Date = new Date()): 'light' | 'dark' {
  const hour = istHour(date);
  return hour >= 5 && hour < 12 ? 'light' : 'dark';
}

/** Human label for the auto-theme window, used in the UI + e-mails. */
export function istWindowLabel(): string {
  return '05:00 - 12:00 IST';
}
