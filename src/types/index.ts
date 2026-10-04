/* ============================================================================
 * NexStream - Central type definitions
 * Every entity that is persisted into the local database (localStorage) or
 * exchanged between modules is declared here so all layers stay in sync.
 * ==========================================================================*/

/* ----------------------------- Users & auth ------------------------------ */

export type ThemeMode = 'light' | 'dark';

/** Device classification derived purely from the User-Agent string. */
export type DeviceType = 'Desktop' | 'Mobile' | 'Tablet';

export interface DeviceInfo {
  type: DeviceType;
  /** e.g. "Windows 10/11", "Android 14", "iOS 17", "macOS 14" */
  os: string;
  /** e.g. "Chrome 128.0.0.0" */
  browser: string;
  /** Best-effort hardware model (mobile/tablet only, "Unknown" otherwise) */
  model: string;
  /** Stable per-browser-install fingerprint (random id kept in localStorage) */
  fingerprint: string;
  screen: string;
  timezone: string;
  language: string;
  userAgent: string;
}

export interface GeoLocation {
  ip: string;
  city: string;
  region: string;
  country: string;
  /** Human readable "Mumbai, Maharashtra, India" */
  label: string;
  simulated: boolean;
}

export interface TrustedDevice {
  fingerprint: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
  model: string;
  ip: string;
  location: string;
  firstSeen: number;
  lastSeen: number;
  /** epoch ms until which this device skips OTP prompts */
  trustedUntil: number;
}

export type LoginStatus = 'success' | 'otp_required' | 'otp_failed' | 'blocked';
export type OtpChannel = 'email' | 'sms';

/** One row of the security audit trail (login history / session list). */
export interface LoginRecord {
  id: string;
  userId: string;
  timestamp: number;
  ip: string;
  city: string;
  region: string;
  country: string;
  browser: string;
  os: string;
  deviceType: DeviceType;
  deviceModel: string;
  fingerprint: string;
  status: LoginStatus;
  /** Why OTP was demanded, e.g. ["new_browser","new_city"] */
  reasons: string[];
  otpChannel?: OtpChannel;
  /** Detected theme applied for this session */
  themeApplied: ThemeMode;
  loggedInAtHourIst: number;
}

export interface PendingOtp {
  id: string;
  userId: string;
  code: string;
  channel: OtpChannel;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
  context: {
    device: DeviceInfo;
    geo: GeoLocation;
    reasons: string[];
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  password: string; // demo only - a real backend would store a hash
  avatarColor: string;
  createdAt: number;
  /** User's saved theme preference (persists across sessions + devices) */
  theme: ThemeMode;
  /** true = user manually picked the theme, so login no longer overrides it */
  themeLockedByUser: boolean;
  /** If true the IST login window rules overwrite the theme on every login */
  autoThemeOnLogin: boolean;
  planId: PlanId;
  trustedDevices: TrustedDevice[];
  trustDurationDays: number;
}

/* ---------------------------- Subscriptions ------------------------------ */

export type PlanId = 'free' | 'bronze' | 'silver' | 'gold';
export type PlanTier = 0 | 1 | 2 | 3;
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  tier: PlanTier;
  tagline: string;
  monthlyPrice: number;
  /** Pillar accent colours used across the UI */
  accent: string;
  gradient: string;
  /** -1 means "unlimited" */
  dailyDownloadLimit: number;
  monthlyDownloadLimit: number;
  maxStreamQuality: 360 | 480 | 720 | 1080 | 2160;
  dailyWatchMinutes: number; // -1 = unlimited
  maxDevices: number; // concurrent registered devices
  offlineDownloads: boolean;
  adFree: boolean;
  priorityStreaming: boolean;
  exclusiveCourses: boolean;
  premiumAccessPercent: number; // how much of the premium catalogue is unlocked
  maxCallParticipants: number;
  features: string[];
  renewalPolicy: string;
  upgradeEligible: boolean;
}

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'pending';
export type SubscriptionAction = 'new' | 'renew' | 'upgrade' | 'downgrade';

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  startDate: number;
  expiryDate: number;
  /** Set when the user cancels: access continues until expiryDate */
  cancelledAt?: number;
  autoRenew: boolean;
  /** Pro-rated credit carried over from the previous plan */
  creditCarried: number;
  createdAt: number;
  action: SubscriptionAction;
  previousPlanId?: PlanId;
  /** Snapshot so history stays correct after plan prices change */
  pricePaid: number;
  currency: string;
  invoiceNumber: string;
}

/* ------------------------------- Payments -------------------------------- */

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'duplicate'
  | 'verification_failed'
  | 'network_error';

export interface PaymentOrder {
  /** Primary key of the orders table (mirrors orderId for readability). */
  id: string;
  orderId: string;
  userId: string;
  planId: PlanId;
  cycle: BillingCycle;
  amount: number; // in the smallest currency unit (paise)
  currency: string;
  receipt: string;
  status: PaymentStatus;
  createdAt: number;
  /** Dedupe guard: two "pay" clicks inside this window are treated as one */
  idempotencyKey: string;
  /** How many times the user has opened checkout for this order */
  attempts: number;
  /** What the Razorpay webhook will eventually report. Used to settle orders
   *  whose client callback was lost (browser closed, network dropped). */
  webhookOutcome?: PaymentStatus;
  settledAt?: number;
}

export interface Transaction {
  id: string;
  userId: string;
  orderId: string;
  paymentId: string | null;
  signature?: string;
  signatureVerified?: boolean;
  invoiceNumber: string;
  planId: PlanId;
  cycle: BillingCycle;
  amount: number; // paise
  currency: string;
  status: PaymentStatus;
  method: string; // card / upi / netbanking / wallet
  cardLast4?: string;
  createdAt: number;
  verifiedAt?: number;
  failureReason?: string;
  retryOf?: string;
  subscriptionId?: string;
  action: SubscriptionAction;
}

/* -------------------------------- Videos --------------------------------- */

export type VideoAccess = 'public' | 'premium' | 'exclusive';
export type QualityLabel = '360p' | '720p' | '1080p';

export interface VideoSource {
  quality: QualityLabel;
  url: string;
  sizeBytes: number;
}

export interface Video {
  id: string;
  title: string;
  description: string;
  category: string;
  channel: string;
  duration: number; // seconds
  thumbnail: string;
  poster: string;
  access: VideoAccess;
  minTier: PlanTier; // minimum plan tier required to stream/download
  views: number;
  likes: number;
  publishedAt: number;
  tags: string[];
  sources: VideoSource[];
  captions?: { label: string; url: string }[];
}

export interface WatchProgress {
  userId: string;
  videoId: string;
  position: number;
  duration: number;
  percent: number;
  completed: boolean;
  updatedAt: number;
  /** Minutes watched today - feeds the free-plan watch-time limit */
  minutesToday: number;
  dayKey: string;
}

/* ------------------------------ Downloads -------------------------------- */

export type DownloadStatus =
  | 'queued'
  | 'validating'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'blocked'
  | 'expired_access';

export interface DownloadRecord {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  thumbnail: string;
  quality: QualityLabel;
  fileSize: number;
  status: DownloadStatus;
  /** 0-100 */
  progress: number;
  downloadedBytes: number;
  /** epoch ms; a download is "counted" only if it reaches completed */
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
  planId: PlanId;
  planName: string;
  /** Audit trail ------------------------------------------------------- */
  ip: string;
  city: string;
  region: string;
  country: string;
  deviceType: DeviceType;
  deviceModel: string;
  os: string;
  browser: string;
  userAgent: string;
  fingerprint: string;
  /** true when the record was served from the duplicate cache and did NOT
   *  consume quota */
  duplicateOf?: string;
  countsAgainstQuota: boolean;
  /** Remaining quota captured right after this download */
  quotaAfter: number;
  failureReason?: string;
  retryCount: number;
}

export interface QuotaState {
  userId: string;
  /** IST calendar day, e.g. "2026-10-03" - resets at 00:00 IST */
  dayKey: string;
  usedToday: number;
  /** IST calendar month, e.g. "2026-10" */
  monthKey: string;
  usedThisMonth: number;
  lastResetAt: number;
}

export interface DownloadAuditEntry {
  id: string;
  userId: string;
  videoId: string;
  downloadId?: string;
  timestamp: number;
  event:
    | 'request'
    | 'authorized'
    | 'blocked'
    | 'duplicate'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'resumed'
    | 'cancelled'
    | 'quota_reset';
  detail: string;
  ip: string;
  fingerprint: string;
  planId: PlanId;
}

/* ------------------------------- E-mails --------------------------------- */

export interface MailMessage {
  id: string;
  userId: string;
  to: string;
  subject: string;
  preview: string;
  /** Plain text body rendered in the in-app inbox */
  body: string;
  kind: 'invoice' | 'otp' | 'welcome' | 'subscription' | 'download' | 'security';
  createdAt: number;
  read: boolean;
  meta?: Record<string, string>;
}

/* ------------------------------- Calling --------------------------------- */

export type CallConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'connecting';
export type CallRole = 'host' | 'cohost' | 'participant';

export interface CallParticipant {
  id: string; // peer id (random per tab)
  userId: string;
  name: string;
  avatarColor: string;
  role: CallRole;
  isSelf: boolean;
  micOn: boolean;
  cameraOn: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  speaking: boolean;
  quality: CallConnectionQuality;
  joinedAt: number;
  facingMode: 'user' | 'environment';
}

export interface CallChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  avatarColor: string;
  text: string;
  timestamp: number;
  system?: boolean;
  file?: { name: string; size: number; type: string; url: string };
}

export interface CallRoomState {
  roomId: string;
  hostId: string;
  locked: boolean;
  allowChat: boolean;
  allowScreenShare: boolean;
  recording: boolean;
  participants: CallParticipant[];
}

/* ------------------------------- UI helpers ------------------------------ */

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

export type CommentLanguage =
  | 'English'
  | 'Hindi'
  | 'Marathi'
  | 'Bengali'
  | 'Gujarati'
  | 'Tamil'
  | 'Telugu'
  | 'Kannada'
  | 'Malayalam'
  | 'Punjabi'
  | 'Urdu'
  | 'Other';

export interface VideoComment {
  id: string;
  videoId: string;
  userId: string;
  authorName: string;
  text: string;
  language: CommentLanguage;
  createdAt: number;
}

export interface WatchEvent {
  id: string;
  userId: string;
  videoId: string;
  timestamp: number;
  type: 'play' | 'pause' | 'seek' | 'completed' | 'quality_change' | 'speed_change';
  detail?: string;
}
