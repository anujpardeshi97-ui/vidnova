/* ============================================================================
 * securityService.ts - login, adaptive theming and OTP verification.
 *
 * Implements three product requirements in one flow:
 *   1. TIME-BASED THEMING - login between 05:00 and 12:00 IST => light theme,
 *      any other IST time => dark theme. The result is written to the user
 *      profile so it survives future sessions and other devices.
 *   2. FULL LOGIN AUDIT - IP, browser, OS, device type/model, timestamp, city,
 *      state, country for every attempt, successful or not.
 *   3. STEP-UP 2FA - a new browser, device, IP, city or state demands an OTP
 *      over e-mail before access is granted; success trusts the device for a
 *      configurable window so the user is not challenged every time.
 * ==========================================================================*/
import type {
  LoginRecord,
  LoginStatus,
  OtpChannel,
  PendingOtp,
  TrustedDevice,
  User,
} from '../types';
import { TABLES, readTable, uid, upsert, writeTable } from '../lib/storage';
import { collectDeviceInfo } from '../lib/device';
import { resolveGeoLocation } from '../lib/geo';
import {
  evaluateLogin,
  generateOtp,
  hashPassword,
  maskEmail,
  maskPhone,
  trustDevice,
  verifyPassword,
} from '../lib/security';
import { istDayKey, istDateTime, istHour, istMonthKey, themeForIstLogin } from '../lib/ist';
import { sendOtpMail, sendTrustedDeviceMail } from './mailService';
import { buildSubscription, nextInvoiceNumber } from './db';
import { findById } from '../lib/storage';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/* ------------------------------- Login flow ------------------------------- */

export interface LoginAttemptResult {
  status: LoginStatus;
  user?: User;
  /** Present when status === 'otp_required' */
  otp?: { id: string; channel: OtpChannel; destination: string; expiresAt: number; code: string };
  /** Theme decided by the IST rule for this login */
  theme?: 'light' | 'dark';
  reasons?: string[];
  message: string;
  record: LoginRecord;
}

/**
 * Authenticate with e-mail + password.
 *
 * On success the caller either receives a session (trusted device) or an OTP
 * challenge (new context). Either way a LoginRecord is written first - the
 * audit entry exists even for failed attempts.
 */
export function attemptLogin(email: string, password: string): LoginAttemptResult {
  const device = collectDeviceInfo();
  const geo = resolveGeoLocation();
  const hour = istHour();
  const theme = themeForIstLogin();
  const users = readTable<User>(TABLES.USERS);
  const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());

  const base = {
    userId: user?.id ?? 'anonymous',
    ip: geo.ip,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    deviceModel: device.model,
    fingerprint: device.fingerprint,
    themeApplied: theme,
    loggedInAtHourIst: hour,
  };

  // Unknown e-mail or wrong password -> single generic audit row (no user
  // enumeration: the message never reveals which of the two was wrong).
  if (!user || !verifyPassword(password, user.password)) {
    const record = writeLoginRecord({
      ...base,
      status: 'blocked',
      reasons: [user ? 'bad_password' : 'unknown_account'],
    });
    return {
      status: 'blocked',
      record,
      theme,
      message: 'Incorrect e-mail or password. Please try again.',
    };
  }

  const evaluation = evaluateLogin(user, device, geo);

  if (!evaluation.requiresOtp) {
    const record = writeLoginRecord({
      ...base,
      status: 'success',
      reasons: ['trusted_device'],
    });
    return {
      status: 'success',
      user,
      record,
      theme,
      reasons: [],
      message: 'Welcome back - recognised device, no verification needed.',
    };
  }

  // New context -> e-mail a one-time code and write exactly ONE audit row.
  const otp = issueOtp(user, device, geo, evaluation.reasons, 'email');
  const challengeRecord = writeLoginRecord({
    ...base,
    status: 'otp_required',
    reasons: evaluation.reasons,
    otpChannel: 'email',
  });

  return {
    status: 'otp_required',
    user,
    record: challengeRecord,
    otp: {
      id: otp.id,
      channel: 'email',
      destination: maskEmail(user.email),
      expiresAt: otp.expiresAt,
      code: otp.code, // surfaced in the UI because there is no real inbox
    },
    theme,
    reasons: evaluation.reasons,
    message: 'New sign-in context detected. Enter the 6-digit code we e-mailed you.',
  };
}

/** Create + persist a pending OTP and queue the delivery mail. */
export function issueOtp(
  user: User,
  device: ReturnType<typeof collectDeviceInfo>,
  geo: ReturnType<typeof resolveGeoLocation>,
  reasons: string[],
  channel: OtpChannel,
): PendingOtp {
  const code = generateOtp(6);
  const otp: PendingOtp = {
    id: uid('otp'),
    userId: user.id,
    code,
    channel,
    createdAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MINUTES * 60_000,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    consumed: false,
    context: { device, geo, reasons },
  };
  upsert(TABLES.OTP_CODES, otp);

  if (channel === 'email') {
    sendOtpMail({
      user,
      code,
      context: {
        browser: device.browser,
        os: device.os,
        deviceType: device.type,
        ip: geo.ip,
        location: geo.label,
      },
      expiresInMinutes: OTP_TTL_MINUTES,
      reasons,
    });
  } else {
    // SMS channel: recorded in the mailbox as an audit note only.
    console.info(`[sms] OTP ${code} sent to ${maskPhone(user.phone)}`);
  }
  return otp;
}

export interface OtpVerifyResult {
  ok: boolean;
  status: LoginStatus;
  message: string;
  user?: User;
  theme?: 'light' | 'dark';
  record?: LoginRecord;
  attemptsLeft: number;
}

/** Verify a code. Enforces expiry and a hard attempt cap. */
export function verifyOtp(otpId: string, code: string): OtpVerifyResult {
  const rows = readTable<PendingOtp & { id: string }>(TABLES.OTP_CODES);
  const otp = rows.find((o) => o.id === otpId);
  const device = collectDeviceInfo();
  const geo = resolveGeoLocation();
  const theme = themeForIstLogin();

  if (!otp) {
    return { ok: false, status: 'otp_failed', message: 'This verification request has expired. Please sign in again.', attemptsLeft: 0 };
  }

  const user = findById<User>(TABLES.USERS, otp.userId)!;
  const attemptsLeft = Math.max(0, otp.maxAttempts - otp.attempts);

  if (otp.consumed) {
    return { ok: false, status: 'otp_failed', message: 'This code was already used.', attemptsLeft };
  }
  if (Date.now() > otp.expiresAt) {
    return { ok: false, status: 'otp_failed', message: 'The code has expired. Request a new one.', attemptsLeft };
  }
  if (otp.attempts >= otp.maxAttempts) {
    writeLoginRecord({
      userId: user.id,
      ...geoFields(device, geo, theme),
      status: 'blocked',
      reasons: ['otp_attempt_limit'],
    });
    return { ok: false, status: 'blocked', message: 'Too many incorrect attempts. Sign-in blocked - request a new code.', attemptsLeft: 0 };
  }

  if (otp.code !== code.trim()) {
    const updated = { ...otp, attempts: otp.attempts + 1 };
    upsert(TABLES.OTP_CODES, updated);
    writeLoginRecord({
      userId: user.id,
      ...geoFields(device, geo, theme),
      status: 'otp_failed',
      reasons: ['incorrect_otp', ...otp.context.reasons],
      otpChannel: otp.channel,
    });
    return {
      ok: false,
      status: 'otp_failed',
      message: `Incorrect code. ${Math.max(0, otp.maxAttempts - updated.attempts)} attempt(s) remaining.`,
      attemptsLeft: Math.max(0, otp.maxAttempts - updated.attempts),
    };
  }

  // Success: burn the code, trust the device, audit the verification.
  upsert(TABLES.OTP_CODES, { ...otp, consumed: true });

  const existingTrust = user.trustedDevices.find((d) => d.fingerprint === device.fingerprint);
  const trusted: TrustedDevice = trustDevice(device, geo, user.trustDurationDays, existingTrust);
  const updatedTrusted = existingTrust
    ? user.trustedDevices.map((d) => (d.fingerprint === trusted.fingerprint ? trusted : d))
    : [...user.trustedDevices, trusted];

  // Apply the IST-derived theme unless the user explicitly pinned one.
  const appliedTheme = user.themeLockedByUser ? user.theme : theme;
  const updatedUser: User = {
    ...user,
    trustedDevices: updatedTrusted,
    theme: appliedTheme,
    planId: user.planId,
  };
  upsert(TABLES.USERS, updatedUser);

  writeLoginRecord({
    userId: user.id,
    ...geoFields(device, geo, theme),
    status: 'success',
    reasons: ['otp_verified', ...otp.context.reasons],
    otpChannel: otp.channel,
  });

  sendTrustedDeviceMail({
    user: updatedUser,
    browser: device.browser,
    location: geo.label,
    ip: geo.ip,
    trustDays: user.trustDurationDays,
  });

  return {
    ok: true,
    status: 'success',
    message: 'Verified. This device is now trusted.',
    user: updatedUser,
    theme: appliedTheme,
    attemptsLeft: 0,
  };
}

function geoFields(
  device: ReturnType<typeof collectDeviceInfo>,
  geo: ReturnType<typeof resolveGeoLocation>,
  theme: 'light' | 'dark',
) {
  return {
    ip: geo.ip,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    deviceModel: device.model,
    fingerprint: device.fingerprint,
    themeApplied: theme,
    loggedInAtHourIst: istHour(),
  };
}

/* ------------------------------ Audit storage ----------------------------- */

function writeLoginRecord(input: Omit<LoginRecord, 'id' | 'timestamp'>): LoginRecord {
  const record: LoginRecord = { id: uid('log'), timestamp: Date.now(), ...input };
  const rows = readTable<LoginRecord>(TABLES.LOGIN_RECORDS);
  rows.push(record);
  writeTable(TABLES.LOGIN_RECORDS, rows.slice(-400));
  return record;
}

export function loginHistory(userId: string, limit = 50): LoginRecord[] {
  return readTable<LoginRecord>(TABLES.LOGIN_RECORDS)
    .filter((r) => r.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function securitySummary(userId: string) {
  const rows = readTable<LoginRecord>(TABLES.LOGIN_RECORDS).filter((r) => r.userId === userId);
  const today = istDayKey();
  return {
    total: rows.length,
    successful: rows.filter((r) => r.status === 'success').length,
    otpChallenges: rows.filter((r) => r.status === 'otp_required').length,
    failedOtps: rows.filter((r) => r.status === 'otp_failed').length,
    blocked: rows.filter((r) => r.status === 'blocked').length,
    todayCount: rows.filter((r) => istDayKey(new Date(r.timestamp)) === today).length,
    lastLogin: rows.filter((r) => r.status === 'success').sort((a, b) => b.timestamp - a.timestamp)[0] ?? null,
  };
}

/* ---------------------------- Trusted devices ----------------------------- */

export function trustedDevices(userId: string): TrustedDevice[] {
  const user = findById<User>(TABLES.USERS, userId);
  return (user?.trustedDevices ?? []).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function revokeDevice(userId: string, fingerprint: string): void {
  const user = findById<User>(TABLES.USERS, userId);
  if (!user) return;
  upsert(TABLES.USERS, {
    ...user,
    trustedDevices: user.trustedDevices.filter((d) => d.fingerprint !== fingerprint),
  });
}

/** Extend (or shorten) the trust window of one device. */
export function setTrustWindow(userId: string, fingerprint: string, days: number): void {
  const user = findById<User>(TABLES.USERS, userId);
  if (!user) return;
  upsert(TABLES.USERS, {
    ...user,
    trustDurationDays: days,
    trustedDevices: user.trustedDevices.map((d) =>
      d.fingerprint === fingerprint ? { ...d, trustedUntil: Date.now() + days * 86_400_000 } : d,
    ),
  });
}

export function isDeviceTrusted(userId: string, fingerprint: string): boolean {
  const user = findById<User>(TABLES.USERS, userId);
  const match = user?.trustedDevices.find((d) => d.fingerprint === fingerprint);
  return Boolean(match && match.trustedUntil > Date.now());
}

/* ------------------------------ Account edits ----------------------------- */

export function updateProfile(userId: string, patchData: Partial<User>): User | null {
  const user = findById<User>(TABLES.USERS, userId);
  if (!user) return null;
  const next = { ...user, ...patchData };
  upsert(TABLES.USERS, next);
  return next;
}

export function changePassword(userId: string, current: string, next: string): { ok: boolean; message: string } {
  const user = findById<User>(TABLES.USERS, userId);
  if (!user) return { ok: false, message: 'Account not found.' };
  if (!verifyPassword(current, user.password)) return { ok: false, message: 'Current password is incorrect.' };
  if (next.length < 8) return { ok: false, message: 'New password must be at least 8 characters.' };
  upsert(TABLES.USERS, { ...user, password: hashPassword(next) });
  return { ok: true, message: 'Password updated. All new sign-ins will use it.' };
}

export function registerUser(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): { ok: boolean; message: string; user?: User } {
  const users = readTable<User>(TABLES.USERS);
  if (users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
    return { ok: false, message: 'An account with this e-mail already exists.' };
  }
  const user: User = {
    id: uid('usr'),
    name: input.name,
    email: input.email,
    phone: input.phone,
    password: hashPassword(input.password),
    avatarColor: ['#f43f5e', '#6366f1', '#14b8a6', '#f59e0b', '#8b5cf6'][users.length % 5],
    createdAt: Date.now(),
    theme: themeForIstLogin(),
    themeLockedByUser: false,
    autoThemeOnLogin: true,
    planId: 'free',
    trustedDevices: [],
    trustDurationDays: 30,
  };
  upsert(TABLES.USERS, user);

  // Every account needs a Free subscription row + a quota bucket, otherwise the
  // download engine would refuse it with "no active subscription".
  const freeSubscription = buildSubscription({
    userId: user.id,
    planId: 'free',
    cycle: 'monthly',
    startDate: Date.now(),
    action: 'new',
    pricePaid: 0,
    invoiceNumber: nextInvoiceNumber(),
    status: 'active',
  });
  upsert(TABLES.SUBSCRIPTIONS, freeSubscription);
  upsert(TABLES.QUOTAS, {
    id: uid('qt'),
    userId: user.id,
    dayKey: istDayKey(),
    monthKey: istMonthKey(),
    usedToday: 0,
    usedThisMonth: 0,
    lastResetAt: Date.now(),
  });

  return { ok: true, message: `Account created. You are on the Free plan.`, user };
}

export { istDateTime };
