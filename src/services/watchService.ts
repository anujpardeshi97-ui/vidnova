/* ============================================================================
 * watchService.ts - playback state: resume positions, watch-time limits,
 * "one video at a time", and the completed-at-N% rule.
 * ==========================================================================*/
import type { Video, WatchEvent, WatchProgress } from '../types';
import { TABLES, readTable, uid, upsert, writeTable } from '../lib/storage';
import { istDayKey } from '../lib/ist';
import { getPlan } from '../data/plans';
import { activeSubscription } from './subscriptionService';

/** A video counts as "completed" once the viewer passes this percentage. */
export const COMPLETION_THRESHOLD = 90;

/* ----------------------------- Resume position ---------------------------- */

export function progressFor(userId: string, videoId: string): WatchProgress | null {
  return (
    readTable<WatchProgress>(TABLES.WATCH_PROGRESS).find((p) => p.userId === userId && p.videoId === videoId) ?? null
  );
}

export function saveProgress(params: {
  userId: string;
  videoId: string;
  position: number;
  duration: number;
  secondsWatched?: number;
}): WatchProgress {
  const { userId, videoId, position, duration } = params;
  const rows = readTable<WatchProgress>(TABLES.WATCH_PROGRESS);
  const existing = rows.find((p) => p.userId === userId && p.videoId === videoId);
  const today = istDayKey();
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const next: WatchProgress = {
    userId,
    videoId,
    position,
    duration,
    percent,
    completed: percent >= COMPLETION_THRESHOLD,
    updatedAt: Date.now(),
    minutesToday:
      (existing && existing.dayKey === today ? existing.minutesToday : 0) +
      Math.max(0, (params.secondsWatched ?? 0) / 60),
    dayKey: today,
  };
  upsert(TABLES.WATCH_PROGRESS, { ...next, id: `${userId}:${videoId}` });
  return next;
}

export function progressList(userId: string): WatchProgress[] {
  return readTable<WatchProgress>(TABLES.WATCH_PROGRESS)
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function continueWatching(userId: string, catalogue: Video[], limit = 6): (WatchProgress & { video: Video })[] {
  return progressList(userId)
    .filter((p) => !p.completed && p.position > 3)
    .map((p) => ({ ...p, video: catalogue.find((v) => v.id === p.videoId)! }))
    .filter((p) => Boolean(p.video))
    .slice(0, limit);
}

export function clearProgress(userId: string, videoId: string): void {
  writeTable(
    TABLES.WATCH_PROGRESS,
    readTable<WatchProgress>(TABLES.WATCH_PROGRESS).filter(
      (p) => !(p.userId === userId && p.videoId === videoId),
    ),
  );
}

/* ------------------------------ Watch time cap ---------------------------- */

export interface WatchAllowance {
  allowed: boolean;
  minutesUsed: number;
  limitMinutes: number; // -1 = unlimited
  minutesLeft: number;
  reason?: string;
}

/**
 * Free members get 60 minutes a day; Bronze 180; Silver/Gold unlimited.
 * Watch time accumulates across every video watched in the current IST day.
 */
export function watchAllowance(userId: string): WatchAllowance {
  const plan = getPlan(activeSubscription(userId)?.planId ?? 'free');
  const today = istDayKey();
  const used = readTable<WatchProgress>(TABLES.WATCH_PROGRESS)
    .filter((p) => p.userId === userId && p.dayKey === today)
    .reduce((sum, p) => sum + p.minutesToday, 0);

  if (plan.dailyWatchMinutes === -1) {
    return { allowed: true, minutesUsed: Math.round(used), limitMinutes: -1, minutesLeft: -1 };
  }
  const left = Math.max(0, plan.dailyWatchMinutes - used);
  return {
    allowed: left > 0.05,
    minutesUsed: Math.round(used * 10) / 10,
    limitMinutes: plan.dailyWatchMinutes,
    minutesLeft: Math.round(left * 10) / 10,
    reason:
      left > 0.05
        ? undefined
        : `You have used your ${plan.dailyWatchMinutes} minutes of watch time for today. It resets at 00:00 IST - or upgrade for unlimited viewing.`,
  };
}

/* --------------------------- Playback event log --------------------------- */

export function logWatchEvent(event: Omit<WatchEvent, 'id' | 'timestamp'> & { timestamp?: number }): void {
  const row: WatchEvent = { id: uid('we'), timestamp: event.timestamp ?? Date.now(), ...event } as WatchEvent;
  const rows = readTable<WatchEvent>(TABLES.WATCH_EVENTS);
  rows.push(row);
  writeTable(TABLES.WATCH_EVENTS, rows.slice(-800));
}

/* ----------------------- Single simultaneous playback --------------------- */

/**
 * "Prevent multiple videos from playing simultaneously" is enforced globally:
 * whoever registers last takes over the playback slot, and every other player
 * pauses itself. Works across tabs as well, because the flag lives in
 * localStorage (the `storage` event fires in the other tabs).
 */
const ACTIVE_KEY = 'nexstream:active-player';

export function claimPlaybackSlot(playerId: string): void {
  localStorage.setItem(ACTIVE_KEY, playerId);
}

export function releasePlaybackSlot(playerId: string): void {
  if (localStorage.getItem(ACTIVE_KEY) === playerId) localStorage.removeItem(ACTIVE_KEY);
}

export function onPlaybackSlotChange(handler: (activeId: string | null) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === ACTIVE_KEY) handler(e.newValue);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

export function activePlaybackSlot(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

/* ------------------------------- Next video ------------------------------- */

export function nextVideoIn(catalogue: Video[], currentId: string): Video | undefined {
  const index = catalogue.findIndex((v) => v.id === currentId);
  if (index < 0) return undefined;
  return catalogue[index + 1] ?? catalogue[0];
}
