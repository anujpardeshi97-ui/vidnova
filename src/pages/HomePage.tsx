/* ============================================================================
 * HomePage.tsx - the catalogue.
 * Every card knows whether the signed-in plan may stream and download the
 * title, so the paywall is visible before the user clicks.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import { Clock, Crown, Flame, Lock, Play, Search, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { CATEGORIES, VIDEOS } from '../data/videos';
import type { Video } from '../types';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, Progress, SectionTitle } from '../components/ui';
import { canStream, qualityCap } from '../services/subscriptionService';
import { continueWatching, progressFor } from '../services/watchService';
import { compactNumber, formatDuration } from '../lib/format';
import { relativeTime } from '../lib/format';

export function HomePage({ query = '' }: { query?: string }) {
  const { user, plan, subscription, version, quota } = useApp();
  const [category, setCategory] = useState('All');
  const [onlyMine, setOnlyMine] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VIDEOS.filter((v) => {
      const matchesCategory = category === 'All' || v.category === category;
      const matchesQuery =
        !q ||
        v.title.toLowerCase().includes(q) ||
        v.channel.toLowerCase().includes(q) ||
        v.tags.some((t) => t.includes(q));
      const matchesAccess = !onlyMine || !user || canStream(user.id, v).allowed;
      return matchesCategory && matchesQuery && matchesAccess;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, onlyMine, user, version]);

  const resume = user ? continueWatching(user.id, VIDEOS) : [];

  return (
    <div className="space-y-8">
      {/* ------------------------------- hero ------------------------------ */}
      <Card className="relative overflow-hidden !p-0">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-600/90 via-red-700/80 to-slate-900" />
        <div className="relative grid gap-6 p-7 lg:grid-cols-[1.4fr_1fr] lg:p-9">
          <div className="text-white">
            <Badge tone="rose" className="!bg-white/20 !text-white">
              <Sparkles size={11} /> {plan.name} plan · {subscription ? `${Math.max(0, Math.ceil((subscription.expiryDate - Date.now()) / 86_400_000))} days remaining` : 'no expiry'}
            </Badge>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Watch, download and meet - all governed by your plan
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
              {plan.id === 'free'
                ? 'You are on Free: 1 download a day, 360p streaming and 60 minutes of watch time. Upgrade for higher quotas, HD, offline retention and ad-free viewing.'
                : `${plan.name} unlocks ${plan.dailyDownloadLimit === -1 ? 'unlimited' : plan.dailyDownloadLimit + ' downloads a day'}, up to ${plan.maxStreamQuality}p, ${plan.maxDevices} registered devices${plan.adFree ? ' and ad-free viewing' : ''}.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Play size={15} />} onClick={() => navigate('watch', VIDEOS[0].id)}>
                Play a free title
              </Button>
              <Button
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                icon={<Crown size={15} />}
                onClick={() => navigate('subscriptions')}
              >
                {plan.id === 'free' ? 'Upgrade to Bronze' : 'Manage subscription'}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white backdrop-blur">
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">Today's download allowance</p>
            <p className="mt-1 text-4xl font-extrabold">
              {quota.remainingToday === -1 ? '∞' : quota.remainingToday}
              <span className="ml-2 text-base font-semibold text-white/70">
                {quota.dailyLimit === -1 ? 'unlimited' : `of ${quota.dailyLimit} left`}
              </span>
            </p>
            {quota.dailyLimit !== -1 && (
              <>
                <Progress value={quota.percentToday} barClass="bg-white" trackClass="bg-white/25" className="mt-3" />
                <p className="mt-2 text-xs text-white/75">
                  {quota.usedToday} used today · {quota.usedThisMonth}
                  {quota.monthlyLimit === -1 ? '' : `/${quota.monthlyLimit}`} used this month
                </p>
              </>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <Chip icon={<TrendingUp size={12} />} label={`${plan.maxStreamQuality}p max`} />
              <Chip icon={<Clock size={12} />} label={plan.dailyWatchMinutes === -1 ? 'No watch limit' : `${plan.dailyWatchMinutes} min/day`} />
              <Chip icon={<ShieldCheck size={12} />} label={`${plan.maxDevices} device${plan.maxDevices > 1 ? 's' : ''}`} />
              <Chip icon={<Crown size={12} />} label={plan.adFree ? 'Ad-free' : 'With ads'} />
            </div>
          </div>
        </div>
      </Card>

      {/* -------------------------- continue watching ---------------------- */}
      {resume.length > 0 && (
        <section>
          <SectionTitle title="Continue watching" subtitle="Resume positions are saved every 5 seconds and synced to your profile" icon={<Clock size={18} />} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resume.map(({ video, position, percent }) => (
              <button
                key={video.id}
                onClick={() => navigate('watch', video.id)}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="relative aspect-video">
                  <img src={video.thumbnail} alt={video.title} className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div className="h-full bg-rose-500" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {formatDuration(video.duration - position)} left
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 text-sm font-bold">{video.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Resume at {formatDuration(position)} · {Math.round(percent)}% watched
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------ catalogue -------------------------- */}
      <section>
        <SectionTitle
          title="Browse the catalogue"
          subtitle={`${filtered.length} of ${VIDEOS.length} titles · your ${plan.name} plan caps streaming at ${qualityCap(user?.id ?? '')}p`}
          icon={<Flame size={18} />}
          right={
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-rose-500" />
              Only titles my plan can play
            </label>
          }
        />

        <div className="mb-5 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                category === c
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-14 text-center">
            <Search size={26} className="text-slate-400" />
            <p className="text-sm font-semibold">No titles match that filter</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Try another category or clear the search box.</p>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 font-semibold">
      {icon} {label}
    </span>
  );
}

function VideoCard({ video }: { video: Video; key?: React.Key }) {
  const { user, plan, version } = useApp();
  const decision = user ? canStream(user.id, video) : { allowed: false, reason: 'Sign in to watch' };
  const progress = user ? progressFor(user.id, video.id) : null;
  const accessible = plan.tier >= video.minTier;

  return (
    <button
      onClick={() => navigate('watch', video.id)}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="relative aspect-video overflow-hidden">
        <img
          src={video.thumbnail}
          alt={video.title}
          className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${accessible ? '' : 'opacity-50 grayscale'}`}
        />
        <div className="absolute left-2 top-2 flex gap-1.5">
          {video.access !== 'public' && (
            <Badge tone={video.access === 'exclusive' ? 'amber' : 'violet'}>
              {video.access === 'exclusive' ? <><Sparkles size={10} /> Exclusive</> : 'Premium'}
            </Badge>
          )}
          {!accessible && (
            <Badge tone="red"><Lock size={10} /> Locked</Badge>
          )}
        </div>
        <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatDuration(video.duration)}
        </span>
        {progress && !progress.completed && progress.position > 2 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-rose-500" style={{ width: `${progress.percent}%` }} />
          </div>
        )}
      </div>
      <div className="p-3.5">
        <p className="line-clamp-2 text-sm font-bold leading-snug">{video.title}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {video.channel} · {compactNumber(video.views)} views · {relativeTime(video.publishedAt)}
        </p>
        <div className="mt-2.5 flex items-center justify-between text-[11px]">
          <Badge tone="slate">{video.category}</Badge>
          <span className={decision.allowed ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>
            {decision.allowed ? 'Playable' : `Needs tier ${video.minTier}`}
          </span>
        </div>
      </div>
    </button>
  );
}
