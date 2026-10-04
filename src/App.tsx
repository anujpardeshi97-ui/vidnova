/* ============================================================================
 * App.tsx - routing shell.
 * Chooses between the auth screen (no session) and the application layout,
 * then resolves the current hash route to a page.
 * ==========================================================================*/
import React, { useState } from 'react';
import { AppProvider, useApp, type RouteName } from './context/AppContext';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { WatchPage } from './pages/WatchPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { SecurityPage } from './pages/SecurityPage';
import { BillingPage } from './pages/BillingPage';
import { InboxPage } from './pages/InboxPage';
import { ProfilePage } from './pages/ProfilePage';
import { CallsPage } from './pages/CallsPage';

function Router() {
  const { user, route } = useApp();
  const [search, setSearch] = useState('');

  /* No session -> the auth flow owns the screen. */
  if (!user) return <AuthPage />;

  const page = (() => {
    switch (route.name as RouteName) {
      case 'watch':
        return <WatchPage videoId={route.param} />;
      case 'subscriptions':
        return <SubscriptionsPage />;
      case 'downloads':
        return <DownloadsPage />;
      case 'security':
        return <SecurityPage />;
      case 'billing':
        return <BillingPage />;
      case 'inbox':
        return <InboxPage />;
      case 'calls':
        return <CallsPage roomParam={route.param} />;
      case 'profile':
        return <ProfilePage />;
      case 'auth':
        return <HomePage query={search} />;
      case 'home':
      default:
        return <HomePage query={search} />;
    }
  })();

  return (
    <Layout onSearch={setSearch}>
      {page}
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
