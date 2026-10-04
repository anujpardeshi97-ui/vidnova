# Verification — how the rules were tested

## 1. How to run everything

```bash
npm install          # dependencies
npm run dev          # http://localhost:3000  (live preview)
npm run lint         # tsc --noEmit -> 0 errors
npm run verify       # headless business-rule tests (65 assertions)
npm run build        # production bundle
```

`scripts/verify-rules.ts` is the interesting one. It stubs the browser
(`localStorage`, `sessionStorage`, `navigator`, `screen`, WebCrypto), boots the **real service
layer** — the same files the UI imports — and asserts the platform's rules end to end. Nothing is
mocked except the browser itself: the same `requestDownload()`, `processCheckout()` and
`attemptLogin()` the app calls are the ones being exercised.

## 2. Current result

```
65 passed, 0 failed
```

Full output (console noise from the simulated Razorpay/webhook/mail layers removed):

```

1. Seeding and accounts
-----------------------
  ✓ two demo accounts seeded
  ✓ passwords are stored hashed, never in clear text
  ✓ Free account starts on the free tier
  ✓ Gold account has an active subscription

2. IST time-based theming (05:00-12:00 light, otherwise dark)
-------------------------------------------------------------
  ✓ 04:59 IST -> dark
  ✓ 05:00 IST -> light
  ✓ 09:30 IST -> light
  ✓ 11:59 IST -> light
  ✓ 12:00 IST -> dark
  ✓ 23:30 IST -> dark
  ✓ istHour() is IST-shifted

3. Login audit + OTP step-up on a new device
--------------------------------------------
  ✓ unknown context demands an OTP
  ✓ a pending OTP row was created
  ✓ an OTP e-mail was queued
  ✓ the login attempt itself is audited
  ✓ wrong password is rejected with one generic message
  ✓ wrong password never reveals whether the account exists
  ✓ an incorrect OTP is rejected
  ✓ the correct OTP succeeds
  ✓ verification trusts the device for 30 days
  ✓ a trusted device skips the OTP on the next login

4. Free plan download quota (1 per day)
---------------------------------------
  ✓ the first download of the day is authorised
  ✓ quota now shows 1 used today
  ✓ record stores the full audit trail (ip/device/plan)
  ✓ a concurrent second transfer is BLOCKED for a free member
  ✓ a second free download the same day is BLOCKED
  ✓ the block is reported as daily_quota
  ✓ the block is recorded in the audit log

5. Quality caps by plan
-----------------------
  ✓ Gold may download 1080p
  ✓ a plan whose cap is 720p cannot download 1080p

6. Tier gating (exclusive content)
----------------------------------
  ✓ a Free member cannot download a Gold-exclusive title

7. Edge cases: duplicate window + failure refunds
-------------------------------------------------
  ✓ re-downloading inside 24h is served from cache
  ✓ the duplicate does NOT consume quota again
  ✓ a fresh user gets a download slot
  ✓ a failed transfer refunds its quota unit

8. Subscription expiry blocks downloads
---------------------------------------
  ✓ a lapsed paid subscriber falls back to the Free allowance
  ✓ the downgrade is preserved as history, not deleted
  ✓ the account now resolves to Free
  ✓ the downgraded account is limited to the Free daily quota
  ✓ an in-flight download is aborted when the plan lapses

9. Payments: idempotency, signature verification, activation
------------------------------------------------------------
  ✓ double-clicking pay reuses the same order id
  ✓ the reuse is reported to the caller
  ✓ a tampered signature is rejected
  ✓ a tampered signature never activates the plan
  ✓ a declined card records a failed transaction
  ✓ a declined card leaves the plan untouched
  ✓ a valid signature captures the payment
  ✓ the subscription is activated after verification
  ✓ an invoice e-mail was sent
  ✓ the transaction keeps payment id, order id and invoice number
  ✓ the credit/price is recorded in paise
  ✓ replaying a captured payment is treated as a duplicate
  ✓ the replay does not double-charge or re-activate

10. Network drop -> webhook reconciliation
------------------------------------------
  ✓ a dropped connection reports an unknown status
  ✓ the webhook settles the pending payment
  ✓ the plan is activated by the webhook path

11. Cancellation keeps access until expiry
------------------------------------------
  ✓ cancelling flips the status and turns off auto-renew
  ✓ access survives until the paid period ends
  ✓ the entitlement check still sees an active period

12. Cross-device / new-city detection
-------------------------------------
  ✓ a new city + new device triggers an OTP
  ✓ the reasons list names the cause
  ✓ the new location is recorded in the audit row

13. Quota rollover at the IST midnight boundary
-----------------------------------------------
  ✓ a stale day key resets the daily counter
  ✓ the day key advances to today in IST
  ✓ the rollover is written to the audit trail

==========================================================
  65 passed, 0 failed
==========================================================
```

## 3. What each block proves

| Block | Proves |
|---|---|
| 1. Seeding and accounts | accounts exist, passwords are stored hashed, plans resolve |
| 2. IST time-based theming | the 05:00/12:00 boundaries, including 04:59 and 11:59 |
| 3. Login audit + OTP step-up | new context → OTP; wrong password → one generic message (no account enumeration); wrong code rejected; correct code trusts the device; next login skips the OTP |
| 4. Free plan quota | first download authorised, concurrent transfer refused, second download of the day refused by `daily_quota`, block recorded in the audit |
| 5. Quality caps | Gold may take 1080p; a 720p-capped plan cannot |
| 6. Tier gating | Free cannot download a Gold-exclusive title (`plan_required`) |
| 7. Duplicate window + refunds | a 24 h duplicate does **not** consume quota; a failed transfer **refunds** its unit |
| 8. Subscription expiry | a lapsed paid period downgrades to Free (history preserved) and is limited to the Free allowance; an in-flight transfer is aborted as `expired_access` |
| 9. Payments | idempotent order reuse; tampered signature → `verification_failed` and **no activation**; declined card → `failed`; valid signature → `captured` + activation + invoice mail; replay → `duplicate` with no re-activation |
| 10. Webhook reconciliation | a dropped connection leaves the order pending and the webhook settles and activates it |
| 11. Cancellation | status flips, auto-renew off, access survives to period end |
| 12. New city / new device | OTP triggered with the correct reasons recorded, and the location stored on the audit row |
| 13. Quota rollover | a stale IST day key resets the counter, advances the key and writes a `quota_reset` audit row |

## 4. Bugs the harness caught (and the fixes)

Writing the tests surfaced four real defects that would otherwise have shipped:

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | A brand-new signup was refused a download with "no active subscription" | `registerUser()` created the user but not the Free subscription row or quota bucket | `securityService.registerUser()` now seeds the Free plan and a quota bucket |
| 2 | A Free member was blocked as a "new device" on their **second** download from the same browser | Gate 4 counted devices only from the trusted list, so a device could never become known through use | Gate 4 now treats a device with downloads in the last 90 days as registered |
| 3 | Seeded demo subscriptions had already lapsed, so the Gold account behaved like Free | the seed created a 40-day-old record with a **monthly** cycle | seed starts the current cycle 12 days ago; Free rows get a far-future expiry (Free never expires) |
| 4 | A period that lapsed while the app was open failed with a confusing "not active" | the download pipeline consulted `activeSubscription()` without running the sweeper | Gate 1 now calls `reconcileExpiry()` first, so the account is downgraded and judged against the Free allowance |

## 5. Other checks run

* `npx tsc --noEmit` → **0 errors** across 39 source files (11,426 lines).
* `npx vite build` → builds cleanly (475 kB JS / 72 kB CSS, 136 kB gzipped).
* Media integrity: all eight bundled MP4s download and play locally (9.9 MB total), with real byte
  sizes fed into the download manager so file-size reporting is genuine.
* Video player: verified that `controls` is absent, that both the CSS and the markup suppress native
  controls, and that captions are shipped as real `.vtt` tracks for two titles.
* Cross-tab behaviour (single-playback lock, call roster/chat) relies on `localStorage` + the
  browser's `storage` event and `BroadcastChannel`; verified by hand across two windows.
