# Demo script — a 15-minute walkthrough

Two seeded accounts (password for both: `Demo@1234`):

| Account | Plan | Why it exists |
|---|---|---|
| `priya@nexstream.test` | **Free** | to show every limit, block and upgrade prompt |
| `arjun@nexstream.test` | **Gold**, 12 days into a monthly cycle | to show the unlocked experience, billing history and recording |

---

## Step 1 — Sign in and watch the theming rule fire (2 min)

1. Open the app. The left panel shows the **live IST clock** and which theme this login will apply
   (light between 05:00–12:00 IST, dark otherwise).
2. Sign in as **Priya**. Because her browser is new, an **OTP challenge** appears.
   *Why this happens* is listed in the modal (`new_device`, `new_browser`, `new_ip`, `new_city`).
3. The 6-digit code is displayed in the modal *because there is no mail server* — it is also written
   to her Inbox as a real message. Enter it.
4. You are signed in, the device is now trusted for 30 days, and the toast reports the theme that
   was applied from the IST window.
5. Press **Sign out → sign in again**: no OTP this time (trusted device). That contrast is the whole
   point of the step-up design.

**Then:** press **"Act as new device"** (rotates the fingerprint) or pick **Bengaluru** in the test
console and sign in again — the OTP returns, and the reason changes to `new_city` / `new_device`.

## Step 2 — Free-tier limits, end to end (3 min)

1. Open **Big Buck Bunny** (a free title) and press **Download**.
2. The sheet shows the quota meter, the renditions, and *why* 720p/1080p are disabled
   (Free caps quality at 360p). Pick 360p → the transfer starts and the audit message appears.
3. Open the **Downloads** page: the row shows thumbnail, title, size, start time, status, plan used,
   the IP and city, the device and browser, and whether it consumed quota. Press **Audit details** to
   see the full stored record including the device fingerprint and user agent.
4. Try to download a **second** title today. Two gates are now in play and the message tells you
   which one stopped you — a **concurrent transfer** first, then **`daily_quota`** once the first
   one finishes. Free is 1/day, full stop.
5. Open the **Silver** title *Razorpay Integration Deep Dive* → the player is **locked** with the
   reason from `canStream()` and an upgrade CTA.

## Step 3 — Edge cases the spec asks about (3 min)

On the Downloads page, use the **edge-case test bench**:

| Button | What you will see |
|---|---|
| *Simulate a dropped connection* | the row turns `interrupted` at its current byte offset, and **Resume** continues from there |
| *Simulate a failed download* | the row turns `failed`, and the quota unit is **refunded** (the meter goes back up) |
| *Test the 24h duplicate cache* | re-downloading the same title returns "served from your offline cache — no quota consumed" |
| *Force an IST quota reset* | the day key is moved back, so the counters reset on the next read with a `quota_reset` audit row |

Also demonstrated there: **pause/resume** mid-transfer and **delete** from the library.

## Step 4 — Upgrade through Razorpay (3 min)

1. **Subscriptions** → compare the four plans (17-row matrix), switch the cycle to **Yearly** and
   watch the price change (20 % off).
2. Press **Upgrade to Bronze** on Priya's account. The checkout sheet opens with the **pro-rata
   credit** of her unused current plan already deducted, GST shown as an inclusive split, and the
   total.
3. Pay with the Visa test card → progress stages: order created → checkout opened → bank → **signature
   verification** → captured. The result screen shows order id, payment id, invoice number and
   "HMAC verified ✅".
4. Check the **Inbox**: the invoice e-mail with the full receipt and support details. Check
   **Billing**: the transaction row with the signature status.
5. Now demonstrate the failure paths (each in ~10 seconds):
   * **Card declined** → `failed`, plan unchanged.
   * **Abandon checkout** → `cancelled`, nothing charged.
   * **Network drop** → "confirmation pending"; press **Check pending payments** and the simulated
     webhook settles it and activates the plan — no second payment needed.
   * **Tamper signature** → `verification_failed` and **the plan is not activated**. This is the most
     important behaviour in the whole payment flow.
   * **Double-click Pay** → "existing order reused (no double charge)">
6. Finish by cancelling: **Cancel subscription** states exactly what happens and what is preserved,
   and access continues to the period end.

## Step 5 — The custom player (2 min)

Open any title, then:

* Hover the **timeline** → a frame-accurate preview thumbnail with the target time (decoded by a
  hidden video element into a canvas).
* Press **Space, ←, →, Shift+←/→, ↑/↓, M, F, T, P, C, S, N, 0–9** and watch the legend under the
  player.
* Open the **settings** popover → switch quality (playback continues from the same timestamp) and
  speed.
* Turn on **captions** (available on Big Buck Bunny and Sintel), try **PiP** and **theatre mode**.
* Let a video finish → the **"Up next in 10s"** countdown appears with a **cancel** button.
* Leave mid-video, go back to Browse → *Continue watching* shows the resume position; re-open and the
  player resumes and shows a "Resumed from 0:07" badge.
* Open a **second tab** with another video → the first pauses itself with a notice (single-playback
  lock, enforced across tabs).
* As **Priya** on Free, watch for a minute: the watch-time card tracks 60 min/day and the player
  refuses playback past the budget.

## Step 6 — Video calling (2 min)

1. **Calls → New meeting** → **Copy link**.
2. Paste the link into a **second browser tab**. Both tabs join the same roster — each with its own
   real camera.
3. Chat between the tabs (real cross-tab delivery over `BroadcastChannel`), send a file name, raise a
   hand, share a screen, and watch the mic/camera/speaking indicators update.
4. Use the host controls: **mute all**, **lock meeting**, **restrict screen share**, **promote to
   co-host**, **remove participant** — each writes a line to the session log.
5. Press **Simulate drop** → the reconnecting banner appears, then media and roster are restored.
6. **Add participant** until the participant cap is reached — the refusal message names the plan
   limit. Recording is offered only to a Gold host (**sign in as Arjun** to try it).
7. Deny the camera permission in your browser and rejoin: you land in **audio-only / listen-only**
   mode with an explanatory banner instead of being ejected.

## Step 7 — Security centre, billing and data (2 min)

* **Account security**: the login audits (browser, OS, device, IP, city/state/country, theme, hour,
  reason), trusted-device cards with **Extend**/**Revoke**, the theme-rule toggles, and change
  password.
* **Billing**: transactions, orders with idempotency attempts, and invoices — plus **Check pending
  payments** to run the webhook reconciliation on demand.
* **Profile → Demo data**: **Export database as JSON** to inspect every table, or **Reset all demo
  data** to return to the seeded state.
