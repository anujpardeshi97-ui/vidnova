/* ============================================================================
 * SubscriptionsPage.tsx - plan comparison, purchase, upgrade/downgrade,
 * renewal and cancellation.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  Award, BadgeCheck, CalendarClock, CheckCircle2, CreditCard, Crown, Info, RefreshCcw,
  ShieldAlert, Sparkles, TrendingDown, TrendingUp, XCircle, Zap,
} from 'lucide-react';
import type { BillingCycle, PlanId } from '../types';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, CheckList, Modal, PageHeader, Progress, SectionTitle } from '../components/ui';
import { CYCLE_DISCOUNT, COMPARISON_ROWS, PLAN_ORDER, PLANS, getPlan, priceFor, quotaSummary } from '../data/plans';
import { classifyAction, cancelSubscription, overview, planQuota, quote, resumeSubscription } from '../services/subscriptionService';
import { formatMoney, percent } from '../lib/format';
import { istDateTime } from '../lib/ist';
import { CheckoutSheet } from '../components/CheckoutSheet';

export function SubscriptionsPage() {
  const { user, plan, toast, bump, version } = useApp();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [compareOpen, setCompareOpen] = useState(false);
  const [checkoutFor, setCheckoutFor] = useState<PlanId | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!user) return null;

  const data = useMemo(() => overview(user.id), [user.id, version]);
  const currentPlanId = plan.id;

  const handleCancel = () => {
    const result = cancelSubscription(user.id, 'user requested');
    setConfirmCancel(false);
    if (result) {
      toast({
        kind: 'warning',
        title: 'Subscription cancelled',
        message: `You keep ${plan.name} benefits until ${istDateTime(result.expiryDate)}. Nothing else will be charged.`,
      });
      bump();
    }
  };

  const handleResume = () => {
    resumeSubscription(user.id);
    toast({ kind: 'success', title: 'Auto-renew re-enabled', message: 'Your plan will continue after the current period.' });
    bump();
  };

  return (
    <div className="space-y-7">
      <PageHeader
        title="Subscriptions"
        subtitle="Compare Free, Bronze, Silver and Gold, then upgrade, downgrade, renew or cancel. Payments run through the Razorpay test gateway with signature verification."
        icon={<Crown size={20} />}
        action={
          <Button variant="outline" size="sm" icon={<CreditCard size={14} />} onClick={() => navigate('billing')}>
            Billing history
          </Button>
        }
      />

      {/* --------------------------- current status ------------------------ */}
      <Card className="overflow-hidden !p-0">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={currentPlanId === 'gold' ? 'amber' : currentPlanId === 'free' ? 'slate' : 'violet'}>
                <Crown size={11} /> {plan.name} plan · Tier {plan.tier}
              </Badge>
              <Badge tone={data.status === 'active' ? 'emerald' : data.status === 'cancelled' ? 'amber' : 'red'}>
                {data.status === 'active' ? <><BadgeCheck size={11} /> Active</> : data.status === 'cancelled' ? <><ShieldAlert size={11} /> Cancelled</> : <><XCircle size={11} /> Expired</>}
              </Badge>
              {data.subscription?.cycle && <Badge tone="sky">{CYCLE_DISCOUNT[data.subscription.cycle].label} billing</Badge>}
            </div>

            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
              {data.subscription ? `${plan.name} until ${istDateTime(data.subscription.expiryDate)}` : 'No active paid plan'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {data.subscription
                ? `${data.daysRemaining} day(s) remaining · ${data.nextRenewal ? `auto-renews on ${istDateTime(data.nextRenewal)}` : 'auto-renew is off'}`
                : 'You are on the Free plan. Upgrade for higher quotas and better quality.'}
            </p>

            {data.subscription && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <span>Validity used</span>
                  <span>{percent(data.percentElapsed, 100)}% of {CYCLE_DISCOUNT[data.subscription.cycle].label.toLowerCase()} cycle</span>
                </div>
                <Progress value={data.percentElapsed} barClass={data.percentElapsed > 85 ? 'bg-amber-500' : 'bg-emerald-500'} className="mt-1.5" />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {istDateTime(data.subscription.startDate)} → {istDateTime(data.subscription.expiryDate)}
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {currentPlanId !== 'gold' && (
                <Button icon={<TrendingUp size={15} />} onClick={() => setCheckoutFor(PLAN_ORDER[PLAN_ORDER.indexOf(currentPlanId) + 1])}>
                  Upgrade to {getPlan(PLAN_ORDER[PLAN_ORDER.indexOf(currentPlanId) + 1]).name}
                </Button>
              )}
              {currentPlanId !== 'free' && (
                <>
                  <Button variant="outline" icon={<RefreshCcw size={15} />} onClick={() => setCheckoutFor(currentPlanId)}>
                    Renew now
                  </Button>
                  <Button variant="outline" icon={<TrendingDown size={15} />} onClick={() => setCheckoutFor('bronze')} disabled={currentPlanId === 'bronze'}>
                    Downgrade
                  </Button>
                  {data.subscription?.status === 'cancelled' ? (
                    <Button variant="success" icon={<CheckCircle2 size={15} />} onClick={handleResume}>
                      Re-enable auto-renew
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={<XCircle size={15} />} onClick={() => setConfirmCancel(true)}>
                      Cancel subscription
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" icon={<Info size={15} />} onClick={() => setCompareOpen(true)}>
                Compare all plans
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Your entitlements right now</p>
            <EntitlementRow label="Daily downloads" value={planQuota(plan.id).dailyLabel} />
            <EntitlementRow label="Monthly downloads" value={planQuota(plan.id).monthlyLabel} />
            <EntitlementRow label="Streaming quality" value={`${plan.maxStreamQuality}p`} />
            <EntitlementRow label="Daily watch time" value={plan.dailyWatchMinutes === -1 ? 'Unlimited' : `${plan.dailyWatchMinutes} min`} />
            <EntitlementRow label="Registered devices" value={String(plan.maxDevices)} />
            <EntitlementRow label="Call participants" value={String(plan.maxCallParticipants)} />
            <EntitlementRow label="Ad-free" value={plan.adFree ? 'Yes' : 'No'} />
            <EntitlementRow label="Lifetime paid" value={formatMoney(data.totalPaid)} />
          </div>
        </div>
      </Card>

      {/* ------------------------------ cycle picker ----------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Plans" subtitle="Prices in INR, GST inclusive. Longer cycles cost less per month." icon={<Award size={18} />} />
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['monthly', 'quarterly', 'yearly'] as BillingCycle[]).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
                cycle === c ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {CYCLE_DISCOUNT[c].label}
              {c !== 'monthly' && <span className="ml-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                {c === 'yearly' ? '20% off' : '10% off'}
              </span>}
            </button>
          ))}
        </div>
      </div>

      {/* -------------------------------- cards ---------------------------- */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_ORDER.map((planId) => (
          <PlanCard
            key={planId}
            planId={planId}
            cycle={cycle}
            current={currentPlanId === planId}
            onSelect={() => setCheckoutFor(planId)}
          />
        ))}
      </div>

      {user.planId !== plan.id && (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/25">
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Heads-up: your account record still says <strong>{user.planId}</strong> while the entitlement engine resolved{' '}
            <strong>{plan.name}</strong>. The next reconciliation pass will align them.
          </p>
        </Card>
      )}

      {/* ------------------------------ history ---------------------------- */}
      <Card>
        <SectionTitle
          title="Subscription timeline"
          subtitle="Every activation, renewal, upgrade, downgrade and expiry - newest first"
          icon={<CalendarClock size={18} />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 font-semibold">Plan</th>
                <th className="py-2 pr-3 font-semibold">Action</th>
                <th className="py-2 pr-3 font-semibold">Cycle</th>
                <th className="py-2 pr-3 font-semibold">Start</th>
                <th className="py-2 pr-3 font-semibold">Expiry</th>
                <th className="py-2 pr-3 font-semibold">Paid</th>
                <th className="py-2 pr-3 font-semibold">Invoice</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-2.5 pr-3 font-semibold">{getPlan(row.planId).name}</td>
                  <td className="py-2.5 pr-3 capitalize">{row.action}</td>
                  <td className="py-2.5 pr-3 capitalize">{row.cycle}</td>
                  <td className="py-2.5 pr-3">{istDateTime(row.startDate)}</td>
                  <td className="py-2.5 pr-3">{istDateTime(row.expiryDate)}</td>
                  <td className="py-2.5 pr-3">{formatMoney(row.pricePaid)}</td>
                  <td className="py-2.5 pr-3 font-mono text-[11px]">{row.invoiceNumber}</td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={row.status === 'active' ? 'emerald' : row.status === 'cancelled' ? 'amber' : 'slate'}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* --------------------------- compare modal ------------------------- */}
      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Compare all plans"
        subtitle="Every limit enforced by the platform, side by side"
        wide
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Capability</th>
                {PLAN_ORDER.map((id) => (
                  <th key={id} className="py-2 pr-3 text-center">
                    <span className="block font-bold">{PLANS[id].name}</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      {PLANS[id].monthlyPrice === 0 ? 'Free' : `${formatMoney(priceFor(id, cycle))} / ${CYCLE_DISCOUNT[cycle].label.toLowerCase()}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(COMPARISON_ROWS.map((r) => r.group))).map((group) => (
                <React.Fragment key={group}>
                  <tr>
                    <td colSpan={5} className="pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-rose-500">{group}</td>
                  </tr>
                  {COMPARISON_ROWS.filter((r) => r.group === group).map((row) => (
                    <tr key={row.label} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{row.label}</td>
                      {PLAN_ORDER.map((id) => {
                        const value = row.values[id];
                        const isYes = value === 'Yes';
                        const isNo = value === 'No';
                        return (
                          <td key={id} className="py-2 pr-3 text-center font-semibold">
                            {row.boolean ? (
                              isYes ? <CheckCircle2 size={14} className="mx-auto text-emerald-500" /> : isNo ? <XCircle size={14} className="mx-auto text-slate-300 dark:text-slate-600" /> : value
                            ) : (
                              <span className={currentPlanId === id ? 'text-rose-600 dark:text-rose-400' : ''}>{value}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
          Renewal policy: {PLANS[currentPlanId].renewalPolicy}
        </p>
      </Modal>

      {/* --------------------------- cancel confirm ------------------------ */}
      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel your subscription?"
        subtitle={`${plan.name} · ${data.daysRemaining} days remaining`}
      >
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p>Here is exactly what happens if you cancel:</p>
          <CheckList
            items={[
              `You keep every ${plan.name} benefit until ${data.subscription ? istDateTime(data.subscription.expiryDate) : 'the period ends'}.`,
              'Then the account drops to Free: 1 download/day, 360p, 60 minutes of watch time.',
              'Your watch history, resume positions, trusted devices and invoice records are preserved.',
              'Completed downloads remain listed (Playback is disabled after expiry).',
              'You can re-enable auto-renew before the period ends and nothing is lost.',
            ]}
          />
          <div className="flex gap-2 pt-2">
            <Button variant="danger" onClick={handleCancel} icon={<XCircle size={15} />}>
              Yes, cancel at period end
            </Button>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep my plan
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------------ checkout --------------------------- */}
      {checkoutFor && (
        <CheckoutSheet
          planId={checkoutFor}
          cycle={cycle}
          onClose={() => setCheckoutFor(null)}
          onSuccess={() => {
            setCheckoutFor(null);
            bump();
          }}
        />
      )}
    </div>
  );
}

function EntitlementRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function PlanCard({
  planId, cycle, current, onSelect,
}: { planId: PlanId; cycle: BillingCycle; current: boolean; onSelect: () => void; key?: React.Key }) {
  const plan = getPlan(planId);
  const price = priceFor(planId, cycle);
  const perMonth = Math.round(price / CYCLE_DISCOUNT[cycle].months);

  return (
    <Card
      className={`relative flex flex-col transition hover:-translate-y-0.5 hover:shadow-xl ${
        current ? 'border-rose-400 ring-2 ring-rose-500/25' : ''
      } ${planId === 'gold' ? 'border-amber-300 dark:border-amber-700/60' : ''}`}
    >
      {planId === 'gold' && (
        <span className="absolute -top-3 left-5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">
          Best value
        </span>
      )}
      {current && (
        <span className="absolute -top-3 right-5 rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">
          Current
        </span>
      )}

      <div className={`rounded-xl bg-gradient-to-br ${plan.gradient} p-3 text-white`}>
        <p className="text-xs font-bold uppercase tracking-wider opacity-90">{plan.name}</p>
        <p className="mt-1 text-2xl font-extrabold">
          {price === 0 ? 'Free' : formatMoney(price)}
          {price > 0 && <span className="text-xs font-semibold opacity-80"> / {CYCLE_DISCOUNT[cycle].label.toLowerCase()}</span>}
        </p>
        <p className="mt-0.5 text-[11px] opacity-90">
          {price === 0 ? 'forever' : `${formatMoney(perMonth)} per month · ${plan.tagline}`}
        </p>
      </div>

      <div className="mt-3 flex-1">
        <CheckList items={plan.features.slice(0, 6)} />
        {plan.features.length > 6 && (
          <p className="mt-2 text-[11px] font-semibold text-rose-500">+ {plan.features.length - 6} more benefits</p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Downloads: {quotaSummary(planId)} · Quality: {plan.maxStreamQuality}p
        </p>
        {current ? (
          <Button variant="outline" className="w-full" disabled>
            Your current plan
          </Button>
        ) : (
          <Button
            className="w-full"
            variant={planId === 'gold' ? 'primary' : 'secondary'}
            icon={<Sparkles size={15} />}
            onClick={onSelect}
          >
            {planId === 'free' ? 'Switch to Free' : `${classifyAction('free', planId) === 'upgrade' ? 'Upgrade' : 'Choose'} ${plan.name}`}
          </Button>
        )}
        <p className="text-center text-[10px] text-slate-400">{plan.renewalPolicy}</p>
      </div>
    </Card>
  );
}
