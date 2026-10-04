/* ============================================================================
 * subscriptionService.ts - plans, entitlements, lifecycle.
 *
 * This module is the single authority for "what is this user allowed to do?".
 * The UI never reads plan fields directly; it asks these functions. That keeps
 * the paywall logic consistent across streaming, downloads, calls and themes.
 * ==========================================================================*/
import type {
  Plan,
  PlanId,
  PlanTier,
  Subscription,
  SubscriptionAction,
  SubscriptionStatus,
  Transaction,
  User,
  Video,
} from '../types';
import { TABLES, findById, readTable, uid, upsert, writeTable } from '../lib/storage';
import { addMonths, istDateTime } from '../lib/ist';
import { CYCLE_DISCOUNT, PLAN_ORDER, getPlan } from '../data/plans';
import { buildSubscription, nextInvoiceNumber } from './db';

/* --------------------------- Reading entitlements ------------------------- */

/** All subscription rows for a user, newest first. */
export function subscriptionHistory(userId: string): Subscription[] {
  return readTable<Subscription>(TABLES.SUBSCRIPTIONS)
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.startDate - a.startDate);
}

/** The row that currently governs access (active and not past expiry). */
export function activeSubscription(userId: string): Subscription | null {
  const now = Date.now();
  return (
    subscriptionHistory(userId).find(
      (s) => (s.status === 'active' || s.status === 'cancelled') && s.expiryDate > now,
    ) ?? null
  );
}

/**
 * Sweeper: any subscription whose expiry has passed is flipped to `expired`,
 * the user is downgraded to Free (data and watch history preserved) and a
 * notification e-mail is queued by the caller.
 *
 * Returns the freshly created Free subscription when a downgrade happened.
 */
export function reconcileExpiry(userId: string): { downgraded: boolean; subscription: Subscription | null } {
  const now = Date.now();
  const rows = subscriptionHistory(userId);
  let downgraded = false;

  rows
    .filter((s) => s.status === 'active' && s.expiryDate <= now)
    .forEach((s) => {
      s.status = 'expired';
      upsert(TABLES.SUBSCRIPTIONS, s);
      downgraded = true;
    });

  const stillActive = activeSubscription(userId);
  if (stillActive) {
    const user = findById<User>(TABLES.USERS, userId);
    if (user && user.planId !== stillActive.planId) {
      upsert(TABLES.USERS, { ...user, planId: stillActive.planId });
    }
    return { downgraded, subscription: stillActive };
  }

  // No valid subscription -> ensure a Free baseline exists.
  const user = findById<User>(TABLES.USERS, userId);
  const existingFree = rows.find((s) => s.planId === 'free' && s.expiryDate > now);
  if (existingFree) {
    if (user && user.planId !== 'free') upsert(TABLES.USERS, { ...user, planId: 'free' });
    return { downgraded, subscription: existingFree };
  }

  const free = buildSubscription({
    userId,
    planId: 'free',
    cycle: 'monthly',
    startDate: now,
    action: downgraded ? 'downgrade' : 'new',
    pricePaid: 0,
    invoiceNumber: nextInvoiceNumber(),
    status: 'active',
  });
  upsert(TABLES.SUBSCRIPTIONS, free);
  if (user) upsert(TABLES.USERS, { ...user, planId: 'free' });
  return { downgraded, subscription: free };
}

/** Effective plan object for a user (always resolves, defaults to Free). */
export function effectivePlan(userId: string): Plan {
  const sub = activeSubscription(userId);
  return getPlan(sub?.planId ?? 'free');
}

/* ----------------------------- Access control ----------------------------- */

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  requiredTier?: PlanTier;
  currentTier: PlanTier;
}

/** Can this user stream this video at all? */
export function canStream(userId: string, video: Video): AccessDecision {
  const plan = effectivePlan(userId);
  if (video.access === 'public') return { allowed: true, currentTier: plan.tier };

  if (plan.tier < video.minTier) {
    const required = getPlan(PLAN_ORDER[video.minTier]);
    return {
      allowed: false,
      currentTier: plan.tier,
      requiredTier: video.minTier,
      reason: `"${video.title}" is a ${video.access === 'exclusive' ? 'Gold-exclusive' : 'premium'} title. Your ${plan.name} plan does not include it - upgrade to ${required.name} or above.`,
    };
  }
  return { allowed: true, currentTier: plan.tier };
}

/** Highest quality this plan may stream. */
export function qualityCap(userId: string): number {
  return effectivePlan(userId).maxStreamQuality;
}

/** Downloads are only for paying members with the offline feature. */
export function canDownloadAtAll(userId: string): AccessDecision {
  const plan = effectivePlan(userId);
  const sub = activeSubscription(userId);
  if (!sub) {
    return { allowed: false, currentTier: plan.tier, reason: 'No active subscription found. Please sign in again.' };
  }
  if (sub.expiryDate <= Date.now()) {
    return {
      allowed: false,
      currentTier: plan.tier,
      reason: 'Your subscription has expired, so downloads are disabled. Renew to restore offline access.',
    };
  }
  if (!plan.offlineDownloads) {
    return {
      allowed: false,
      currentTier: plan.tier,
      reason: 'Offline downloads are a paid feature. Free members can still stream and can download 1 video per day after upgrading to Bronze.',
    };
  }
  return { allowed: true, currentTier: plan.tier };
}

/* ----------------------------- Price helpers ------------------------------ */

export interface Quote {
  planId: PlanId;
  cycle: keyof typeof CYCLE_DISCOUNT;
  baseAmount: number; // paise
  credit: number; // paise, unused value of the current plan
  gst: number; // 18% inclusive-split shown separately for the invoice
  total: number; // paise actually charged
  months: number;
  renewsOn: number;
}

/**
 * Build a payable quote for a plan change.
 * Upgrades are pro-rated: the unused remainder of the current plan is credited
 * against the new plan's price, which is why `total` can be lower than `base`.
 */
export function quote(params: {
  userId: string;
  planId: PlanId;
  cycle: keyof typeof CYCLE_DISCOUNT;
}): Quote {
  const plan = getPlan(params.planId);
  const months = CYCLE_DISCOUNT[params.cycle].months;
  const base = Math.round(plan.monthlyPrice * CYCLE_DISCOUNT[params.cycle].multiplier) * 100;

  const current = activeSubscription(params.userId);
  let credit = 0;
  if (current && current.pricePaid > 0 && current.expiryDate > Date.now()) {
    const totalSpan = current.expiryDate - current.startDate;
    const unusedRatio = Math.max(0, (current.expiryDate - Date.now()) / totalSpan);
    credit = Math.round(current.pricePaid * unusedRatio);
  }

  const net = Math.max(0, base - credit);
  const gst = Math.round((net * 18) / 118); // GST-inclusive display split
  return {
    planId: params.planId,
    cycle: params.cycle,
    baseAmount: base,
    credit,
    gst,
    total: net,
    months,
    renewsOn: addMonths(Date.now(), months),
  };
}

/** Classify a plan change so the UI can label the button correctly. */
export function classifyAction(currentPlanId: PlanId, targetPlanId: PlanId): SubscriptionAction {
  const from = PLAN_ORDER.indexOf(currentPlanId);
  const to = PLAN_ORDER.indexOf(targetPlanId);
  if (currentPlanId === 'free') return 'new';
  if (to > from) return 'upgrade';
  if (to < from) return 'downgrade';
  return 'renew';
}

/* ------------------------------ State changes ----------------------------- */

/**
 * Activate (or extend) a subscription after a VERIFIED payment.
 * Never call this from the checkout UI directly - only from the payment
 * service, after the Razorpay signature has been validated.
 */
export function activateSubscription(params: {
  userId: string;
  planId: PlanId;
  cycle: keyof typeof CYCLE_DISCOUNT;
  transaction: Transaction;
  action: SubscriptionAction;
  creditCarried: number;
}): Subscription {
  const user = findById<User>(TABLES.USERS, params.userId);
  const existing = activeSubscription(params.userId);
  const now = Date.now();

  // Renewals of the same plan extend the current period instead of resetting it.
  const startDate =
    existing && existing.planId === params.planId && existing.expiryDate > now
      ? existing.expiryDate
      : now;

  // A same-plan renewal extends the existing row; a plan change creates a new row.
  if (existing && existing.planId === params.planId && existing.expiryDate > now) {
    const extended: Subscription = {
      ...existing,
      status: 'active',
      cycle: params.cycle,
      expiryDate: addMonths(startDate, CYCLE_DISCOUNT[params.cycle].months),
      autoRenew: true,
      cancelledAt: undefined,
      pricePaid: params.transaction.amount,
      invoiceNumber: params.transaction.invoiceNumber,
      action: existing.action,
      creditCarried: params.creditCarried,
    };
    upsert(TABLES.SUBSCRIPTIONS, extended);
    if (user) upsert(TABLES.USERS, { ...user, planId: params.planId });
    return extended;
  }

  // Plan change: close any still-running subscription and open a fresh row.
  if (existing) {
    upsert(TABLES.SUBSCRIPTIONS, {
      ...existing,
      status: params.action === 'downgrade' ? 'cancelled' : 'expired',
      cancelledAt: params.action === 'downgrade' ? now : existing.cancelledAt,
    });
  }

  const created = buildSubscription({
    userId: params.userId,
    planId: params.planId,
    cycle: params.cycle,
    startDate: now,
    action: params.action,
    pricePaid: params.transaction.amount,
    invoiceNumber: params.transaction.invoiceNumber,
    previousPlanId: existing?.planId,
    status: 'active',
    creditCarried: params.creditCarried,
  });
  upsert(TABLES.SUBSCRIPTIONS, created);
  if (user) upsert(TABLES.USERS, { ...user, planId: params.planId });
  return created;
}

/** Cancel at period end: access stays until expiryDate, autoRenew turns off. */
export function cancelSubscription(userId: string, reason?: string): Subscription | null {
  const current = activeSubscription(userId);
  if (!current || current.planId === 'free') return null;
  const updated: Subscription = {
    ...current,
    status: 'cancelled',
    cancelledAt: Date.now(),
    autoRenew: false,
  };
  upsert(TABLES.SUBSCRIPTIONS, updated);
  writeTable(
    TABLES.WATCH_EVENTS,
    readTable<{ id: string }>(TABLES.WATCH_EVENTS),
  ); // no-op write keeps the audit table initialised
  if (reason) {
    console.info(`[subscription] cancelled for ${userId}: ${reason}`);
  }
  return updated;
}

/** Undo a pending cancellation before the period ends. */
export function resumeSubscription(userId: string): Subscription | null {
  const current = activeSubscription(userId);
  if (!current) return null;
  const updated: Subscription = { ...current, status: 'active', cancelledAt: undefined, autoRenew: true };
  upsert(TABLES.SUBSCRIPTIONS, updated);
  return updated;
}

/** Transactions for the billing history table, newest first. */
export function billingHistory(userId: string): Transaction[] {
  return readTable<Transaction>(TABLES.TRANSACTIONS)
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Human sentence describing the current subscription status. */
export function statusSentence(sub: Subscription | null): string {
  if (!sub) return 'No active subscription - you are on the Free plan.';
  const plan = getPlan(sub.planId);
  if (sub.status === 'cancelled') {
    return `Cancelled. ${plan.name} benefits continue until ${istDateTime(sub.expiryDate)}.`;
  }
  return `${plan.name} plan active until ${istDateTime(sub.expiryDate)}.`;
}

export interface SubscriptionOverview {
  subscription: Subscription | null;
  plan: Plan;
  status: SubscriptionStatus;
  daysRemaining: number;
  percentElapsed: number;
  nextRenewal: number | null;
  history: Subscription[];
  transactions: Transaction[];
  totalPaid: number;
}

/** Everything the subscription dashboard needs, computed in one pass. */
export function overview(userId: string): SubscriptionOverview {
  reconcileExpiry(userId);
  const sub = activeSubscription(userId);
  const plan = getPlan(sub?.planId ?? 'free');
  const now = Date.now();
  const span = sub ? sub.expiryDate - sub.startDate : 0;
  const elapsed = sub ? now - sub.startDate : 0;
  const transactions = billingHistory(userId);
  return {
    subscription: sub,
    plan,
    status: sub?.status ?? 'expired',
    daysRemaining: sub ? Math.max(0, Math.ceil((sub.expiryDate - now) / 86_400_000)) : 0,
    percentElapsed: span > 0 ? Math.min(100, Math.round((elapsed / span) * 100)) : 100,
    nextRenewal: sub && sub.autoRenew ? sub.expiryDate : null,
    history: subscriptionHistory(userId),
    transactions,
    totalPaid: transactions
      .filter((t) => t.status === 'captured')
      .reduce((sum, t) => sum + t.amount, 0),
  };
}

/** Download quota numbers for the current plan (used by the plan cards). */
export function planQuota(planId: PlanId) {
  const plan = getPlan(planId);
  return {
    daily: plan.dailyDownloadLimit,
    monthly: plan.monthlyDownloadLimit,
    dailyLabel: plan.dailyDownloadLimit === -1 ? 'Unlimited' : String(plan.dailyDownloadLimit),
    monthlyLabel: plan.monthlyDownloadLimit === -1 ? 'Unlimited' : String(plan.monthlyDownloadLimit),
  };
}

export { uid };
