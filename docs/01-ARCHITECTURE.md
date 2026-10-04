# NexStream — Architecture Overview

> A subscription video platform with tiered download limits, Razorpay test payments,
> adaptive IST theming, OTP device verification, a fully custom HTML5 player and
> real-time video calling.
>
> **Stack:** React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · lucide-react · zero backend

---

## 1. Running without a backend (and how that shapes the code)

The platform is delivered as a single-page application with no server component, so every
"backend" concern is implemented **client-side but behind a service API that mirrors a real backend
contract**. The rules are not scattered through the UI: each one is a function in `src/services/`,
with the same signature it would have as a REST endpoint.

What that means concretely:

| Backend concern | How it is implemented here | What changes in production |
|---|---|---|
| Database | `src/lib/storage.ts` — namespaced JSON tables in `localStorage` | swap for Postgres/MySQL; the repository functions keep the same signatures |
| Auth + sessions | `src/services/securityService.ts` (hashing, OTP, device trust) | move to `/api/auth/*` with httpOnly cookies and bcrypt/argon2 |
| Payments | `src/services/paymentService.ts` + `src/lib/razorpay.ts` — real HMAC-SHA256 signature verification via WebCrypto, order/payment id shapes identical to Razorpay's | point `createOrder` at your `/api/orders`; signature check moves server-side |
| E-mail | `src/services/mailService.ts` writes to a `mails` table rendered as an in-app inbox | hand the same objects to SendGrid/SES |
| Webhooks | `reconcile()` simulates the `payment.captured` webhook so lost callbacks still settle | real webhook route calling the same function |
| File transfer | `downloadService` drives byte progress with a resumable offset | point it at a signed CDN URL and use HTTP Range requests |

Every service is written so that the swap is a function-body change, not a rewrite: the UI only
ever calls `requestDownload()`, `processCheckout()` or `attemptLogin()` — never `localStorage`
directly, and never a rule of its own.

---

## 2. Layered structure

```
┌──────────────────────────────────────────────────────────────────┐
│  PAGES            HomePage · WatchPage · SubscriptionsPage …     │  UI composition
├──────────────────────────────────────────────────────────────────┤
│  COMPONENTS       VideoPlayer · Downloads · CheckoutSheet · ui   │  reusable widgets
├──────────────────────────────────────────────────────────────────┤
│  CONTEXT          AppContext — session, theme, route, toasts     │  global state
├──────────────────────────────────────────────────────────────────┤
│  SERVICES         download · subscription · payment · security   │  ALL business rules
│                   mail · call · watch · db                        │
├──────────────────────────────────────────────────────────────────┤
│  DATA             plans · videos · thumbnails                     │  configuration
├──────────────────────────────────────────────────────────────────┤
│  LIB              storage · ist · format · device · geo ·         │  primitives
│                   security · razorpay                             │
├──────────────────────────────────────────────────────────────────┤
│  TYPES            one file describing every persisted entity      │  contracts
└──────────────────────────────────────────────────────────────────┘
```

**The one rule that keeps this maintainable:** business decisions live in `src/services/*` and
nowhere else. A page may render a "Download" button, but whether that download is *allowed* is
decided by `requestDownload()` in `downloadService.ts`. That is why the same eight gates protect
the watch page, the downloads page and any future client — and why deleting a UI component can
never accidentally remove a security rule.

### Dependency direction

```
types  ←  lib  ←  data  ←  services  ←  context  ←  components  ←  pages  ←  App
```

Nothing ever imports upwards. `services/` never imports a React component; `lib/` never imports a
service. This is what makes the service layer testable headlessly — see
`scripts/verify-rules.ts`, which exercises the entire rule engine with no browser at all.

---

## 3. The data model (16 tables)

All tables live under the `nexstream:1:<table>` namespace and are declared in
`src/types/index.ts`.

| Table | Entity | Written by | Purpose |
|---|---|---|---|
| `users` | `User` | securityService, db | profile, hashed password, theme preference, trusted devices |
| `subscriptions` | `Subscription` | subscriptionService, db | one row per purchase/renewal/upgrade, with validity dates |
| `orders` | `PaymentOrder` | paymentService | Razorpay order created before checkout, with an idempotency key |
| `transactions` | `Transaction` | paymentService | captured/failed/cancelled/duplicate/verification_failed payments |
| `downloads` | `DownloadRecord` | downloadService | the offline library + full audit columns |
| `downloadAudit` | `DownloadAuditEntry` | downloadService | every request, authorisation, block, duplicate, failure |
| `quotas` | `QuotaState` | downloadService | daily/monthly counters keyed by IST day and month |
| `loginRecords` | `LoginRecord` | securityService | IP, browser, OS, device, city/state/country, theme, outcome |
| `otpCodes` | `PendingOtp` | securityService | pending challenges with expiry + attempt counter |
| `mails` | `MailMessage` | mailService | invoices, OTPs, security alerts, downgrade notices |
| `watchProgress` | `WatchProgress` | watchService | resume position, completion flag, minutes watched today |
| `watchEvents` | `WatchEvent` | watchService | play/pause/seek/complete telemetry |
| `callRooms` | `CallRoomState` | callService | room flags (lock, chat, screen share, recording) |
| `callChat` | `CallChatMessage` | callService | in-call messages, emojis, file references |
| `callLogs` | `CallLogEntry` | callService | call history with duration and participant count |
| `recordings` | `RecordingSession` | callService | start/stop lifecycle, size estimate, host-only access |

### Key relationships

```
User ─1:N─ Subscription ─1:N─ Transaction ─N:1─ PaymentOrder
  │
  ├─1:N─ DownloadRecord ─1:N─ DownloadAuditEntry
  ├─1:1─ QuotaState
  ├─1:N─ LoginRecord
  ├─1:N─ TrustedDevice (embedded in User)
  ├─1:N─ WatchProgress
  └─1:N─ MailMessage
```

---

## 4. The four big flows

### 4.1 Download authorisation — eight gates, in order

```
requestDownload({ user, video, quality, device, geo })
  │
  ├─ Gate 0  audit: "request"                       always recorded, even for blocks
  ├─ Gate 1  active subscription?   ── reconcile expiry first ──▶ block: subscription_expired
  ├─ Gate 2  content tier (video.minTier ≤ plan.tier)          ──▶ block: plan_required
  ├─ Gate 2b quality within plan cap                            ──▶ block: quality_not_allowed
  ├─ Gate 3  duplicate window (24h)  ──▶ duplicate (quota untouched)
  ├─ Gate 4  registered devices (plan.maxDevices)               ──▶ block: device_limit
  ├─ Gate 5  concurrency (free 1, paid 2, gold 3)               ──▶ block: concurrency
  ├─ Gate 6  daily quota (IST day key)                          ──▶ block: daily_quota
  ├─ Gate 7  monthly quota (IST month key)                      ──▶ block: monthly_quota
  └─ Gate 8  AUTHORISED → reserve quota → audit → transfer
```

Fault handling after the transfer starts:

| Event | Effect on the record | Effect on quota |
|---|---|---|
| Completed | `completed`, `quotaAfter` stored | consumed |
| Paused → resumed | keeps `downloadedBytes`, resumes from that offset | still consumed |
| Interrupted | `interrupted`, resumable | kept (resume does not double-charge) |
| Failed | `failed` + `failureReason`, retryable | **refunded** |
| Cancelled by user | `cancelled` | **refunded** |
| Subscription lapses mid-transfer | `expired_access`, transfer aborted | consumed record kept for audit |
| Re-download of a completed title inside 24h | links to the existing record | **not consumed** |

### 4.2 Payment flow — verify before you trust

```
createOrder()          → order_XXXX (idempotency key = user:plan:cycle:minute)
processCheckout()
   ├─ already captured for this order?        → duplicate (no second charge, no re-activation)
   ├─ user abandoned checkout                 → cancelled
   ├─ bank declined                           → failed
   ├─ connection dropped after the charge     → pending + webhookOutcome=captured
   └─ checkout returned pay_XXX + signature
         ├─ HMAC-SHA256(order_id|payment_id, secret) ≠ signature → verification_failed  ❌ NO ACCESS
         └─ signature verified ✔ → activate subscription → invoice e-mail → plan switch
webhook (reconcile)  → settles any pending order, then sweeps lapsed subscriptions
```

The single most important branch in the codebase is the one above: **a signature mismatch must
never activate a subscription**. `verifyPaymentSignature()` in `src/lib/razorpay.ts` performs a real
WebCrypto HMAC, and the test harness proves a tampered signature leaves the plan unchanged.

### 4.3 Login → theme + step-up OTP

```
attemptLogin(email, password)
  ├─ capture device (UA parsing) + geo (IP → city/state/country) + IST hour
  ├─ bad credentials → ONE generic audit row (no account enumeration)
  └─ valid
      ├─ device already trusted and window unexpired → session, no OTP
      └─ new browser / device / IP / city / state   → OTP e-mail
            ├─ wrong code  → attempts++, audited
            ├─ 5 failures  → challenge blocked
            ├─ expired     → rejected (10-minute TTL)
            └─ correct     → device trusted for 30 days, theme applied, session created
```

Theme rule: `themeForIstLogin()` returns `light` for IST hours `05:00–11:59` and `dark` otherwise.
The result is written to the **user profile** (`users.theme`), so it survives logout, other sessions
and other devices — unless the user pinned a manual choice (`themeLockedByUser = true`).

### 4.4 Video call lifecycle

```
createRoom() → room id nx-xxxx-xxxx → copy link
join      → real getUserMedia (camera/mic), graceful audio-only fallback on denial
roster    → each tab heartbeats its participant row every 2s; stale rows (>8s) pruned
chat      → localStorage + BroadcastChannel, so two tabs genuinely talk to each other
moderation→ lock, mute-all, remove, promote, per-feature permissions
recording → Gold host only; start/stop lifecycle stored for the host
resilience→ permission denial keeps you in the room; reconnection restores media; participant cap enforced
```

---

## 5. Configuration over conditionals

Plans are data, not `if` statements. Adding a "Platinum" plan means adding one object to
`src/data/plans.ts` — every gate, card, table and invoice picks it up automatically because they all
read `getPlan(planId)`:

| | Free | Bronze | Silver | Gold |
|---|---|---|---|---|
| Price / month | ₹0 | ₹199 | ₹399 | ₹699 |
| Downloads / day | 1 | 3 | 10 | unlimited |
| Downloads / month | 5 | 25 | 100 | unlimited |
| Max quality | 360p | 720p | 1080p | 2160p |
| Watch time / day | 60 min | 180 min | unlimited | unlimited |
| Registered devices | 1 | 2 | 3 | 5 |
| Download retention | 24 h | 30 d | 90 d | while subscribed |
| Ad-free | no | no | yes | yes |
| Exclusive courses | no | no | no | yes |
| Call participants | 4 | 10 | 25 | 50 |
| Concurrency cap | 1 | 2 | 2 | 3 |

Cycle multipliers: monthly ×1 · quarterly ×2.7 (10% off) · yearly ×9.6 (20% off).

---

## 6. Money, time and IDs — the three invariants

1. **Money is in paise.** Every amount is an integer in the smallest currency unit, exactly like
   Razorpay. `formatMoney()` divides by 100 only at render time. No float drift anywhere.
2. **Time is IST.** Quotas key on `istDayKey()`/`istMonthKey()`, the theme on `istHour()`, all
   displayed timestamps on `istDateTime()`. The browser's own timezone is never used for a business
   rule, so the platform behaves identically for a user in Mumbai and one in London.
3. **IDs carry meaning.** `order_`/`pay_` mirror Razorpay, `NS-2026-000123` is a monotonic invoice
   number, `nx-…` is a shareable room code, `dl_…`/`aud_…`/`usr_…` are table-local.
