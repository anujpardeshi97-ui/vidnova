# How to run NexStream — step by step

Everything below assumes the ZIP is extracted and you are in the `NexStream` folder.
**No API keys, no database, no internet connection and no backend are required.** The app runs
entirely in the browser.

---

## 0. What you need (one-time setup)

| Requirement | Why | How to check |
|---|---|---|
| **Node.js 18 or newer** (20 or 22 LTS recommended) | runs the dev server and build | open a terminal and type `node -v` → should print `v20.x` or higher |
| **npm** (comes with Node) | installs dependencies | `npm -v` |
| A modern browser | Chrome, Edge, Firefox or Safari | — |

If `node -v` says "command not found" / "not recognized", install Node.js from
<https://nodejs.org> (pick the **LTS** button, click through the installer with the defaults), then
**close and reopen the terminal** and check `node -v` again.

> Windows users who see a PowerShell "running scripts is disabled" message when using `npm` should
> run this once in an **Administrator** PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

---

## 1. Extract the ZIP

Extract `NexStream-Complete.zip` somewhere simple, e.g. `Desktop\NexStream` or `~/projects/NexStream`.
Avoid paths with unusual symbols; spaces are fine.

You should see this folder layout:

```
NexStream/
├── index.html          ← the app shell
├── package.json        ← dependencies + scripts
├── vite.config.ts
├── RUN.md              ← this file
├── start.bat           ← one-click launcher (Windows)
├── start.sh            ← one-click launcher (macOS / Linux)
├── docs/               ← full documentation
├── public/             ← the demo videos + captions
├── scripts/            ← rule-verification tests
└── src/                ← all application source
```

---

## 2. Install dependencies (once)

Open a terminal **in the NexStream folder**:

* **Windows** — hold `Shift`, right-click inside the folder, choose **"Open PowerShell window here"**
  (or "Open in Terminal" on Windows 11).
* **macOS** — right-click the folder in Finder → **Services → New Terminal at Folder**
  (or drag the folder onto the Terminal icon).
* **Linux** — right-click → *Open in Terminal*.

Then run:

```bash
npm install
```

This downloads React, Vite, TypeScript, Tailwind and Lucide into a `node_modules` folder. It takes
about 10–30 seconds and only prints a few `npm warn deprecated` lines, which are harmless.

---

## 3. Start the app

```bash
npm run dev
```

You will see:

```
  VITE v6.4.3  ready in 450 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.x.x:3000/
```

Open **<http://localhost:3000>** in your browser. That's it — the platform is running.

Keep the terminal window open while you use the app; pressing `Ctrl + C` in it stops the server.

### Alternative: one-click launchers

* **Windows** — double-click **`start.bat`**
* **macOS / Linux** — double-click **`start.sh`**, or run `./start.sh`

Both scripts check that Node is installed, run `npm install` automatically the first time, and then
start the dev server.

---

## 4. Sign in

Two accounts are pre-seeded — password **`Demo@1234`** for both:

| Account | Plan | Use it to see |
|---|---|---|
| `priya@nexstream.test` | Free | 1 download/day, 360p, watch-time limit, upgrade prompts |
| `arjun@nexstream.test` | Gold | unlimited downloads, 1080p, billing history, call recording |

**On the very first sign-in an OTP challenge appears.** That is the device-verification feature
working: the browser is new, so the platform demands a one-time code. The 6-digit code is shown in
the dialog (there is no mail server to send it to) and is also delivered to the in-app **Inbox**.

Sign in, sign out, and sign in again from the same browser — this time there is **no** OTP, because
the device is now trusted for 30 days. Use **"Act as new device"** or the city buttons on the login
screen to trigger the challenge again on demand.

### A 3-minute tour (in this order)

1. **Downloads tab** (sidebar) → try to download a second free video → watch the quota rule refuse
   it, with the reason spelled out.
2. **Downloads → Edge-case test bench** → *Simulate a failed download* (quota is refunded) and
   *Simulate a dropped connection* (resume from the same byte).
3. **Subscriptions** → *Upgrade to Bronze* → pay with the test Visa card → then try the
   **"Tamper signature"** fault to see the platform refuse to activate a plan.
4. **Inbox** → read the invoice e-mail it just generated.
5. **Calls** → *New meeting* → **Copy link** → paste the link into a **second browser tab** → chat
   between the two tabs.
6. Any video → hover the **timeline** for frame previews, and try `Space`, `←`, `→`, `M`, `F`, `T`,
   `P`, `C`, `S`, `N`.

A longer scripted walkthrough is in **`docs/06-DEMO-SCRIPT.md`**.

---

## 5. Other commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload on <http://localhost:3000> |
| `npm run verify` | runs the 65 rule assertions headlessly in Node (no browser needed) |
| `npm run lint` | TypeScript type-check — should report **0 errors** |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serves the production bundle locally |

---

## 6. Showing it to someone else

**On this computer:** just open <http://localhost:3000>.

**On a phone or another PC in the same Wi-Fi:** with `npm run dev` running, the terminal prints a
**Network** address (e.g. `http://192.168.1.24:3000`). Open that on the other device.
Note that browsers only allow camera/microphone access on `localhost` or HTTPS, so on a LAN address
the video-call suite will fall back to listen-only mode — use a tunnel (`ngrok http 3000`,
`cloudflared tunnel --url http://localhost:3000`) or deploy it over HTTPS for full camera access.

**Deploying it for real (free options):** run `npm run build` and upload the `dist/` folder to
Netlify, Vercel, Cloudflare Pages or GitHub Pages. Because the app uses hash-based routing
(`…/#/watch/vid_bbb`), it needs **no** server-side rewrite rules.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `'node' is not recognized` / `command not found` | Node isn't installed, or the terminal was open before installing it | install Node LTS from nodejs.org, then **reopen the terminal** |
| `npm ERR! ... EACCES` / permission errors on macOS/Linux | `npm install` was run with `sudo` earlier | delete `node_modules`, then run `npm install` without `sudo` |
| `Error: Port 3000 is already in use` (`EADDRINUSE`) | another dev server is running | stop it, or start on another port: `npm run dev -- --port=3001` |
| Blank white page | a stale service worker or old site data | open DevTools → Console for the error; then hard-refresh (`Ctrl+Shift+R`) and/or clear site data for `localhost:3000` |
| Sign-in says "Incorrect e-mail or password" | typo, or the demo data was reset while a form was open | use the **demo account buttons** on the login card to fill the credentials |
| Expected "New sign-in context" OTP but got straight in | this browser is already a trusted device | press **"Act as new device"** on the login screen, or **Sign out → sign in** from a private/incognito window |
| Camera/microphone blocked in a call | browser permission denied, or the page isn't a secure context | click the padlock/settings icon in the address bar → allow Camera & Microphone → reload; make sure you are on `localhost` or HTTPS |
| Videos don't play | very old browser without H.264 support | use a current Chrome, Edge, Firefox or Safari |
| Downloads/quota/plans look wrong | the data is per-browser and may have been edited during testing | **Profile → Demo data → Reset all demo data** (or clear site data for the origin) |
| `npm install` fails on a corporate network | proxy/registry restrictions | try `npm install --registry=https://registry.npmjs.org` |

---

## 8. Where the data lives

All state (accounts, subscriptions, payments, downloads, audit logs, mails, calls) is stored in the
browser's `localStorage` under `nexstream:1:*`. Two consequences worth knowing:

* **Different browser or profile = a fresh database.** Incognito windows start from the seeded state.
* **You can inspect or reset it at any time** from **Profile → Demo data** — *Export database as
  JSON* dumps every table, *Reset all demo data* restores the seeded accounts.

---

## 9. Quick reference

```bash
# first time
npm install

# every time after that
npm run dev          # → http://localhost:3000

# checks
npm run lint         # 0 TypeScript errors expected
npm run verify       # 65 passed, 0 failed expected
```

Credentials: `priya@nexstream.test` (Free) · `arjun@nexstream.test` (Gold) · password `Demo@1234`
