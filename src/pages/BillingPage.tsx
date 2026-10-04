/* ============================================================================
 * BillingPage.tsx - invoices, transactions and the webhook reconciliation
 * control. Every row here is a record written by paymentService.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Ban, CreditCard, Download, FileText, RefreshCw, Receipt, WifiOff, XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, KV, Modal, PageHeader, SectionTitle, Stat } from '../components/ui';
import { billingHistory, overview } from '../services/subscriptionService';
import { ordersFor, pendingOrder, reconcile } from '../services/paymentService';
import { inbox } from '../services/mailService';
import { formatMoney } from '../lib/format';
import { istDateTime } from '../lib/ist';
import type { Transaction } from '../types';

const STATUS_TONE: Record<string, 'emerald' | 'red' | 'amber' | 'sky' | 'slate'> = {
  captured: 'emerald',
  failed: 'red',
  cancelled: 'amber',
  verification_failed: 'red',
  network_error: 'amber',
  duplicate: 'sky',
  pending: 'amber',
  created: 'slate',
};

export function BillingPage() {
  const { user, toast, bump, version } = useApp();
  const [openInvoice, setOpenInvoice] = useState<Transaction | null>(null);

  if (!user) return null;

  const data = useMemo(() => overview(user.id), [user.id, version]);
  const transactions = useMemo(() => billingHistory(user.id), [user.id, version]);
  const orders = useMemo(() => ordersFor(user.id), [user.id, version]);
  const pending = pendingOrder(user.id);
  const invoiceMails = useMemo(() => inbox(user.id).filter((m) => m.kind === 'invoice'), [user.id, version]);

  const captured = transactions.filter((t) => t.status === 'captured');
  const failed = transactions.filter((t) => ['failed', 'verification_failed', 'cancelled'].includes(t.status));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & invoices"
        subtitle="Every Razorpay order, payment id, invoice number, amount and verification result - plus the e-mailed receipts."
        icon={<CreditCard size={20} />}
        action={
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => {
              const report = reconcile(user.id);
              bump();
              toast({
                kind: report.settled.length ? 'success' : 'info',
                title: report.settled.length ? `${report.settled.length} pending payment settled` : 'Nothing pending',
                message: report.settled.length
                  ? 'The simulated Razorpay webhook confirmed the payment and the plan is active.'
                  : 'All orders are already settled and no subscription has lapsed.',
              });
            }}
          >
            Check pending payments
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lifetime paid" value={formatMoney(data.totalPaid)} hint={`${captured.length} successful payment(s)`} icon={<Receipt size={14} />} />
        <Stat label="Failed / cancelled" value={failed.length} hint="Never activated a plan" icon={<XCircle size={14} />} />
        <Stat label="Open orders" value={orders.filter((o) => o.status === 'pending' || o.status === 'created').length} hint="awaiting webhook confirmation" icon={<WifiOff size={14} />} />
        <Stat label="Invoices e-mailed" value={invoiceMails.length} hint="also visible in your Inbox" icon={<FileText size={14} />} />
      </div>

      {pending && (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/25">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
            <AlertTriangle size={16} /> Payment awaiting confirmation
          </p>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
            Order <span className="font-mono">{pending.orderId}</span> ({formatMoney(pending.amount)}) was created{' '}
            {istDateTime(pending.createdAt)} but the client callback never arrived. The webhook will settle it automatically -
            press “Check pending payments” to run the reconciliation now. You do not need to pay again.
          </p>
        </Card>
      )}

      <Card>
        <SectionTitle title="Transactions" subtitle="Complete payment records with Razorpay identifiers and verification state" icon={<Receipt size={18} />} />
        {transactions.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={24} />}
            title="No transactions yet"
            message="Purchase a plan from the Subscriptions page. Successful, failed, cancelled, duplicate and unverified attempts all land here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 pr-3 font-semibold">Date (IST)</th>
                  <th className="py-2 pr-3 font-semibold">Invoice</th>
                  <th className="py-2 pr-3 font-semibold">Plan</th>
                  <th className="py-2 pr-3 font-semibold">Action</th>
                  <th className="py-2 pr-3 font-semibold">Amount</th>
                  <th className="py-2 pr-3 font-semibold">Method</th>
                  <th className="py-2 pr-3 font-semibold">Order id</th>
                  <th className="py-2 pr-3 font-semibold">Payment id</th>
                  <th className="py-2 pr-3 font-semibold">Signature</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-2.5 pr-3 font-mono text-[11px]">{istDateTime(t.createdAt)}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">{t.invoiceNumber}</td>
                    <td className="py-2.5 pr-3 font-semibold capitalize">{t.planId}</td>
                    <td className="py-2.5 pr-3 capitalize">{t.action}</td>
                    <td className="py-2.5 pr-3 font-semibold">{formatMoney(t.amount)}</td>
                    <td className="py-2.5 pr-3 capitalize">{t.method}{t.cardLast4 ? ` ····${t.cardLast4}` : ''}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">{t.orderId}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">{t.paymentId ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      {t.signatureVerified ? (
                        <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400"><BadgeCheck size={12} /> verified</span>
                      ) : t.signature ? (
                        <span className="flex items-center gap-1 font-semibold text-red-600 dark:text-red-400"><Ban size={12} /> mismatch</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={STATUS_TONE[t.status] ?? 'slate'}>{t.status.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Button size="sm" variant="ghost" icon={<FileText size={12} />} onClick={() => setOpenInvoice(t)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Razorpay orders" subtitle="Created before every checkout attempt; idempotency keys prevent double charging" icon={<Download size={18} />} />
        {orders.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {orders.slice(0, 8).map((o) => (
              <div key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
                <div>
                  <p className="font-mono text-[11px] font-semibold">{o.orderId}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {o.planId} · {o.cycle} · receipt {o.receipt} · attempts {o.attempts}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{formatMoney(o.amount)}</span>
                  <Badge tone={STATUS_TONE[o.status] ?? 'slate'}>{o.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Invoices sent to your e-mail" subtitle={`${user.email} - the same message that carries your payment receipt`} icon={<FileText size={18} />} />
        {invoiceMails.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No invoices yet.</p>
        ) : (
          <div className="space-y-2">
            {invoiceMails.map((mail) => (
              <div key={mail.id} className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{mail.subject}</p>
                  <span className="font-mono text-[11px] text-slate-400">{istDateTime(mail.createdAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{mail.preview}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* invoice viewer */}
      <Modal
        open={Boolean(openInvoice)}
        onClose={() => setOpenInvoice(null)}
        title={`Invoice ${openInvoice?.invoiceNumber ?? ''}`}
        subtitle={openInvoice ? istDateTime(openInvoice.createdAt) : ''}
        wide
      >
        {openInvoice && (
          <div className="space-y-4">
            <div className="space-y-0.5">
              <KV label="Status" value={openInvoice.status.replace(/_/g, ' ')} />
              <KV label="Plan" value={`${openInvoice.planId} · ${openInvoice.cycle} · ${openInvoice.action}`} />
              <KV label="Amount" value={`${formatMoney(openInvoice.amount)} ${openInvoice.currency}`} />
              <KV label="Method" value={openInvoice.method + (openInvoice.cardLast4 ? ` ····${openInvoice.cardLast4}` : '')} />
              <KV label="Order id" value={openInvoice.orderId} mono />
              <KV label="Payment id" value={openInvoice.paymentId ?? '—'} mono />
              <KV label="Signature" value={openInvoice.signature ?? '—'} mono />
              <KV label="Signature verified" value={openInvoice.signatureVerified ? 'Yes ✅' : 'No ❌'} />
              <KV label="Failure reason" value={openInvoice.failureReason ?? '—'} />
              <KV label="Verified at" value={openInvoice.verifiedAt ? istDateTime(openInvoice.verifiedAt) : '—'} />
              <KV label="Retry of" value={openInvoice.retryOf ?? '—'} mono />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              GST is shown as an inclusive 18% split on the invoice e-mail. A production deployment would also store the
              Razorpay fee/ tax breakdown returned by the settlements API.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
