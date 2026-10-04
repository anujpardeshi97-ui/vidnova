/* ============================================================================
 * device.ts - User-Agent intelligence.
 *
 * Every login and every download records the browser, OS, device type and
 * (where the UA exposes it) the hardware model. This is the auditing layer
 * required by the spec, so the parsing lives in one well-tested place.
 * ==========================================================================*/
import type { DeviceInfo, DeviceType } from '../types';

const FINGERPRINT_KEY = 'nexstream:device:fingerprint';

/**
 * A stable identifier for "this browser install". It is not a hardware serial
 * number - browsers deliberately do not expose one - but it is exactly what
 * real products use: a random token stored in localStorage that survives
 * reloads and disappears with site data. Combined with UA attributes it is
 * strong enough to tell "same device" from "new device".
 */
export function getFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = `fp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

/** Rotate the stored fingerprint (used to demo the "new device" OTP flow). */
export function resetFingerprint(): string {
  localStorage.removeItem(FINGERPRINT_KEY);
  return getFingerprint();
}

interface BrowserRule {
  name: string;
  test: RegExp;
  /** Capture index of the version number inside `test`. */
  versionGroup?: number;
}

/**
 * Order matters: Edge and Opera both contain "Chrome", Chrome contains
 * "Safari", so the most specific signatures must be tested first.
 */
const BROWSER_RULES: BrowserRule[] = [
  { name: 'Edge', test: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: 'Opera', test: /(?:OPR|OPiOS)\/([\d.]+)/ },
  { name: 'Samsung Internet', test: /SamsungBrowser\/([\d.]+)/ },
  { name: 'Brave', test: /Brave\/([\d.]+)/ },
  { name: 'Firefox', test: /(?:Firefox|FxiOS)\/([\d.]+)/ },
  { name: 'Chrome', test: /(?:Chrome|CriOS)\/([\d.]+)/ },
  { name: 'Safari', test: /Version\/([\d.]+).*Safari/ },
];

/** "Chrome 128.0.0.0" */
export function parseBrowser(ua: string): string {
  for (const rule of BROWSER_RULES) {
    const match = ua.match(rule.test);
    if (match) return `${rule.name} ${match[1] ?? ''}`.trim();
  }
  return 'Unknown Browser';
}

/** "Windows 11", "Android 14", "iOS 17.5", "macOS 14.6", "Linux". */
export function parseOS(ua: string): string {
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
  if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
  if (/Android ([\d.]+)/.test(ua)) return `Android ${ua.match(/Android ([\d.]+)/)![1]}`;
  if (/(?:iPhone|iPad|iPod).*OS ([\d_]+)/.test(ua)) {
    return `iOS ${ua.match(/OS ([\d_]+)/)![1].replace(/_/g, '.')}`;
  }
  if (/Mac OS X ([\d_.]+)/.test(ua)) return `macOS ${ua.match(/Mac OS X ([\d_.]+)/)![1].replace(/_/g, '.')}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

/** Desktop | Tablet | Mobile, in that evaluation order. */
export function parseDeviceType(ua: string, touchPoints = 0): DeviceType {
  if (/iPad|Tablet|PlayBook|Silk|Nexus 7|Nexus 10/.test(ua)) return 'Tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'Tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/.test(ua)) return 'Mobile';
  if (touchPoints > 1 && /Macintosh/.test(ua)) return 'Tablet'; // iPadOS 13+ masquerades as Mac
  return 'Desktop';
}

/** Best-effort model detection ("SM-S918B", "Pixel 7", "iPhone" ...). */
export function parseModel(ua: string, deviceType: DeviceType): string {
  if (deviceType === 'Desktop') return 'Desktop / Laptop';
  const samsung = ua.match(/SM-[A-Z0-9]+/);
  if (samsung) return `Samsung ${samsung[0]}`;
  const pixel = ua.match(/Pixel \d+[A-Za-z ]*/);
  if (pixel) return pixel[0].trim();
  if (/iPhone/.test(ua)) return 'Apple iPhone';
  if (/iPad/.test(ua)) return 'Apple iPad';
  const oneplus = ua.match(/(?:ONEPLUS|OnePlus) [A-Z0-9]+/);
  if (oneplus) return oneplus[0];
  const redmi = ua.match(/(?:Redmi|POCO|Mi) [A-Za-z0-9 ]{1,12}/);
  if (redmi) return redmi[0].trim();
  return deviceType === 'Tablet' ? 'Android Tablet' : 'Android Phone';
}

/** Assemble the full device profile captured for audit purposes. */
export function collectDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  const type = parseDeviceType(ua, touchPoints);
  return {
    type,
    os: parseOS(ua),
    browser: parseBrowser(ua),
    model: parseModel(ua, type),
    fingerprint: getFingerprint(),
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}x`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    userAgent: ua,
  };
}

/** Short "Chrome 128 - Windows 10/11" label used in lists. */
export function deviceLabel(device: Pick<DeviceInfo, 'browser' | 'os'>): string {
  return `${device.browser.split(' ')[0]} - ${device.os}`;
}
