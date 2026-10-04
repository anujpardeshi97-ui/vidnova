/* ============================================================================
 * AuthPage.tsx - sign-in, registration and the step-up OTP challenge.
 *
 * Demonstrates three specified behaviours directly on this screen:
 *   - the IST login window and the theme it will apply (live clock in the hero)
 *   - OTP verification when the browser/device/IP/city/state is new
 *   - a full login audit trail (shown at the bottom of the page)
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Clapperboard, Clock, KeyRound, Laptop, Loader2, Lock,
  Mail, MapPin, Moon, Phone, ShieldCheck, Smartphone, Sparkles, Sun, UserPlus, Wand2,
} from 'lucide-react';
import type { LoginRecord, OtpChannel } from '../types';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Field, KV, Modal, SectionTitle, inputClass } from '../components/ui';
import { attemptLogin, loginHistory, verifyOtp, registerUser, OTP_TTL_MINUTES } from '../services/securityService';
import { DEMO_ACCOUNTS } from '../services/db';
import { sendWelcomeMail } from '../services/mailService';
import { collectDeviceInfo, resetFingerprint } from '../lib/device';
import { geoOptions, resolveGeoLocation, simulateLocation } from '../lib/geo';
import { istClock, istDateTime, istHour, themeForIstLogin } from '../lib/ist';
import { deviceLabel } from '../lib/device';

export function AuthPage() {
  const { signIn, toast, bump } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState(DEMO_ACCOUNTS[0].password);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* pending OTP challenge */
  const [challenge, setChallenge] = useState<{
    otpId: string;
    code: string;
    destination: string;
    channel: OtpChannel;
    reasons: string[];
    expiresAt: number;
  } | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  const device = useMemo(() => collectDeviceInfo(), []);
  const geo = useMemo(() => resolveGeoLocation(), []);
  const theme = themeForIstLogin();
  const hour = istHour();

  /* The audit trail for the account currently typed in the email field. */
  const recentAudit: LoginRecord[] = useMemo(() => {
    const account = DEMO_ACCOUNTS.find((a) => a.email === email);
    void account;
    const records = JSON.parse(localStorage.getItem('nexstream:1:loginRecords') ?? '[]') as LoginRecord[];
    return records.slice(-6).reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, challenge, busy]);

  /* ------------------------------ sign in -------------------------------- */
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    window.setTimeout(() => {
      if (mode === 'signup') {
        const result = registerUser({ name, email, phone, password });
        setBusy(false);
        if (!result.ok || !result.user) {
          setError(result.message);
          return;
        }
        sendWelcomeMail(result.user);
        toast({ kind: 'success', title: 'Account created', message: `Welcome ${name.split(' ')[0]}! You start on the Free plan.` });
        signIn(result.user, themeForIstLogin());
        return;
      }

      const result = attemptLogin(email, password);
      setBusy(false);

      if (result.status === 'blocked') {
        setError(result.message);
        toast({ kind: 'error', title: 'Sign-in failed', message: result.message });
        return;
      }

      if (result.status === 'otp_required' && result.otp && result.user) {
        setChallenge({
          otpId: result.otp.id,
          code: result.otp.code,
          destination: result.otp.destination,
          channel: result.otp.channel,
          reasons: result.reasons ?? [],
          expiresAt: result.otp.expiresAt,
        });
        setOtpInput('');
        setOtpError(null);
        setAttemptsLeft(null);
        toast({
          kind: 'warning',
          title: 'Verification required',
          message:`New sign-in context detected (${(result.reasons ?? []).join(', ').replace(/_/g, ' ')}).`,
        });
        return;
      }

      if (result.user) {
        toast({
          kind: 'success',
          title: `Welcome back, ${result.user.name.split(' ')[0]}`,
          message: `Theme set to ${result.theme} for this IST login window.`,
        });
        signIn(result.user, result.theme ?? theme);
      }
    }, 450);
  };

  /* ------------------------------ verify OTP ------------------------------ */
  const submitOtp = () => {
    if (!challenge) return;
    const result = verifyOtp(challenge.otpId, otpInput);
    setAttemptsLeft(result.attemptsLeft);
    if (!result.ok) {
      setOtpError(result.message);
      return;
    }
    if (result.user) {
      setChallenge(null);
      toast({ kind: 'success', title: 'Device verified', message: result.message });
      signIn(result.user, result.theme ?? theme);
      bump();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2">
        {/* ------------------------------ hero ------------------------------ */}
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-700 shadow-lg shadow-rose-600/30">
              <Clapperboard size={22} />
            </span>
            <span className="text-2xl font-extrabold tracking-tight">
              Nex<span className="text-rose-500">Stream</span>
            </span>
          </div>

          <h1 className="mt-7 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Stream, download and meet -<br />
            <span className="bg-gradient-to-r from-rose-400 to-amber-300 bg-clip-text text-transparent">
              with limits that actually hold.
            </span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-300">
            A subscription platform with tiered download quotas, Razorpay test payments, a fully custom
            HTML5 player, IST-based adaptive theming, OTP device verification and real-time video calling.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <InfoTile icon={<Clock size={15} />} title="IST login theming">
              Now <strong className="font-mono">{istClock()} IST</strong> (hour {hour}) → this login applies the{' '}
              <strong>{theme}</strong> theme. Light between 05:00-12:00 IST, dark otherwise.
            </InfoTile>
            <InfoTile icon={<ShieldCheck size={15} />} title="Step-up verification">
              A new browser, device, IP, city or state triggers a 6-digit code to your e-mail before access is granted.
            </InfoTile>
            <InfoTile icon={<Laptop size={15} />} title="This device">
              {deviceLabel(device)} · {device.type} · {device.model}
              <span className="mt-1 block font-mono text-[10px] opacity-70">{device.fingerprint}</span>
            </InfoTile>
            <InfoTile icon={<MapPin size={15} />} title="Your connection">
              {geo.label}
              <span className="mt-1 block font-mono text-[10px] opacity-70">{geo.ip}</span>
            </InfoTile>
          </div>

          {/* ------------------------- testing console -------------------- */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
              <Wand2 size={14} /> Security test console
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Force a verification challenge without a second machine:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={() => {
                  resetFingerprint();
                  toast({ kind: 'info', title: 'Device fingerprint rotated', message: 'Sign in again - you will be treated as a brand-new device.' });
                }}
              >
                <Smartphone size={14} /> Act as new device
              </Button>
              {geoOptions().slice(0, 4).map((option) => (
                <Button
                  key={option.ip}
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => {
                    simulateLocation(option);
                    toast({ kind: 'info', title: `Connection moved to ${option.city}`, message: `New IP ${option.ip}. Sign in again to trigger the new-city rule.` });
                  }}
                >
                  <MapPin size={14} /> {option.city}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* ------------------------------ card ------------------------------ */}
        <div className="rounded-3xl border border-white/10 bg-white/95 p-6 text-slate-900 shadow-2xl backdrop-blur dark:bg-slate-900/95 dark:text-white">
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  mode === m ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Full name" required>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha Nair" required />
                </Field>
                <Field label="Mobile number" required hint="Used for OTP delivery if you prefer SMS">
                  <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" required />
                </Field>
              </>
            )}

            <Field label="E-mail" required>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  className={`${inputClass} pl-9`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  className={`${inputClass} pl-9`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </Field>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={busy} icon={mode === 'signin' ? <ArrowRight size={16} /> : <UserPlus size={16} />}>
              {mode === 'signin' ? 'Sign in securely' : 'Create my account'}
            </Button>
          </form>

          {mode === 'signin' && (
            <div className="mt-5 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Demo accounts</p>
              <div className="mt-2 space-y-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    onClick={() => { setEmail(account.email); setPassword(account.password); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <span>
                      <span className="block font-semibold">{account.name}</span>
                      <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">{account.email}</span>
                    </span>
                    <Badge tone={account.planId === 'gold' ? 'amber' : 'slate'}>
                      {account.planId === 'gold' ? <><Sparkles size={10} /> Gold</> : 'Free'}
                    </Badge>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Password for both: <span className="font-mono">Demo@1234</span></p>
            </div>
          )}

          {recentAudit.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Recent login audit</p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {recentAudit.map((record) => (
                  <div key={record.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800">
                    <span className="truncate">
                      {record.status === 'success' ? '✅' : record.status === 'otp_required' ? '🔐' : '⛔'} {record.browser} · {record.city}
                    </span>
                    <span className="shrink-0 font-mono text-slate-400">{istDateTime(record.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* -------------------------- OTP challenge -------------------------- */}
      <Modal
        open={Boolean(challenge)}
        onClose={() => setChallenge(null)}
        title="Verify it is really you"
        subtitle={`We sent a 6-digit code to ${challenge?.destination ?? ''}`}
      >
        {challenge && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-semibold">Why am I being asked?</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {challenge.reasons.map((r) => (
                  <li key={r}>{r.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>

            {/* In a real deployment the code arrives by e-mail only. The demo
                surfaces it here because there is no mail server. */}
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">Demo delivery (also stored in your Inbox):</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-[0.4em] text-rose-600 dark:text-rose-400">{challenge.code}</p>
              <p className="mt-1 text-[11px] text-slate-400">Expires {istDateTime(challenge.expiresAt)} · valid for {OTP_TTL_MINUTES} minutes</p>
            </div>

            <Field label="Enter the 6-digit code" required>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9 font-mono text-lg tracking-[0.3em]`}
                  value={otpInput}
                  maxLength={6}
                  inputMode="numeric"
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && submitOtp()}
                  placeholder="••••••"
                />
              </div>
            </Field>

            {otpError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle size={14} /> {otpError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={submitOtp} className="flex-1" icon={<ShieldCheck size={16} />}>
                Verify & sign in
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setOtpInput('');
                  setOtpError(null);
                  toast({ kind: 'info', title: 'A fresh code was e-mailed', message: 'Previous codes remain invalid after use or expiry.' });
                }}
              >
                <Phone size={15} /> Resend
              </Button>
            </div>

            {attemptsLeft !== null && attemptsLeft < 5 && (
              <p className="text-center text-[11px] text-slate-400">
                {attemptsLeft} attempt(s) remaining before this challenge is blocked.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* footer notes */}
      <div className="mx-auto max-w-6xl px-6 pb-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><Sun size={12} /> 05:00-12:00 IST → light mode</span>
          <span className="flex items-center gap-1"><Moon size={12} /> all other IST hours → dark mode</span>
          <span className="flex items-center gap-1"><ShieldCheck size={12} /> OTP on new browser · device · IP · city · state</span>
          <span>Signed-in state is stored locally for this demo.</span>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
      <p className="flex items-center gap-2 text-xs font-bold text-white">
        <span className="text-rose-400">{icon}</span> {title}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{children}</p>
    </div>
  );
}

export { SectionTitle, KV, navigate };
