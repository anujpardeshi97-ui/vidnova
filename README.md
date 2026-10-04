# NexStream — Video Streaming & Live Platform

A complete subscription video platform built to the assignment brief:

**tiered download management · Free/Bronze/Silver/Gold subscriptions with Razorpay test payments ·
IST-based adaptive theming · OTP device verification with full login audit · a fully custom HTML5
player · real-time video calling with moderation**

React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · 11,400 lines of source · **no backend needed**

---

## How to run it

```bash
npm install      # once — installs React, Vite, TypeScript, Tailwind
npm run dev      # then open http://localhost:3000
```

That is the whole setup: **no API keys, no database, no backend, no internet needed** once the
dependencies are installed. Requires **Node.js 18+** (LTS recommended).

* **Windows** — double-click **`start.bat`**
* **macOS / Linux** — double-click **`start.sh`** (it installs dependencies on first run)
* Prefer doing it by hand, or hit a problem? **`RUN.md`** has the full step-by-step guide,
  including troubleshooting, running it on your phone, and deploying it.

### Sign in

Password **`Demo@1234`** for both pre-seeded accounts:

| Account | Plan | Use it to see |
|---|---|---|
| `priya@nexstream.test` | Free | 1 download/day, 360p, watch-time limit, upgrade prompts |
| `arjun@nexstream.test` | Gold | unlimited downloads, 1080p, billing history, call recording |

The first sign-in from a new browser shows an **OTP verification** dialog — that is the device
verification feature working. The code is displayed in the dialog (no mail server here) and also
lands in the in-app Inbox. Sign in again from the same browser and no code is needed, because the
device is now trusted for 30 days.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server on `0.0.0.0:3000` (hot reload) |
| `npm run verify` | headless business-rule tests — **65 assertions, all passing** |
| `npm run lint` | `tsc --noEmit` — 0 errors |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the production bundle locally |

---

## What is implemented, at a glance

### 1. Controlled download management
An eight-gate pipeline (`src/services/downloadService.ts`) runs on **every** request:
active subscription → content tier → quality cap → 24 h duplicate window → registered devices →
concurrency → daily quota → monthly quota. Anything that fails returns a typed reason *and* writes an
audit row. Around it: a quota engine keyed to the IST day/month, refunds for failed/cancelled
transfers, resumable interrupts, and a complete record per download (IP, city, device, browser,
fingerprint, plan, size, status, quota impact).

Free = **1 download/day** (5/month, 1 device, 1 concurrent transfer); Bronze 3/25; Silver 10/100;
Gold unlimited. Re-downloading the same title within 24 h never consumes quota twice.

### 2. Subscriptions + Razorpay test payments
Four data-driven plans with pricing, cycles (monthly/quarterly/yearly at 10 %/20 % off), a 17-row
comparison matrix, pro-rated upgrade credit, GST-inclusive invoices and a full subscription timeline.
The payment flow covers **success, failure, cancellation, duplicates, network drops and signature
tampering** — and the activation step is guarded by a **real HMAC-SHA256 signature check**: a
mismatch never activates a plan. Lost callbacks are settled by a simulated webhook, and lapsed plans
are swept to Free while preserving all user data.

### 3. IST theming + security
Login between **05:00 and 12:00 IST** applies the light theme, any other IST hour applies dark, and
the choice is stored on the profile so it follows the user across sessions and devices (until they
pin a manual choice). Every attempt is audited with IP, browser, OS, device type/model, city, state,
country and timestamp, and any new browser/device/IP/city/state triggers a 6-digit e-mail OTP before
access is granted. Verified devices are trusted for a configurable window (default 30 days).

### 4. Custom HTML5 player
No native controls anywhere. Play/pause, draggable volume, mute, five speeds, ±10 s and ±30 s seeks,
theatre mode, fullscreen, Picture-in-Picture, captions, live quality switching, buffering states,
remaining time, **frame-accurate timeline hover previews**, a next-video autoplay countdown with
cancel, resume-from-position, periodic progress saving, completed-at-90 %, a cross-tab
single-playback lock, the full desktop keyboard map, and controls that hide after 3 s of inactivity.

### 5. Video calling
Real `getUserMedia` camera/mic, room links (`#/calls/nx-xxxx-xxxx`), participant roster with mic,
camera, speaking, hand-raise and connection-quality indicators, in-call chat with emojis and file
sharing, host moderation (lock, mute-all, remove, promote to co-host, per-feature permissions),
screen sharing, camera switching, call recording for Gold hosts, plan-based participant limits, and
graceful handling of permission denial, reconnection, refresh and low bandwidth.

Two browser tabs genuinely talk to each other (chat, roster, presence) over `BroadcastChannel` +
`localStorage`; remote *video* is the one part that needs a signalling server, and the code says so
rather than pretending.

---

## Documentation in `docs/`

| File | Contents |
|---|---|
| `01-ARCHITECTURE.md` | layers, data model (16 tables), the four big flows, design invariants |
| `02-FILE-BY-FILE-1-foundation.md` | **line-by-line explanation**: config, types, all of `src/lib`, all of `src/data` |
| `03-FILE-BY-FILE-2-services.md` | line-by-line: the entire service layer (every rule, every gate) |
| `04-FILE-BY-FILE-3-ui.md` | line-by-line: context, components, player, checkout, all pages |
| `05-REQUIREMENTS-TRACEABILITY.md` | **every clause of the brief → the code that implements it**, plus how to demo it |
| `06-DEMO-SCRIPT.md` | a 15-minute guided walkthrough |
| `07-VERIFICATION.md` | how the rules were tested, the full test output, and the 4 bugs the tests caught |
| `../RUN.md` | **how to install, run, troubleshoot, share and deploy the app** |

---

## Project layout

```
NexStream/
├── index.html                  app shell
├── index.css                   Tailwind v4 + the .dark variant + player helpers
├── vite.config.ts              dev/build config (host + CORS for the preview proxy)
├── public/
│   ├── videos/                 8 royalty-free renditions (360p/720p/1080p, 9.9 MB)
│   └── captions/               2 WebVTT subtitle tracks
├── scripts/verify-rules.ts     headless rule tests (npm run verify)
├── docs/                       the seven documents above
└── src/
    ├── types/index.ts          every contract (16 tables)
    ├── lib/                    storage · ist · format · device · geo · security · razorpay
    ├── data/                   plans · videos · thumbnails
    ├── services/               db · subscription · download · payment · mail · security · watch · call
    ├── context/AppContext.tsx  session, theme, routing, toasts
    ├── components/             ui · Layout · Downloads · CheckoutSheet · player/VideoPlayer
    └── pages/                  Auth · Home · Watch · Subscriptions · Downloads · Security ·
                                Billing · Inbox · Profile · Calls
```

---

## Where the data lives

Everything is stored in this browser under the `nexstream:1:*` keys (16 tables). That makes the demo
inspectable: **Profile → Demo data → Export database as JSON** dumps every table, and **Reset all
demo data** returns to the seeded state. Clearing site data does the same thing.

## Known scope limits (all documented in `docs/05`)

Remote call video needs a WebRTC signalling server; passwords use a demo-only digest (a real build
hashes server-side with bcrypt/argon2); IP geolocation and e-mail delivery are modelled locally; the
download transfer is simulated with a resumable byte offset rather than a real CDN stream. Each of
these is a function body away from production, and the service APIs were designed for exactly that
swap.
