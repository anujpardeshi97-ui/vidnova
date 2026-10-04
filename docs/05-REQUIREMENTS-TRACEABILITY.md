# Requirements traceability — every clause of the brief → the code that implements it

Use this table to check the build against the assignment. **"Where"** names the file and function;
**"Prove it"** is the fastest way to see it working in the UI.

---

## Module 1 — Controlled video download management system

| # | Requirement | Where it is implemented | Prove it |
|---|---|---|---|
| 1 | Users download videos based on their subscription plan | `downloadService.requestDownload()` gates 1–2 (`plan.tier ≥ video.minTier`, plan capability flags) | Open a Gold-exclusive title as Free (`vid_react`) → download is blocked with an upgrade CTA |
| 2 | Download limits enforced | Gates 6–7 against `QuotaState.usedToday/usedThisMonth` | Download once as Free, then try another title the same day |
| 3 | **Free = one video per day** | `plans.ts` → `free.dailyDownloadLimit: 1`; enforced in gate 6 | Downloads page → quota meter shows `1 / 1`; second attempt returns `daily_quota` |
| 4 | Bronze / Silver / Gold higher limits | `plans.ts` daily 3 / 10 / unlimited, monthly 25 / 100 / unlimited | Switch plan → the quota meter and the plan card update from the same table |
| 5 | Verify **active subscription** | Gate 1, and `subscriptionService.canDownloadAtAll()` | Billing → let a plan lapse → download is refused with a renewal message |
| 6 | Verify **remaining daily/monthly quota** | Gate 6 (`istDayKey`) and gate 7 (`istMonthKey`) | Edge-case bench → "Force an IST quota reset" → counters return to zero |
| 7 | Verify **video accessibility** | Gate 2 (tier) + gate 2b (quality cap) | Free user opening a Silver title sees the locked overlay from `canStream()` |
| 8 | Downloads shown in a dedicated profile section | Route `#/downloads` → `pages/DownloadsPage.tsx` + `components/Downloads.tsx` | Sidebar → Downloads |
| 9 | …showing **title, thumbnail, date and time, status, file size, plan used, remaining quota** | `DownloadRow` renders exactly these: title, thumbnail, `istDateTime(startedAt/completedAt)`, status badge, `formatBytes(fileSize)`, `planName`, `quotaAfter` | Any completed row |
| 10 | Complete records in the database | `DownloadRecord` carries userId, videoId, timestamp, ip, device info, browser, plan + `DownloadAuditEntry` for history | Download row → **Audit details** (expanded panel lists every stored field) |
| 11 | Prevent duplicate downloads counting twice in a period | Gate 3, `DUPLICATE_WINDOW_MS = 24h` → returns `duplicate`, quota untouched | Bench → "Test the 24h duplicate cache" |
| 12 | Block unlimited downloads by free users | Free caps: 1/day **and** 5/month **and** 1 concurrent + 1 device | `scripts/verify-rules.ts` §4 asserts the block |
| 13 | Validate download authorization before each request | Every request re-walks all eight gates; nothing is cached client-side | Watch any title → Download → the modal shows the live verdict |
| 14 | Restrict downloads after subscription expiry | Gate 1 calls `reconcileExpiry()` → downgrade to Free; `invalidateForExpiry()` aborts in-flight transfers | §8 of the verification script (in-flight abort assertion) |
| 15 | Limit downloads to registered devices | Gate 4 — trusted devices ∪ devices with downloads in the last 90 days vs `plan.maxDevices` | Free (1 device) on a second browser → `device_limit` |
| 16 | Handle interrupted downloads | `simulateInterruption()` → `interrupted`, resumable from `downloadedBytes` | Bench → "Simulate a dropped connection", then Resume |
| 17 | Handle failed download attempts | `simulateFailure()` → `failed`, quota **refunded**, retry counter | Bench → "Simulate a failed download" |
| 18 | Handle repeated refresh requests | All state is in the database, so a refresh re-reads rather than re-requests; idempotent gates | Download something, press F5 — the record and quota are intact, no double count |
| 19 | Simultaneous downloads across devices | Gate 5 `CONCURRENT_LIMIT` (free 1 / paid 2 / gold 3) names the blocking device | Bench → start one download, press F5 in a second tab and download → `concurrency` |
| 20 | Quota resets at the start of a new day (IST) | `getQuota()` lazy rollover on `istDayKey()` change + `quota_reset` audit | Header strip shows the countdown to 00:00 IST |
| 21 | All limits applied securely | Rules live only in `downloadService`; the UI can request but never decide | Delete any component — the gates still hold |

---

## Module 2 — Subscription management with Razorpay

| # | Requirement | Where it is implemented | Prove it |
|---|---|---|---|
| 1 | Free / Bronze / Silver / Gold with progressive features | `data/plans.ts` `PLANS`, `COMPARISON_ROWS` | Subscriptions → Compare all plans |
| 2 | Free: limited premium access, features, lower quality, restricted watch time, limited downloads | Free row: 20 % catalogue, 360p, 60 min/day, 1 download/day, ads | Sign in as `priya@nexstream.test` |
| 3 | Paid: unlimited access, higher quality, offline, priority, exclusive courses, ad-free, higher limits | Bronze/Silver/Gold rows with `adFree`, `priorityStreaming`, `exclusiveCourses`, `maxStreamQuality` | Sign in as `arjun@nexstream.test` (Gold) |
| 4 | Each plan: pricing, validity, feature comparison, renewal policy, upgrade eligibility | `Plan` fields + `renewalPolicy` + `upgradeEligible`, cycle multipliers in `CYCLE_DISCOUNT` | Plan cards show price per cycle and the renewal sentence |
| 5 | Compare plans before purchasing | `COMPARISON_ROWS` → the compare modal (17 rows, 6 groups) | Subscriptions → Compare all plans |
| 6 | View current status, remaining validity, next renewal, billing history, premium features | `subscriptionService.overview()` → status card, validity bar, renewal date, timeline table, entitlements panel | Subscriptions page, top card |
| 7 | Upgrade / downgrade / renew / cancel | `activateSubscription`, `classifyAction`, `cancelSubscription`, `resumeSubscription` | Subscriptions → the action row |
| 8 | Razorpay **test** payment integration | `lib/razorpay.ts` (test key, order/payment id shapes, HMAC via WebCrypto) + `paymentService` | Checkout sheet header shows the test key |
| 9 | Securely handle successful payments | `processCheckout` case 4 → signature verified → `activateSubscription` | Pay with Visa 4111… → success screen |
| 10 | …failed transactions | Case 2 → `failed` transaction + reason, plan untouched | Pick the "Card declined" fault |
| 11 | …cancelled payments | Case 1 → `cancelled`, nothing charged | Pick the "Abandon checkout" fault |
| 12 | …duplicate payment attempts | Settled-order guard + 60 s idempotency window | Double-click Pay → "existing order reused"; replay a captured order → `duplicate` |
| 13 | …network interruptions | Case 3 → order stays `pending`, `webhookOutcome='captured'`; `reconcile()` settles it | "Network drop" fault → **Check pending payments** |
| 14 | …payment verification before updating status | **`verifyPaymentSignature()` HMAC-SHA256 gate precedes activation** | "Tamper signature" fault → `verification_failed`, plan unchanged |
| 15 | Store plan + complete transaction details (payment id, order id, invoice, amount, currency, status, start, expiry, renewal) | `Transaction` + `Subscription` rows → rendered on the Billing page and in the invoice e-mail | Billing → View any invoice |
| 16 | Activate premium features only after verification | `activateSubscription` is called only from the verified branch | §9 of the verification script |
| 17 | Prevent unauthorized access to premium content | `canStream()` everywhere content is opened; player locked overlay | Free user → `vid_react` shows "Playback locked" |
| 18 | Expired subscriptions auto-downgrade to Free, **preserving data and watch history** | `reconcileExpiry()` flips rows, never deletes; watch history is a separate table | §8 of the script; `sendDowngradeMail()` lists what is preserved |
| 19 | Confirmation e-mail with invoice, receipt, subscription details, validity, transaction info, support contact | `mailService.sendInvoiceMail()` (full formatted receipt) | Inbox → the invoice message |
| 20 | Automated renewal reminder | `sendRenewalReminder()` (T-3 days) | `mailService.ts` lines 287–300 |

---

## Module 3 — Personalized + secure user experience (IST theming, login audit, OTP)

| # | Requirement | Where it is implemented | Prove it |
|---|---|---|---|
| 1 | Login 05:00–12:00 IST → **light** theme | `ist.themeForIstLogin()`; applied in `verifyOtp`/`attemptLogin` → `signIn(user, theme)` | Auth page shows the live IST hour and the theme it will apply; the header strip confirms after login |
| 2 | All other IST periods → **dark** theme | Same function (`hour >= 5 && hour < 12 ? 'light' : 'dark'`) | §2 of the script tests 04:59 / 05:00 / 09:30 / 11:59 / 12:00 / 23:30 |
| 3 | Theme saved in the profile; user can change it any time | `users.theme` + `themeLockedByUser`; header switch and Security/Profile toggles | Toggle theme → sign out → sign in: it persists |
| 4 | Preference persists across sessions **and devices** | It lives on the user row, not the session | Same |
| 5 | Record public IP | `geo.resolveGeoLocation()` → `LoginRecord.ip` | Security → login history table |
| 6 | Record browser name and version | `device.parseBrowser()` (e.g. "Chrome 128.0.0.0") | Same |
| 7 | Record OS | `device.parseOS()` | Same |
| 8 | Record device type (Desktop/Mobile/Tablet) | `device.parseDeviceType()` (incl. the iPadOS-as-Mac case) | Same |
| 9 | Record device model where available | `device.parseModel()` | Trusted-device cards show it |
| 10 | Record login timestamp | `LoginRecord.timestamp` shown via `istDateTime()` | Same |
| 11 | Record city, state, country, approximate location | `GeoLocation` → `LoginRecord.city/region/country` | Same |
| 12 | New browser / device / IP / city / state → **OTP required** | `security.evaluateLogin()` → reasons → `issueOtp()` | Auth page → "Act as new device" or pick another city, then sign in |
| 13 | OTP via registered e-mail or mobile | `OtpChannel` ('email' implemented with a real mail row; 'sms' logged) | OTP modal shows the masked destination |
| 14 | Verified device may be marked trusted for a configurable period | `TrustedDevice.trustedUntil` from `user.trustDurationDays` (default 30, editable) | Security → trusted-device card → Extend |
| 15 | Store login attempts, successful verifications, failed OTP attempts, trusted devices, login history | `LoginRecord` for every path + `users.trustedDevices` | Security page: stats, history table, device cards; a wrong code writes `otp_failed` |
| 16 | Available to the user through an account security page for review and session management | `pages/SecurityPage.tsx` (stats, history, devices, revoke, change password) | Route `#/security` |

---

## Module 4 — Fully customized HTML5 video player

| # | Requirement | Where it is implemented | Prove it |
|---|---|---|---|
| 1 | No default browser controls | `<video>` has no `controls` attribute; `index.css` also hides `::-webkit-media-controls` | Any video |
| 2 | Play / pause | `togglePlay()`, click on video, Space/K | — |
| 3 | Volume via draggable slider | `<input type="range">` bound to `changeVolume()` | Hover the speaker icon |
| 4 | Mute / unmute | `toggleMute()` (M) | — |
| 5 | Playback speed 0.5/1/1.25/1.5/2 | `SPEEDS`, settings popover, S cycles | — |
| 6 | Seek ±10 s | `seekBy(±10)` buttons and ←/→ | — |
| 7 | Theatre mode and fullscreen | `toggleTheater()` (T) and `toggleFullscreen()` (F) on the shell element | — |
| 8 | Picture-in-Picture | `togglePip()` (P) with enter/leave events | — |
| 9 | Subtitles/captions toggle | `<track>` + `toggleCaptions()` (C), "Not available" notice otherwise | Big Buck Bunny / Sintel ship captions |
| 10 | Current time, total duration, remaining time | Control-bar readout | — |
| 11 | Buffering progress and playback progress | Two-bar timeline (`buffered` vs `currentTime`) | — |
| 12 | Loading indicators | `waiting` state + spinner overlay | Scrub quickly |
| 13 | Video quality information | Live quality badge + settings menu | — |
| 14 | Autoplay countdown for the next video **with cancel** | `countdown` state, "Up next in Ns" card with ✕ and Play-now | Let a video finish |
| 15 | Remember last watched position and auto-resume | `watchService.saveProgress/ progressFor` → `resumeFrom` + "Resumed from 0:07" badge | Leave mid-video, come back |
| 16 | Save watch progress periodically | 5-second interval in the player | Progress table in Profile |
| 17 | Mark videos completed after a configurable watch percentage | `COMPLETION_THRESHOLD = 90`, `completed` flag | Watch past 90 % → "completed ✅" |
| 18 | Prevent multiple videos playing simultaneously | `claimPlaybackSlot` / `storage` event → other player pauses with a notice | Open two tabs with different videos |
| 19 | Keyboard: Space play/pause | Window-level handler | — |
| 20 | ←/→ seek | `seekBy(∓10)` | — |
| 21 | Shift + arrows skip larger intervals | `SKIP_LARGE = 30` | — |
| 22 | ↑/↓ volume | `changeVolume(±0.05)` | — |
| 23 | Dedicated keys for mute, speed, PiP, theatre, subtitles, fullscreen, next video | M, S, P, T, C, F, N | Legend printed under the player |
| 24 | Timeline hover previews | Hidden decoder + canvas painting the frame at the hovered time | Hover the timeline |
| 25 | Controls auto-hide after a few seconds and reappear on mouse move | 3-second idle timer via `wakeControls()` | Move the mouse |

---

## Module 5 — Real-time video calling

| # | Requirement | Where it is implemented | Prove it |
|---|---|---|---|
| 1 | Secure high-quality audio and video | Real `getUserMedia`; DTLS-SRTP is inherent to WebRTC; `acquireMedia` handles denial | Calls → New meeting |
| 2 | One-to-one and group calls | Roster + participant grid with a plan-based cap | "Add participant" repeatedly until the cap is hit |
| 3 | Create/join via unique meeting link or room ID | `createRoom()` → `nx-xxxx-xxxx`, `meetingLink()`, join-by-id | Copy link → paste in a second tab |
| 4 | Mute/unmute microphone | `toggleMic()` disables the real audio track | — |
| 5 | Enable/disable camera | `toggleCamera()` stops or re-acquires the video track and merges it | — |
| 6 | Switch front/rear camera on mobile | `facingMode` state + Flip button re-acquires the stream | Mobile browser |
| 7 | Screen share | `acquireScreenShare()` (real `getDisplayMedia`) with a permission check and picker-cancel handling | Share screen |
| 8 | Leave / end call | End call stops every track and logs the call duration | — |
| 9 | Participant list | Participants panel with seat usage and capacity bar | — |
| 10 | Raise hand | `handRaised` state → ✋ badge on the tile + session-log entry | — |
| 11 | In-call chat with messages, emojis, files | Chat panel; `sendChatMessage` persists + `broadcast()` over BroadcastChannel | Two tabs: message each other |
| 12 | Participant names, speaking indicators, mic/camera status, connection quality, call duration | Tile overlays, speaking ring, quality chip, duration in the header | — |
| 13 | Host moderation: mute participants, remove users, lock the meeting, assign co-hosts, manage screen-share/chat permissions | The "Host controls" card (every action writes to the session log and flips real state) | Calls → in-call |
| 14 | Optional call recording, local/host-only | `startRecording`/`stopRecording`/`recordings()`, Gold host only | Gold account → Record |
| 15 | Participant reconnection after network interruptions | "Simulate drop" → reconnecting banner → media restored, roster intact | In-call |
| 16 | Browser refresh mid-call | Roster heartbeat + session state re-join; stale rows are pruned automatically | Refresh one of the two tabs |
| 17 | Device switching during a call | `flipCamera` re-acquires and merges the track | — |
| 18 | Mic/camera permission denial | `acquireMedia` degrades camera → audio-only → listen-only, with an explanatory banner (you stay in the call) | Deny the prompt |
| 19 | Background noise suppression | `tunedAudioConstraints()` — echoCancellation, noiseSuppression, autoGainControl | — |
| 20 | Low-bandwidth network adaptation | `adaptiveVideoConstraints(quality)` maps detected link quality to resolution/frame rate | Quality chip + console |
| 21 | Maximum participant limits | `addDemoParticipant` refuses past `plan.maxCallParticipants` with an upgrade message | Add participants until the cap |
| 22 | Secure meeting authentication | Rooms live in the user's own store; joining requires the id from the host's link; lockable meeting | Lock meeting → new joins refused |
| 23 | End-to-end encryption where supported | WebRTC media is DTLS-SRTP encrypted by the browser; stated honestly in the capability grid | Calls lobby → capability grid |

---

## Honest limitations (and exactly what a production build changes)

| Area | How it works here | Production change |
|---|---|---|
| Remote video in calls | Remote tiles show presence, mic/camera and speaking state; your own camera is real | Add a signalling socket + `RTCPeerConnection` mesh, or an SFU (LiveKit/Daily/100m) |
| Persistence | `localStorage` (per browser) | Server database + REST/GraphQL API; the service functions become the API contract |
| Password hashing | Fast non-cryptographic digest, documented as demo-only | bcrypt/argon2 on the server; never hash in the client |
| IP geolocation | Simulated pool with a switcher for testing | Server-side lookup (MaxMind/ipapi) from the request's real IP |
| E-mail/SMS | Stored in a `mails` table and rendered as an inbox | SendGrid/SES + MSG91/Twilio for SMS |
| Payment signature | Real HMAC-SHA256, but verified in the browser with a test secret | Verify on the server; keep the secret server-side only |
| Download transfer | Progress simulation with a resumable byte offset | Signed CDN URL + HTTP Range, or a native app for true offline files |
| Recording | Lifecycle metadata + size estimate | `MediaRecorder` over a composed canvas, or SFU-side recording |
