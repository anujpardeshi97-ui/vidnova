# File-by-file explanation — Part 3: state, components and pages

> How the service layer reaches the screen. Line numbers refer to the shipped files.

---

## 1. `src/context/AppContext.tsx` (237 lines) — the only global state

| Lines | What it does |
|---|---|
| 22–33 | `RouteName` union and `Route` — the app has ten routes and no router library. |
| 35–45 | **`parseHash()`** — `#/watch/vid_bbb` → `{name:'watch', param:'vid_bbb'}`. Unknown segments fall back to `home` rather than rendering nothing. |
| 47–50 | `navigate(name, param?, tab?)` — writes the hash, which is what triggers the route change listener. Hash routing is deliberate: it works in a sandboxed iframe with no server rewrites, and every screen is linkable (the meeting link `#/calls/nx-….` is exactly this). |
| 52–75 | The context's shape: user, session, theme, route, toasts, a `version` counter, plus resolved `plan`, `subscription`, `quota` and `unread`, and the actions (`bump`, `toast`, `signIn`, `signOut`, `setTheme`, `refreshUser`). |
| 77–85 | `AppProvider` — state initialises from `getSession()` so a refresh does not flash the login screen. |
| 87–110 | **Boot effect** (runs once): `seedDatabase()`, then for a returning user `reconcile()` (settle webhooks + expiry sweep), `reconcileExpiry()` and `invalidateForExpiry()` — so opening the app is also a housekeeping pass. Then it applies the saved theme to `<html>`. |
| 112–120 | Hash listener: re-parse the route and scroll to top. |
| 122–126 | Theme effect: toggles the `dark` class on `document.documentElement` and sets `color-scheme`. This is what the `@custom-variant dark` line in `index.css` hooks into. |
| 128–140 | `toast()` — appends a toast and auto-dismisses after 6 s. Every service verdict is surfaced through here, so the same rule produces the same message everywhere. |
| 142–160 | **`signIn(user, theme)`** — writes the session pointer with the device fingerprint, IP and location captured at that instant, navigates home and bumps. |
| 162–170 | `signOut()` — clears only the **session pointer**. The theme preference stays on the user row, which is why "persists across future sessions" is literally true. |
| 172–190 | **`setTheme(theme, persistToProfile)`** — applies it and, by default, writes `theme` + `themeLockedByUser: true` to the profile. That flag is what stops the IST login rule from overwriting a deliberate choice on the next sign-in. |
| 192–216 | Derived values: `user` (re-read from the DB on every `version` bump, so it can never go stale), `plan`, `subscription`, `quota`, `unread`. |
| 218–237 | Provider + the `useApp()` hook that throws a clear error if used outside the provider. |

**Why a `version` counter instead of a cache?** `bump()` forces every derived read to re-run. It is a
deliberately simple stand-in for React Query/SWR: services are the source of truth, React just
re-renders. It also means the UI can never disagree with the database.

---

## 2. `src/components/ui.tsx` (411 lines) — the design system

Small primitives, each doing one thing, so pages read as composition instead of markup.

| Lines | Component | Notes |
|---|---|---|
| 16–31 | `Card` | The rounded-2xl panel used everywhere; `padded={false}` for full-bleed media. |
| 33–56 | `SectionTitle` | Title + subtitle + optional icon and right-hand slot. |
| 58–80 | `PageHeader` | Icon tile + page title + subtitle + action, used by the profile-style pages. |
| 84–130 | `Button` | Six variants (primary/secondary/ghost/danger/success/outline), three sizes, `loading` (spinner + disabled), leading `icon`. Disabled state dims and blocks clicks. |
| 132–160 | `Badge` | Seven tones; the tone map is explicit rather than interpolated so Tailwind's scanner can see the class names. |
| 162–186 | `Progress` | Takes **full class strings** (`barClass`) instead of a colour name — the same JIT-safety rule. |
| 188–214 | `Stat` | Label/value/hint tile with an icon, used in the download and security dashboards. |
| 216–240 | `Field` | Label + hint + required marker wrapper for inputs, with `inputClass` exported so every input looks identical. |
| 242–270 | `Toggle` | Switch used by the theme-rule settings. |
| 272–310 | `Modal` | Backdrop blur, click-outside to close, optional `wide` and `footer`. Used for the OTP challenge, checkout, cancel confirmation and audit viewer. |
| 312–340 | `ToastStack` | Bottom-right stack with per-kind icons, wired to `useApp().toasts`. |
| 342–372 | `Tabs`, `EmptyState`, `KV`, `CheckList` | The remaining shared shapes. `EmptyState` always offers an action, so no screen is a dead end. |

---

## 3. `src/components/Layout.tsx` (217 lines) — the shell

| Lines | What it does |
|---|---|
| 19–27 | The `NAV` list — browse, subscriptions, downloads, security, billing, inbox, calls — one array that renders into both the sidebar and the avatar menu. |
| 33–40 | Route detection from the hash and the live library stats. |
| 42–47 | The quota chip text: "N downloads left today" or "Unlimited downloads". |
| 49–75 | Header: brand, search box (wired to the home page filter), quota chip, theme switch, inbox badge and avatar. |
| 77–140 | Avatar dropdown: identity, plan badge, offline count, quick links and sign-out. |
| 142–160 | **The IST status strip** — live IST clock, the light-theme window, whether the current theme was auto-applied or pinned, and the countdown to the next quota reset. This exists so a reviewer can *see* the time-based rules working without reading the code. |
| 162–215 | Sidebar: navigation, an upgrade card for non-Gold users, and an offline-library summary card. |

---

## 4. `src/components/player/VideoPlayer.tsx` (733 lines) — the custom player

The spec asks for a player with no native controls and a long feature list; this file is that list,
implemented. Structure: refs → state → media events → persistence → quality → autoplay → idle hiding
→ fullscreen/PiP → cross-player exclusivity → controls → shortcuts → hover preview → render.

| Section | Lines | Notes |
|---|---|---|
| Refs | 88–106 | Shell (fullscreen target), video, a **hidden second `<video>`** used only to decode preview frames, the preview canvas, plus timers for idle-hiding, progress saving and the autoplay countdown, and a `watchedSeconds` accumulator. |
| State | 108–134 | Playing, time, duration, buffered, volume, muted, rate, quality, theatre, fullscreen, PiP, captions, controls visibility, buffering, settings panel, hover preview, countdown, transient notices and the resume bookmark. |
| Resume | 136–152 | On video change, `resumeAt` (or the stored bookmark) is loaded and the video auto-selects its **highest available** rendition before the user picks one. |
| Media events | 154–230 | One effect binds `loadedmetadata` (duration + resume, clamped to below the completion threshold), `timeupdate` (accumulates watched seconds, publishes position), `progress` (buffered bar), `waiting`/`playing` (spinner), `pause` (releases the playback slot) and `ended` (saves 100% and starts the autoplay countdown). All listeners are torn down together. |
| Progress saving | 232–246 | A 5-second interval persists position **while playing**, then resets the accumulator so `minutesToday` counts real viewing, not wall-clock. |
| Quality switch | 248–262 | Remembers the current time and play state, swaps `src`, then restores both — so changing quality does not restart the video. |
| Autoplay | 264–278 | Decrements a countdown each second; at zero it calls `onNext()`. Cancelling simply clears the state. |
| Idle hiding | 280–296 | `wakeControls()` shows the bar and re-arms a 3-second timer; any mouse move calls it. |
| Fullscreen / PiP | 298–340 | Real `requestFullscreen` on the **shell** (so our controls stay visible) with a `fullscreenchange` sync, and `requestPictureInPicture` with enter/leave events. Both catch and explain failures (`setNotice`), because embeds can block fullscreen. |
| Exclusivity | 342–354 | Subscribes to the cross-tab playback slot; when another player claims it, this one pauses and explains why. |
| Controls | 356–440 | `requestPlay` (consults the `canPlay` veto — the watch-time/quota hook), `togglePlay`, `seekBy`, `seekTo`, `changeVolume` (also unmutes at 0), `toggleMute`, `cycleSpeed`, `toggleFullscreen`, `togglePip`, `toggleTheater`, `toggleCaptions`. |
| Shortcuts | 442–520 | A window-level handler that ignores keystrokes aimed at inputs/textareas, then maps Space/K, ←/→ (±10 s), Shift+←/→ (±30 s), ↑/↓ (±5 % volume), M, F, T, P, C, S, N and 0–9 (jump to 0–90 %). Every action wakes the controls. |
| Hover preview | 522–548 | On timeline mousemove it computes the target time, sets `currentTime` on the **hidden** decoder and, on its `seeked` event, paints that frame into a 160×90 canvas above the cursor, with a monospace time bubble. A `previewSeekPending` guard prevents a backlog of seeks while scrubbing. |
| Timeline | 566–600 | Buffered bar, played bar, a thumb that appears on hover, and click-to-seek anywhere on the track. |
| Control bar | 602–700 | Play/pause, ±10 s, volume slider that expands on hover, `current / duration` plus **remaining time**, a live quality badge, and a settings popover with quality, speed and captions. |
| Shortcut legend | 702–716 | The status strip at the bottom of the player documents its own keyboard map. |
| Locked state | 550–558 | When a plan cannot play a title the player renders a dark overlay with the reason from `canStream()` instead of the media. |

---

## 5. `src/components/Downloads.tsx` (658 lines) — the download UI

| Lines | Component | Notes |
|---|---|---|
| 44–96 | `QuotaMeter` / `QuotaBar` | Daily and monthly usage with plan badge, percentage bars that shift emerald → amber → red, and the IST reset countdown ticking every second. |
| 98–260 | **`DownloadButton`** | Renders the gated action. Opening the sheet lists every rendition, disabling the ones the plan cannot have; choosing one calls `requestDownload()` and renders whatever verdict comes back — started, duplicate or blocked with its `BlockCode`. A blocked outcome offers "See plans that lift this limit". |
| 262–292 | `OutcomeBanner` | Colour-coded result: green for started, blue for duplicate ("no quota consumed"), amber for blocked with the code humanised (`daily_quota` → "Daily Quota") and an upgrade CTA mapped per code. |
| 294–300 | `STATUS_TONE` | One table mapping the nine download statuses to a tone + icon, so every list agrees. |
| 302–500 | **`DownloadRow`** | The core record view: thumbnail, title, size, start/completion timestamps, status badge, live progress with byte counts, and a metadata strip showing **plan used, retention countdown, IP + city, device + browser, whether it consumed quota, retry count and failure reason**. Actions adapt to status: pause / resume / retry / cancel / play-offline / delete. Expanding it reveals the raw audit record — ids, ip, fingerprint, user agent, quota-after, duplicate linkage — the "complete download records in the database" requirement made visible. |
| 502–640 | **`DownloadLibrary`** | Four stat cards (total, completed, in progress, offline size), filter tabs (all/completed/active/problems), the quota meter, the **edge-case test bench** (simulate a dropped connection, simulate a failure, test the 24h duplicate cache, force an IST quota reset) and the audit-trail panel with a full-screen viewer. |
| 642–658 | `MiniStat`, `plan2Days` | Small helpers. |

---

## 6. `src/components/CheckoutSheet.tsx` (436 lines) — the Razorpay test checkout

| Section | Lines | Notes |
|---|---|---|
| State | 44–58 | Method (card/UPI/netbanking/wallet), card fields, UPI id, the selected fault, the stage machine (`form → processing → result`), the stage label/percent and the result object. |
| Quote | 60–62 | `quote()` for the live price breakdown and `classifyAction()` for the button semantics. |
| **`pay()`** | 76–150 | The whole sequence with visible stage transitions: "Creating the order with Razorpay…" (and surfacing `reused` when the idempotency window caught a double click) → "Opening Razorpay Checkout…" → a method-specific waiting message → `processCheckout()` → "Verifying the payment signature (HMAC-SHA256)…" → result. |
| Method tabs & forms | 168–250 | Card entry with live network detection and Luhn feedback, UPI with test handles, and short notes for netbanking/wallet. |
| **Failure-path simulator** | 252–290 | Four chips that make every failure mode reproducible in one click: *card declined*, *abandon checkout*, *network drop*, *tamper signature* — each with an explanation of what the system will do. |
| Order summary | 292–360 | Plan gradient header, the line-item breakdown (**licence, pro-rata credit, GST split, total**), the recorded action with its explanation, a four-point assurance list, and the pay button showing the exact amount. |
| Processing view | 362–378 | Spinner, stage label and progress bar with a "do not close this window" note. |
| Result view | 380–425 | Per-status headline and colour (success, duplicate, verification failure, decline, cancel, pending), the transaction record (order id, payment id, invoice, status, signature verified/❌, idempotency note), and context-aware actions: **"Check pending payments"** for the network case (which calls `reconcile()` and activates if the webhook landed), or "Try again" otherwise. |

---

## 7. Pages

### `AuthPage.tsx` (426 lines)

| Lines | What it does |
|---|---|
| 1–14 | Header comment: the three specified behaviours demonstrated on this one screen. |
| 30–45 | Form state plus the pending-OTP challenge state. |
| 46–52 | Live device + geo capture and the IST-derived theme, shown to the user. |
| 60–96 | **`submit()`** — sign-up path (register → welcome mail → session) or sign-in path: `blocked` → inline error; `otp_required` → open the challenge modal; success → sign in with the IST theme and report it in the toast. |
| 98–112 | `submitOtp()` — verify, show remaining attempts on failure, sign in on success. |
| 118–230 | Left hero: brand, the headline, four info tiles (live IST clock and resulting theme, how step-up verification works, this device, this connection) and the **security test console** — "Act as new device" (rotates the fingerprint) and city buttons (move the simulated IP) so the OTP path can be triggered without a second machine. |
| 232–330 | Right card: sign-in/sign-up tabs, fields, demo-account quick fill, and the recent login audit. |
| 332–420 | The **OTP modal**: the "why am I being asked" reason list, the demo code (explicitly labelled as standing in for the e-mail), the 6-digit input with keyboard submit, the error line, and Verify/Resend. |
| 422–440 | Footer summarising the theme rule and the OTP triggers. |

### `HomePage.tsx` (237 lines)

Hero card (plan badge, days remaining, today's allowance with a progress bar and four entitlement
chips) → *Continue watching* (resume positions with progress bars) → category chips + "only titles my
plan can play" filter → the `VideoCard` grid. Each card shows access badges (Premium/Exclusive),
a **Locked** badge when the plan cannot play it, the progress bar, and a playable/needs-tier line —
so the paywall is legible before any click.

### `WatchPage.tsx` (241 lines)

Composes `VideoPlayer` with the entitlement context: it computes `canStream()`, the allowed
renditions from the plan cap, the watch-time allowance and the resume bookmark, and passes
`canPlay={canPlayNow}` so the player's play button is vetoed (with a toast) once the daily watch
budget is exhausted. Below the player: metadata, `DownloadButton`, description and tags, three live
cards (streaming quality vs cap, watch time today, playback session), a locked-state warning with an
upgrade CTA, and a sidebar with the quota meter, "up next" (with lock overlays on unreachable
titles) and the memory-jogging keyboard-shortcut table.

### `SubscriptionsPage.tsx` (406 lines)

Current-status card (plan, status, cycle, validity bar with used percentage, start → expiry,
renewal date, and the renewal/cancel/resume/compare actions) + an "entitlements right now" panel →
cycle toggle with discount badges → four `PlanCard`s (gradient header with the exact price *and*
per-month equivalent, feature list, quota/quality summary, current-plan state, action button) →
the subscription timeline table (plan, action, cycle, start, expiry, paid, invoice, status) → the
compare-all-plans modal (grouped matrix with tick/cross rendering) → the cancellation modal that
states precisely what happens and what is preserved → the checkout sheet.

### `DownloadsPage.tsx` (44 lines)

The dedicated profile section: a header, an explainer card that restates the current plan's limits
with today's IST keys and usage, then the full `DownloadLibrary`.

### `SecurityPage.tsx` (284 lines)

Four stat cards (logins recorded, OTP challenges, trusted devices, last login) → theme-behaviour card
with the two toggles (auto-apply on login, pin my choice) and manual light/dark buttons → "this
session" card showing everything captured at login, with the test-console buttons → trusted-device
cards (model, browser/OS, location, IP, first/last seen, trusted-until, extend and revoke) → the
**login history table** (time, result, browser/OS, device, IP, location, theme + hour, reason) →
change-password modal.

### `BillingPage.tsx` (227 lines)

Four stats (lifetime paid, failed/cancelled, open orders, invoices e-mailed) → a pending-payment
banner when an order is stuck (with "Check pending payments") → the transactions table (date,
invoice, plan, action, amount, method, order id, payment id, signature verified/mismatch, status,
and an invoice viewer) → the orders list (with receipt and attempt count) → the invoice e-mails →
the invoice modal (full field-level detail including the failure reason and retry linkage).

### `InboxPage.tsx` (127 lines)

Kind filters, a message list with badges and previews, and a reader pane that renders the mail body
verbatim in a monospace block — so the invoice e-mail can be read exactly as a customer would
receive it, including the support block.

### `ProfilePage.tsx` (272 lines)

Four stats (plan, watch time today, videos completed, offline library) → account card (avatar,
editable name/phone, subscription facts, IST keys, quota usage) → plan entitlements with a validity
bar → preferences card (the two theme toggles + manual switch) → recently watched list with progress
→ recent sign-ins → **demo data card** (reset everything, or export every table as a JSON snapshot).

### `CallsPage.tsx` (861 lines) — the video calling suite

| Lines | What it does |
|---|---|
| 1–22 | Header comment stating exactly what is real (local media, cross-tab roster/chat) and what needs a signalling server (remote video). |
| 42–110 | **Lobby**: create a meeting (generates the room and jumps in), join by id or by pasting a link, generate a demo id, a "try it with two windows" explainer, a capability grid for the current plan and the recent-calls list. |
| 112–200 | **Room setup**: participant object, remote/bot rosters, chat, media state, quality, duration, room flags (lock/chat/screen/recording), reconnect banner state and the session event log. |
| 200–260 | Media acquisition with graceful degradation, and binding the stream to the local `<video>` (and the screen-share `<video>`). |
| 262–300 | **Roster sync**: joins the roster, heartbeats every 2 s while pushing the local mic/camera/hand state, prunes stale peers, and listens for chat/roster/moderation signals over `BroadcastChannel`. |
| 302–330 | Duration/quality ticker and simulated-peer speaking rotation. |
| 332–410 | **Actions**: `toggleMic` (disables the real audio track), `toggleCamera` (stops or re-acquires the video track and merges it into the live stream), `flipCamera` (front/rear on mobile), `toggleScreen` (honours the host permission, treats a cancelled picker as neutral), `sendMessage` (persists **and** broadcasts), `shareFile`, `addDemoParticipant` (**enforces the plan's participant cap** with an upgrade message), `reconnectingSim` (a visible drop → rejoin cycle), `startRec`/`stopRec` (Gold-host only). |
| 412–470 | Top bar: leave, room id, duration, participant count vs limit, quality indicator, lock/REC badges, copy-link, add-participant, simulate-drop, participants and chat toggles; plus the reconnecting banner and the **permission-denied banner** explaining that you are still in the meeting. |
| 472–560 | The grid: screen-share surface, the local tile (real video, name, mic/camera icons, hand badge, "camera off" placeholder) and remote tiles (avatar, role, mic/camera state, speaking ring, hand badge, quality chip). |
| 562–600 | Control bar: mute, camera, flip, screen share, raise hand, record, end call. |
| 602–700 | **Host moderation**: lock/unlock, disable chat, restrict screen share, mute all, remove last participant, promote to co-host — each writing a line to the session log, plus a summary of the permissions currently in force. |
| 702–840 | Sidebar: **in-call chat** with emoji strip, file attach, timestamps and system messages; the participants panel with seat usage and a capacity bar; and the session event log. |

### `App.tsx` (66 lines) and `main.tsx` (19 lines)

`App.tsx` wraps everything in `AppProvider` and routes: no session → `AuthPage`; otherwise the
selected page inside `Layout`, with the search query lifted to the router so the header can drive
the catalogue. `main.tsx` seeds the database and mounts, exactly once.
