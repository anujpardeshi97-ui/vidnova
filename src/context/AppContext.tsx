/* ============================================================================
 * AppContext.tsx - the single global store for the whole platform.
 *
 * Holds: the signed-in user, the resolved theme, the current route, toasts and
 * a `version` counter. Any module that writes to the database calls bump() so
 * every screen re-reads its rows - a tiny stand-in for React Query/SWR.
 * ==========================================================================*/
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, QuotaState, Subscription, Toast, User } from '../types';
import { getSession, seedDatabase, setSession, type Session } from '../services/db';
import { reconcile } from '../services/paymentService';
import { activeSubscription, effectivePlan, reconcileExpiry } from '../services/subscriptionService';
import { invalidateForExpiry, quotaSnapshot, type QuotaSnapshot } from '../services/downloadService';
import { unreadCount } from '../services/mailService';
import { collectDeviceInfo } from '../lib/device';
import { resolveGeoLocation } from '../lib/geo';
import { themeForIstLogin } from '../lib/ist';
import { findById, TABLES, upsert } from '../lib/storage';

/* -------------------------------- Routing --------------------------------- */

export type RouteName =
  | 'home'
  | 'watch'
  | 'subscriptions'
  | 'profile'
  | 'downloads'
  | 'security'
  | 'billing'
  | 'inbox'
  | 'calls'
  | 'auth';

export interface Route {
  name: RouteName;
  param?: string;
  tab?: string;
}

/** Parse "#/watch/vid_bbb" into { name: 'watch', param: 'vid_bbb' }. */
export function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash) return { name: 'home' };
  const [name, param, tab] = hash.split('/');
  const known: RouteName[] = [
    'home', 'watch', 'subscriptions', 'profile', 'downloads', 'security', 'billing', 'inbox', 'calls', 'auth',
  ];
  return known.includes(name as RouteName) ? { name: name as RouteName, param, tab } : { name: 'home' };
}

export function navigate(name: RouteName, param?: string, tab?: string): void {
  const path = [name, param, tab].filter(Boolean).join('/');
  window.location.hash = `#/${path}`;
}

/* --------------------------------- Context -------------------------------- */

interface AppContextValue {
  user: User | null;
  session: Session | null;
  theme: 'light' | 'dark';
  route: Route;
  toasts: Toast[];
  version: number;
  plan: Plan;
  subscription: Subscription | null;
  quota: QuotaSnapshot;
  unread: number;
  /* actions */
  bump: () => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  signIn: (user: User, theme: 'light' | 'dark') => void;
  signOut: () => void;
  setTheme: (theme: 'light' | 'dark', persistToProfile?: boolean) => void;
  refreshUser: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [session, setSessionState] = useState<Session | null>(() => getSession());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => getSession()?.theme ?? 'dark');
  const bootstrapped = useRef(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /* Boot: seed the database once, then run the housekeeping sweeps. */
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    seedDatabase();
    const session0 = getSession();
    if (session0) {
      reconcile(session0.userId);        // settle webhooks + expire plans
      reconcileExpiry(session0.userId);
      invalidateForExpiry(session0.userId);
      const user = findById<User>(TABLES.USERS, session0.userId);
      if (user) {
        document.documentElement.classList.toggle('dark', session0.theme === 'dark');
        setThemeState(session0.theme);
      } else {
        setSession(null);
        setSessionState(null);
      }
    }
    bump();
  }, [bump]);

  /* Hash router. */
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* Theme -> <html class="dark">, which is what Tailwind's dark: variant reads. */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((list) => [...list, { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const signIn = useCallback((user: User, appliedTheme: 'light' | 'dark') => {
    const device = collectDeviceInfo();
    const geo = resolveGeoLocation();
    const next: Session = {
      userId: user.id,
      loginAt: Date.now(),
      theme: appliedTheme,
      deviceFingerprint: device.fingerprint,
      ip: geo.ip,
      location: geo.label,
    };
    setSession(next);
    setSessionState(next);
    setThemeState(appliedTheme);
    navigate('home');
    bump();
  }, [bump]);

  const signOut = useCallback(() => {
    // Only the session pointer is cleared - theme preference lives on in the
    // user profile, which is what makes it "persist across sessions/devices".
    setSession(null);
    setSessionState(null);
    navigate('auth');
    bump();
  }, [bump]);

  const setTheme = useCallback(
    (next: 'light' | 'dark', persistToProfile = true) => {
      setThemeState(next);
      const session0 = getSession();
      if (session0) {
        setSession({ ...session0, theme: next });
        setSessionState({ ...session0, theme: next });
      }
      if (persistToProfile && session0) {
        const active = findById<User>(TABLES.USERS, session0.userId);
        if (active) {
          // Persisting themeLockedByUser=true is what stops the IST login rule
          // from overwriting a deliberate user choice on the next sign-in.
          upsert(TABLES.USERS, { ...active, theme: next, themeLockedByUser: true });
        }
      }
      bump();
    },
    [bump],
  );

  const refreshUser = useCallback(() => bump(), [bump]);

  const user = useMemo(() => {
    if (!session) return null;
    return findById<User>(TABLES.USERS, session.userId) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, version]);

  const plan = useMemo<Plan>(() => (user ? effectivePlan(user.id) : effectivePlan('none')), [user, version]);
  const subscription = useMemo<Subscription | null>(() => (user ? activeSubscription(user.id) : null), [user, version]);
  const quota = useMemo<QuotaSnapshot>(
    () => (user ? quotaSnapshot(user.id) : {
      planId: 'free', dailyLimit: 1, monthlyLimit: 5, usedToday: 0, usedThisMonth: 0,
      remainingToday: 1, remainingMonth: 5, dayKey: '', monthKey: '', percentToday: 0, percentMonth: 0,
    }),
    [user, version],
  );
  const unread = useMemo(() => (user ? unreadCount(user.id) : 0), [user, version]);

  const value: AppContextValue = {
    user,
    session,
    theme,
    route,
    toasts,
    version,
    plan,
    subscription,
    quota,
    unread,
    bump,
    toast,
    dismissToast,
    signIn,
    signOut,
    setTheme,
    refreshUser,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** Re-export so pages do not need to import from three different modules. */
export { themeForIstLogin };
export type { QuotaState };
