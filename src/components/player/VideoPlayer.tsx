/* ============================================================================
 * VideoPlayer.tsx - the fully customised HTML5 player.
 *
 * Deliberately does NOT use the browser's native `controls` attribute. Every
 * control below is our own DOM, which is what allows the product-specific
 * behaviours the spec asks for:
 *
 *   playback      play/pause, visible buffering + loading states
 *   audio         draggable volume slider, mute/unmute
 *   speed         0.5x / 1x / 1.25x / 1.5x / 2x
 *   seek          -10s / +10s buttons, Shift+arrows for -30s / +30s
 *   modes         theatre, fullscreen, Picture-in-Picture
 *   captions      <track> toggle when the title ships captions
 *   info          current time, duration, REMAINING time, buffered bar,
 *                 quality badge, live progress bar
 *   autoplay      countdown to the next video with a cancel button
 *   continuity    resume from the last position, save progress every 5s,
 *                 mark complete past the threshold
 *   exclusivity   only one player may play at a time (cross-tab included)
 *   limits        free-plan daily watch minutes enforced before playback
 *   shortcuts     space, arrows, shift+arrows, m f t p c s n, 0-9
 *   hover preview frame thumbnails on the timeline
 * ==========================================================================*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions, Check, Maximize, Minimize, MonitorPlay, Pause, PictureInPicture2, Play,
  RotateCcw, RotateCw, Settings, SkipForward, Subtitles, Volume1, Volume2, VolumeX, X, Gauge, Loader2,
} from 'lucide-react';
import type { QualityLabel, Video } from '../../types';
import { formatDuration } from '../../lib/format';
import { COMPLETION_THRESHOLD, claimPlaybackSlot, onPlaybackSlotChange, progressFor, releasePlaybackSlot, saveProgress } from '../../services/watchService';

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const SKIP_SMALL = 10;
const SKIP_LARGE = 30;
const CONTROLS_IDLE_MS = 3000;
const AUTOPLAY_SECONDS = 10;

export interface VideoPlayerProps {
  video: Video;
  /** Blocked players still render the shell + a message instead of the media. */
  locked?: boolean;
  lockedMessage?: string;
  /** Called before playback starts; return false to veto (quota, watch time...). */
  canPlay?: () => boolean;
  /** Next video for the autoplay countdown. */
  next?: Video;
  onNext?: () => void;
  /** Persist progress (throttled internally). */
  onProgressSave?: (position: number, duration: number, secondsWatched: number) => void;
  /** Live playback position, for parent-side sidebars. */
  onTimeUpdate?: (position: number, duration: number) => void;
  onQualityChange?: (quality: QualityLabel) => void;
  initialQuality?: QualityLabel;
  onTheaterChange?: (theater: boolean) => void;
  /** Where to resume from. When omitted the player reads the stored bookmark. */
  resumeAt?: number;
  playerId?: string;
}

export function VideoPlayer({
  video,
  locked = false,
  lockedMessage,
  canPlay,
  next,
  onNext,
  onProgressSave,
  onTimeUpdate,
  onQualityChange,
  initialQuality,
  onTheaterChange,
  resumeAt,
  playerId = 'main',
}: VideoPlayerProps) {
  /* ------------------------------- refs ---------------------------------- */
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idleTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const watchedSeconds = useRef(0);
  const lastTick = useRef<number>(Date.now());
  const countdownTimer = useRef<number | null>(null);

  /* ------------------------------ state ---------------------------------- */
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [quality, setQuality] = useState<QualityLabel>(initialQuality ?? '360p');
  const [theater, setTheater] = useState(false);
  const [isFullscreen, setFullscreen] = useState(false);
  const [inPip, setInPip] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preview, setPreview] = useState<{ visible: boolean; x: number; time: number }>({ visible: false, x: 0, time: 0 });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resumeFrom, setResumeFrom] = useState(0);
  const [showResumeBadge, setShowResumeBadge] = useState(false);

  const source = useMemo(
    () => video.sources.find((s) => s.quality === quality) ?? video.sources[video.sources.length - 1],
    [video, quality],
  );

  const remaining = Math.max(0, duration - currentTime);
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  /* ------------------------- resume bookmark (prop) ----------------------- */
  useEffect(() => {
    const saved = resumeAt ?? progressFor('', video.id)?.position ?? 0;
    setResumeFrom(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAt, video.id]);

  useEffect(() => {
    // Auto-pick the highest available quality on first load.
    if (!initialQuality) {
      setQuality(video.sources[video.sources.length - 1].quality);
    }
    setCurrentTime(0);
    setBuffered(0);
  }, [video.id, initialQuality, video.sources]);

  /* ----------------------------- media events ----------------------------- */
  const attach = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = rate;
  }, [volume, muted, rate]);

  useEffect(attach, [attach]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onLoaded = () => {
      setDuration(el.duration || video.duration);
      // Resume: only if the viewer stopped meaningfully into the video.
      if (resumeFrom > 2 && resumeFrom < (el.duration || 0) * (COMPLETION_THRESHOLD / 100)) {
        el.currentTime = resumeFrom;
        setShowResumeBadge(true);
        window.setTimeout(() => setShowResumeBadge(false), 5000);
      }
      setWaiting(false);
    };
    const onTime = () => {
      const now = Date.now();
      if (!el.paused) watchedSeconds.current += (now - lastTick.current) / 1000;
      lastTick.current = now;
      setCurrentTime(el.currentTime);
      onTimeUpdate?.(el.currentTime, el.duration || 0);
    };
    const onProgress = () => {
      if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1));
    };
    const onWaiting = () => {
      // `waiting` is the browser's actual playback-stall signal.
      // Do not infer buffering from bufferedEnd < currentTime: a healthy
      // stream can legitimately have only a small buffer ahead.
      if (!el.paused && !el.ended) setWaiting(true);
    };
    const onCanPlay = () => setWaiting(false);
    const onPlaying = () => {
      setWaiting(false);
      setPlaying(true);
      lastTick.current = Date.now();
      claimPlaybackSlot(playerId);
    };
    const onStalled = () => {
      if (!el.paused && !el.ended) setWaiting(true);
    };
    const onPause = () => {
      setPlaying(false);
      releasePlaybackSlot(playerId);
    };
    const onEnded = () => {
      setPlaying(false);
      releasePlaybackSlot(playerId);
      if (onProgressSave) onProgressSave(el.duration, el.duration, watchedSeconds.current);
      if (next && onNext) {
        setCountdown(AUTOPLAY_SECONDS);
      }
    };
    const onError = () => {
      setWaiting(false);
      setNotice('Playback failed. Check your connection and try again.');
    };

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('progress', onProgress);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('stalled', onStalled);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('progress', onProgress);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('stalled', onStalled);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [video.duration, next, onNext, onProgressSave, onTimeUpdate, playerId, resumeFrom, video.id]);

  /* ----------------------- progress persistence (5s) ---------------------- */
  useEffect(() => {
    if (saveTimer.current) window.clearInterval(saveTimer.current);
    saveTimer.current = window.setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused || el.ended) return;
      onProgressSave?.(el.currentTime, el.duration || 0, watchedSeconds.current);
      watchedSeconds.current = 0;
    }, 5000);
    return () => {
      if (saveTimer.current) window.clearInterval(saveTimer.current);
    };
  }, [onProgressSave]);

  /* ------------------- revert quality keeps the position ------------------ */
  const switchQuality = (q: QualityLabel) => {
    const el = videoRef.current;
    const at = el?.currentTime ?? 0;
    const wasPlaying = el ? !el.paused : false;
    setQuality(q);
    onQualityChange?.(q);
    window.setTimeout(() => {
      const el2 = videoRef.current;
      if (!el2) return;
      el2.currentTime = at;
      if (wasPlaying) void el2.play().catch(() => undefined);
    }, 120);
  };

  /* ---------------------------- autoplay countdown ------------------------ */
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      onNext?.();
      return;
    }
    countdownTimer.current = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => {
      if (countdownTimer.current) window.clearTimeout(countdownTimer.current);
    };
  }, [countdown, onNext]);

  /* --------------------- controls auto-hide on inactivity ----------------- */
  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    wakeControls();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [wakeControls]);

  /* --------------------------- fullscreen sync ---------------------------- */
  useEffect(() => {
    const onFs = () => {
      const el = shellRef.current;
      setFullscreen(Boolean(document.fullscreenElement && el && document.fullscreenElement === el));
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onEnter = () => setInPip(true);
    const onLeave = () => setInPip(false);
    el.addEventListener('enterpictureinpicture', onEnter);
    el.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter);
      el.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  /* --------------------- exclusivity across tabs/players ------------------ */
  useEffect(() => {
    return onPlaybackSlotChange((activeId) => {
      if (activeId && activeId !== playerId) {
        const el = videoRef.current;
        if (el && !el.paused) {
          el.pause();
          setNotice('Paused - another video started playing in a different tab.');
          window.setTimeout(() => setNotice(null), 4000);
        }
      }
    });
  }, [playerId]);

  /* -------------------------- playback controls --------------------------- */
  const requestPlay = useCallback(() => {
    if (locked) return;
    if (canPlay && !canPlay()) return;
    const el = videoRef.current;
    if (!el) return;
    void el.play().catch(() => setNotice('Autoplay was blocked by the browser - press play again.'));
  }, [canPlay, locked]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) requestPlay();
    else el.pause();
  }, [requestPlay]);

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.05, el.currentTime + delta));
    setNotice(`${delta > 0 ? '+' : ''}${delta}s`);
    window.setTimeout(() => setNotice(null), 800);
  }, [duration]);

  const seekTo = useCallback((time: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.05, time));
  }, [duration]);

  const changeVolume = useCallback((v: number) => {
    const el = videoRef.current;
    const next = Math.max(0, Math.min(1, v));
    setVolume(next);
    if (el) {
      el.volume = next;
      el.muted = next === 0;
    }
    setMuted(next === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const cycleSpeed = useCallback(() => {
    const el = videoRef.current;
    const index = SPEEDS.indexOf(rate);
    const next = SPEEDS[(index + 1) % SPEEDS.length];
    setRate(next);
    if (el) el.playbackRate = next;
  }, [rate]);

  const toggleFullscreen = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      setNotice('Fullscreen is blocked in this embed - open the preview in a new tab.');
      window.setTimeout(() => setNotice(null), 3500);
    }
  }, []);

  const togglePip = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      setNotice('Picture-in-Picture is not supported for this video in your browser.');
      window.setTimeout(() => setNotice(null), 3500);
    }
  }, []);

  const toggleTheater = useCallback(() => {
    setTheater((t) => {
      onTheaterChange?.(!t);
      return !t;
    });
  }, [onTheaterChange]);

  const toggleCaptions = useCallback(() => {
    const el = videoRef.current;
    if (!el || !video.captions?.length) {
      setNotice('This title has no captions available.');
      window.setTimeout(() => setNotice(null), 2500);
      return;
    }
    const track = el.textTracks[0];
    if (track) track.mode = captionsOn ? 'hidden' : 'showing';
    setCaptionsOn((c) => !c);
  }, [captionsOn, video.captions]);

  /* ------------------------------ shortcuts ------------------------------- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if (locked) return;

      const el = videoRef.current;
      if (!el) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBy(e.shiftKey ? -SKIP_LARGE : -SKIP_SMALL);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekBy(e.shiftKey ? SKIP_LARGE : SKIP_SMALL);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(el.volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(el.volume - 0.05);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          void toggleFullscreen();
          break;
        case 't':
          toggleTheater();
          break;
        case 'p':
          void togglePip();
          break;
        case 'c':
          toggleCaptions();
          break;
        case 's':
          cycleSpeed();
          break;
        case 'n':
          onNext?.();
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            // 0-9 jump to 0%-90% of the timeline.
            const fraction = Number(e.key) / 10;
            seekTo((el.duration || duration) * fraction);
          }
      }
      wakeControls();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    changeVolume, cycleSpeed, duration, locked, onNext, seekBy, seekTo, toggleCaptions,
    toggleFullscreen, toggleMute, togglePip, togglePlay, toggleTheater, wakeControls,
  ]);

  /* ------------------- timeline hover preview (canvas) -------------------- */
  const previewSeekPending = useRef(false);
  const onTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * (duration || 0);
    setPreview({ visible: true, x: ratio * rect.width, time });

    // Ask the hidden <video> to decode that timestamp, then paint it.
    const pv = previewRef.current;
    const canvas = canvasRef.current;
    if (!pv || !canvas || previewSeekPending.current) return;
    previewSeekPending.current = true;
    const paint = () => {
      try {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(pv, 0, 0, canvas.width, canvas.height);
      } catch {
        /* CORS/decoder hiccup - the time bubble alone is still useful */
      }
      previewSeekPending.current = false;
    };
    pv.currentTime = time;
    pv.addEventListener('seeked', paint, { once: true });
  };

  /* ------------------------------ rendering ------------------------------- */
  const volumeIcon = muted || volume === 0 ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />;

  return (
    <div
      ref={shellRef}
      onMouseMove={wakeControls}
      onMouseLeave={() => setControlsVisible(false)}
      className={`group relative w-full overflow-hidden rounded-2xl bg-black ${
        theater ? 'aspect-[21/9]' : 'aspect-video'
      } ${isFullscreen ? 'rounded-none' : ''}`}
    >
      {/* ------------------------------- media ------------------------------ */}
      <video
        ref={videoRef}
        src={source?.url}
        poster={video.poster}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        onClick={togglePlay}
        onDoubleClick={() => void toggleFullscreen()}
        className="h-full w-full cursor-pointer bg-black object-contain"
      >
        {video.captions?.map((c) => (
          <track key={c.label} kind="subtitles" src={c.url} srcLang="en" label={c.label} default={false} />
        ))}
      </video>

      {/* Hidden decoder used only to paint timeline hover previews. */}
      <video ref={previewRef} src={source?.url} muted preload="metadata" crossOrigin="anonymous" className="hidden" />

      {/* --------------------------- blocked state -------------------------- */}
      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/90 px-8 text-center">
          <MonitorPlay size={40} className="text-rose-500" />
          <p className="text-base font-semibold text-white">Playback locked</p>
          <p className="max-w-md text-sm leading-relaxed text-slate-300">{lockedMessage}</p>
        </div>
      )}

      {/* ------------------------- buffering / notices ---------------------- */}
      {waiting && playing && !locked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white">
            <Loader2 size={16} className="animate-spin" /> Buffering…
          </div>
        </div>
      )}

      {showResumeBadge && (
        <div className="absolute left-4 top-4 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white">
          Resumed from {formatDuration(resumeFrom)}
        </div>
      )}

      {notice && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/80 px-4 py-2 text-sm font-semibold text-white">
          {notice}
        </div>
      )}

      {/* --------------------------- autoplay countdown --------------------- */}
      {countdown !== null && next && (
        <div className="absolute bottom-24 right-5 flex w-72 items-center gap-3 rounded-2xl bg-black/85 p-3 text-white shadow-xl">
          <img src={next.thumbnail} alt="" className="h-12 w-20 rounded-lg object-cover" />
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Up next in {countdown}s</p>
            <p className="line-clamp-2 text-xs font-semibold">{next.title}</p>
          </div>
          <div className="flex flex-col gap-1">
            <button onClick={() => setCountdown(null)} className="rounded-lg bg-white/15 p-1.5 hover:bg-white/25" title="Cancel autoplay">
              <X size={14} />
            </button>
            <button onClick={() => { setCountdown(null); onNext?.(); }} className="rounded-lg bg-rose-600 p-1.5 hover:bg-rose-500" title="Play now">
              <SkipForward size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------ controls ---------------------------- */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-16 transition-opacity duration-300 ${
          controlsVisible || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* timeline -------------------------------------------------------- */}
        <div
          className="group/timeline relative mb-2 h-6 cursor-pointer"
          onMouseMove={onTimelineMove}
          onMouseLeave={() => setPreview((p) => ({ ...p, visible: false }))}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
            <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${(buffered / (duration || 1)) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-rose-500" style={{ width: `${progressPercent}%` }} />
          </div>
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500 opacity-0 shadow transition group-hover/timeline:opacity-100"
            style={{ left: `${progressPercent}%` }}
          />

          {preview.visible && (
            <div
              className="pointer-events-none absolute bottom-7 -translate-x-1/2 overflow-hidden rounded-lg border border-white/20 bg-black shadow-xl"
              style={{ left: Math.max(72, Math.min(preview.x, 100000)) }}
            >
              <canvas ref={canvasRef} width={160} height={90} className="block h-[90px] w-[160px] bg-slate-800" />
              <div className="bg-black/90 px-2 py-1 text-center font-mono text-[11px] text-white">
                {formatDuration(preview.time)}
              </div>
            </div>
          )}
        </div>

        {/* buttons --------------------------------------------------------- */}
        <div className="flex items-center gap-1.5 text-white">
          <button onClick={togglePlay} className="rounded-lg p-2 hover:bg-white/15" title="Play / pause (space, k)">
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={() => seekBy(-SKIP_SMALL)} className="hidden rounded-lg p-2 hover:bg-white/15 sm:block" title="Back 10s (←)">
            <RotateCcw size={18} />
          </button>
          <button onClick={() => seekBy(SKIP_SMALL)} className="hidden rounded-lg p-2 hover:bg-white/15 sm:block" title="Forward 10s (→)">
            <RotateCw size={18} />
          </button>

          {/* volume */}
          <div className="group/vol flex items-center gap-1">
            <button onClick={toggleMute} className="rounded-lg p-2 hover:bg-white/15" title="Mute (m)">
              {volumeIcon}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="h-1 w-0 cursor-pointer accent-rose-500 transition-all duration-200 group-hover/vol:w-20 sm:w-16"
              aria-label="Volume"
            />
          </div>

          <div className="ml-1 font-mono text-xs tabular-nums text-white/90">
            {formatDuration(currentTime)} <span className="text-white/40">/</span> {formatDuration(duration)}
            <span className="ml-2 hidden text-white/50 sm:inline">-{formatDuration(remaining)} left</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* live quality badge */}
            <span className="hidden rounded-md bg-white/15 px-2 py-1 text-[11px] font-bold uppercase tracking-wide sm:block">
              {quality}
            </span>

            {/* settings */}
            <div className="relative">
              <button
                onClick={() => setShowSettings((s) => !s)}
                className="rounded-lg p-2 hover:bg-white/15"
                title="Playback settings"
              >
                <Settings size={18} />
              </button>
              {showSettings && (
                <div className="absolute bottom-12 right-0 w-56 rounded-xl border border-white/10 bg-slate-900/97 p-2 text-slate-100 shadow-2xl">
                  <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Quality</p>
                  {[...video.sources].reverse().map((s) => (
                    <button
                      key={s.quality}
                      onClick={() => switchQuality(s.quality)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-white/10"
                    >
                      <span>{s.quality}</span>
                      {quality === s.quality && <Check size={14} className="text-rose-400" />}
                    </button>
                  ))}
                  <p className="mt-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Speed</p>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setRate(s);
                        if (videoRef.current) videoRef.current.playbackRate = s;
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-white/10"
                    >
                      <span>{s}×</span>
                      {rate === s && <Check size={14} className="text-rose-400" />}
                    </button>
                  ))}
                  <p className="mt-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Captions</p>
                  <button
                    onClick={toggleCaptions}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-white/10"
                  >
                    <span>{video.captions?.length ? 'Tip: press C' : 'Not available'}</span>
                    {captionsOn && <Check size={14} className="text-rose-400" />}
                  </button>
                </div>
              )}
            </div>

            <button onClick={toggleCaptions} className="hidden rounded-lg p-2 hover:bg-white/15 sm:block" title="Captions (c)">
              {captionsOn ? <Captions size={18} className="text-rose-400" /> : <Subtitles size={18} />}
            </button>
            <button onClick={() => void togglePip()} className="hidden rounded-lg p-2 hover:bg-white/15 sm:block" title="Picture-in-Picture (p)">
              <PictureInPicture2 size={18} className={inPip ? 'text-rose-400' : ''} />
            </button>
            <button onClick={toggleTheater} className="hidden rounded-lg p-2 hover:bg-white/15 md:block" title="Theatre mode (t)">
              <MonitorPlay size={18} className={theater ? 'text-rose-400' : ''} />
            </button>
            <button onClick={() => void toggleFullscreen()} className="rounded-lg p-2 hover:bg-white/15" title="Fullscreen (f)">
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>

        {/* status strip --------------------------------------------------- */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-white/60">
          <span className="inline-flex items-center gap-1"><Gauge size={12} /> {rate}×</span>
          <span>{video.channel}</span>
          <span className="hidden sm:inline">
            Space play · ←/→ 10s · Shift+←/→ 30s · ↑/↓ volume · M mute · F full · T theatre · P PiP · C captions · S speed · N next
          </span>
        </div>
      </div>
    </div>
  );
}
