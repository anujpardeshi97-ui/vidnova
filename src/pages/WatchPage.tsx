/* ============================================================================
 * WatchPage.tsx - the watch experience.
 * Composes the custom player with the entitlement checks (stream access,
 * quality cap, watch-time budget) and the controlled download action.
 * ==========================================================================*/
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Eye, Lock, Sparkles, ThumbsUp, Timer, Verified } from 'lucide-react';
import { VIDEOS, getVideo } from '../data/videos';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, SectionTitle } from '../components/ui';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { DownloadButton, QuotaMeter } from '../components/Downloads';
import { VideoComments } from '../components/VideoComments';
import { canStream, effectivePlan } from '../services/subscriptionService';
import { logWatchEvent, nextVideoIn, progressFor, saveProgress, watchAllowance, COMPLETION_THRESHOLD } from '../services/watchService';
import { compactNumber, formatDuration, relativeTime } from '../lib/format';
import type { QualityLabel } from '../types';

export function WatchPage({ videoId }: { videoId?: string }) {
  const { user, toast, bump, version } = useApp();
  const video = videoId ? getVideo(videoId) : undefined;
  const [theater, setTheater] = useState(false);
  const [watched, setWatched] = useState<{ position: number; duration: number }>({ position: 0, duration: 0 });
  const [quality, setQuality] = useState<QualityLabel | undefined>(undefined);

  if (!video) {
    return (
      <Card>
        <SectionTitle title="Video not found" subtitle="That title is not in the catalogue." />
        <Button onClick={() => navigate('home')}>Back to browse</Button>
      </Card>
    );
  }

  const plan = user ? effectivePlan(user.id) : null;
  const decision = user ? canStream(user.id, video) : { allowed: false, reason: 'Sign in to watch.' };
  const allowance = user ? watchAllowance(user.id) : null;
  const saved = user ? progressFor(user.id, video.id) : null;
  const next = nextVideoIn(VIDEOS, video.id);

  const related = useMemo(
    () => VIDEOS.filter((v) => v.id !== video.id && (v.category === video.category || v.channel === video.channel)).slice(0, 6),
    [video],
  );

  /* Quality cap: only offer renditions the plan allows. */
  const streams = useMemo(() => {
    if (!user) return [];
    const cap = plan?.maxStreamQuality ?? 360;
    const order = { '360p': 360, '720p': 720, '1080p': 1080 };
    return video.sources.filter((s) => order[s.quality] <= cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, plan?.maxStreamQuality, video, version]);

  const canPlayNow = () => {
    if (!user || !allowance) return false;
    if (!decision.allowed) return false;
    if (!allowance.allowed) {
      toast({ kind: 'warning', title: 'Daily watch time used up', message: allowance.reason });
      return false;
    }
    return true;
  };

  return (
    <div className={`grid gap-6 ${theater ? '' : 'xl:grid-cols-[minmax(0,1fr)_22rem]'}`}>
      <div className="min-w-0 space-y-5">
        <VideoPlayer
          video={video}
          locked={!decision.allowed}
          lockedMessage={decision.reason}
          canPlay={canPlayNow}
          next={next}
          onNext={() => next && navigate('watch', next.id)}
          resumeAt={saved?.position ?? 0}
          initialQuality={quality ?? streams[streams.length - 1]?.quality}
          onQualityChange={setQuality}
          onTheaterChange={setTheater}
          onTimeUpdate={(position, duration) => setWatched({ position, duration })}
          onProgressSave={(position, duration, secondsWatched) => {
            if (!user) return;
            const saved2 = saveProgress({ userId: user.id, videoId: video.id, position, duration, secondsWatched });
            if (saved2.completed) {
              logWatchEvent({ userId: user.id, videoId: video.id, type: 'completed', detail: `Crossed ${COMPLETION_THRESHOLD}% at ${formatDuration(position)}` });
            }
            bump();
          }}
        />

        <VideoComments videoId={video.id} user={user ? { id: user.id, name: user.name } : null} />

        {/* ------------------------------ meta ---------------------------- */}
        <div>
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Eye size={13} /> {compactNumber(video.views)} views</span>
            <span className="flex items-center gap-1"><ThumbsUp size={13} /> {compactNumber(video.likes)}</span>
            <span>{relativeTime(video.publishedAt)}</span>
            <Badge tone={video.access === 'exclusive' ? 'amber' : video.access === 'premium' ? 'violet' : 'slate'}>
              {video.access === 'exclusive' ? <><Sparkles size={10} /> Gold exclusive</> : video.access === 'premium' ? 'Premium' : 'Free title'}
            </Badge>
            {saved && saved.position > 2 && (
              <span className="flex items-center gap-1"><Timer size={13} /> resume at {formatDuration(saved.position)} {saved.completed ? '(completed)' : ''}</span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <DownloadButton video={video} />
            {plan && plan.id !== 'gold' && (
              <Button variant="outline" size="sm" icon={<Sparkles size={14} />} onClick={() => navigate('subscriptions')}>
                Unlock {video.minTier > plan.tier ? 'this title' : 'higher quality'}
              </Button>
            )}
          </div>

          <Card className="mt-4">
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{video.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {video.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  #{tag}
                </span>
              ))}
            </div>
          </Card>

          {/* entitlement + limits strip */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Card className="!p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Streaming quality</p>
              {decision.allowed ? (
                <>
                  <p className="mt-1 text-lg font-extrabold">{quality ?? streams[streams.length - 1]?.quality ?? '360p'}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {streams.length} rendition{streams.length === 1 ? '' : 's'} allowed on {plan?.name}
                    {plan && plan.maxStreamQuality < 1080 ? ` (cap ${plan.maxStreamQuality}p)` : ''}
                  </p>
                </>
              ) : (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-rose-600 dark:text-rose-400">
                  <Lock size={14} /> Locked by plan
                </p>
              )}
            </Card>

            <Card className="!p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Watch time today</p>
              <p className="mt-1 text-lg font-extrabold">
                {allowance ? (allowance.limitMinutes === -1 ? 'Unlimited' : `${allowance.minutesUsed} / ${allowance.limitMinutes} min`) : '—'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {allowance && allowance.limitMinutes !== -1
                  ? `${allowance.minutesLeft} min left before playback is blocked until 00:00 IST`
                  : 'No daily cap on your plan'}
              </p>
            </Card>

            <Card className="!p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Playback session</p>
              <p className="mt-1 text-lg font-extrabold">
                {formatDuration(watched.position)} <span className="text-xs font-semibold text-slate-400">/ {formatDuration(watched.duration || video.duration)}</span>
              </p>
              <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Clock size={11} /> progress saved every 5s · completes at {COMPLETION_THRESHOLD}%
              </p>
            </Card>
          </div>

          {!decision.allowed && (
            <Card className="mt-4 border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
                <AlertTriangle size={16} /> {decision.reason}
              </p>
              <Button size="sm" className="mt-3" icon={<Sparkles size={14} />} onClick={() => navigate('subscriptions')}>
                Compare plans
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------ sidebar ---------------------------- */}
      <aside className="space-y-5">
        <QuotaMeter compact />

        <Card>
          <SectionTitle title="Up next" subtitle="Autoplay countdown starts when this title ends" icon={<Verified size={18} />} />
          <div className="space-y-3">
            {[next, ...related].filter(Boolean).slice(0, 6).map((item) => {
              const v = item!;
              const allowed = user ? canStream(user.id, v).allowed : false;
              return (
                <button
                  key={v.id}
                  onClick={() => navigate('watch', v.id)}
                  className="flex w-full gap-3 rounded-xl p-1.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg">
                    <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                    {!allowed && (
                      <span className="absolute inset-0 grid place-items-center bg-black/60">
                        <Lock size={16} className="text-white" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-xs font-bold leading-snug">{v.title}</p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{v.channel}</p>
                    <p className="text-[11px] text-slate-400">{formatDuration(v.duration)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Keyboard shortcuts" subtitle="Full desktop control without touching the mouse" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            {[
              ['Space / K', 'Play · pause'],
              ['← / →', 'Seek 10s'],
              ['Shift + ← / →', 'Seek 30s'],
              ['↑ / ↓', 'Volume ±5%'],
              ['M', 'Mute · unmute'],
              ['F', 'Fullscreen'],
              ['T', 'Theatre mode'],
              ['P', 'Picture-in-Picture'],
              ['C', 'Captions'],
              ['S', 'Cycle speed'],
              ['N', 'Next video'],
              ['0 – 9', 'Jump 0–90%'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 dark:bg-slate-800/70">
                <span className="font-mono text-[10px] font-bold">{key}</span>
                <span className="text-right text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  );
}
