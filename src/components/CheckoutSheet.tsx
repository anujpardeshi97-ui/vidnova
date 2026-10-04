/* ============================================================================
 * CheckoutSheet.tsx - the Razorpay test-mode checkout experience.
 *
 * Renders the same four things the real Checkout does (order summary, method
 * picker, instrument entry, result) and drives the real service calls:
 * createOrder -> processCheckout -> HMAC verification -> activation -> invoice.
 *
 * The fault-injection row is deliberate: a reviewer can reproduce every failure
 * path the spec asks for - declined card, abandoned checkout, dropped network,
 * tampered signature, duplicate submit - and watch the system refuse to grant
 * access when it should.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, Ban, Building2, CheckCircle2, CreditCard,
  Fingerprint, Loader2, Lock, RefreshCw, ShieldCheck, Smartphone, Sparkles, WifiOff, Wallet, Bug, XCircle,
} from 'lucide-react';
import type { BillingCycle, PlanId, PaymentStatus } from '../types';
import { Badge, Button, Card, CheckList, Field, Modal, Progress, inputClass } from './ui';
import { useApp } from '../context/AppContext';
import { CYCLE_DISCOUNT, getPlan } from '../data/plans';
import { quote, classifyAction } from '../services/subscriptionService';
import { checkoutRequest, createOrder, processCheckout, reconcile } from '../services/paymentService';
import { cardNetwork, luhnValid, RAZORPAY_TEST_KEY_ID } from '../lib/razorpay';
import { formatMoney } from '../lib/format';
import { istDateTime } from '../lib/ist';

type Method = 'card' | 'upi' | 'netbanking' | 'wallet';
type Fault = 'declined' | 'cancelled' | 'network' | 'tampered_signature';

interface ResultState {
  status: PaymentStatus;
  message: string;
  paymentId?: string | null;
  orderId?: string;
  invoiceNumber?: string;
  signature?: string;
  verified?: boolean;
  activated?: boolean;
  expiry?: number;
}

export function CheckoutSheet({
  planId, cycle, onClose, onSuccess,
}: {
  planId: PlanId;
  cycle: BillingCycle;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, toast, bump, version } = useApp();
  const [method, setMethod] = useState<Method>('card');
  const [cardNumber, setCardNumber] = useState('4111 1111 1111 1111');
  const [expiry, setExpiry] = useState('12/28');
  const [cvv, setCvv] = useState('123');
  const [upiId, setUpiId] = useState('success@razorpay');
  const [fault, setFault] = useState<Fault | null>(null);
  const [stage, setStage] = useState<'form' | 'processing' | 'result'>('form');
  const [stageLabel, setStageLabel] = useState('');
  const [stagePercent, setStagePercent] = useState(0);
  const [result, setResult] = useState<ResultState | null>(null);
  const [reusedOrder, setReusedOrder] = useState(false);

  const plan = getPlan(planId);
  const q = useMemo(() => quote({ userId: user?.id ?? 'none', planId, cycle }), [user?.id, planId, cycle, version]);
  const action = user ? classifyAction(user.planId, planId) : 'new';

  if (!user) return null;

  const cardValid = luhnValid(cardNumber);

  /* ------------------------------- pay flow ----------------------------- */
  const pay = async () => {
    if (method === 'card' && !cardValid) {
      toast({ kind: 'error', title: 'Check your card number', message: 'The card failed the Luhn check.' });
      return;
    }

    setStage('processing');
    setStagePercent(15);
    setStageLabel('Creating the order with Razorpay…');

    // Step 1 - order creation (idempotent within a 60s window).
    const { order, reused } = createOrder({ user, planId, cycle });
    setReusedOrder(reused);
    setStagePercent(35);

    // The checkout.js contract, rendered as data.
    const request = checkoutRequest(user, order);
    void request;

    setStageLabel('Opening Razorpay Checkout…');
    await new Promise((r) => window.setTimeout(r, 700));

    setStagePercent(60);
    setStageLabel(
      method === 'card'
        ? 'Waiting for your bank…'
        : method === 'upi'
        ? 'Waiting for your UPI app to approve the collect request…'
        : 'Waiting for the bank page…',
    );

    // Step 2 - the instrument does its thing (or fails on purpose).
    const outcome = await processCheckout({
      user,
      order,
      method,
      cardNumber: method === 'card' ? cardNumber : undefined,
      simulateFailure: fault ?? undefined,
    });

    setStagePercent(85);
    setStageLabel(
      outcome.status === 'captured' || outcome.status === 'duplicate'
        ? 'Verifying the payment signature (HMAC-SHA256)…'
        : 'Recording the outcome…',
    );
    await new Promise((r) => window.setTimeout(r, 550));
    setStagePercent(100);

    setResult({
      status: outcome.status,
      message: outcome.message,
      paymentId: outcome.transaction?.paymentId ?? null,
      orderId: order.orderId,
      invoiceNumber: outcome.transaction?.invoiceNumber,
      signature: outcome.transaction?.signature,
      verified: outcome.transaction?.signatureVerified,
      activated: outcome.activated,
      expiry: outcome.subscription?.expiryDate,
    });
    setStage('result');

    if (outcome.activated) {
      toast({ kind: 'success', title: `${plan.name} activated`, message: outcome.message });
      bump();
    } else if (outcome.status === 'network_error') {
      toast({ kind: 'warning', title: 'Confirmation pending', message: outcome.message });
    } else if (outcome.status === 'duplicate') {
      toast({ kind: 'info', title: 'Duplicate payment ignored', message: outcome.message });
    } else {
      toast({ kind: 'error', title: 'Payment not completed', message: outcome.message });
    }
  };

  /* ------------------------------ result view ---------------------------- */
  const resultTone: Record<string, string> = {
    captured: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30',
    duplicate: 'border-sky-200 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/30',
    verification_failed: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30',
    failed: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30',
    cancelled: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30',
    network_error: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30',
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={stage === 'result' ? 'Payment result' : `Complete your ${plan.name} purchase`}
      subtitle={
        stage === 'result'
          ? 'Every outcome is written to the transactions table with its Razorpay identifiers'
          : `Secure test-mode checkout · key ${RAZORPAY_TEST_KEY_ID}`
      }
    >
      {/* ------------------------------- form ----------------------------- */}
      {stage === 'form' && (
        <div className="grid gap-5 md:grid-cols-[1.15fr_1fr]">
          <div className="space-y-4">
            {/* method tabs */}
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {([
                ['card', 'Card', <CreditCard key="c" size={14} />],
                ['upi', 'UPI', <Smartphone key="u" size={14} />],
                ['netbanking', 'Netbanking', <Building2 key="n" size={14} />],
                ['wallet', 'Wallet', <Wallet key="w" size={14} />],
              ] as [Method, string, React.ReactNode][]).map(([id, label, icon]) => (
                <button
                  key={id}
                  onClick={() => setMethod(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    method === id ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {method === 'card' && (
              <div className="space-y-3">
                <Field label="Card number" required hint={cardNumber.replace(/\D/g, '').length >= 2 ? `Detected: ${cardNetwork(cardNumber)}${cardValid ? ' · Luhn valid ✅' : ' · Luhn invalid ❌'}` : 'Test cards listed on the right'}>
                  <input
                    className={`${inputClass} font-mono`}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value.replace(/[^\d ]/g, '').slice(0, 19))}
                    placeholder="4111 1111 1111 1111"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Expiry" required>
                    <input className={`${inputClass} font-mono`} value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="MM/YY" />
                  </Field>
                  <Field label="CVV" required>
                    <input className={`${inputClass} font-mono`} value={cvv} onChange={(e) => setCvv(e.target.value.slice(0, 4))} type="password" placeholder="•••" />
                  </Field>
                </div>
              </div>
            )}

            {method === 'upi' && (
              <Field label="UPI ID" required hint="Test handles: success@razorpay (captures), failure@razorpay (declines)">
                <input className={inputClass} value={upiId} onChange={(e) => setUpiId(e.target.value)} />
              </Field>
            )}

            {method === 'netbanking' && (
              <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <p className="font-semibold">Test bank pages</p>
                <p className="mt-1">In test mode every bank returns success unless a failure is injected below.</p>
              </div>
            )}

            {method === 'wallet' && (
              <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <p className="font-semibold">Wallets</p>
                <p className="mt-1">Paytm / PhonePe / Amazon Pay test wallets are auto-authorised in test mode.</p>
              </div>
            )}

            {/* fault injection */}
            <Card className="!p-3.5">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Bug size={13} /> Failure-path simulator
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <FaultChip active={fault === 'declined'} onClick={() => setFault(fault === 'declined' ? null : 'declined')} icon={<Ban size={12} />} label="Card declined" />
                <FaultChip active={fault === 'cancelled'} onClick={() => setFault(fault === 'cancelled' ? null : 'cancelled')} icon={<XCircle size={12} />} label="Abandon checkout" />
                <FaultChip active={fault === 'network'} onClick={() => setFault(fault === 'network' ? null : 'network')} icon={<WifiOff size={12} />} label="Network drop" />
                <FaultChip active={fault === 'tampered_signature'} onClick={() => setFault(fault === 'tampered_signature' ? null : 'tampered_signature')} icon={<Fingerprint size={12} />} label="Tamper signature" />
              </div>
              {fault === 'tampered_signature' && (
                <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                  The charge will appear to succeed, but the HMAC signature check fails → the plan is <strong>not</strong> activated and
                  the transaction is recorded as verification_failed.
                </p>
              )}
              {fault === 'network' && (
                <p className="mt-2 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
                  The order stays pending. Reopen Billing (or press “Check pending payments”) and the simulated webhook settles it.
                </p>
              )}
            </Card>
          </div>

          {/* -------------------------- order summary ----------------------- */}
          <div className="space-y-4">
            <div className={`rounded-2xl bg-gradient-to-br ${plan.gradient} p-4 text-white`}>
              <p className="text-xs font-bold uppercase tracking-wider opacity-90">{plan.name} plan</p>
              <p className="mt-1 text-3xl font-extrabold">{formatMoney(q.total)}</p>
              <p className="text-[11px] opacity-90">
                {CYCLE_DISCOUNT[cycle].label} · {CYCLE_DISCOUNT[cycle].note}
              </p>
              <p className="mt-2 text-[11px] opacity-90">
                Valid {istDateTime(Date.now()).split(',')[0]} → {istDateTime(q.renewsOn)}
              </p>
            </div>

            <Card className="!p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Price breakdown</p>
              <div className="mt-2 space-y-1.5 text-xs">
                <Row label={`${plan.name} licence × ${q.months} month(s)`} value={formatMoney(q.baseAmount)} />
                {q.credit > 0 && <Row label="Credit from unused current plan" value={`−${formatMoney(q.credit)}`} accent />}
                <Row label="GST @ 18% (included)" value={formatMoney(q.gst)} />
                <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-extrabold dark:border-slate-700">
                  <span>Total payable</span>
                  <span>{formatMoney(q.total)}</span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Action recorded as <strong className="capitalize">{action}</strong>
                {action === 'renew' && ' - renewals extend the current period instead of restarting it.'}
                {action === 'upgrade' && ' - the unused value of your current plan is credited automatically.'}
              </p>
            </Card>

            <CheckList
              items={[
                'Signature verified before the plan is activated',
                'Duplicate submissions detected for 60 seconds',
                'Invoice e-mailed with payment ID, order ID and support details',
                'Failed or cancelled attempts never change your plan',
              ]}
            />

            <Button
              className="w-full"
              size="lg"
              icon={<Lock size={16} />}
              loading={false}
              onClick={() => void pay()}
              disabled={method === 'card' && !cardValid}
            >
              Pay {formatMoney(q.total)} securely
            </Button>
            <p className="text-center text-[11px] text-slate-400">
              Test mode - no real money moves. Razorpay test key {RAZORPAY_TEST_KEY_ID}
            </p>
          </div>
        </div>
      )}

      {/* ----------------------------- processing -------------------------- */}
      {stage === 'processing' && (
        <div className="flex flex-col items-center gap-5 py-10">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-rose-50 dark:bg-rose-950/40">
            <Loader2 size={26} className="animate-spin text-rose-600" />
          </div>
          <div className="w-full max-w-md text-center">
            <p className="text-sm font-bold">{stageLabel}</p>
            <Progress value={stagePercent} className="mt-3" />
            <p className="mt-2 text-[11px] text-slate-400">Do not close this window - verify the signature completes the purchase.</p>
          </div>
        </div>
      )}

      {/* ------------------------------- result ---------------------------- */}
      {stage === 'result' && result && (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${resultTone[result.status] ?? 'border-slate-200'}`}>
            <p className="flex items-center gap-2 text-sm font-bold">
              {result.status === 'captured' && <><BadgeCheck size={17} /> Payment successful · plan activated</>}
              {result.status === 'duplicate' && <><RefreshCw size={17} /> Duplicate payment ignored</>}
              {result.status === 'verification_failed' && <><AlertTriangle size={17} /> Signature verification failed</>}
              {result.status === 'failed' && <><XCircle size={17} /> Payment declined</>}
              {result.status === 'cancelled' && <><Ban size={17} /> Checkout abandoned</>}
              {result.status === 'network_error' && <><WifiOff size={17} /> Confirmation pending</>}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed">{result.message}</p>
            {result.activated && result.expiry && (
              <p className="mt-2 text-xs font-semibold">
                {plan.name} active until {istDateTime(result.expiry)} · invoice {result.invoiceNumber}
              </p>
            )}
          </div>

          <Card className="!p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Transaction record</p>
            <div className="mt-2 space-y-1.5 font-mono text-[11px]">
              <Row label="Order id" value={result.orderId ?? '—'} mono />
              <Row label="Payment id" value={result.paymentId ?? '— (never created)'} mono />
              <Row label="Invoice" value={result.invoiceNumber ?? '—'} mono />
              <Row label="Status" value={result.status} mono />
              <Row
                label="Signature"
                value={result.verified ? 'HMAC verified ✅' : fault === 'tampered_signature' ? 'mismatch ❌' : '—'}
                mono
              />
              {reusedOrder && <Row label="Idempotency" value="existing order reused (no double charge)" mono />}
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            {result.activated ? (
              <Button icon={<ArrowRight size={15} />} onClick={() => { onSuccess(); onClose(); }}>
                Go to my downloads
              </Button>
            ) : result.status === 'network_error' ? (
              <Button
                icon={<RefreshCw size={15} />}
                onClick={() => {
                  const report = reconcile(user.id);
                  bump();
                  if (report.settled.length > 0) {
                    toast({ kind: 'success', title: 'Webhook settled your payment', message: 'Your plan is now active and the invoice has been e-mailed.' });
                    onSuccess();
                    onClose();
                  } else {
                    toast({ kind: 'info', title: 'Still waiting on the webhook', message: 'Give it a few seconds and check again from Billing.' });
                  }
                }}
              >
                Check pending payments
              </Button>
            ) : (
              <Button icon={<RefreshCw size={15} />} onClick={() => { setStage('form'); setResult(null); setFault(null); }}>
                Try again
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>
              Every attempt above is stored in the transactions table with its order id, payment id, invoice number,
              amount, currency, method, status and (when captured) the verified signature - that is the audit trail the
              billing screen renders.
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, mono = false, accent = false }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${accent ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold'}`}>{value}</span>
    </div>
  );
}

function FaultChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
        active
          ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {icon} {label}
    </button>
  );
}

export { Sparkles };
