/* ============================================================================
 * plans.ts - the four membership pillars.
 *
 * Everything that differs between Free / Bronze / Silver / Gold lives in this
 * single table: prices, validity, quotas, quality caps, feature flags. Adding a
 * fifth plan means adding one object here - no branching anywhere else.
 *
 * Quota convention: -1 === unlimited.
 * ==========================================================================*/
import type { BillingCycle, Plan, PlanId } from '../types';

/** Multipliers applied to the monthly price for longer commitments. */
export const CYCLE_DISCOUNT: Record<BillingCycle, { months: number; multiplier: number; label: string; note: string }> = {
  monthly: { months: 1, multiplier: 1, label: 'Monthly', note: 'Billed every month' },
  quarterly: { months: 3, multiplier: 2.7, label: 'Quarterly', note: '10% off - billed every 3 months' },
  yearly: { months: 12, multiplier: 9.6, label: 'Yearly', note: '20% off - billed every 12 months' },
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tier: 0,
    tagline: 'Explore NexStream at no cost',
    monthlyPrice: 0,
    accent: '#64748b',
    gradient: 'from-slate-500 to-slate-700',
    dailyDownloadLimit: 1,
    monthlyDownloadLimit: 5,
    maxStreamQuality: 360,
    dailyWatchMinutes: 60,
    maxDevices: 1,
    // Free members DO get offline downloads - just one per day (see the spec).
    offlineDownloads: true,
    adFree: false,
    priorityStreaming: false,
    exclusiveCourses: false,
    premiumAccessPercent: 20,
    maxCallParticipants: 4,
    features: [
      '1 video download per day (max 5 / month)',
      '360p streaming only',
      '60 minutes of watch time per day',
      'Access to 20% of the premium catalogue',
      'Ads between videos',
      'Up to 4 participants in video calls',
      'Downloads kept for 24 hours',
    ],
    renewalPolicy: 'Never expires - the Free plan is always available as a fallback.',
    upgradeEligible: true,
  },
  bronze: {
    id: 'bronze',
    name: 'Bronze',
    tier: 1,
    tagline: 'For casual viewers',
    monthlyPrice: 199,
    accent: '#b45309',
    gradient: 'from-amber-700 to-orange-800',
    dailyDownloadLimit: 3,
    monthlyDownloadLimit: 25,
    maxStreamQuality: 720,
    dailyWatchMinutes: 180,
    maxDevices: 2,
    offlineDownloads: true,
    adFree: false,
    priorityStreaming: false,
    exclusiveCourses: false,
    premiumAccessPercent: 60,
    maxCallParticipants: 10,
    features: [
      '3 video downloads per day (max 25 / month)',
      'Up to 720p HD streaming',
      '3 hours of watch time per day',
      'Access to 60% of the premium catalogue',
      'Downloads kept for 30 days',
      'Registered on 2 devices',
      'Up to 10 participants in video calls',
    ],
    renewalPolicy: 'Auto-renews monthly. Cancel any time - access continues until the paid period ends.',
    upgradeEligible: true,
  },
  silver: {
    id: 'silver',
    name: 'Silver',
    tier: 2,
    tagline: 'For regular binge-watchers',
    monthlyPrice: 399,
    accent: '#475569',
    gradient: 'from-slate-400 to-slate-600',
    dailyDownloadLimit: 10,
    monthlyDownloadLimit: 100,
    maxStreamQuality: 1080,
    dailyWatchMinutes: -1,
    maxDevices: 3,
    offlineDownloads: true,
    adFree: true,
    priorityStreaming: true,
    exclusiveCourses: false,
    premiumAccessPercent: 90,
    maxCallParticipants: 25,
    features: [
      '10 video downloads per day (max 100 / month)',
      'Up to 1080p Full HD streaming',
      'Unlimited daily watch time',
      'Access to 90% of the premium catalogue',
      'Completely ad-free',
      'Priority streaming (dedicated CDN lane)',
      'Downloads kept for 90 days',
      'Registered on 3 devices',
      'Up to 25 participants in video calls',
    ],
    renewalPolicy: 'Auto-renews monthly or quarterly. Downgrade at cycle end without losing watch history.',
    upgradeEligible: true,
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    tier: 3,
    tagline: 'Everything, unlocked',
    monthlyPrice: 699,
    accent: '#ca8a04',
    gradient: 'from-yellow-500 to-amber-600',
    dailyDownloadLimit: -1,
    monthlyDownloadLimit: -1,
    maxStreamQuality: 2160,
    dailyWatchMinutes: -1,
    maxDevices: 5,
    offlineDownloads: true,
    adFree: true,
    priorityStreaming: true,
    exclusiveCourses: true,
    premiumAccessPercent: 100,
    maxCallParticipants: 50,
    features: [
      'Unlimited downloads (fair-use policy applies)',
      'Up to 4K 2160p streaming',
      'Unlimited daily watch time',
      'Full premium + exclusive course library',
      'Ad-free + early access to new releases',
      'Fastest streaming lane, zero buffering target',
      'Downloads never expire while subscribed',
      'Registered on 5 devices',
      'Up to 50 participants in video calls with cloud recording',
    ],
    renewalPolicy: 'Auto-renews monthly, quarterly or yearly. Cancel any time; the plan runs to the end of the paid period.',
    upgradeEligible: true,
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'bronze', 'silver', 'gold'];

export function getPlan(id: PlanId): Plan {
  return PLANS[id] ?? PLANS.free;
}

/** Plan price for a given billing cycle, in paise (Razorpay's smallest unit). */
export function priceFor(planId: PlanId, cycle: BillingCycle): number {
  const plan = getPlan(planId);
  return Math.round(plan.monthlyPrice * CYCLE_DISCOUNT[cycle].multiplier) * 100;
}

/** Validity in months for a cycle. */
export function cycleMonths(cycle: BillingCycle): number {
  return CYCLE_DISCOUNT[cycle].months;
}

/** Human summary of what a plan allows, used in cards and e-mails. */
export function quotaSummary(planId: PlanId): string {
  const plan = getPlan(planId);
  const daily = plan.dailyDownloadLimit === -1 ? 'Unlimited' : `${plan.dailyDownloadLimit}/day`;
  const monthly = plan.monthlyDownloadLimit === -1 ? 'unlimited' : `${plan.monthlyDownloadLimit}/month`;
  return `${daily} (${monthly})`;
}

/**
 * Feature-comparison matrix powering the "Compare plans" table.
 * Each row is one capability, each column one plan.
 */
export interface ComparisonRow {
  label: string;
  group: string;
  values: Record<PlanId, string>;
  /** Render the value as a tick / cross instead of text. */
  boolean?: boolean;
}

export const COMPARISON_ROWS: ComparisonRow[] = [
  { group: 'Downloads', label: 'Daily download limit', values: { free: '1', bronze: '3', silver: '10', gold: 'Unlimited' } },
  { group: 'Downloads', label: 'Monthly download limit', values: { free: '5', bronze: '25', silver: '100', gold: 'Unlimited' } },
  { group: 'Downloads', label: 'Offline downloads', values: { free: '1 / day', bronze: 'Yes', silver: 'Yes', gold: 'Yes' } },
  { group: 'Downloads', label: 'Download retention', values: { free: '24 hours', bronze: '30 days', silver: '90 days', gold: 'While subscribed' } },
  { group: 'Downloads', label: 'Download quality', values: { free: '360p', bronze: '720p', silver: '1080p', gold: 'Up to 4K' } },
  { group: 'Streaming', label: 'Max video quality', values: { free: '360p', bronze: '720p', silver: '1080p', gold: '2160p (4K)' } },
  { group: 'Streaming', label: 'Daily watch time', values: { free: '60 min', bronze: '180 min', silver: 'Unlimited', gold: 'Unlimited' } },
  { group: 'Streaming', label: 'Ad-free viewing', values: { free: 'No', bronze: 'No', silver: 'Yes', gold: 'Yes' }, boolean: true },
  { group: 'Streaming', label: 'Priority streaming lane', values: { free: 'No', bronze: 'No', silver: 'Yes', gold: 'Yes' }, boolean: true },
  { group: 'Content', label: 'Premium catalogue access', values: { free: '20%', bronze: '60%', silver: '90%', gold: '100%' } },
  { group: 'Content', label: 'Exclusive premium courses', values: { free: 'No', bronze: 'No', silver: 'No', gold: 'Yes' }, boolean: true },
  { group: 'Content', label: 'Early access to releases', values: { free: 'No', bronze: 'No', silver: 'No', gold: 'Yes' }, boolean: true },
  { group: 'Security', label: 'Registered devices', values: { free: '1', bronze: '2', silver: '3', gold: '5' } },
  { group: 'Security', label: 'Login OTP on new device', values: { free: 'Yes', bronze: 'Yes', silver: 'Yes', gold: 'Yes' }, boolean: true },
  { group: 'Video calls', label: 'Max participants', values: { free: '4', bronze: '10', silver: '25', gold: '50' } },
  { group: 'Video calls', label: 'Call recording', values: { free: 'No', bronze: 'No', silver: 'No', gold: 'Yes' }, boolean: true },
  { group: 'Support', label: 'Support channel', values: { free: 'Community', bronze: 'E-mail (72h)', silver: 'E-mail (24h)', gold: 'Priority chat (4h)' } },
];
