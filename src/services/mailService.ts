/* ============================================================================
 * mailService.ts - transactional e-mail queue.
 *
 * Every message the platform is specified to send (payment invoice, OTP codes,
 * renewal/expiry notices, security alerts) is composed here and stored in the
 * `mails` table. The UI renders that table as a real inbox, which makes an
 * otherwise invisible backend behaviour demonstrable.
 * ==========================================================================*/
import type { MailMessage, OtpChannel, Plan, Subscription, Transaction, User } from '../types';
import { TABLES, readTable, uid, upsert } from '../lib/storage';
import { formatMoney } from '../lib/format';
import { istDateTime } from '../lib/ist';
import { CYCLE_DISCOUNT } from '../data/plans';

const SUPPORT_EMAIL = 'support@nexstream.test';
const SUPPORT_PHONE = '+91 22 4890 7700';

interface SendInput {
  user: User;
  subject: string;
  preview: string;
  body: string;
  kind: MailMessage['kind'];
  meta?: Record<string, string>;
}

export function sendMail(input: SendInput): MailMessage {
  const mail: MailMessage = {
    id: uid('mail'),
    userId: input.user.id,
    to: input.user.email,
    subject: input.subject,
    preview: input.preview,
    body: input.body,
    kind: input.kind,
    createdAt: Date.now(),
    read: false,
    meta: input.meta,
  };
  upsert(TABLES.MAILS, mail);
  // A real deployment hands this to an SMTP/provider queue; we log it so the
  // flow is observable in the console too.
  console.info(`[mail] -> ${mail.to} :: ${mail.subject}`);
  return mail;
}

export function inbox(userId: string): MailMessage[] {
  return readTable<MailMessage>(TABLES.MAILS)
    .filter((m) => m.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function markRead(mailId: string): void {
  const rows = readTable<MailMessage>(TABLES.MAILS);
  const found = rows.find((m) => m.id === mailId);
  if (found && !found.read) upsert(TABLES.MAILS, { ...found, read: true });
}

export function unreadCount(userId: string): number {
  return inbox(userId).filter((m) => !m.read).length;
}

/* --------------------------- Composed messages ---------------------------- */

const line = '─'.repeat(58);

/**
 * The payment-confirmation e-mail required by the spec: invoice, receipt,
 * subscription details, validity period, transaction information and support
 * contact details, all in one message.
 */
export function sendInvoiceMail(params: {
  user: User;
  plan: Plan;
  subscription: Subscription;
  transaction: Transaction;
  creditCarried: number;
}): MailMessage {
  const { user, plan, subscription, transaction } = params;
  const cycle = CYCLE_DISCOUNT[transaction.cycle];
  const gst = Math.round((transaction.amount * 18) / 118);
  const body = `Hi ${user.name.split(' ')[0]},

Your payment was successful and your ${plan.name} plan is now active on NexStream. 🎉

${line}
INVOICE ${transaction.invoiceNumber}
${line}
Billed to      : ${user.name}
E-mail         : ${user.email}
Phone          : ${user.phone}
Invoice date   : ${istDateTime(transaction.createdAt)}

Item                               Qty      Amount
${plan.name} plan - ${cycle.label} licence            1        ${formatMoney(transaction.amount - gst)}
GST @ 18% (incl.)                                    ${formatMoney(gst)}
${' '.repeat(40)}${'─'.repeat(11)}
TOTAL PAID                                           ${formatMoney(transaction.amount)}

Payment method : ${transaction.method}${transaction.cardLast4 ? ` ending ${transaction.cardLast4}` : ''}
Payment ID     : ${transaction.paymentId ?? '-'}
Order ID       : ${transaction.orderId}
Signature      : ${transaction.signatureVerified ? 'verified ✔' : 'not verified ✖'}
Status         : ${transaction.status.toUpperCase()}

${line}
SUBSCRIPTION DETAILS
${line}
Plan           : ${plan.name} (Tier ${plan.tier})
Cycle          : ${cycle.label} - ${cycle.note}
Validity       : ${istDateTime(subscription.startDate)}  ->  ${istDateTime(subscription.expiryDate)}
Next renewal   : ${subscription.autoRenew ? istDateTime(subscription.expiryDate) : 'Off (auto-renew disabled)'}
Action         : ${transaction.action}
${params.creditCarried > 0 ? `Credit applied : ${formatMoney(params.creditCarried)} (unused value of your previous plan)\n` : ''}
Downloads      : ${plan.dailyDownloadLimit === -1 ? 'Unlimited' : `${plan.dailyDownloadLimit} per day`} ${
    plan.monthlyDownloadLimit === -1 ? '(unlimited monthly)' : `(max ${plan.monthlyDownloadLimit} / month)`
  }
Streaming      : up to ${plan.maxStreamQuality}p${plan.adFree ? ', ad-free' : ''}
Registered on  : ${plan.maxDevices} device(s)
Watch time     : ${plan.dailyWatchMinutes === -1 ? 'Unlimited' : `${plan.dailyWatchMinutes} min / day`}

${line}
Need help? Reply to this e-mail or contact us:
  Support : ${SUPPORT_EMAIL}
  Phone   : ${SUPPORT_PHONE} (Mon-Sat, 09:00-21:00 IST)
  Refund  : 7-day no-questions refund window on first purchase

Thank you for watching with NexStream.
- Team NexStream`;

  return sendMail({
    user,
    subject: `Payment successful - Invoice ${transaction.invoiceNumber} for ${plan.name} plan`,
    preview: `${formatMoney(transaction.amount)} paid. ${plan.name} active until ${istDateTime(subscription.expiryDate)}.`,
    body,
    kind: 'invoice',
    meta: {
      invoiceNumber: transaction.invoiceNumber,
      paymentId: transaction.paymentId ?? '',
      orderId: transaction.orderId,
      amount: formatMoney(transaction.amount),
    },
  });
}

/** OTP delivery e-mail (the "email channel" of 2FA verification). */
export function sendOtpMail(params: {
  user: User;
  code: string;
  context: { browser: string; os: string; deviceType: string; ip: string; location: string };
  expiresInMinutes: number;
  reasons: string[];
}): MailMessage {
  const { user, code, context } = params;
  const body = `Hi ${user.name.split(' ')[0]},

We noticed a sign-in to your NexStream account from a device we do not recognise.

${line}
VERIFICATION CODE
${line}

        ${code}

This code expires in ${params.expiresInMinutes} minutes.

${line}
SIGN-IN DETAILS
${line}
Time      : ${istDateTime(Date.now())}
Browser   : ${context.browser}
OS        : ${context.os}
Device    : ${context.deviceType}
IP address: ${context.ip}
Location  : ${context.location}

Why am I seeing this? We ask for a one-time code whenever we see:
${params.reasons.map((r) => `  • ${r.replace(/_/g, ' ')}`).join('\n')}

If this was you, enter the code above. Once verified, this browser is trusted
for ${user.trustDurationDays} days and you will not be asked again on it.

If this was NOT you, do not enter the code. Change your password immediately
and contact ${SUPPORT_EMAIL} so we can lock the account.

- Team NexStream Security`;

  return sendMail({
    user,
    subject: `Your NexStream verification code: ${code}`,
    preview: `Sign-in from a new ${context.deviceType.toLowerCase()} in ${context.location}. Code expires in ${params.expiresInMinutes} minutes.`,
    body,
    kind: 'otp',
    meta: { code, ip: context.ip, location: context.location },
  });
}

/** Sent on every successful OTP verification (2FA confirmation receipt). */
export function sendTrustedDeviceMail(params: {
  user: User;
  browser: string;
  location: string;
  ip: string;
  trustDays: number;
}): MailMessage {
  return sendMail({
    user: params.user,
    subject: 'New trusted device added to your NexStream account',
    preview: `${params.browser} from ${params.location} is now trusted for ${params.trustDays} days.`,
    body: `Hi ${params.user.name.split(' ')[0]},

${params.browser} signing in from ${params.location} (IP ${params.ip}) passed OTP verification and has been added to your trusted devices.

Trust period : ${params.trustDays} days
Added at     : ${istDateTime(Date.now())}

You can review or revoke trusted devices any time from Account -> Security.

If you did not do this, contact ${SUPPORT_EMAIL} immediately.

- Team NexStream Security`,
    kind: 'security',
    meta: { ip: params.ip, location: params.location },
  });
}

/** Sent when a subscription lapses and the account falls back to Free. */
export function sendDowngradeMail(params: { user: User; previousPlan: Plan; expiryDate: number }): MailMessage {
  return sendMail({
    user: params.user,
    subject: `Your ${params.previousPlan.name} plan has expired - account moved to Free`,
    preview: `Access ended ${istDateTime(params.expiryDate)}. Your watch history and downloads on record are preserved.`,
    body: `Hi ${params.user.name.split(' ')[0]},

Your ${params.previousPlan.name} plan expired on ${istDateTime(params.expiryDate)} and your account has been moved to the Free plan.

WHAT CHANGED
  • Downloads  : ${params.previousPlan.dailyDownloadLimit === -1 ? 'unlimited' : `${params.previousPlan.dailyDownloadLimit}/day`} -> 1/day
  • Streaming  : up to ${params.previousPlan.maxStreamQuality}p -> 360p
  • Watch time : unlimited -> 60 min/day
  • Ads        : ${params.previousPlan.adFree ? 'off' : 'on'} -> on

WHAT IS PRESERVED
  • Your entire watch history and resume positions
  • Your account, playlists and trusted devices
  • Records of past invoices (downloadable from Billing)

Renew any time from the Subscriptions page and every benefit is restored instantly.

- Team NexStream`,
    kind: 'subscription',
    meta: { expiredPlan: params.previousPlan.id, expiry: istDateTime(params.expiryDate) },
  });
}

/** Renewal reminder (T-3 days). */
export function sendRenewalReminder(params: { user: User; plan: Plan; expiryDate: number; amount: number }): MailMessage {
  return sendMail({
    user: params.user,
    subject: `Reminder: your ${params.plan.name} plan renews on ${istDateTime(params.expiryDate)}`,
    preview: `${formatMoney(params.amount)} will be charged automatically. Manage or cancel from Billing.`,
    body: `Hi ${params.user.name.split(' ')[0]},

Your ${params.plan.name} plan renews automatically on ${istDateTime(params.expiryDate)}.

Amount      : ${formatMoney(params.amount)}
Method      : the card/UPI mandate saved with Razorpay
Cancel by   : ${istDateTime(params.expiryDate - 86_400_000)}

You can cancel or switch plans any time from Subscriptions -> Manage. Cancelling
keeps your benefits until the end of the current period.

- Team NexStream`,
    kind: 'subscription',
    meta: { expiry: istDateTime(params.expiryDate) },
  });
}

export function sendWelcomeMail(user: User): MailMessage {
  return sendMail({
    user,
    subject: 'Welcome to NexStream',
    preview: 'Your account is ready. Here is what you can do right away.',
    body: `Hi ${user.name.split(' ')[0]},

Welcome to NexStream! Your account is ready.

  • Browse the catalogue and stream free titles immediately
  • Download 1 video per day on the Free plan
  • Upgrade to Bronze, Silver or Gold for higher limits, HD/4K and ad-free viewing
  • Start a video call with up to 4 people (50 on Gold)

One security note: we will e-mail you a one-time code whenever you sign in from
a new browser, device, IP or city. Verified devices are remembered for
${user.trustDurationDays} days.

Happy watching,
- Team NexStream`,
    kind: 'welcome',
  });
}

export { SUPPORT_EMAIL, SUPPORT_PHONE, OtpChannel };
