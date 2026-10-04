/* ============================================================================
 * Layout.tsx - application shell: header, navigation, theme switch, toasts.
 * ==========================================================================*/
import React, { useState } from 'react';
import {
  Bell, Clapperboard, CreditCard, Crown, Download, Home, LogOut, Mail, Menu, Moon,
  Repeat, Search, ShieldCheck, Sun, Video, X, ChevronDown, HardDriveDownload, ListChecks,
} from 'lucide-react';
import { useApp, navigate, type RouteName } from '../context/AppContext';
import { Badge, Button, ToastStack } from './ui';
import { formatBytes } from '../lib/format';
import { libraryStats } from '../services/downloadService';
import { countdownLabel, istClock, istWindowLabel, msUntilNextIstMidnight } from '../lib/ist';

const NAV: { id: RouteName; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Browse', icon: <Home size={17} /> },
  { id: 'subscriptions', label: 'Subscriptions', icon: <Crown size={17} /> },
  { id: 'downloads', label: 'Downloads', icon: <Download size={17} /> },
  { id: 'security', label: 'Account security', icon: <ShieldCheck size={17} /> },
  { id: 'billing', label: 'Billing & invoices', icon: <CreditCard size={17} /> },
  { id: 'inbox', label: 'Inbox', icon: <Mail size={17} /> },
  { id: 'calls', label: 'Video calls', icon: <Video size={17} /> },
];

export function Layout({ children, onSearch }: { children: React.ReactNode; onSearch?: (q: string) => void }) {
  const { user, plan, quota, theme, setTheme, toasts, dismissToast, signOut, unread, version } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [search, setSearch] = useState('');

  const route = window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  const stats = user ? libraryStats(user.id) : null;

  const quotaChip =
    quota.remainingToday === -1
      ? 'Unlimited downloads'
      : `${quota.remainingToday} download${quota.remainingToday === 1 ? '' : 's'} left today`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* ------------------------------- header ------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-16 max-w-[110rem] items-center gap-3 px-4">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" onClick={() => setMenuOpen((m) => !m)}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <button onClick={() => navigate('home')} className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-red-700 text-white shadow-lg shadow-rose-600/20">
              <Clapperboard size={18} />
            </span>
            <span className="hidden text-lg font-extrabold tracking-tight sm:block">
              VID<span className="text-rose-500">NOVA</span>
            </span>
          </button>

          {/* search */}
          <div className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-xl border border-slate-200 bg-slate-100/70 px-3 py-2 focus-within:border-rose-400 dark:border-slate-700 dark:bg-slate-900">
            <Search size={16} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                onSearch?.(e.target.value);
              }}
              placeholder="Search videos, courses, channels…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          {/* right cluster */}
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500 xl:flex dark:border-slate-700 dark:text-slate-400">
              <HardDriveDownload size={13} /> {quotaChip}
            </span>

            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (saved to your profile)`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button onClick={() => navigate('inbox')} className="relative rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" title="Inbox">
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>

            {user && (
              <div className="relative">
                <button
                  onClick={() => setAvatarOpen((a) => !a)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 py-1 pl-1 pr-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: user.avatarColor }}>
                    {user.name.split(' ').map((n) => n[0]).join('')}
                  </span>
                  <span className="hidden text-xs font-semibold sm:block">{user.name.split(' ')[0]}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>

                {avatarOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                    onMouseLeave={() => setAvatarOpen(false)}
                  >
                    <div className="border-b border-slate-100 p-3 dark:border-slate-800">
                      <p className="text-sm font-bold">{user.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge tone={plan.id === 'gold' ? 'amber' : plan.id === 'free' ? 'slate' : 'violet'}>
                          <Crown size={11} /> {plan.name} plan
                        </Badge>
                        {stats && <Badge tone="sky">{stats.completed} offline</Badge>}
                      </div>
                    </div>
                    {NAV.filter((n) => ['subscriptions', 'downloads', 'security', 'billing', 'calls'].includes(n.id)).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => { navigate(item.id); setAvatarOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {item.icon} {item.label}
                      </button>
                    ))}
                    <button
                      onClick={signOut}
                      className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-slate-800 dark:hover:bg-red-950/40"
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* IST status strip - makes the time-based rules observable */}
        <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-1.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono">{istClock()} IST</span>
            <span>Light theme window: {istWindowLabel()}</span>
            <span className="hidden sm:inline">Current theme: <strong className="capitalize">{theme}</strong> {user?.themeLockedByUser ? '(set manually)' : '(auto by IST login time)'}</span>
            {quota.remainingToday !== -1 && (
              <span>Daily quota resets in {countdownLabel(msUntilNextIstMidnight())}</span>
            )}
          </div>
        </div>
      </header>

      {/* -------------------------------- body ------------------------------- */}
      <div className="mx-auto flex max-w-[110rem] gap-6 px-4 py-6">
        {/* sidebar */}
        <aside className={`${menuOpen ? 'fixed inset-x-4 top-24 z-30' : 'hidden'} w-full shrink-0 lg:sticky lg:top-28 lg:block lg:h-fit lg:w-60`}>
          <nav className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
            {NAV.map((item) => {
              const active = route === item.id || (item.id === 'home' && ['watch'].includes(route));
              return (
                <button
                  key={item.id}
                  onClick={() => { navigate(item.id); setMenuOpen(false); }}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">{item.icon} {item.label}</span>
                  {item.id === 'inbox' && unread > 0 && (
                    <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {user && plan.id !== 'gold' && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4 dark:border-rose-900/60 dark:from-rose-950/40 dark:to-slate-900">
              <p className="flex items-center gap-2 text-sm font-bold text-rose-700 dark:text-rose-300">
                <Crown size={16} /> Upgrade your plan
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {plan.id === 'free'
                  ? 'Free gives you 1 download a day and 360p. Bronze unlocks 720p, 3 downloads a day and 60% of the premium catalogue.'
                  : `You are on ${plan.name}. Step up for higher quotas, better quality and more concurrent devices.`}
              </p>
              <Button size="sm" variant="primary" icon={<Repeat size={14} />} className="mt-3 w-full" onClick={() => navigate('subscriptions')}>
                Compare plans
              </Button>
            </div>
          )}

          {stats && stats.completed > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <ListChecks size={14} /> Offline library
              </p>
              <p className="mt-2 text-2xl font-extrabold">{stats.completed}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(stats.totalBytes)} on this device</p>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <input type="hidden" value={version} readOnly />
    </div>
  );
}
