# File-by-file explanation — Part 2: the service layer

> This is where every rule lives. If you read only one document, read this one.
> Line numbers refer to the shipped files.

Service layer map:

| File | Lines | Responsibility |
|---|---|---|
| `db.ts` | 233 | seeding, session pointer, invoice numbering |
| `subscriptionService.ts` | 379 | plans, entitlements, quotes, lifecycle, expiry sweep |
| `downloadService.ts` | 819 | the eight-gate download pipeline, quotas, audit, transfer engine |
| `paymentService.ts` | 475 | Razorpay orders, checkout outcomes, signature gate, webhook reconcile |
| `mailService.ts` | 303 | invoice / OTP / security / downgrade e-mails |
| `securityService.ts` | 452 | login, OTP issue + verify, device trust, login audit |
| `watchService.ts` | 157 | resume positions, watch-time budget, single-playback lock |
| `callService.ts` | 486 | rooms, participants, moderation, chat, media, roster |

---

## 1. `src/services/db.ts` (233 lines) — bootstrap and session

| Lines | What it does |
|---|---|
| 14–20 | `SESSION_KEY = 'nexstream:session'` and the `Session` interface: **which** user is signed in, plus the login timestamp, applied theme, device fingerprint, IP and location captured at that moment. The session is deliberately a small pointer — the authoritative user row lives in the `users` table. |
| 24–45 | `getSession` / `setSession` / `currentUserId` / `currentUser`. `getSession` tolerates corrupt JSON by returning `null` (signed out) rather than throwing. |
| 47–94 | `DEMO_ACCOUNTS` — Priya Sharma (Free) and Arjun Mehta (Gold, 12 days into a monthly cycle), both `Demo@1234`. Two accounts exist so a reviewer can compare a free and a paid experience side by side without registering. |
| 96–130 | **`buildSubscription(params)`** — the single factory for subscription rows. Notable lines: the cycle→months mapping (1/3/12); `expiryDate` computed as `addDays(start, 3650)` for Free and `addMonths(start, months)` for paid — giving Free a far-future expiry that keeps "is this active?" a single comparison; and `autoRenew: planId !== 'free'`. |
| 132–137 | `nextInvoiceNumber()` — `NS-2026-000123`, derived from the row count so numbers are monotonic and never reused. A real deployment would use a database sequence. |
| 139–212 | **`seedDatabase()`** — idempotent: it returns immediately if any user exists, so it never clobbers real activity. It creates the two accounts (with hashed passwords and `themeLockedByUser` inverted from `autoThemeOnLogin`), then subscription rows — an expired earlier cycle plus the running cycle for the paid user — and finally a quota row per user keyed to the current IST day/month. |
| 214–219 | `hardReset()` — clears both storages and re-seeds. Backs the "Reset all demo data" button. |
| 221–226 | `daysUntil(ts)` — used for "x days remaining" copy. |
| 228–233 | Re-exports `addDays` so callers do not need two imports. |

---

## 2. `src/services/subscriptionService.ts` (379 lines) — the entitlement authority

**The contract of this module:** the UI never reads `plan.dailyDownloadLimit` to decide anything.
It asks `canStream()`, `canDownloadAtAll()`, `qualityCap()` or `effectivePlan()`. That is how one
rule change propagates everywhere at once.

| Lines | What it does |
|---|---|
| 32–38 | `subscriptionHistory(userId)` — all rows newest first. History is never deleted, which is what lets the billing screen show expired periods after an upgrade. |
| 40–48 | `activeSubscription(userId)` — the row that governs access right now: `status` active **or** cancelled (cancelled means "runs to period end"), and `expiryDate > now`. One function, used by every gate. |
| 50–101 | **`reconcileExpiry(userId)`** — the sweeper. It (a) flips any active-but-past-expiry row to `expired`, (b) re-points `users.planId` at whatever plan is genuinely active, and (c) if nothing is active, ensures a Free baseline row exists (**creating one if necessary**). It returns `{downgraded, subscription}` so callers can decide whether to send a downgrade e-mail. This is the function that implements "expired subscriptions are automatically downgraded to the Free plan while preserving user data and watch history" — nothing is deleted, and watch history lives in its own table so it is untouched. |
| 103–110 | `effectivePlan(userId)` — resolves to a `Plan` object, defaulting to Free. Note the fallback: an unknown or missing subscription can only ever be *more* restrictive, never more permissive. |
| 112–136 | `canStream(userId, video)` — public titles pass; otherwise plan tier must be ≥ `video.minTier`. On refusal it returns a sentence naming the required plan, which the UI renders verbatim inside a toast and in the player's locked overlay. |
| 138–141 | `qualityCap(userId)` — highest stream height the plan allows. |
| 143–165 | `canDownloadAtAll(userId)` — the coarse check used for UI affordances: no subscription → refused; **expired** → refused with a renewal message; plan without the offline feature → refused. It explains *why* in each case rather than returning a bare boolean. |
| 167–215 | `Quote` + **`quote({userId, planId, cycle})`** — builds a payable quote. The interesting part is the pro-rata credit: if the current paid period is still running, the unused fraction of what was paid is computed as `pricePaid × (expiry - now) / (expiry - start)` and subtracted from the new plan's price. GST is then shown as an **inclusive 18% split** (`net × 18 / 118`) so the invoice adds up without pretending tax is extra. |
| 217–224 | `classifyAction(current, target)` — tier comparison → `new` / `upgrade` / `downgrade` / `renew`. Drives button labels, the invoice line and the subscription row's `action`. |
| 226–290 | **`activateSubscription({…})`** — the only function allowed to grant a plan, and it is called *only* by `paymentService` after signature verification. Two paths: a same-plan renewal **extends the existing row's `expiryDate`** (never restarts the period, so the user does not lose days), while a plan change closes the running row (`cancelled` for a downgrade, `expired` for an upgrade — both preserved for history) and creates a new one with `previousPlanId` recorded. |
| 292–308 | `cancelSubscription(userId, reason)` — sets `status: 'cancelled'`, `cancelledAt`, `autoRenew: false`. Access continues because `activeSubscription()` still matches cancelled rows inside their validity window. Free cannot be "cancelled". |
| 310–316 | `resumeSubscription(userId)` — undoes a cancellation before the period ends. |
| 318–325 | `billingHistory(userId)` — transactions newest first for the billing table. |
| 327–336 | `statusSentence(sub)` — one human sentence for dashboards and e-mails. |
| 338–375 | `overview(userId)` — everything the subscription dashboard needs in a single pass: current row, plan, status, `daysRemaining`, `percentElapsed` (validity bar), next renewal, full history, transactions and `totalPaid` (captured transactions only). It calls `reconcileExpiry()` first, so simply *opening* the page heals a lapsed account. |
| 377–385 | `planQuota(planId)` — quota labels for the plan cards. |

---

## 3. `src/services/downloadService.ts` (819 lines) — the controlled download system

This file is the heart of the specification. It is organised as: constants → quota engine → audit →
readers → emitter → quality rules → **the pipeline** → the transfer engine → user controls → fault
injection → library stats.

### Constants (lines 40–60)

| Lines | Constant | Meaning |
|---|---|---|
| 44–46 | `DUPLICATE_WINDOW_MS = 24h` | Re-downloading the same title inside this window is served from cache and does **not** consume quota. |
| 48–54 | `RETENTION_DAYS` | How long a completed file stays usable: Free 1 day, Bronze 30, Silver 90, Gold effectively while subscribed (3650). |
| 56–58 | `CONCURRENT_LIMIT` | Simultaneous transfers: Free 1, Bronze 2, Silver 2, Gold 3. |
| 60 | `QUALITY_ORDER` | Ascending rendition order for comparisons. |

### Quota engine (lines 62–160)

| Lines | What it does |
|---|---|
| 70–110 | **`getQuota(userId)`** — reads the bucket and **lazily applies the IST rollover before anything else**. If `dayKey` is stale, `usedToday` resets and a `quota_reset` audit row is written; same for `monthKey`. Lazy-on-read is deliberately defensive: it behaves correctly even if the app was closed across midnight, which a cron-only design would not. Missing buckets are created on first use. |
| 112–126 | `consumeQuota` / `releaseQuota` — reserve one unit (after all gates pass) and give one back (on failure/cancel/interruption), both clamped at zero so a double release can never create negative usage. |
| 128–160 | `QuotaSnapshot` + `quotaSnapshot(userId)` — the shape the UI consumes: limits (`-1` = unlimited), used counts, **remaining** counts, day/month keys and percentages for the progress bars. |

### Audit (lines 162–180)

`writeAudit(entry)` appends to the `downloadAudit` table and trims it to the last 500 rows so the
store cannot grow without bound. `auditFor(userId, limit)` reads it newest-first for the Downloads
tab's audit panel.

### Readers and emitter (lines 182–220)

`downloadsFor`, `activeDownloads` (queued/validating/downloading/paused), `findDownload`, and a tiny
`subscribeDownloads(listener)` pub/sub. Every persist calls `emit(record)`, which is what lets a row
update live while a transfer is running without prop-drilling.

### Quality rules (lines 222–245)

`allowedQualities(video, planId)` filters the rendition ladder by the plan's height cap;
`bestQuality()` picks the highest allowed. The UI renders every rendition but disables the ones the
plan cannot have — so the paywall is *visible* rather than hidden.

### The pipeline (lines 247–430) — `requestDownload(input)`

Each gate returns either a typed `blocked` outcome **or** falls through to the next. Every gate
writes an audit row, including the successful ones, so "why was I refused?" and "how did this
succeed?" are both answerable.

| Lines | Gate | Behaviour |
|---|---|---|
| 271–280 | 0 — request | Always logged first, with the requested quality. |
| 282–300 | 1 — subscription | Calls **`reconcileExpiry()` first**, so a period that lapsed since page load downgrades to Free and is then judged against the Free allowance rather than failing obscurely. Only a genuinely absent subscription blocks (`subscription_expired`). |
| 302–312 | 2 — content tier | `video.minTier > plan.tier` → `plan_required`. |
| 314–325 | 2b — quality | Requested quality not in the allowed ladder → `quality_not_allowed`. |
| 327–350 | 3 — duplicate | A completed record for the same video inside 24h returns `kind: 'duplicate'` with a friendly message ("served from your offline cache - no quota consumed") and **does not touch quota**. |
| 352–388 | 4 — devices | A device is *registered* if it is in the user's trusted list **or** if it has downloaded in the last 90 days. Distinct devices (trusted ∪ recent) must be under `plan.maxDevices` for any *unknown* device. The subtle-but-important part: a device's own history counts as registration, otherwise a Free member could never download twice from their only device. |
| 390–410 | 5 — concurrency | Active transfers ≥ the plan cap → `concurrency`, with a message that names the *other device* when the blocking transfer came from a different fingerprint (the "simultaneous downloads across multiple devices" case). |
| 412–432 | 6 & 7 — quotas | Daily then monthly. Zero remaining → `daily_quota` / `monthly_quota` with the exact counts and "resets at 00:00 IST". |
| 434–480 | 8 — authorised | Resolves the source rendition, **reserves quota**, builds the full `DownloadRecord` with every audit column (ip, city/region/country, device type/model, OS, browser, userAgent, fingerprint, plan, `countsAgainstQuota`, retry count), writes an `authorized` audit row, kicks off the transfer and returns the live record plus a fresh quota snapshot. |

### Transfer engine (lines 482–560)

| Lines | What it does |
|---|---|
| 484–500 | `speedFor(fileSize)` — derives a bytes/tick rate so a file finishes in roughly 6–9 seconds with jitter. Realistic pacing matters: it makes pause/resume demonstrable. |
| 502–540 | `startTransfer(id)` — sets `validating` (a visible state, like fetching a signed URL), waits 450 ms, flips to `downloading`, then runs a 250 ms interval that advances `downloadedBytes`, recomputes `progress`, persists and emits. On reaching `fileSize` it stops the timer and completes. |
| 542–552 | `stopTransfer(id)` — always clears the interval *and* removes it from the map, so no timer can leak. |
| 554–572 | `completeDownload()` — sets `completed`, `100%`, `completedAt` and writes the `completed` audit row. |

### User controls (lines 574–700)

| Function | Semantics |
|---|---|
| `pauseDownload(id)` | Stops the timer, keeps `downloadedBytes` — a paused transfer is resumable, not lost. |
| `resumeDownload(id)` | Flips back to `downloading`, writes a `resumed` audit entry with the byte offset, and restarts from that offset (HTTP Range semantics). |
| `cancelDownload(id)` | Stops the transfer, **refunds the quota unit** and marks the record `cancelled`. |
| `retryDownload(id)` | Clears the failure reason, increments `retryCount` and re-reserves quota only if the previous reservation had been refunded — so a retry cannot silently double-charge the allowance. |
| `deleteDownload(id)` | Removes the row from the library; quota is untouched (it was already spent or refunded). |

### Fault injection (lines 702–770)

`simulateFailure(id, reason)` and `simulateInterruption(id)` are test hooks rather than user
features: they produce a `failed` record with a refunded quota, and an `interrupted` record that
keeps its progress. Both write audit rows naming the simulated cause, so the resulting state is
indistinguishable from a genuine network fault. `invalidateForExpiry(userId)` is the
real-world counterpart: when the subscription lapses, every queued/running transfer is aborted and
marked `expired_access`.

### Library stats (lines 772–819)

`libraryStats(userId)` — totals, completed, in-progress, problems, total bytes, a per-quality
breakdown and the last download time, powering the four stat cards. `isPlayableOffline()` and
`retentionLabel()` decide whether a completed file is still usable ("expires in 22h" for Free).

---

## 4. `src/services/paymentService.ts` (475 lines) — Razorpay orchestration

| Lines | What it does |
|---|---|
| 38–45 | `idempotencyKey(user, plan, cycle)` — includes the **current minute**, so two "Pay" clicks in the same minute collapse into one order while a genuine later attempt is a fresh order. |
| 47–95 | **`createOrder()`** — reuses a matching order created within 60 s (returning `reused: true` and incrementing `attempts`), otherwise mints a real-shaped `order_…` with the quoted amount in paise and the receipt. The `reused` flag is surfaced in the checkout UI as "existing order reused (no double charge)". |
| 97–112 | `checkoutRequest(user, order)` — the `checkout.js` configuration, ready to hand to the official SDK. |
| 114–146 | `transactionsFor`, `writeTransaction` — the receipt table. |
| 148–186 | **The settled-order guard.** Before anything else, `processCheckout` looks for a captured/authorized transaction for this order id. If one exists it writes a `duplicate` transaction and returns `activated: false`. This is the "duplicate payment attempt" and "repeated refresh" defence at the data level — the check is on the order, not on the UI's state. |
| 188–215 | **Case 1 — abandoned checkout:** a `cancelled` transaction, order closed, message confirming nothing was charged and the plan is unchanged. |
| 217–243 | **Case 2 — declined:** a `failed` transaction carrying the reason and the card's last four, order closed. |
| 245–262 | **Case 3 — network drop after the charge:** no transaction is written; the order stays `pending` with `webhookOutcome: 'captured'`, and the user is told not to pay again. `reconcile()` will settle it. |
| 264–330 | **Case 4 — capture:** mints `pay_…`, computes the signature, then applies the tamper hook if requested and calls **`verifyPaymentSignature()`**. When it fails → `verification_failed` transaction, **no activation**, a message promising auto-reversal. When it passes → writes the `captured` transaction with `signatureVerified: true`, activates the subscription (with pro-rata credit), closes the order, and sends the invoice mail. |
| 332–420 | **`reconcile(userId)`** — the webhook stand-in. It settles any `pending` order older than 4 seconds whose `webhookOutcome` says captured (writing the transaction, activating the plan, mailing the invoice), then runs the **subscription expiry sweep** and queues a downgrade e-mail if a plan lapsed. This is what makes "browser closed mid-payment" recoverable. |
| 422–445 | `retryOrder()` — clones a failed transaction into a fresh order, recording `retryOfOrder` so the audit trail links them. |
| 447–475 | `detectCard`, `pendingOrder`, `ordersFor` — helpers for the checkout sheet and billing page. |

---

## 5. `src/services/mailService.ts` (303 lines) — the transactional mailbox

| Lines | What it does |
|---|---|
| 25–45 | `sendMail(input)` — persists a `MailMessage` and logs the delivery. Every e-mail in the product is a row in one table, which is what makes the inbox screen a faithful view of the messaging layer. |
| 47–70 | `inbox`, `markRead`, `unreadCount` — the inbox page and the header badge. |
| 76–160 | **`sendInvoiceMail()`** — the spec's required confirmation mail, assembled as a formatted receipt: invoice number, billed-to block, line items with the GST-inclusive split, payment method, payment id, order id, signature-verification line, status, then a subscription-details block (plan, cycle with its discount note, validity start → expiry, next renewal, action, credit applied), the entitlements the plan grants, and support details (e-mail, phone, 7-day refund window). It is deliberately plain text with box-drawing rules so it renders identically everywhere and reads well in a `<pre>`. |
| 162–215 | **`sendOtpMail()`** — the code in a monospaced block, its expiry, the sign-in details (time, browser, OS, device, IP, location) and a bullet list of *why* a code was requested (the `reasons` array). Ends with "if this wasn't you" instructions. |
| 217–245 | `sendTrustedDeviceMail()` — 2FA receipt: which device passed, from where, and for how long it is trusted. |
| 247–285 | `sendDowngradeMail()` — sent when a plan lapses: a WHAT CHANGED table (limits before → after) and a WHAT IS PRESERVED list (watch history, resume positions, invoices, devices). Telling the user what they keep is the difference between a downgrade and a churn. |
| 287–300 | `sendRenewalReminder()` — T-3 days notice with amount, method and cancellation deadline. |
| 302–330 | `sendWelcomeMail()` — onboarding, including a warning that new-context logins will require a code. |

---

## 6. `src/services/securityService.ts` (452 lines) — login, OTP, device trust

| Lines | What it does |
|---|---|
| 33–34 | `OTP_TTL_MINUTES = 10`, `OTP_MAX_ATTEMPTS = 5` — policy constants in one place. |
| 36–52 | `LoginAttemptResult` — the rich return shape: status, user, pending OTP details, the IST-derived theme, the reasons, a message and the audit record. Every branch of the flow returns this so the UI has one shape to render. |
| 54–95 | **`attemptLogin(email, password)`** — captures device + geo + IST hour up front, then: |
| | • account missing **or** password wrong → a **single generic audit row** (`unknown_account` / `bad_password` internally) and the identical user-facing message for both. No account enumeration. |
| | • context already trusted → `success` with "recognised device, no verification needed". |
| | • new context → issues an OTP (e-mail), writes exactly **one** `otp_required` audit row and returns the challenge. |
| 97–135 | **`issueOtp()`** — creates the pending row with TTL and attempt cap, sends the e-mail (or logs the SMS path), and returns the challenge. The code is returned to the caller only because this demo has no real inbox; the comment says so. |
| 137–160 | `OtpVerifyResult` — success flag, status, message, updated user, theme and remaining attempts. |
| 162–250 | **`verifyOtp(otpId, code)`** — enforces the order of checks that matters: unknown/consumed challenge → expired → attempt cap → correctness. A wrong code increments `attempts` and audits `incorrect_otp`; hitting the cap audits `otp_attempt_limit` and **blocks** the challenge. On success it burns the code (`consumed: true` — a code can never be replayed), trusts the device for the user's configured window, applies the IST theme **unless the user pinned a manual choice**, audits success, and sends the trusted-device mail. |
| 252–268 | `geoFields()` — the shared audit fragment (ip, city, region, country, browser, os, device type/model, fingerprint, theme, IST hour). |
| 270–285 | `writeLoginRecord()` — appends and trims to 400 rows. Every login path funnels through here, which is why the audit trail is complete by construction. |
| 287–300 | `loginHistory(userId, limit)` — newest first for the security table. |
| 302–320 | `securitySummary(userId)` — totals, successes, OTP challenges, failed OTPs, blocked attempts, today's count and the last successful login. |
| 322–352 | `trustedDevices`, `revokeDevice`, `setTrustWindow`, `isDeviceTrusted` — the device-management surface. `setTrustWindow` also updates the user's default `trustDurationDays`, so one control changes both policy and existing rows. |
| 354–372 | `updateProfile(userId, patch)` — used by the settings toggles and profile form. |
| 374–390 | `changePassword(userId, current, next)` — verifies the current password, enforces an 8-character minimum, stores the new hash. |
| 392–440 | **`registerUser()`** — creates the account, then **also creates the Free subscription row and a quota bucket**. That second step is easy to forget and its absence is invisible until a brand-new user is refused a download with "no active subscription"; the verification script now asserts this path. |

---

## 7. `src/services/watchService.ts` (157 lines)

| Lines | What it does |
|---|---|
| 12–13 | `COMPLETION_THRESHOLD = 90` — "completed" is configurable, not hard-coded into the player. |
| 17–50 | **`saveProgress()`** — upserts by `${userId}:${videoId}`, computes `percent`, sets `completed` past the threshold, and accumulates `minutesToday` **only when the stored `dayKey` is today** (so a day rollover silently resets the watch-time budget). |
| 52–79 | `progressList`, `continueWatching` (not-completed, past 3 seconds, joined with catalogue data), `clearProgress`. |
| 81–110 | **`watchAllowance(userId)`** — sums today's minutes across all videos and compares with the plan's daily cap. Unlimited plans short-circuit. The refusal message names 00:00 IST and suggests upgrading. |
| 112–124 | `logWatchEvent()` — play/pause/seek/complete telemetry, trimmed to 800 rows. |
| 126–150 | **The single-playback lock.** `claimPlaybackSlot(playerId)` / `releasePlaybackSlot()` write `nexstream:active-player` in `localStorage`, and `onPlaybackSlotChange()` listens to the browser's `storage` event. Because the flag is in `localStorage` (not memory), this works **across tabs** — the second video pauses itself when another starts anywhere. |
| 152–163 | `nextVideoIn(catalogue, currentId)` — wraps to the first title at the end, which is what the autoplay countdown uses. |

---

## 8. `src/services/callService.ts` (486 lines) — video calling

Two halves: the **client-side calling model** (section 1) and a **cross-tab roster/signalling
stand-in** (section 2, appended at line 300+).

| Lines | What it does |
|---|---|
| 1–22 | The architecture note. It states plainly that production pairs this UI with an SFU (LiveKit/Daily/100ms) or a mesh of `RTCPeerConnection`s plus a signalling socket, and that **local camera and mic are genuinely real** (`getUserMedia`) while remote peers are modelled — because remote video cannot exist without signalling. |
| 24–60 | `StoredRoom`, `rooms()`, `newRoomId()` (`nx-4f7a-91c2`), `meetingLink()` (a shareable `#/calls/<id>` URL), `createRoom()` and `findRoom/getRoomState`. |
| 62–90 | `makeParticipant(user, role)` — the local participant factory. |
| 92–140 | The simulated-peer directory and `simulatedPeer(index, role)`, plus **`tickSpeaking()`** which rotates who is "speaking" and drifts each peer's reported connection quality, so the speaking indicator and quality badges look alive rather than static. |
| 142–165 | **`capabilities(plan, participant, room)`** — the permissions object: screen share, chat, record (Gold + host only), moderate, and the plan's participant limit. The UI renders from this, so a permission change needs no component edit. |
| 167–220 | Chat: `sendChatMessage`, `systemMessage` ("X joined the meeting"), `chatFor`, `clearChat`. System messages reuse the same table with a `system` flag so ordering is trivial. |
| 222–300 | **Media helpers.** `acquireMedia({video, audio, facingMode})` requests a real stream and handles denial gracefully — camera denied → retry audio-only; both denied → return "listen-only" with `error` set, and the room keeps you in it. `acquireScreenShare()` treats a cancelled picker (`NotAllowedError`) as a non-event rather than an error toast. `tunedAudioConstraints()` bundles echo cancellation, noise suppression and auto-gain. **`adaptiveVideoConstraints(quality)`** maps the detected link quality to resolution and frame rate — the low-bandwidth adaptation the spec asks for. `networkQuality()` reads `navigator.connection` when available. |
| 302–340 | Recording lifecycle: `startRecording`, `stopRecording` (estimates ~1.1 MB/s of 720p), `recordings(roomId)` — host-only by construction, since the UI shows them only to the host. `logCall()` / `callLog()` write the call history. |
| 344–420 | **Roster.** `joinRoster`, `heartbeat` (every 2 s), `leaveRoster`, and `readRoster` which **prunes rows whose heartbeat is older than 8 seconds** — the same liveness model a socket server uses, so a closed tab disappears from the grid automatically. |
| 422–484 | **Signalling stand-in.** A `RoomSignal` union (roster / leave / chat / moderation / reaction) carried over `BroadcastChannel`, with `broadcast()`, `listenRoom()` and `closeChannel()`. This is the piece that makes the demo genuinely interactive: two tabs on the same machine really do exchange chat messages and see each other in the roster. Replacing `joinRoster`/`listenRoom` with socket calls and adding peer connections is the whole path to production. |
