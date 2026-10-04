/* ============================================================================
 * videos.ts - the demo catalogue.
 *
 * All eight titles stream from three royalty-free clips (Big Buck Bunny,
 * Sintel, Jellyfish) that ship inside /public/videos, re-encoded here as
 * 360p / 720p / 1080p "renditions" so the quality switcher and the tier-based
 * quality cap are exercised with real media rather than mock filenames.
 *
 * `access`  -> public | premium | exclusive      (content gating)
 * `minTier` -> lowest plan tier that may stream/download it
 * ==========================================================================*/
import type { Video } from '../types';
import { makeThumbnail } from './thumbnails';

const DAY = 86_400_000;
const NOW = Date.now();

/** Rendition table: one entry per (clip, quality). */
const SRC = {
  bbb360: { url: '/videos/big-buck-bunny-360p.mp4', sizeBytes: 991_017, quality: '360p' as const },
  bbb720: { url: '/videos/big-buck-bunny-720p.mp4', sizeBytes: 969_201, quality: '720p' as const },
  bbb1080: { url: '/videos/big-buck-bunny-1080p.mp4', sizeBytes: 2_097_084, quality: '1080p' as const },
  sin360: { url: '/videos/sintel-360p.mp4', sizeBytes: 1_047_614, quality: '360p' as const },
  sin720: { url: '/videos/sintel-720p.mp4', sizeBytes: 1_047_954, quality: '720p' as const },
  sin1080: { url: '/videos/sintel-1080p.mp4', sizeBytes: 2_096_968, quality: '1080p' as const },
  jel360: { url: '/videos/jellyfish-360p.mp4', sizeBytes: 1_047_059, quality: '360p' as const },
  jel720: { url: '/videos/jellyfish-720p.mp4', sizeBytes: 1_047_967, quality: '720p' as const },
};

/** Every clip is 10 seconds long at 30fps. */
const CLIP_DURATION = 10;

interface Seed {
  id: string;
  title: string;
  description: string;
  category: string;
  channel: string;
  access: Video['access'];
  minTier: 0 | 1 | 2 | 3;
  emoji: string;
  from: string;
  to: string;
  views: number;
  likes: number;
  daysAgo: number;
  tags: string[];
  sources: Video['sources'];
  captions?: Video['captions'];
  badge?: string;
}

const SEEDS: Seed[] = [
  {
    id: 'vid_bbb',
    title: 'Big Buck Bunny - The Open Movie',
    description:
      'The Blender Foundation classic that proved open-source animation could look this good. A giant rabbit, three bullying rodents and one very satisfying revenge arc - rendered entirely with free software.',
    category: 'Animation',
    channel: 'Blender Open Movies',
    access: 'public',
    minTier: 0,
    emoji: '🐰',
    from: '#f97316',
    to: '#7c2d12',
    views: 1_284_930,
    likes: 24_881,
    daysAgo: 12,
    tags: ['animation', 'open source', 'family', 'creator'],
    sources: [SRC.bbb360, SRC.bbb720, SRC.bbb1080],
    captions: [{ label: 'English', url: '/captions/big-buck-bunny.vtt' }],
    badge: 'Free',
  },
  {
    id: 'vid_sintel',
    title: 'Sintel - A Dragon, A Promise',
    description:
      'A lone girl crosses a frozen world to find the dragon she raised. Sintel is a masterclass in storytelling economy - every frame of this Blender short carries emotional weight.',
    category: 'Animation',
    channel: 'Blender Open Movies',
    access: 'public',
    minTier: 0,
    emoji: '🐉',
    from: '#0ea5e9',
    to: '#0c4a6e',
    views: 942_117,
    likes: 19_402,
    daysAgo: 20,
    tags: ['fantasy', 'drama', 'short film'],
    sources: [SRC.sin360, SRC.sin720, SRC.sin1080],
    captions: [{ label: 'English', url: '/captions/sintel.vtt' }],
    badge: 'Free',
  },
  {
    id: 'vid_jellyfish',
    title: 'Jellyfish Dreams in Ultra HD',
    description:
      'Ten minutes of drifting medusae shot at 120fps and graded for OLED panels. Our most-downloaded ambient title - ideal for focus sessions and second monitors.',
    category: 'Nature & Relaxation',
    channel: 'Deep Ocean Studio',
    access: 'premium',
    minTier: 1,
    emoji: '🪼',
    from: '#06b6d4',
    to: '#1e1b4b',
    views: 512_884,
    likes: 11_230,
    daysAgo: 5,
    tags: ['4k', 'ambient', 'focus', 'nature'],
    sources: [SRC.jel360, SRC.jel720, SRC.bbb1080],
    badge: 'Bronze+',
  },
  {
    id: 'vid_react',
    title: 'Full-Stack React Masterclass - Lecture 01',
    description:
      'Architecture, state boundaries and the five rendering modes you actually need. Part one of the NexStream exclusive course library: shipping production React without a framework crutch.',
    category: 'Courses',
    channel: 'NexStream Academy',
    access: 'exclusive',
    minTier: 3,
    emoji: '⚛️',
    from: '#8b5cf6',
    to: '#312e81',
    views: 88_431,
    likes: 7_664,
    daysAgo: 2,
    tags: ['react', 'course', 'exclusive', 'engineering'],
    sources: [SRC.bbb720, SRC.bbb1080],
    badge: 'Gold only',
  },
  {
    id: 'vid_razorpay',
    title: 'Razorpay Integration Deep Dive',
    description:
      'Order creation, checkout, signature verification, webhooks and idempotency. A production-grade walkthrough of taking money in India without double-charging a single user.',
    category: 'Courses',
    channel: 'NexStream Academy',
    access: 'premium',
    minTier: 2,
    emoji: '💳',
    from: '#22c55e',
    to: '#064e3b',
    views: 64_902,
    likes: 5_901,
    daysAgo: 9,
    tags: ['payments', 'backend', 'india', 'course'],
    sources: [SRC.sin720, SRC.sin1080],
    badge: 'Silver+',
  },
  {
    id: 'vid_grading',
    title: 'Cinematic Colour Grading Workflow',
    description:
      'Node-based grading from log footage to final delivery: balance, contrast, secondaries and the looks that survive compression. Project files included with the Gold plan.',
    category: 'Courses',
    channel: 'NexStream Academy',
    access: 'exclusive',
    minTier: 3,
    emoji: '🎨',
    from: '#ec4899',
    to: '#500724',
    views: 41_118,
    likes: 4_220,
    daysAgo: 15,
    tags: ['colour', 'film', 'post-production', 'exclusive'],
    sources: [SRC.jel360, SRC.jel720, SRC.bbb1080],
    badge: 'Gold only',
  },
  {
    id: 'vid_lofi',
    title: 'Lo-fi Study Session - Rain & Vinyl',
    description:
      'A relaxed loop with rain texture and vinyl crackle. Available to everyone, forever - because study music should never sit behind a paywall.',
    category: 'Music',
    channel: 'NexStream Sessions',
    access: 'public',
    minTier: 0,
    emoji: '🎧',
    from: '#a855f7',
    to: '#1e1b4b',
    views: 2_045_772,
    likes: 61_440,
    daysAgo: 32,
    tags: ['lofi', 'study', 'music', 'loop'],
    sources: [SRC.jel360, SRC.jel720],
    badge: 'Free',
  },
  {
    id: 'vid_pitch',
    title: 'Startup Pitch Teardown - Ep. 07',
    description:
      'We rebuild a failed seed-round deck slide by slide. Metrics framing, competitive moats and the one question every investor asks in the first ninety seconds.',
    category: 'Business',
    channel: 'Founder Room',
    access: 'premium',
    minTier: 2,
    emoji: '🚀',
    from: '#ef4444',
    to: '#450a0a',
    views: 173_559,
    likes: 9_018,
    daysAgo: 4,
    tags: ['startup', 'fundraising', 'pitch', 'analysis'],
    sources: [SRC.sin360, SRC.sin720, SRC.bbb720],
    badge: 'Silver+',
  },
];

export const VIDEOS: Video[] = SEEDS.map((s) => ({
  id: s.id,
  title: s.title,
  description: s.description,
  category: s.category,
  channel: s.channel,
  duration: CLIP_DURATION,
  thumbnail: makeThumbnail({ title: s.title, subtitle: s.category, from: s.from, to: s.to, icon: s.emoji, badge: s.badge }),
  poster: makeThumbnail({ title: s.title, subtitle: s.channel, from: s.from, to: s.to, icon: s.emoji, badge: s.badge, width: 1280, height: 720 }),
  access: s.access,
  minTier: s.minTier,
  views: s.views,
  likes: s.likes,
  publishedAt: NOW - s.daysAgo * DAY,
  tags: s.tags,
  sources: s.sources,
  captions: s.captions,
}));

export const CATEGORIES = ['All', ...Array.from(new Set(VIDEOS.map((v) => v.category)))];

export function getVideo(id: string): Video | undefined {
  return VIDEOS.find((v) => v.id === id);
}

/** Quality ladder of one video, ascending: ["360p","720p","1080p"]. */
export function qualityLadder(video: Video): Video['sources'] {
  const order = { '360p': 0, '720p': 1, '1080p': 2 };
  return [...video.sources].sort((a, b) => order[a.quality] - order[b.quality]);
}
