/* ============================================================================
 * security.ts - password hashing, OTP generation, trust windows.
 *
 * NOTE ON SCOPE: this is a front-end demo, so "hashing" here is a fast,
 * non-cryptographic digest whose only job is to avoid storing plaintext in
 * localStorage. A production system must hash with bcrypt/argon2 on a server.
 * The function names mirror what the server API would expose.
 * ==========================================================================*/
import type { DeviceInfo, GeoLocation, TrustedDevice, User } from '../types';
import { getFingerprint } from './device';
import { addDays } from './ist';

const SALT = 'nexstream::v1';

/**
 * djb2 + FNV-1a style digest. Deterministic, fast, NOT secure - see the note
 * above. It is used so that a screenshot of localStorage does not reveal the
 * demo password in clear text.
 */
export function digest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 * 33) ^ c;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function hashPassword(password: string): string {
  return digest(`${SALT}|${password}`);
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/** Cryptographically strong 6-digit OTP (falls back to Math.random). */
export function generateOtp(length = 6): string {
  const digits = '0123456789';
  let out = '';
  const cryptoObj = window.crypto;
  if (cryptoObj?.getRandomValues) {
    const buffer = new Uint32Array(length);
    cryptoObj.getRandomValues(buffer);
    for (let i = 0; i < length; i++) out += digits[buffer[i] % 10];
  } else {
    for (let i = 0; i < length; i++) out += digits[Math.floor(Math.random() * 10)];
  }
  return out;
}

/**
 * Decide whether a login must be challenged with an OTP.
 * A challenge is raised when ANY of the following is new for this account:
 *   - browser / fingerprint (new browser or a cleared-storage re-install)
 *   - device type + model
 *   - IP address
 *   - city or state/region
 * Already-trusted devices with an unexpired trust window skip the challenge.
 */
export interface LoginEvaluation {
  requiresOtp: boolean;
  reasons: string[];
  trusted: boolean;
  trustedUntil?: number;
}

export function evaluateLogin(
  user: User,
  device: DeviceInfo,
  geo: GeoLocation,
  now = Date.now(),
): LoginEvaluation {
  const match = user.trustedDevices?.find((d) => d.fingerprint === device.fingerprint);
  if (match && match.trustedUntil > now) {
    // Trusted device: still refresh the "last seen" metadata, but no OTP.
    const ipChanged = match.ip !== geo.ip;
    return {
      requiresOtp: false,
      reasons: ipChanged ? ['ip_rotated_but_trusted'] : [],
      trusted: true,
      trustedUntil: match.trustedUntil,
    };
  }

  const reasons: string[] = [];
  if (!match) reasons.push('new_device');
  else reasons.push('trust_expired');

  const seenBrowsers = new Set((user.trustedDevices ?? []).map((d) => d.browser));
  if (!seenBrowsers.has(device.browser)) reasons.push('new_browser');

  const seenIps = new Set((user.trustedDevices ?? []).map((d) => d.ip));
  if (!seenIps.has(geo.ip)) reasons.push('new_ip');

  const seenCities = new Set((user.trustedDevices ?? []).map((d) => d.location.split(',')[0].trim()));
  if (!seenCities.has(geo.city)) reasons.push('new_city');

  const seenStates = new Set(
    (user.trustedDevices ?? []).map((d) => d.location.split(',')[1]?.trim() ?? ''),
  );
  if (!seenStates.has(geo.region)) reasons.push('new_state');

  return {
    requiresOtp: reasons.length > 0,
    reasons,
    trusted: false,
  };
}

/** Turn a successful OTP verification into (or refresh) a trusted device row. */
export function trustDevice(
  device: DeviceInfo,
  geo: GeoLocation,
  trustDays: number,
  existing?: TrustedDevice,
): TrustedDevice {
  const now = Date.now();
  return {
    fingerprint: device.fingerprint,
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    model: device.model,
    ip: geo.ip,
    location: geo.label,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    trustedUntil: addDays(now, trustDays),
  };
}

/** Mask an e-mail for display: "priya.r@gmail.com" -> "pr***a@gmail.com". */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.slice(0, 2)}***${name.slice(-2)}@${domain}`;
}

/** Mask a phone number: "+91 98765 43210" -> "+91 ***** 43210". */
export function maskPhone(phone: string): string {
  return phone.replace(/(\d{2})(\d+)(\d{4})/, (_m, a, b, c) => `${a}${'*'.repeat(b.length)}${c}`);
}

export function currentFingerprint(): string {
  return getFingerprint();
}
