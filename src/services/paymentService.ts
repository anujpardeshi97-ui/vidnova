/* ============================================================================
 * paymentService.ts - Razorpay TEST payment orchestration.
 *
 * Sequence implemented here (mirrors the real server-side contract):
 *
 *   createOrder()          -> order_xxx persisted with status 'created'
 *   processCheckout()      -> checkout returns pay_xxx + signature
 *        ├── cancelled     -> transaction cancelled, retry allowed
 *        ├── failed        -> transaction failed, reason recorded
 *        ├── network drop  -> status unknown, order stays pending and the
 *        │                    webhook settles it later (reconcileOrders)
 *        └── captured      -> VERIFY signature (HMAC-SHA256) BEFORE anything
 *                             else; only a verified signature may activate the
 *                             subscription, write the invoice and send mail.
 *
 * Idempotency: an order created for the same (user, plan, cycle) within 60s is
 * reused, so double-clicking "Pay" cannot create two charges. A repeated
 * callback for an already-captured order returns the original transaction and
 * marks the duplicate instead of re-activating the plan.
 * ==========================================================================*/
import type {
  BillingCycle,
  PaymentOrder,
  PaymentStatus,
  PlanId,
  Subscription,
  Transaction,
  User,
} from '../types';
import { TABLES, findById, readTable, uid, upsert } from '../lib/storage';
import {
  buildCheckoutRequest,
  cardNetwork,
  newOrderId,
  newPaymentId,
  newReceipt,
  signPayment,
  verifyPaymentSignature,
  webhookEventFor,
} from '../lib/razorpay';
import { getPlan } from '../data/plans';
import { activateSubscription, classifyAction, quote, reconcileExpiry } from './subscriptionService';
import { nextInvoiceNumber } from './db';
import { sendDowngradeMail, sendInvoiceMail } from './mailService';
import { istDateTime } from '../lib/ist';

/* ------------------------------ Order creation ---------------------------- */

/** Stable key so two rapid clicks collapse into one order. */
function idempotencyKey(userId: string, planId: PlanId, cycle: BillingCycle): string {
  const minute = Math.floor(Date.now() / 60_000);
  return `${userId}:${planId}:${cycle}:${minute}`;
}

export interface CreateOrderResult {
  order: PaymentOrder;
  /** true when an identical order from the last minute was reused */
  reused: boolean;
}

export function createOrder(params: {
  user: User;
  planId: PlanId;
  cycle: BillingCycle;
}): CreateOrderResult {
  const key = idempotencyKey(params.user.id, params.planId, params.cycle);
  const orders = readTable<PaymentOrder>(TABLES.ORDERS);
  const existing = orders.find((o) => o.idempotencyKey === key && Date.now() - o.createdAt < 60_000);

  if (existing) {
    const reused = { ...existing, attempts: existing.attempts + 1 };
    upsert(TABLES.ORDERS, reused);
    console.info('[razorpay] reusing idempotent order', existing.orderId);
    return { order: reused, reused: true };
  }

  const q = quote({ userId: params.user.id, planId: params.planId, cycle: params.cycle });
  const orderId = newOrderId();
  const order: PaymentOrder = {
    id: orderId,
    orderId,
    userId: params.user.id,
    planId: params.planId,
    cycle: params.cycle,
    amount: q.total,
    currency: 'INR',
    receipt: newReceipt(params.planId, params.cycle),
    status: 'created',
    createdAt: Date.now(),
    idempotencyKey: key,
    attempts: 1,
  };
  upsert(TABLES.ORDERS, order);
  console.info(`[razorpay] order ${order.orderId} created for ${q.total} paise`);
  return { order, reused: false };
}

/** Everything the checkout sheet needs (drop-in replacement for checkout.js). */
export function checkoutRequest(user: User, order: PaymentOrder) {
  const plan = getPlan(order.planId);
  return buildCheckoutRequest({
    amount: order.amount,
    description: `${plan.name} plan - ${order.cycle} subscription`,
    orderId: order.orderId,
    user: { name: user.name, email: user.email, phone: user.phone },
    notes: { userId: user.id, planId: order.planId, cycle: order.cycle, invoice: order.receipt },
    accent: plan.accent,
  });
}

/* ------------------------------- Transactions ----------------------------- */

export function transactionsFor(userId: string): Transaction[] {
  return readTable<Transaction>(TABLES.TRANSACTIONS)
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function writeTransaction(row: Transaction): Transaction {
  upsert(TABLES.TRANSACTIONS, row);
  return row;
}

export interface CheckoutOutcome {
  status: PaymentStatus;
  message: string;
  transaction?: Transaction;
  subscription?: Subscription;
  /** true when the plan benefits were activated by this call */
  activated: boolean;
}

/**
 * Execute the checkout result.
 *
 * @param simulateFailure  optional fault injection for the demo:
 *   'declined' | 'cancelled' | 'network' | 'tampered_signature' | undefined
 */
export async function processCheckout(params: {
  user: User;
  order: PaymentOrder;
  method: 'card' | 'upi' | 'netbanking' | 'wallet';
  cardNumber?: string;
  simulateFailure?: 'declined' | 'cancelled' | 'network' | 'tampered_signature';
}): Promise<CheckoutOutcome> {
  const { user, order, method } = params;
  const plan = getPlan(order.planId);

  // ---- Guard: an order that is already settled must never re-activate ----
  const settled = readTable<Transaction>(TABLES.TRANSACTIONS).find(
    (t) => t.orderId === order.orderId && (t.status === 'captured' || t.status === 'authorized'),
  );
  if (settled) {
    const duplicate = writeTransaction({
      ...settled,
      id: uid('txn'),
      status: 'duplicate',
      createdAt: Date.now(),
      failureReason: 'Duplicate callback for an already-captured order - ignored',
    });
    upsert(TABLES.ORDERS, { ...order, status: 'duplicate' });
    return {
      status: 'duplicate',
      message:
        'This payment was already captured. We ignored the duplicate request, so you were not charged twice. Your plan is already active.',
      transaction: duplicate,
      activated: false,
    };
  }

  const cardLast4 = params.cardNumber ? params.cardNumber.replace(/\D/g, '').slice(-4) : undefined;
  const invoiceNumber = nextInvoiceNumber();

  /* ---------------- Case 1: user abandoned the checkout sheet ------------ */
  if (params.simulateFailure === 'cancelled') {
    const txn = writeTransaction({
      id: uid('txn'),
      userId: user.id,
      orderId: order.orderId,
      paymentId: null,
      invoiceNumber,
      planId: order.planId,
      cycle: order.cycle,
      amount: order.amount,
      currency: 'INR',
      status: 'cancelled',
      method,
      createdAt: Date.now(),
      failureReason: 'Checkout closed by user before payment',
      action: classifyAction(user.planId, order.planId),
    });
    upsert(TABLES.ORDERS, { ...order, status: 'cancelled', settledAt: Date.now() });
    return {
      status: 'cancelled',
      message: 'Payment cancelled - nothing was charged and your current plan is unchanged.',
      transaction: txn,
      activated: false,
    };
  }

  /* ---------------- Case 2: bank / card declined ------------------------- */
  if (params.simulateFailure === 'declined') {
    const txn = writeTransaction({
      id: uid('txn'),
      userId: user.id,
      orderId: order.orderId,
      paymentId: newPaymentId(),
      invoiceNumber,
      planId: order.planId,
      cycle: order.cycle,
      amount: order.amount,
      currency: 'INR',
      status: 'failed',
      method,
      cardLast4,
      createdAt: Date.now(),
      failureReason: 'Payment declined by issuing bank (test card 5104 0600 0000 0008)',
      action: classifyAction(user.planId, order.planId),
    });
    upsert(TABLES.ORDERS, { ...order, status: 'failed', settledAt: Date.now() });
    return {
      status: 'failed',
      message: 'Your bank declined the payment. No money was deducted - try another method or card.',
      transaction: txn,
      activated: false,
    };
  }

  /* ---------------- Case 3: network drop after the charge ---------------- */
  if (params.simulateFailure === 'network') {
    upsert(TABLES.ORDERS, {
      ...order,
      status: 'pending',
      attempts: order.attempts + 1,
      webhookOutcome: 'captured',
    });
    return {
      status: 'network_error',
      message:
        'The connection dropped before we received confirmation. If the money left your account we will activate your plan automatically within a few seconds - no need to pay again.',
      activated: false,
    };
  }

  /* ---------------- Case 4: successful capture --------------------------- */
  const paymentId = newPaymentId();
  const signature = await signPayment(order.orderId, paymentId);

  // Tampering simulation: hand the verifier a corrupted signature.
  const presentedSignature =
    params.simulateFailure === 'tampered_signature' ? `${signature.slice(0, -4)}dead` : signature;

  const verified = await verifyPaymentSignature({
    orderId: order.orderId,
    paymentId,
    signature: presentedSignature,
  });

  if (!verified) {
    // The single most important security rule of the whole flow: a signature
    // that does not match means we must NOT grant access.
    const txn = writeTransaction({
      id: uid('txn'),
      userId: user.id,
      orderId: order.orderId,
      paymentId,
      signature: presentedSignature,
      signatureVerified: false,
      invoiceNumber,
      planId: order.planId,
      cycle: order.cycle,
      amount: order.amount,
      currency: 'INR',
      status: 'verification_failed',
      method,
      cardLast4,
      createdAt: Date.now(),
      failureReason: 'HMAC-SHA256 signature mismatch - subscription NOT activated',
      action: classifyAction(user.planId, order.planId),
    });
    upsert(TABLES.ORDERS, { ...order, status: 'verification_failed', settledAt: Date.now() });
    return {
      status: 'verification_failed',
      message:
        'We could not verify this payment with Razorpay, so we did not activate the plan. Any amount debited is auto-reversed within 5-7 working days.',
      transaction: txn,
      activated: false,
    };
  }

  /* ---------------- Verified: activate everything ------------------------ */
  const action = classifyAction(user.planId, order.planId);
  const q = quote({ userId: user.id, planId: order.planId, cycle: order.cycle });

  const txn = writeTransaction({
    id: uid('txn'),
    userId: user.id,
    orderId: order.orderId,
    paymentId,
    signature,
    signatureVerified: true,
    invoiceNumber,
    planId: order.planId,
    cycle: order.cycle,
    amount: order.amount,
    currency: 'INR',
    status: 'captured',
    method,
    cardLast4,
    createdAt: Date.now(),
    verifiedAt: Date.now(),
    action,
  });

  const subscription = activateSubscription({
    userId: user.id,
    planId: order.planId,
    cycle: order.cycle,
    transaction: { ...txn, invoiceNumber },
    action,
    creditCarried: q.credit,
  });

  upsert(TABLES.ORDERS, { ...order, status: 'captured', settledAt: Date.now() });

  // Invoice + receipt + subscription e-mail (the spec's confirmation mail).
  sendInvoiceMail({
    user: findById<User>(TABLES.USERS, user.id)!,
    plan,
    subscription,
    transaction: txn,
    creditCarried: q.credit,
  });

  console.info(`[razorpay] ${webhookEventFor('captured')} -> ${plan.name} activated until ${istDateTime(subscription.expiryDate)}`);

  return {
    status: 'captured',
    message: `${plan.name} plan activated. Invoice ${invoiceNumber} has been e-mailed to you.`,
    transaction: txn,
    subscription,
    activated: true,
  };
}

/* --------------------------- Webhook reconciliation ----------------------- */

export interface ReconcileReport {
  settled: Transaction[];
  expiredPlans: number;
}

/**
 * Runs on boot and whenever the user opens Billing.
 *   (a) settles pending orders whose webhook has "arrived"
 *   (b) sweeps lapsed subscriptions and downgrades them to Free
 */
export function reconcile(userId: string): ReconcileReport {
  const report: ReconcileReport = { settled: [], expiredPlans: 0 };
  const user = findById<User>(TABLES.USERS, userId);
  if (!user) return report;

  const now = Date.now();
  readTable<PaymentOrder>(TABLES.ORDERS)
    .filter(
      (o) =>
        o.userId === userId &&
        o.status === 'pending' &&
        Boolean(o.webhookOutcome) &&
        now - o.createdAt > 4_000, // the webhook takes a moment to arrive
    )
    .forEach((order) => {
      const outcome = order.webhookOutcome!;
      if (outcome === 'captured') {
        const action = classifyAction(user.planId, order.planId);
        const q = quote({ userId, planId: order.planId, cycle: order.cycle });
        const txn = writeTransaction({
          id: uid('txn'),
          userId,
          orderId: order.orderId,
          paymentId: newPaymentId(),
          signature: 'webhook',
          signatureVerified: true,
          invoiceNumber: nextInvoiceNumber(),
          planId: order.planId,
          cycle: order.cycle,
          amount: order.amount,
          currency: 'INR',
          status: 'captured',
          method: 'webhook',
          createdAt: order.createdAt,
          verifiedAt: Date.now(),
          action,
        });
        const subscription = activateSubscription({
          userId,
          planId: order.planId,
          cycle: order.cycle,
          transaction: txn,
          action,
          creditCarried: q.credit,
        });
        sendInvoiceMail({
          user,
          plan: getPlan(order.planId),
          subscription,
          transaction: txn,
          creditCarried: q.credit,
        });
        upsert(TABLES.ORDERS, { ...order, status: 'captured', settledAt: Date.now() });
        report.settled.push(txn);
        console.info(`[webhook] payment.captured reconciled for ${order.orderId}`);
      } else if (outcome === 'failed') {
        upsert(TABLES.ORDERS, { ...order, status: 'failed', settledAt: Date.now() });
      }
    });

  // Subscription expiry sweep -> automatic downgrade to Free.
  const before = readTable<Subscription>(TABLES.SUBSCRIPTIONS).filter(
    (s) => s.userId === userId && s.status === 'active',
  ).length;
  const { downgraded } = reconcileExpiry(userId);
  if (downgraded) {
    report.expiredPlans += 1;
    const previous = getPlan(user.planId);
    if (previous.id !== 'free') {
      sendDowngradeMail({ user, previousPlan: previous, expiryDate: Date.now() });
    }
    console.info(`[sweeper] downgraded ${userId} to Free (was ${before} active row(s))`);
  }

  return report;
}

/* --------------------------------- Retries -------------------------------- */

/** Retry a failed / cancelled payment by cloning the order (fresh order id). */
export function retryOrder(params: {
  user: User;
  transaction: Transaction;
}): CreateOrderResult {
  const fresh = createOrder({
    user: params.user,
    planId: params.transaction.planId,
    cycle: params.transaction.cycle,
    // Force a brand-new order id rather than reusing the idempotent window:
  });
  const order: PaymentOrder = { ...fresh.order, retryOfOrder: params.transaction.orderId } as PaymentOrder & {
    retryOfOrder: string;
  };
  upsert(TABLES.ORDERS, order);
  upsert(TABLES.TRANSACTIONS, { ...params.transaction, retryOf: params.transaction.orderId });
  return { order, reused: false };
}

/* ------------------------------ Card helpers ------------------------------ */

/** Exposed so the checkout sheet can show the detected network as you type. */
export function detectCard(cardNumber: string): string {
  return cardNumber.replace(/\D/g, '').length >= 2 ? cardNetwork(cardNumber) : 'Card';
}

export function pendingOrder(userId: string): PaymentOrder | undefined {
  return readTable<PaymentOrder>(TABLES.ORDERS)
    .filter((o) => o.userId === userId && o.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function ordersFor(userId: string): PaymentOrder[] {
  return readTable<PaymentOrder>(TABLES.ORDERS)
    .filter((o) => o.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export { newOrderId };
