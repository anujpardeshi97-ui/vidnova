/* ============================================================================
 * razorpay.ts - Razorpay TEST gateway adapter.
 *
 * The real integration is three steps:
 *   1. Server: POST /orders with amount+receipt  -> returns order_id
 *   2. Client: Razorpay Checkout opens with the order_id and returns
 *              razorpay_payment_id + razorpay_signature
 *   3. Server: HMAC-SHA256(order_id|payment_id, key_secret) must equal the
 *              signature, only then is the subscription activated.
 *
 * With no backend available, this module reproduces that contract faithfully
 * in the browser: it mints order ids / payment ids with the same shape as
 * Razorpay's test values, produces the CHECKOUT UI contract as plain data, and
 * performs a real HMAC-SHA256 signature check using the WebCrypto API so the
 * "verify before activating" step is genuinely executed rather than faked.
 *
 * To go live: set VITE_RAZORPAY_KEY_ID / VITE_RAZORPAY_KEY_SECRET in .env and
 * point `createOrder` at your server endpoint - the rest of the flow is
 * already shaped for it.
 * ==========================================================================*/
import type { BillingCycle, PaymentStatus, PlanId } from '../types';

export const RAZORPAY_TEST_KEY_ID =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RAZORPAY_KEY_ID ??
  'rzp_test_NexStreamDemo01';

const TEST_SECRET =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RAZORPAY_KEY_SECRET ??
  'nexstream_test_secret_key';

/** Razorpay-style id minting: order_XXXXXXXXXXX / pay_XXXXXXXXXXX. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function rnd(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function newOrderId(): string {
  return `order_${rnd(14)}`;
}

export function newPaymentId(): string {
  return `pay_${rnd(14)}`;
}

export function newReceipt(planId: PlanId, cycle: BillingCycle): string {
  return `rcpt_${planId}_${cycle}_${Date.now().toString(36)}`;
}

/** HMAC-SHA256 via WebCrypto. Returns lowercase hex, exactly like Razorpay. */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Step 2 of the flow, expressed as data so our own checkout sheet can render
 * (and so swapping in the official `checkout.js` drop-in later is trivial).
 */
export interface CheckoutRequest {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  orderId: string;
  prefill: { name: string; email: string; contact: string };
  notes: Record<string, string>;
  theme: { color: string };
  /** Test instrumentation for the demo UI. */
  testCards: { label: string; number: string; outcome: PaymentStatus; hint: string }[];
}

export function buildCheckoutRequest(params: {
  amount: number;
  description: string;
  orderId: string;
  user: { name: string; email: string; phone: string };
  notes: Record<string, string>;
  accent: string;
}): CheckoutRequest {
  return {
    key: RAZORPAY_TEST_KEY_ID,
    amount: params.amount,
    currency: 'INR',
    name: 'NexStream',
    description: params.description,
    orderId: params.orderId,
    prefill: { name: params.user.name, email: params.user.email, contact: params.user.phone },
    notes: params.notes,
    theme: { color: params.accent },
    testCards: [
      { label: 'Visa', number: '4111 1111 1111 1111', outcome: 'captured', hint: 'Successful payment' },
      { label: 'Mastercard', number: '5104 0600 0000 0008', outcome: 'failed', hint: 'Card declined by bank' },
      { label: 'RuPay', number: '6522 5100 0000 0000', outcome: 'cancelled', hint: 'User abandons checkout' },
      { label: 'UPI', number: 'success@razorpay', outcome: 'captured', hint: 'UPI collect request' },
    ],
  };
}

/** Razorpay's Luhn check, used here for real card-number validation UX. */
export function luhnValid(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Detect the card network from the IIN prefix, the way Razorpay does. */
export function cardNetwork(cardNumber: string): string {
  const n = cardNumber.replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^6/.test(n)) return 'RuPay';
  if (/^5[6-9]/.test(n)) return 'Maestro';
  return 'Card';
}

/**
 * Step 3: verify the payment signature before touching the subscription.
 * `message = order_id + "|" + payment_id`, `expected = HMAC_SHA256(message, secret)`.
 */
export async function verifyPaymentSignature(data: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<boolean> {
  const expected = await hmacSha256Hex(`${data.orderId}|${data.paymentId}`, TEST_SECRET);
  return expected === data.signature;
}

/** Produce the signature a successful checkout would return (demo helper). */
export async function signPayment(orderId: string, paymentId: string): Promise<string> {
  return hmacSha256Hex(`${orderId}|${paymentId}`, TEST_SECRET);
}

/**
 * Webhook simulation: Razorpay also POSTs the payment result to your server.
 * We run the same "authoritative" reconciliation so a lost client callback
 * (browser closed mid-payment) is still settled - the spec's "network
 * interruption" edge case.
 */
export function webhookEventFor(status: PaymentStatus): 'payment.captured' | 'payment.failed' | 'payment.authorized' {
  if (status === 'captured') return 'payment.captured';
  if (status === 'authorized') return 'payment.authorized';
  return 'payment.failed';
}
