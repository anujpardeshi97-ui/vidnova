/* ============================================================================
 * DownloadsPage.tsx - the dedicated Downloads section of the profile.
 * ==========================================================================*/
import React from 'react';
import { Download, HardDrive, Info } from 'lucide-react';
import { useApp, navigate } from '../context/AppContext';
import { Card, PageHeader, Button } from '../components/ui';
import { DownloadLibrary } from '../components/Downloads';
import { RETENTION_DAYS, quotaSnapshot } from '../services/downloadService';
import { istDayKey, istMonthKey } from '../lib/ist';

export function DownloadsPage() {
  const { user, plan, quota } = useApp();
  if (!user) return null;
  const snapshot = quotaSnapshot(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Downloads"
        subtitle="Every offline download with its full audit record - title, thumbnail, date and time, status, file size, the plan that was used and your remaining quota."
        icon={<Download size={20} />}
        action={<Button variant="outline" size="sm" icon={<HardDrive size={14} />} onClick={() => navigate('subscriptions')}>Raise my limits</Button>}
      />

      <Card className="border-sky-200 bg-sky-50/60 dark:border-sky-900/50 dark:bg-sky-950/25">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-sky-900 dark:text-sky-200">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>How the limits work on your {plan.name} plan:</strong>{' '}
            {plan.dailyDownloadLimit === -1 ? 'unlimited' : `${plan.dailyDownloadLimit} downloads per day`} and{' '}
            {plan.monthlyDownloadLimit === -1 ? 'unlimited monthly' : `${plan.monthlyDownloadLimit} per calendar month`}.
            Quota resets at 00:00 IST (today is {istDayKey()} IST, month key {istMonthKey()}). Completed files stay
            available for {RETENTION_DAYS[plan.id]} day(s) on your plan. Re-downloading the same title inside 24 hours
            does not consume quota. Failed, cancelled and interrupted transfers are automatically refunded.
            {' '}You have used {snapshot.usedToday} today and {snapshot.usedThisMonth} this month.
          </span>
        </p>
      </Card>

      <DownloadLibrary />
    </div>
  );
}
