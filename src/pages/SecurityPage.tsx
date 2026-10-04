/* ============================================================================
 * SecurityPage.tsx - account security centre.
 * Login history (IP, browser, OS, device, city/state/country, timestamp),
 * trusted devices with revocable trust windows, security statistics and the
 * controls that drive the IST theme rule.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Fingerprint, Globe, KeyRound, Laptop, Lock,
  MapPin, MonitorSmartphone, Moon, ShieldCheck, Smartphone, Sun, Tablet, Trash2, UserCheck, XCircle,
} from 'lucide-react';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, Field, KV, Modal, PageHeader, SectionTitle, Stat, Toggle, inputClass } from '../components/ui';
import { changePassword, loginHistory, revokeDevice, securitySummary, setTrustWindow, trustedDevices, updateProfile } from '../services/securityService';
import { collectDeviceInfo, resetFingerprint } from '../lib/device';
import { geoOptions, resolveGeoLocation, simulateLocation } from '../lib/geo';
import { istDateTime, istWindowLabel } from '../lib/ist';
import { humanize } from '../lib/format';

export function SecurityPage() {
  const { user, toast, bump, version, theme, setTheme } = useApp();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  if (!user) return null;

  const summary = useMemo(() => securitySummary(user.id), [user.id, version]);
  const history = useMemo(() => loginHistory(user.id, 40), [user.id, version]);
  const devices = useMemo(() => trustedDevices(user.id), [user.id, version]);
  const device = useMemo(() => collectDeviceInfo(), []);
  const geo = useMemo(() => resolveGeoLocation(), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account security"
        subtitle="Every sign-in is recorded with its IP, browser, OS, device and location. New contexts demand an OTP before access is granted."
        icon={<ShieldCheck size={20} />}
        action={<Button variant="outline" size="sm" icon={<KeyRound size={14} />} onClick={() => setPwdOpen(true)}>Change password</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Logins recorded" value={summary.total} hint={`${summary.todayCount} today (IST)`} icon={<Clock size={14} />} />
        <Stat label="OTP challenges" value={summary.otpChallenges} hint={`${summary.failedOtps} failed attempts`} icon={<Fingerprint size={14} />} />
        <Stat label="Trusted devices" value={devices.length} hint={`trust window ${user.trustDurationDays} days`} icon={<UserCheck size={14} />} />
        <Stat
          label="Last login"
          value={summary.lastLogin ? summary.lastLogin.city : '—'}
          hint={summary.lastLogin ? istDateTime(summary.lastLogin.timestamp) : 'no record'}
          icon={<MapPin size={14} />}
        />
      </div>

      {/* --------------------------- theme behaviour ----------------------- */}
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <SectionTitle
            title="Theme & login-time behaviour"
            subtitle={`Logins between ${istWindowLabel()} apply the light theme automatically; every other IST hour applies dark.`}
            icon={theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          />
          <div className="space-y-3">
            <Toggle
              checked={user.autoThemeOnLogin}
              onChange={(value) => {
                updateProfile(user.id, { autoThemeOnLogin: value });
                toast({ kind: 'info', title: value ? 'IST theming enabled' : 'IST theming disabled', message: value ? 'Each login re-applies the time-based theme unless you pinned one.' : 'Your manual theme will be kept regardless of login time.' });
                bump();
              }}
              label="Adapt theme on every login (IST rule)"
              hint="05:00–12:00 IST → light · otherwise → dark"
            />
            <Toggle
              checked={user.themeLockedByUser}
              onChange={(value) => {
                updateProfile(user.id, { themeLockedByUser: value });
                toast({ kind: 'info', title: value ? 'Manual choice pinned' : 'Back to automatic', message: value ? 'The IST rule will no longer override your selection.' : 'The next login will set the theme from the IST window.' });
                bump();
              }}
              label="Pin my manual choice"
              hint="Stops the login-time rule from overriding the switch in the header"
            />
            <div className="flex gap-2">
              <Button size="sm" variant={theme === 'light' ? 'primary' : 'outline'} icon={<Sun size={14} />} onClick={() => setTheme('light')}>
                Light
              </Button>
              <Button size="sm" variant={theme === 'dark' ? 'primary' : 'outline'} icon={<Moon size={14} />} onClick={() => setTheme('dark')}>
                Dark
              </Button>
              <span className="self-center text-[11px] text-slate-400">
                Saved to your profile - it follows you to every session and device.
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle title="This session" subtitle="What we captured when you signed in" icon={<Laptop size={18} />} />
          <div className="space-y-0.5">
            <KV label="Browser" value={device.browser} />
            <KV label="Operating system" value={device.os} />
            <KV label="Device type / model" value={`${device.type} · ${device.model}`} />
            <KV label="Screen" value={device.screen} />
            <KV label="Public IP (simulated)" value={geo.ip} mono />
            <KV label="Approximate location" value={`${geo.city}, ${geo.region}, ${geo.country}`} />
            <KV label="Device fingerprint" value={device.fingerprint} mono />
            <KV label="Timezone (browser)" value={device.timezone} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Smartphone size={14} />}
              onClick={() => {
                resetFingerprint();
                toast({ kind: 'warning', title: 'Fingerprint rotated', message: 'Sign out and back in: the next login will look like a brand-new device and require an OTP.' });
              }}
            >
              Act as a new device
            </Button>
            {geoOptions().slice(0, 3).map((option) => (
              <Button
                key={option.ip}
                size="sm"
                variant="ghost"
                icon={<Globe size={14} />}
                onClick={() => {
                  simulateLocation(option);
                  toast({ kind: 'info', title: `Now browsing from ${option.city}`, message: `IP ${option.ip}. The next sign-in triggers the new-city verification.` });
                  bump();
                }}
              >
                {option.city}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      {/* --------------------------- trusted devices ---------------------- */}
      <Card>
        <SectionTitle
          title="Trusted devices"
          subtitle={`Verified devices skip the OTP until their trust window closes. Your plan allows downloads on ${user ? '' : ''}${device ? '' : ''}multiple devices per the plan's limit.`}
          icon={<MonitorSmartphone size={18} />}
        />
        {devices.length === 0 ? (
          <EmptyState
            icon={<UserCheck size={24} />}
            title="No trusted devices yet"
            message="The next time you sign in from a new browser, the OTP you enter will register it here with its own trust window."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {devices.map((d) => {
              const expired = d.trustedUntil < Date.now();
              const active = d.fingerprint === device.fingerprint;
              return (
                <div key={d.fingerprint} className={`rounded-2xl border p-4 ${active ? 'border-rose-300 dark:border-rose-800' : 'border-slate-200 dark:border-slate-700'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800">
                        {d.deviceType === 'Mobile' ? <Smartphone size={16} /> : d.deviceType === 'Tablet' ? <Tablet size={16} /> : <Laptop size={16} />}
                      </span>
                      <div>
                        <p className="text-sm font-bold">
                          {d.model} {active && <Badge tone="rose" className="ml-1">this device</Badge>}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{d.browser} · {d.os}</p>
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <MapPin size={11} /> {d.location} · {d.ip}
                        </p>
                      </div>
                    </div>
                    <Badge tone={expired ? 'slate' : 'emerald'}>{expired ? 'expired' : 'trusted'}</Badge>
                  </div>

                  <div className="mt-3 space-y-0.5">
                    <KV label="First seen" value={istDateTime(d.firstSeen)} />
                    <KV label="Last seen" value={istDateTime(d.lastSeen)} />
                    <KV label="Trusted until" value={istDateTime(d.trustedUntil)} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      setTrustWindow(user.id, d.fingerprint, user.trustDurationDays);
                      toast({ kind: 'success', title: 'Trust window extended', message: `${user.trustDurationDays} more days for this device.` });
                      bump();
                    }}>
                      Extend {user.trustDurationDays}d
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => {
                      revokeDevice(user.id, d.fingerprint);
                      toast({ kind: 'warning', title: 'Device revoked', message: 'The next sign-in from it will require a fresh OTP.' });
                      bump();
                    }}>
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ----------------------------- login history ---------------------- */}
      <Card>
        <SectionTitle
          title="Login history"
          subtitle="Successful logins, OTP challenges, failed codes and blocked attempts"
          icon={<Clock size={18} />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pr-3 font-semibold">When (IST)</th>
                <th className="py-2 pr-3 font-semibold">Result</th>
                <th className="py-2 pr-3 font-semibold">Browser / OS</th>
                <th className="py-2 pr-3 font-semibold">Device</th>
                <th className="py-2 pr-3 font-semibold">IP</th>
                <th className="py-2 pr-3 font-semibold">Location</th>
                <th className="py-2 pr-3 font-semibold">Theme</th>
                <th className="py-2 pr-3 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-2.5 pr-3 font-mono text-[11px]">{istDateTime(row.timestamp)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1 font-semibold">
                      {row.status === 'success' && <CheckCircle2 size={12} className="text-emerald-500" />}
                      {row.status === 'otp_required' && <Lock size={12} className="text-amber-500" />}
                      {row.status === 'otp_failed' && <AlertTriangle size={12} className="text-orange-500" />}
                      {row.status === 'blocked' && <XCircle size={12} className="text-red-500" />}
                      {humanize(row.status)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">{row.browser} · {row.os}</td>
                  <td className="py-2.5 pr-3">{row.deviceType} · {row.deviceModel}</td>
                  <td className="py-2.5 pr-3 font-mono text-[11px]">{row.ip}</td>
                  <td className="py-2.5 pr-3">{row.city}, {row.region}, {row.country}</td>
                  <td className="py-2.5 pr-3 capitalize">{row.themeApplied} <span className="text-slate-400">({row.loggedInAtHourIst}h)</span></td>
                  <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                    {row.reasons.length ? row.reasons.map((r) => r.replace(/_/g, ' ')).join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Change password" subtitle="You will stay signed in on trusted devices">
        <div className="space-y-3">
          <Field label="Current password" required>
            <input type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <input type="password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button
            onClick={() => {
              const result = changePassword(user.id, current, next);
              toast({ kind: result.ok ? 'success' : 'error', title: result.ok ? 'Password updated' : 'Update failed', message: result.message });
              if (result.ok) {
                setPwdOpen(false);
                setCurrent('');
                setNext('');
              }
              bump();
            }}
            icon={<KeyRound size={15} />}
          >
            Update password
          </Button>
        </div>
      </Modal>
    </div>
  );
}
