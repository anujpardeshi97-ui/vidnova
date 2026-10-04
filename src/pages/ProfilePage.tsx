/* ============================================================================
 * ProfilePage.tsx - profile overview + settings.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  CalendarClock, Clock, Crown, Database, Download, HardDrive, History, RotateCcw, Save,
  Settings, ShieldCheck, Sparkles, User as UserIcon, Video,
} from 'lucide-react';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, CheckList, Field, KV, PageHeader, Progress, SectionTitle, Stat, Toggle, inputClass } from '../components/ui';
import { overview, planQuota } from '../services/subscriptionService';
import { libraryStats, quotaSnapshot } from '../services/downloadService';
import { progressList, watchAllowance } from '../services/watchService';
import { loginHistory, updateProfile } from '../services/securityService';
import { clearChat } from '../services/callService';
import { hardReset } from '../services/db';
import { formatBytes, formatDuration, formatMoney } from '../lib/format';
import { istDateTime, istDayKey, istMonthKey } from '../lib/ist';
import type { Video as VideoType } from '../types';
import { VIDEOS } from '../data/videos';

export function ProfilePage() {
  const { user, plan, theme, setTheme, toast, bump, version, subscription, quota } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');

  if (!user) return null;

  const data = useMemo(() => overview(user.id), [user.id, version]);
  const stats = useMemo(() => libraryStats(user.id), [user.id, version]);
  const allowance = useMemo(() => watchAllowance(user.id), [user.id, version]);
  const history = useMemo(() => progressList(user.id), [user.id, version]);
  const logins = useMemo(() => loginHistory(user.id, 5), [user.id, version]);
  const snapshot = quotaSnapshot(user.id);

  const completed = history.filter((h) => h.completed).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & settings"
        subtitle="Your plan, watch activity, offline library and account preferences in one place."
        icon={<UserIcon size={20} />}
        action={<Button variant="outline" size="sm" icon={<Crown size={14} />} onClick={() => navigate('subscriptions')}>Manage plan</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plan" value={plan.name} hint={subscription ? `${data.daysRemaining} days remaining` : 'no expiry'} icon={<Crown size={14} />} />
        <Stat label="Watch time today" value={allowance.limitMinutes === -1 ? 'Unlimited' : `${allowance.minutesUsed} min`} hint={allowance.limitMinutes === -1 ? 'no cap' : `of ${allowance.limitMinutes} min`} icon={<Clock size={14} />} />
        <Stat label="Videos completed" value={completed} hint={`${history.length} titles with progress`} icon={<Video size={14} />} />
        <Stat label="Offline library" value={`${stats.completed}`} hint={formatBytes(stats.totalBytes)} icon={<HardDrive size={14} />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        {/* ------------------------------ account -------------------------- */}
        <Card>
          <SectionTitle title="Account details" subtitle="Changes are saved to your profile immediately" icon={<UserIcon size={18} />} />
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-2xl text-lg font-extrabold text-white" style={{ background: user.avatarColor }}>
              {user.name.split(' ').map((n) => n[0]).join('')}
            </span>
            <div>
              <p className="text-base font-bold">{user.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
              <div className="mt-1 flex gap-1.5">
                <Badge tone={plan.id === 'gold' ? 'amber' : plan.id === 'free' ? 'slate' : 'violet'}>{plan.name}</Badge>
                <Badge tone="sky">member since {istDateTime(user.createdAt).split(',')[0]}</Badge>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Display name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Mobile number" hint="Used as the SMS OTP alternative">
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
          <Button
            className="mt-3"
            size="sm"
            icon={<Save size={14} />}
            onClick={() => {
              updateProfile(user.id, { name, phone });
              toast({ kind: 'success', title: 'Profile updated' });
              bump();
            }}
          >
            Save changes
          </Button>

          <div className="mt-5 space-y-0.5">
            <KV label="Subscription status" value={data.subscription ? `${data.subscription.status} · ${istDateTime(data.subscription.expiryDate)}` : 'Free plan'} />
            <KV label="Billing cycle" value={data.subscription?.cycle ?? '—'} />
            <KV label="Next renewal" value={data.nextRenewal ? istDateTime(data.nextRenewal) : 'auto-renew off'} />
            <KV label="Lifetime paid" value={formatMoney(data.totalPaid)} />
            <KV label="Current IST day / month key" value={`${istDayKey()} / ${istMonthKey()}`} mono />
            <KV label="Downloads used today / month" value={`${snapshot.usedToday} / ${snapshot.usedThisMonth}`} />
          </div>
        </Card>

        {/* ------------------------------ activity ------------------------- */}
        <div className="space-y-5">
          <Card>
            <SectionTitle title="Plan entitlements" subtitle={`${plan.name} · ${plan.tagline}`} icon={<Sparkles size={18} />} />
            <div className="space-y-0.5">
              <KV label="Daily downloads" value={planQuota(plan.id).dailyLabel} />
              <KV label="Monthly downloads" value={planQuota(plan.id).monthlyLabel} />
              <KV label="Max streaming quality" value={`${plan.maxStreamQuality}p`} />
              <KV label="Daily watch time" value={plan.dailyWatchMinutes === -1 ? 'Unlimited' : `${plan.dailyWatchMinutes} min`} />
              <KV label="Registered devices" value={`${plan.maxDevices} (${user.trustedDevices.length} trusted)`} />
              <KV label="Download retention" value={plan.id === 'free' ? '24 hours' : plan.id === 'bronze' ? '30 days' : plan.id === 'silver' ? '90 days' : 'while subscribed'} />
              <KV label="Ad-free" value={plan.adFree ? 'Yes' : 'No'} />
              <KV label="Call participants" value={String(plan.maxCallParticipants)} />
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Validity used</span>
                <span>{data.percentElapsed}%</span>
              </div>
              <Progress value={data.percentElapsed} barClass="bg-emerald-500" className="mt-1.5" />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Preferences" subtitle="Theme and theming rules" icon={<Settings size={18} />} />
            <div className="space-y-2">
              <Toggle
                checked={user.autoThemeOnLogin}
                onChange={(v) => { updateProfile(user.id, { autoThemeOnLogin: v }); bump(); }}
                label="Apply the IST rule on each login"
                hint="05:00–12:00 IST → light, otherwise dark"
              />
              <Toggle
                checked={user.themeLockedByUser}
                onChange={(v) => { updateProfile(user.id, { themeLockedByUser: v }); bump(); }}
                label="Pin my manual theme choice"
                hint={`Currently ${theme}`}
              />
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant={theme === 'light' ? 'primary' : 'outline'} onClick={() => setTheme('light')}>Light theme</Button>
                <Button size="sm" variant={theme === 'dark' ? 'primary' : 'outline'} onClick={() => setTheme('dark')}>Dark theme</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ------------------------------ activity tables -------------------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="Recently watched"
            subtitle="Resume positions stored per video and synced to your profile"
            icon={<History size={18} />}
            right={<Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => navigate('downloads')}>My downloads</Button>}
          />
          {history.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nothing watched yet.</p>
          ) : (
            <div className="space-y-2">
              {history.slice(0, 6).map((row) => {
                const video = VIDEOS.find((v: VideoType) => v.id === row.videoId);
                if (!video) return null;
                return (
                  <button
                    key={row.videoId}
                    onClick={() => navigate('watch', row.videoId)}
                    className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <img src={video.thumbnail} alt="" className="h-11 w-20 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{video.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatDuration(row.position)} / {formatDuration(row.duration)} · {Math.round(row.percent)}%
                        {row.completed && ' · completed ✅'}
                      </p>
                      <Progress value={row.percent} className="mt-1.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title="Recent sign-ins" subtitle="Full audit available under Account security" icon={<ShieldCheck size={18} />} />
          {logins.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No logins recorded.</p>
          ) : (
            <div className="space-y-0.5">
              {logins.map((row) => (
                <KV
                  key={row.id}
                  label={`${row.browser} · ${row.deviceType}`}
                  value={`${row.city} · ${istDateTime(row.timestamp)}`}
                />
              ))}
            </div>
          )}
          <Button size="sm" variant="outline" className="mt-3" icon={<ShieldCheck size={14} />} onClick={() => navigate('security')}>
            Open security centre
          </Button>
        </Card>
      </div>

      {/* ------------------------------ danger zone ------------------------ */}
      <Card className="border-red-200 dark:border-red-900/50">
        <SectionTitle
          title="Demo data"
          subtitle="Everything lives in this browser's localStorage, so you can wipe it and start from the seeded state."
          icon={<Database size={18} />}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={() => {
              hardReset();
              clearChat('');
              toast({ kind: 'warning', title: 'Demo data reset', message: 'Accounts, subscriptions, downloads and audit logs were re-seeded. You have been signed out.' });
              window.location.hash = '#/auth';
              window.location.reload();
            }}
          >
            Reset all demo data
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const payload = {
                users: JSON.parse(localStorage.getItem('nexstream:1:users') ?? '[]'),
                subscriptions: JSON.parse(localStorage.getItem('nexstream:1:subscriptions') ?? '[]'),
                transactions: JSON.parse(localStorage.getItem('nexstream:1:transactions') ?? '[]'),
                downloads: JSON.parse(localStorage.getItem('nexstream:1:downloads') ?? '[]'),
                downloadAudit: JSON.parse(localStorage.getItem('nexstream:1:downloadAudit') ?? '[]'),
                loginRecords: JSON.parse(localStorage.getItem('nexstream:1:loginRecords') ?? '[]'),
              };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `nexstream-export-${istDayKey()}.json`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ kind: 'success', title: 'Database exported', message: 'A JSON snapshot of every table was downloaded.' });
            }}
          >
            Export database as JSON
          </Button>
        </div>
        <div className="mt-3">
          <CheckList
            items={[
              'Tables: users, subscriptions, transactions, orders, downloads, downloadAudit, quotas, loginRecords, otpCodes, mails, watchProgress, watchEvents, callRooms, callChat, callLogs, recordings',
              'Seed accounts: priya@nexstream.test (Free) and arjun@nexstream.test (Gold) - password Demo@1234',
              'Clearing site data has the same effect as the reset button',
            ]}
          />
        </div>
      </Card>

      <p className="flex items-center gap-2 text-[11px] text-slate-400">
        <CalendarClock size={12} /> All timestamps shown in IST. Quotas reset at 00:00 IST; the countdown is in the header.
      </p>
    </div>
  );
}
