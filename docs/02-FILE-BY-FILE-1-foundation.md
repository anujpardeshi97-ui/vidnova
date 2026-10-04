# File-by-file explanation — Part 1: configuration, types, libraries, data

> Every file in the project, explained block by block with line references.
> Read Part 2 for the service layer and Part 3 for the UI layer.
> Line numbers refer to the files as shipped in this ZIP.

---

## 0. Project configuration

### `package.json` (34 lines)

| Lines | What it does |
|---|---|
| 1–6 | Package identity: `react-example`, `"type": "module"` so every `.ts`/`.tsx` file is an ES module. |
| 7–12 | Scripts. `dev` runs `vite --port=3000 --host=0.0.0.0` — `0.0.0.0` matters because the live preview is proxied from outside the sandbox, so the server must not bind to `127.0.0.1` only. `lint` is `tsc --noEmit` (type-check without emitting files). |
| 13–27 | Runtime dependencies: `react`/`react-dom` 19, `lucide-react` for icons, `@tailwindcss/vite` + `tailwindcss` 4 for styling, `vite` for build and dev. `express`, `dotenv` and `@google/genai` are still listed but unused — the app has no server, so they are harmless weight that can be dropped. |
| 28–34 | Dev dependencies: TypeScript 5.8, `tsx` (runs the verification script), `@types/*` for Node, Express and React. |

The `verify` script runs the headless rule tests:

```json
"verify": "tsx scripts/verify-rules.ts"
```

### `vite.config.ts` (23 lines)

| Lines | What it does |
|---|---|
| 1–3 | Import `defineConfig`, the React plugin (JSX transform + Fast Refresh) and the Tailwind v4 plugin. |
| 6–7 | Register plugins. Tailwind v4 needs no `tailwind.config.js`; the plugin scans the source automatically. |
| 8–17 | Dev server config. `port: 3000`, `host: '0.0.0.0'`, `strictPort: true`, and crucially `allowedHosts: true` — Vite 6 blocks unknown `Host` headers by default, which would break the proxied preview URL (the classic `Blocked request. This host is not allowed` error). `cors: true` keeps the media requests happy. |
| 18 | Same rules for `vite preview`. |
| 19 | `build.outDir: 'dist'`, and a raised chunk-size warning limit because the single-page bundle is ~475 kB. |

### `tsconfig.json` (23 lines)

Compiler settings: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`,
`jsx: "react-jsx"` (so no `import React` is required for JSX), `strict` behaviour via
`noEmit` + `skipLibCheck`, and the `@/*` path alias pointing at the project root.

### `index.html` (22 lines)

The single-page shell. `<div id="root">` is the mount point, and
`<script type="module" src="/src/main.tsx">` boots the app. The Google Fonts preconnect/stylesheet
tags load the display font; when they are unreachable (offline, or a sandboxed preview) the app
degrades gracefully to the system font stack declared in `index.css`.

### `index.css` (≈120 lines)

| Lines | What it does |
|---|---|
| 1 | `@import "tailwindcss"` — pulls in the whole v4 framework with its content scanner. |
| 3 | `@custom-variant dark (&:where(.dark, .dark *))` — Tailwind v4 defaults to `prefers-color-scheme`, but the product needs a *user-controlled, per-profile* theme, so `dark:` must respond to a `.dark` class on `<html>`. This one line is what makes the IST theme rule possible. |
| 5–9 | Base layer: the Plus Jakarta Sans stack with system fallbacks. |
| 11–27 | Custom scrollbars (6px, translucent thumb). |
| 29–47 | Range-slider styling: `accent-color` plus the `.video-scrubber` thumb with a scale-on-hover effect used by the player's volume slider. |
| 49–56 | `pulse-subtle` keyframes for the "live" indicators. |
| 58+ | `html.dark { color-scheme: dark }` (native form controls and scrollbars follow the theme), smooth scrolling, `video::-webkit-media-controls { display: none }` (belt-and-braces, so no native controls can appear over the custom player), and hand-written `.line-clamp-1/2` utilities so text truncation does not depend on a plugin. |

### `metadata.json` (7 lines)

The app manifest: display name, description, the frame permissions the app requires
(`camera`, `microphone`, `display-capture` — all three are needed by the video-calling suite) and a
server-side capability flag. Only the permission list is functionally significant.

### `scripts/verify-rules.ts` (342 lines) — see Part 5

---

## 1. `src/main.tsx` (19 lines) — entry point

| Lines | What it does |
|---|---|
| 6–8 | Imports `seedDatabase` from the service layer and the global stylesheet. |
| 10 | **`seedDatabase()` runs before React renders.** Booting the database first means the first paint already sees the demo accounts, the seeded subscriptions and the quota rows — no empty-state flash, no race between effects and reads. |
| 12–13 | `document.getElementById('root')` with an explicit throw if `index.html` was edited and the mount point disappeared. Failing loudly here beats a blank white page. |
| 15–17 | `createRoot(...).render(StrictMode(App))`. `React.createElement` is used instead of JSX because this file has no JSX to compile and keeping it a `.tsx`-free entry makes the build graph obvious. |

---

## 2. `src/types/index.ts` (437 lines) — every contract in one place

One file, grouped by domain, so any module can `import type { … }` without hunting. Types are
compile-time only; nothing here emits JavaScript.

### Users and authentication (lines 1–120)

| Lines | Type | Notes |
|---|---|---|
| 12–25 | `DeviceInfo` | What the audit trail stores about a browser: `type` (Desktop/Mobile/Tablet), `os`, `browser`, hardware `model`, `fingerprint`, screen, timezone, language and the raw `userAgent`. |
| 27–35 | `GeoLocation` | `ip`, `city`, `region`, `country`, a display `label` and `simulated` — the flag exists so the UI can state plainly that IP geolocation is resolved locally here. |
| 37–48 | `TrustedDevice` | A device that passed OTP: fingerprint, its metadata, `firstSeen`, `lastSeen` and `trustedUntil` (the configurable trust window). |
| 50–80 | `LoginRecord` | One row per login attempt — including failures. Carries `status`, `reasons` (why OTP was demanded), `otpChannel`, the theme applied and `loggedInAtHourIst`. |
| 82–100 | `PendingOtp` | The challenge itself: `code`, `expiresAt`, `attempts`, `maxAttempts`, `consumed`, plus the device/geo context captured at issue time. |
| 102–120 | `User` | Profile + `password` (hashed before storage), `theme`, `themeLockedByUser`, `autoThemeOnLogin`, current `planId`, embedded `trustedDevices` and `trustDurationDays`. |

**Design note:** `theme` and `themeLockedByUser` are on the *user*, not in `localStorage` alone. That
is exactly what makes the spec's "preference persists across sessions and devices" true.

### Subscriptions and money (lines 122–215)

| Lines | Type | Notes |
|---|---|---|
| 124–125 | `PlanId`, `PlanTier` | `free|bronze|silver|gold` and a numeric tier `0|1|2|3` used for all "is this content unlocked?" comparisons. |
| 130–150 | `Plan` | The whole plan schema: prices, `-1 = unlimited` quota fields, quality cap, watch-time cap, device count, feature flags, `maxCallParticipants`, `features[]`, `renewalPolicy`. |
| 152–172 | `Subscription` | One purchased period: `status`, `cycle`, `startDate`, `expiryDate`, `cancelledAt`, `autoRenew`, `creditCarried` (pro-rated credit), `action` (new/renew/upgrade/downgrade), `pricePaid`, `invoiceNumber`. |
| 175–200 | `PaymentStatus`, `PaymentOrder` | Order lifecycle: `created → pending → authorized → captured`, plus every failure state. `idempotencyKey` + `attempts` + `webhookOutcome` exist specifically for the duplicate-submit and lost-callback edge cases. |
| 202–215 | `Transaction` | The receipt: `paymentId`, `signature`, `signatureVerified`, invoice number, amount in paise, method, card last-4, failure reason, `retryOf`. |

### Catalogue, watch state and downloads (lines 217–330)

| Lines | Type | Notes |
|---|---|---|
| 219–250 | `Video`, `VideoSource` | Title, description, category, channel, duration, generated thumbnail/poster, `access` (public/premium/exclusive), `minTier`, tags, a `sources[]` rendition ladder (quality + url + exact `sizeBytes`) and optional captions. |
| 252–265 | `WatchProgress` | Resume position, `percent`, `completed`, and `minutesToday` + `dayKey` so the daily watch-time limit is enforced from the same table. |
| 267–305 | `DownloadRecord` | The centrepiece of the download system: video metadata, quality, `fileSize`, `status`, `progress`, `downloadedBytes`, timestamps, **and** the audit block (`ip`, `city`, `region`, `country`, `deviceType`, `deviceModel`, `os`, `browser`, `userAgent`, `fingerprint`), plus `countsAgainstQuota`, `quotaAfter`, `duplicateOf`, `failureReason`, `retryCount`. |
| 307–320 | `QuotaState` | `dayKey`, `usedToday`, `monthKey`, `usedThisMonth`, `lastResetAt` — the counters that reset at 00:00 IST. |
| 322–330 | `DownloadAuditEntry` | Append-only log: `event` (request/authorized/blocked/duplicate/completed/failed/interrupted/resumed/cancelled/quota_reset), human-readable `detail`, and the ip/fingerprint/plan context. |

### Mail, calling and UI helpers (lines 332–437)

`MailMessage` (with a `kind` union that drives the inbox badges), the whole calling model
(`CallParticipant`, `CallChatMessage`, `CallRoomState`, `CallConnectionQuality`, `CallRole`),
plus `Toast` and `WatchEvent` for the UI and telemetry.

---

## 3. `src/lib/` — primitives with no business rules

### `storage.ts` (156 lines) — the mini database

| Lines | What it does |
|---|---|
| 15–30 | `Tables` interface + `key(table)` builder. Every table is stored as `nexstream:1:<table>`, so bumping `SCHEMA_VERSION` migrates the whole store by itself. |
| 32–45 | `readTable<T>(table)` — parse JSON, and on corruption (bad JSON, or a value that is not an array) **return `[]` instead of throwing**. A demo store can be corrupted by an interrupted write; the app must never white-screen because of it. |
| 47–55 | `writeTable<T>(table, rows)` — one `setItem` call per table, so a write is atomic from the app's point of view. Catches `QuotaExceededError` (private mode / full disk) and logs instead of crashing. |
| 57–68 | `upsert<T extends {id: string}>(table, row)` — insert or merge by `id`. This single function is what every service uses to persist. |
| 70–80 | `patch()` — partial update by id. |
| 82–101 | `findById`, `remove`, `removeWhere` — the rest of the basic repository surface. |
| 103–118 | `findOne`, `filter` — read helpers so services do not re-implement `.filter()` chains. |
| 120–128 | `throttle(key, windowMs)` — lets noisy audit writes be rate-limited without a counter table. |
| 130–137 | `resetDatabase()` — iterates every table name and removes it. Used by "Reset demo data". |
| 139–155 | The `TABLES` constant map (16 names) and `uid(prefix)`: time-ordered base-36 timestamp + random suffix, e.g. `dl_musjkodnv2z871`. Time-ordering makes ids sortable, which is handy in logs. |

### `ist.ts` (117 lines) — India Standard Time

| Lines | What it does |
|---|---|
| 14–15 | `IST_OFFSET_MINUTES = 5*60+30`. IST has **no daylight saving**, so a fixed offset is exact — no timezone database needed. |
| 17–20 | `toIstShifted(date)` — shifts the instant by +5:30 so the *UTC getters* return IST wall-clock values. This one trick removes every timezone bug: callers read `getUTCHours()` and get IST. |
| 22–35 | `istHour`, `istMinute`, `istDecimalTime` — decimal time (9.5 = 09:30) makes range comparisons readable. |
| 37–43 | `istClock()` — `"14:07:33"` for the header clock. |
| 45–54 | `istDateTime(ts)` — `"03 Oct 2026, 14:07 IST"`. Used for every user-facing timestamp in the app. |
| 56–61 | `istDayKey()` — `"2026-10-03"`, the **key the daily quota resets on**. |
| 63–67 | `istMonthKey()` — `"2026-10"` for the monthly quota. |
| 69–80 | `msUntilNextIstMidnight()` — milliseconds to the next 00:00 IST, for the reset countdown. |
| 82–90 | `countdownLabel(ms)` — `"6h 12m 40s"`. |
| 92–105 | `addDays`, `addMonths` — month addition clamps the day-of-month (31 Jan + 1 month = 28 Feb) instead of rolling into March, which is what subscription renewals must do. |
| 107–112 | **`themeForIstLogin()`** — the spec rule in four lines: hour ≥ 5 and < 12 → `light`, otherwise `dark`. |
| 114–116 | `istWindowLabel()` — `"05:00 - 12:00 IST"`, reused in the UI and in e-mails so the copy cannot drift from the rule. |

### `format.ts` (88 lines) — display helpers

`formatBytes` (binary units, 1 decimal), `formatDuration` (`1:02:05`), **`formatMoney`** (paise →
`₹499.00` with Indian digit grouping — the only place money is divided by 100), `relativeTime`
("3 days ago"), `formatDate` (IST), `compactNumber` ("12.4K"), `clamp`, `percent`, and `humanize`
(`otp_required` → `OTP Required`) which keeps audit tables readable.

### `device.ts` (125 lines) — User-Agent intelligence

| Lines | What it does |
|---|---|
| 14–27 | `getFingerprint()` — reads/creates `nexstream:device:fingerprint`. Browsers deliberately expose no hardware id, so a random token in `localStorage` *is* the industry-standard substitute: it survives reloads and dies with site data. |
| 29–33 | `resetFingerprint()` — clears the token so the next login looks like a brand-new device. This is the button that makes the OTP flow demonstrable on demand. |
| 35–53 | `BROWSER_RULES` — **order matters**: Edge UA strings contain "Chrome", Chrome's contain "Safari", so the most specific signatures are tested first. |
| 55–61 | `parseBrowser(ua)` → `"Chrome 128.0.0.0"`. |
| 63–76 | `parseOS(ua)` → Windows 10/11, Android 14, iOS 17.5, macOS, ChromeOS, Linux. |
| 78–85 | `parseDeviceType(ua, touchPoints)` — Tablet before Mobile before Desktop; the `maxTouchPoints > 1 && Macintosh` case catches iPadOS 13+, which pretends to be a Mac. |
| 87–101 | `parseModel(ua, type)` — best-effort `"Samsung SM-S918B"`, `"Pixel 7"`, `"Apple iPhone"` from UA fragments. |
| 103–117 | `collectDeviceInfo()` — assembles the full profile including screen size, IANA timezone and language. Called once per login and once per download request. |
| 119–124 | `deviceLabel()` — `"Chrome - Windows 10/11"` for compact lists. |

### `geo.ts` (69 lines) — IP and approximate location

| Lines | What it does |
|---|---|
| 12–22 | `IP_POOL` — seven realistic egress IPs across Mumbai, Pune, Bengaluru, Delhi, Chennai, Jaipur and Singapore. A real deployment calls an IP-geolocation service **server-side**; this models the same contract. |
| 24–26 | `pick()` — random resolver result. |
| 28–44 | `resolveGeoLocation(forceNew)` — caches the result for the tab in `sessionStorage` so **one visit is internally consistent**: the IP on the login record is the same IP on every download row from that visit. |
| 46–49 | `currentIp()` — IP only, for audit rows. |
| 51–56 | `simulateLocation(geo)` — the hook behind the "move me to Bengaluru" buttons that demonstrate the new-city OTP rule. |
| 58–68 | `geoOptions()` — the pool, exposed to the UI. |

### `security.ts` (151 lines) — hashing, OTP, trust windows

| Lines | What it does |
|---|---|
| 1–12 | The header comment is explicit that this is a **front-end demo**: the "hash" is fast and non-cryptographic, and its only job is to stop plaintext passwords sitting in `localStorage`. A production system must use bcrypt/argon2 on the server. Being explicit beats pretending. |
| 20–31 | `digest(input)` — FNV-1a + djb2 combined into 16 hex characters. Deterministic, fast, collision-resistant enough for a demo. |
| 33–39 | `hashPassword` / `verifyPassword` with a `SALT` prefix. |
| 41–55 | `generateOtp(6)` — **`crypto.getRandomValues`**, not `Math.random`, with a documented fallback. |
| 57–100 | `evaluateLogin(user, device, geo)` — the step-up decision. Returns early when a trusted device's window is still open (and notes an IP rotation that did *not* force a challenge). Otherwise it diffs the current context against every known device to build `reasons`: `new_device`, `trust_expired`, `new_browser`, `new_ip`, `new_city`, `new_state`. Those reason strings appear verbatim in the OTP e-mail and the audit table. |
| 102–121 | `trustDevice(device, geo, days, existing)` — creates or refreshes the trusted-device row, preserving `firstSeen` so history is not rewritten. |
| 123–136 | `maskEmail` / `maskPhone` — `priya.sharma@…` → `pr***ma@…`. Used everywhere the demo surfaces a code or destination. |
| 138–150 | `currentFingerprint()` — convenience re-export. |

### `razorpay.ts` (169 lines) — test gateway adapter

| Lines | What it does |
|---|---|
| 1–25 | Header comment describing the real three-step flow (server creates the order → Checkout returns ids → server verifies HMAC) and the key/secret resolution from `VITE_RAZORPAY_*` env vars with test defaults. |
| 27–43 | `newOrderId()`, `newPaymentId()`, `newReceipt()` — ids with the same shape as Razorpay's (`order_` + 14 alphanumerics). |
| 45–57 | **`hmacSha256Hex(message, secret)`** — a real HMAC-SHA256 via WebCrypto, returned as lowercase hex exactly like Razorpay's signatures. This is not a stub: the signature really is computed and really is checked. |
| 59–100 | `CheckoutRequest` + `buildCheckoutRequest()` — the `checkout.js` configuration expressed as data (key, amount, currency, prefill, notes, theme) plus a `testCards` table: Visa → captured, Mastercard → declined, RuPay → cancelled, UPI → captured. |
| 102–115 | `luhnValid(cardNumber)` — the real Luhn checksum, so card entry validates like a payment form. |
| 117–125 | `cardNetwork(number)` — IIN prefix → Visa/Mastercard/Amex/RuPay/Maestro, shown live under the input. |
| 127–135 | **`verifyPaymentSignature({orderId, paymentId, signature})`** — recomputes `HMAC_SHA256(order_id|payment_id, secret)` and compares. The single gate that decides whether a plan may activate. |
| 137–140 | `signPayment()` — produces the signature a successful checkout would return. |
| 142–168 | `webhookEventFor()` — maps a status to the Razorpay event name (`payment.captured` / `failed` / `authorized`) used in the reconciliation logs. |

---

## 4. `src/data/` — configuration, not logic

### `plans.ts` (206 lines)

| Lines | What it does |
|---|---|
| 14–18 | `CYCLE_DISCOUNT` — monthly ×1, quarterly ×2.7 (10% off), yearly ×9.6 (20% off). The multipliers are applied to the monthly price and rounded to whole rupees. |
| 20–160 | The four `PLANS` objects. Each carries prices, `-1 = unlimited` quota fields, quality caps, watch-time caps, device limits, feature flags, `maxCallParticipants`, a human-readable `features[]` list for the cards, a `renewalPolicy` sentence for the cancellation modal, and `premiumAccessPercent` for catalogue gating copy. Free explicitly keeps `offlineDownloads: true` — the spec grants Free *one download per day*, so the limit is enforced by quota, not by a feature flag. |
| 162–170 | `PLAN_ORDER` (drives every table and card), `getPlan(id)` with a Free fallback so an unknown id can never crash the UI, and `priceFor(planId, cycle)` returning **paise**. |
| 172–186 | `quotaSummary(planId)` — "3/day (25/month)" for cards and e-mails. |
| 188–206 | `COMPARISON_ROWS` — the 17-row, 6-group matrix powering "Compare plans": daily/monthly limits, retention, download & streaming quality, watch time, ad-free, priority lane, catalogue access, exclusive courses, device count, call participants, recording and support channel. Marked `boolean: true` where a tick/cross reads better than text. |

### `videos.ts` (239 lines)

| Lines | What it does |
|---|---|
| 1–17 | The header explains the media strategy: eight titles streaming from three royalty-free clips shipped in `public/videos`, re-encoded as 360p/720p/1080p renditions so the quality switcher and plan caps are exercised with **real media**, not fake filenames. |
| 19–30 | `SRC` — one entry per rendition with its exact byte size, so file size in the UI is real data. |
| 32 | `CLIP_DURATION = 10` — every bundled clip is 10 seconds; the player treats duration strictly as metadata anyway, so it stays correct whatever media you drop in. |
| 34–220 | `SEEDS` — the eight catalogue entries with titles, descriptions, categories, channels, `access` (`public`/`premium`/`exclusive`), `minTier` (0–3), emoji + gradient used for poster generation, view/like counts, tags, renditions and captions. |
| 222–239 | `VIDEOS` — maps seeds into full `Video` objects, generating both the 640×360 thumbnail and the 1280×720 poster through `makeThumbnail()`. Then `CATEGORIES` (for the filter chips), `getVideo(id)` and `qualityLadder(video)` (renditions sorted ascending, used by the settings menu). |

### `thumbnails.ts` (121 lines)

| Lines | What it does |
|---|---|
| 1–15 | Why procedural art: shipping JPEGs bloats the repo and breaks offline previews. Every thumbnail is an inline SVG `data:` URI, so it can never 404. |
| 17–24 | `esc()` — escapes `&`, `<`, `>`, quotes. Required because titles are interpolated into SVG markup. |
| 26–40 | `wrap(title, 24, 3)` — greedy word wrap to at most three lines so long titles never overflow the poster. |
| 42–99 | `makeThumbnail(opts)` — builds the SVG: two-stop diagonal gradient, subtle 40px grid pattern, two translucent circles for depth, a darkening vignette, an emoji, the category eyebrow in letterspaced caps, the wrapped title, a "▶ NexStream" chip and an optional badge ("Gold only", "Free"…). Returned URL-encoded so it is valid inside `src` and CSS `url()`. |
| 101–120 | `makeAvatar(name, color)` — round initials tile used by call participants, security lists and chat. |

**Why this matters:** because thumbnails carry the title text themselves, the download rows, e-mail
invoices and call tiles all have a genuine image without a single binary asset.
