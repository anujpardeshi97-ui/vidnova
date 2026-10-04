/* ============================================================================
 * format.ts - small pure formatting helpers shared by every screen.
 * ==========================================================================*/

/** 1536 -> "1.50 KB" (binary units, 1 decimal for KB and above). */
export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/** 3725 -> "1:02:05"; 65 -> "1:05". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Paise (smallest unit) -> "₹499.00". Razorpay always works in paise. */
export function formatMoney(paise: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "3 days ago", "in 27 days". */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [2_592_000_000, 'day'],
    [31_536_000_000, 'month'],
  ];
  if (abs < 60_000) return 'just now';
  let value = 1;
  let unit = 'second';
  for (const [limit, name] of units) {
    if (abs >= limit) {
      value = Math.floor(abs / limit);
      unit = name;
    }
  }
  const plural = value === 1 ? '' : 's';
  return diff < 0 ? `${value} ${unit}${plural} ago` : `in ${value} ${unit}${plural}`;
}

/** "12 Oct 2026" in IST. */
export function formatDate(ts: number): string {
  const d = new Date(ts + 5.5 * 60 * 60 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compact number: 12_400 -> "12.4K". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.round((part / total) * 100), 0, 100);
}

/** Title Case for enum-ish strings ("otp_required" -> "OTP Required"). */
export function humanize(token: string): string {
  return token
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOtp\b/g, 'OTP')
    .replace(/\bIp\b/g, 'IP')
    .replace(/\bId\b/g, 'ID');
}
