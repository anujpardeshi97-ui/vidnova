/* ============================================================================
 * db.ts - database bootstrap: schema seed, session persistence, migration.
 *
 * Called once from main.tsx before React renders. Responsibilities:
 *   1. create the demo accounts on first run (idempotent)
 *   2. keep the "current session" pointer (who is logged in + their theme)
 *   3. run the housekeeping sweeps (expired subscriptions, stale quotas)
 * ==========================================================================*/
import type { PlanId, Subscription, User } from '../types';
import { TABLES, findById, readTable, uid, upsert, writeTable } from '../lib/storage';
import { hashPassword } from '../lib/security';
import { addDays, addMonths, istDayKey, istMonthKey } from '../lib/ist';
import { getPlan } from '../data/plans';

const SESSION_KEY = 'nexstream:session';

export interface Session {
  userId: string;
  loginAt: number;
  theme: 'light' | 'dark';
  deviceFingerprint: string;
  ip: string;
  location: string;
}

/* ------------------------------- Session --------------------------------- */

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function currentUserId(): string | null {
  return getSession()?.userId ?? null;
}

export function currentUser(): User | null {
  const id = currentUserId();
  return id ? (findById<User>(TABLES.USERS, id) ?? null) : null;
}

/* -------------------------------- Seeding -------------------------------- */

interface SeedUser {
  name: string;
  email: string;
  phone: string;
  password: string;
  planId: PlanId;
  /** Days the paid plan has already been running; negative = starts today. */
  startedDaysAgo: number;
  autoThemeOnLogin: boolean;
  theme: 'light' | 'dark';
  avatarColor: string;
}

export const DEMO_ACCOUNTS: SeedUser[] = [
  {
    name: 'Priya Sharma',
    email: 'priya@nexstream.test',
    phone: '+919876543210',
    password: 'Demo@1234',
    planId: 'free',
    startedDaysAgo: 0,
    autoThemeOnLogin: true,
    theme: 'dark',
    avatarColor: '#f43f5e',
  },
  {
    name: 'Arjun Mehta',
    email: 'arjun@nexstream.test',
    phone: '+919812345678',
    password: 'Demo@1234',
    planId: 'gold',
    startedDaysAgo: 12,
    autoThemeOnLogin: false,
    theme: 'dark',
    avatarColor: '#6366f1',
  },
];

/** Create a subscription row for a user (used by seed + by the paywall flow). */
export function buildSubscription(params: {
  userId: string;
  planId: PlanId;
  cycle: 'monthly' | 'quarterly' | 'yearly';
  startDate: number;
  action: Subscription['action'];
  pricePaid: number;
  invoiceNumber: string;
  previousPlanId?: PlanId;
  status?: Subscription['status'];
  creditCarried?: number;
}): Subscription {
  const months = params.cycle === 'monthly' ? 1 : params.cycle === 'quarterly' ? 3 : 12;
  // The Free plan has no end date: giving the row a far-future expiry keeps the
  // "is this subscription active?" check simple and honest.
  const expiryDate =
    params.planId === 'free' ? addDays(params.startDate, 3650) : addMonths(params.startDate, months);
  return {
    id: uid('sub'),
    userId: params.userId,
    planId: params.planId,
    status: params.status ?? 'active',
    cycle: params.cycle,
    startDate: params.startDate,
    expiryDate,
    autoRenew: params.planId !== 'free',
    creditCarried: params.creditCarried ?? 0,
    createdAt: Date.now(),
    action: params.action,
    previousPlanId: params.previousPlanId,
    pricePaid: params.pricePaid,
    currency: 'INR',
    invoiceNumber: params.invoiceNumber,
  };
}

/** Next invoice number: NS-2026-000123 (monotonic, never reused). */
export function nextInvoiceNumber(): string {
  const all = readTable<Subscription>(TABLES.SUBSCRIPTIONS);
  const year = new Date().getFullYear();
  const seq = String(all.length + 1001).padStart(6, '0');
  return `NS-${year}-${seq}`;
}

/**
 * Idempotent seed. Runs on every boot but only writes what is missing, so
 * user-created data (downloads, upgrades, cancellations) is never clobbered.
 */
export function seedDatabase(): void {
  const users = readTable<User>(TABLES.USERS);
  if (users.length > 0) return;

  const created: User[] = DEMO_ACCOUNTS.map((seed, index) => ({
    id: uid('usr'),
    name: seed.name,
    email: seed.email,
    phone: seed.phone,
    password: hashPassword(seed.password),
    avatarColor: seed.avatarColor,
    createdAt: Date.now() - (index + 1) * 30 * 86_400_000,
    theme: seed.theme,
    themeLockedByUser: !seed.autoThemeOnLogin,
    autoThemeOnLogin: seed.autoThemeOnLogin,
    planId: seed.planId,
    trustedDevices: [],
    trustDurationDays: 30,
  }));
  writeTable(TABLES.USERS, created);

  // Historical subscription rows so the billing screen is not empty on boot.
  const subscriptions: Subscription[] = [];
  created.forEach((user, index) => {
    const seed = DEMO_ACCOUNTS[index];
    if (seed.planId === 'free') {
      subscriptions.push(
        buildSubscription({
          userId: user.id,
          planId: 'free',
          cycle: 'monthly',
          startDate: Date.now() - 60 * 86_400_000,
          action: 'new',
          pricePaid: 0,
          invoiceNumber: nextInvoiceNumber(),
        }),
      );
      return;
    }
    // One expired earlier cycle + the currently running cycle.
    const firstStart = Date.now() - seed.startedDaysAgo * 86_400_000;
    subscriptions.push(
      buildSubscription({
        userId: user.id,
        planId: seed.planId,
        cycle: 'monthly',
        startDate: addMonths(firstStart, -1),
        action: 'new',
        pricePaid: getPlan(seed.planId).monthlyPrice * 100,
        invoiceNumber: nextInvoiceNumber(),
        status: 'expired',
      }),
      buildSubscription({
        userId: user.id,
        planId: seed.planId,
        cycle: 'monthly',
        startDate: firstStart,
        action: 'renew',
        pricePaid: getPlan(seed.planId).monthlyPrice * 100,
        invoiceNumber: nextInvoiceNumber(),
      }),
    );
  });
  writeTable(TABLES.SUBSCRIPTIONS, subscriptions);

  // Seed a quota row per user for the current IST day/month.
  writeTable(
    TABLES.QUOTAS,
    created.map((u) => ({
      id: uid('qt'),
      userId: u.id,
      dayKey: istDayKey(),
      monthKey: istMonthKey(),
      usedToday: 0,
      usedThisMonth: 0,
      lastResetAt: Date.now(),
    })),
  );
}

/** Wipe everything and re-seed (used by Settings -> Reset demo data). */
export function hardReset(): void {
  localStorage.clear();
  sessionStorage.clear();
  seedDatabase();
}

/** Days until a timestamp; negative when already past. */
export function daysUntil(ts: number): number {
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

export { addDays };
