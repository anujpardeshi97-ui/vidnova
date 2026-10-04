/* ============================================================================
 * callService.ts - real-time video calling.
 *
 * ARCHITECTURE NOTE
 * A production deployment pairs this UI with a WebRTC SFU (LiveKit, Daily,
 * 100ms) or a mesh of RTCPeerConnections plus a signalling socket. Because the
 * demo has no backend, this service implements everything that lives on the
 * *client* and is observable in a demo: room lifecycle, participant roster,
 * moderation, permissions, in-call chat/file sharing, hand-raising, connection
 * quality, reconnection, recording state and participant limits.
 *
 * The local camera/mic use REAL getUserMedia - so permission prompts, device
 * switching, mute and screen share are genuine browser APIs. Remote peers are
 * simulated (they would otherwise require a signalling server) and are labelled
 * as such in the UI so nobody is misled.
 * ==========================================================================*/
import type {
  CallChatMessage, CallConnectionQuality, CallParticipant, CallRoomState, Plan, User,
} from '../types';
import { TABLES, readTable, uid, upsert, writeTable } from '../lib/storage';
import { istDateTime } from '../lib/ist';

/* ------------------------------- Room store -------------------------------- */

interface StoredRoom extends CallRoomState {
  /** Primary key for the local table (roomId is the shareable address). */
  id: string;
  createdAt: number;
  endedAt?: number;
  recordingOwner?: string;
}

function rooms(): StoredRoom[] {
  return readTable<StoredRoom>(TABLES.CALL_ROOMS);
}

function saveRoom(room: StoredRoom): StoredRoom {
  upsert(TABLES.CALL_ROOMS, room);
  return room;
}

/** 8-character room id, e.g. "nx-4f7a-91c2" - shareable as a meeting link. */
export function newRoomId(): string {
  const part = () => Math.random().toString(36).slice(2, 6);
  return `nx-${part()}-${part()}`;
}

export function meetingLink(roomId: string): string {
  return `${window.location.origin}${window.location.pathname}#/calls/${roomId}`;
}

export function createRoom(host: User): StoredRoom {
  const room: StoredRoom = {
    id: uid('room'),
    roomId: newRoomId(),
    hostId: host.id,
    locked: false,
    allowChat: true,
    allowScreenShare: true,
    recording: false,
    participants: [],
    createdAt: Date.now(),
  };
  return saveRoom(room);
}

export function findRoom(roomId: string): StoredRoom | undefined {
  return rooms().find((r) => r.roomId === roomId);
}

export function getRoomState(roomId: string): CallRoomState | undefined {
  const room = findRoom(roomId);
  if (!room) return undefined;
  return room;
}

/* --------------------------- Participant factory --------------------------- */

export function makeParticipant(user: User, role: CallParticipant['role'] = 'host'): CallParticipant {
  return {
    id: uid('peer'),
    userId: user.id,
    name: user.name,
    avatarColor: user.avatarColor,
    role,
    isSelf: true,
    micOn: true,
    cameraOn: true,
    handRaised: false,
    screenSharing: false,
    speaking: false,
    quality: 'good',
    joinedAt: Date.now(),
    facingMode: 'user',
  };
}

/* --------------------------- Simulated peers ------------------------------- */
/* Remote participants are generated from a small directory so the roster,
 * speaking indicators, moderation controls and the participant cap can all be
 * exercised without a signalling server. */

const DIRECTORY = [
  { name: 'Neha Kulkarni', color: '#0ea5e9' },
  { name: 'Rahul Verma', color: '#22c55e' },
  { name: 'Zoya Khan', color: '#eab308' },
  { name: 'Vikram Rao', color: '#a855f7' },
  { name: 'Ananya Iyer', color: '#fb7185' },
  { name: 'Karthik Nair', color: '#14b8a6' },
  { name: 'Meera Joshi', color: '#f97316' },
  { name: 'Devansh Gupta', color: '#6366f1' },
];

export function simulatedPeer(index: number, role: CallParticipant['role'] = 'participant'): CallParticipant {
  const person = DIRECTORY[index % DIRECTORY.length];
  return {
    id: `sim-${index}-${Math.random().toString(36).slice(2, 6)}`,
    userId: `sim-user-${index}`,
    name: person.name,
    avatarColor: person.color,
    role,
    isSelf: false,
    micOn: index % 3 !== 0,
    cameraOn: index % 4 !== 0,
    handRaised: false,
    screenSharing: false,
    speaking: index % 2 === 0,
    quality: (['excellent', 'good', 'fair', 'poor'] as CallConnectionQuality[])[index % 4],
    joinedAt: Date.now(),
    facingMode: 'user',
  };
}

/** Keep one remote "speaking" at a time so the indicator looks believable. */
export function tickSpeaking(participants: CallParticipant[]): CallParticipant[] {
  const remotes = participants.filter((p) => !p.isSelf && p.micOn);
  if (remotes.length === 0) return participants;
  const talker = remotes[Math.floor(Math.random() * remotes.length)];
  return participants.map((p) =>
    p.isSelf ? p : { ...p, speaking: p.id === talker.id, quality: driftQuality(p.quality) },
  );
}

function driftQuality(current: CallConnectionQuality): CallConnectionQuality {
  const ladder: CallConnectionQuality[] = ['excellent', 'good', 'fair', 'poor'];
  const roll = Math.random();
  if (roll > 0.85) {
    const i = ladder.indexOf(current);
    return ladder[Math.max(0, Math.min(ladder.length - 1, i + (Math.random() > 0.5 ? 1 : -1)))];
  }
  return current;
}

/* ------------------------------ Permissions -------------------------------- */

export interface CallCapabilities {
  canScreenShare: boolean;
  canChat: boolean;
  canRecord: boolean;
  canModerate: boolean;
  participantLimit: number;
}

export function capabilities(plan: Plan, participant: CallParticipant, room: CallRoomState): CallCapabilities {
  const isHost = participant.role === 'host' || participant.role === 'cohost';
  return {
    canScreenShare: room.allowScreenShare || isHost,
    canChat: room.allowChat || isHost,
    canRecord: plan.id === 'gold' && isHost,
    canModerate: isHost,
    participantLimit: plan.maxCallParticipants,
  };
}

/* --------------------------------- Chat ----------------------------------- */

export function sendChatMessage(params: {
  roomId: string;
  author: CallParticipant;
  text: string;
  file?: CallChatMessage['file'];
}): CallChatMessage {
  const message: CallChatMessage = {
    id: uid('msg'),
    roomId: params.roomId,
    authorId: params.author.id,
    authorName: params.author.name,
    avatarColor: params.author.avatarColor,
    text: params.text,
    timestamp: Date.now(),
    file: params.file,
  };
  upsert(TABLES.CALL_CHAT, message);
  return message;
}

export function systemMessage(roomId: string, text: string): CallChatMessage {
  const message: CallChatMessage = {
    id: uid('msg'),
    roomId,
    authorId: 'system',
    authorName: 'NexStream',
    avatarColor: '#64748b',
    text,
    timestamp: Date.now(),
    system: true,
  };
  upsert(TABLES.CALL_CHAT, message);
  return message;
}

export function chatFor(roomId: string): CallChatMessage[] {
  return readTable<CallChatMessage>(TABLES.CALL_CHAT)
    .filter((m) => m.roomId === roomId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function clearChat(roomId: string): void {
  writeTable(
    TABLES.CALL_CHAT,
    readTable<CallChatMessage>(TABLES.CALL_CHAT).filter((m) => m.roomId !== roomId),
  );
}

/* ------------------------------ Media helpers ------------------------------ */

export interface MediaState {
  stream: MediaStream | null;
  error: string | null;
  /** What the browser actually granted - the UI reflects reality. */
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Real getUserMedia with graceful degradation:
 *   camera denied      -> audio-only call, banner explains what to enable
 *   microphone denied  -> camera-only call
 *   both denied        -> "listen-only" mode, still allowed to stay in the room
 */
export async function acquireMedia(opts: {
  video: boolean;
  audio: boolean;
  facingMode?: 'user' | 'environment';
}): Promise<MediaState> {
  const constraints: MediaStreamConstraints = { audio: opts.audio, video: opts.video ? { facingMode: opts.facingMode ?? 'user' } : false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return {
      stream,
      error: null,
      hasVideo: stream.getVideoTracks().length > 0,
      hasAudio: stream.getAudioTracks().length > 0,
    };
  } catch (err) {
    const name = (err as DOMException)?.name ?? 'Error';
    if (opts.video) {
      // Retry audio-only so a denied camera does not eject the participant.
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return {
          stream: audioOnly,
          error: `${name}: camera unavailable - joined with audio only.`,
          hasVideo: false,
          hasAudio: true,
        };
      } catch {
        /* fall through */
      }
    }
    return { stream: null, error: `${name}: microphone and camera unavailable - you joined in listen-only mode.`, hasVideo: false, hasAudio: false };
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Screen share, with the "user cancelled the picker" case handled quietly. */
export async function acquireScreenShare(): Promise<{ stream: MediaStream | null; error: string | null }> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return { stream, error: null };
  } catch (err) {
    const name = (err as DOMException)?.name ?? 'Error';
    if (name === 'NotAllowedError') return { stream: null, error: null }; // user cancelled - not an error
    return { stream: null, error: `Screen share failed: ${name}` };
  }
}

/** Background-noise suppression + adaptive bitrate, when the browser supports it. */
export function tunedAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

/** Low-bandwidth adaptation: drop video bitrate / resolution when the network dips. */
export function adaptiveVideoConstraints(quality: CallConnectionQuality): MediaTrackConstraints {
  const map: Record<CallConnectionQuality, { width: number; height: number; frameRate: number }> = {
    excellent: { width: 1280, height: 720, frameRate: 30 },
    good: { width: 960, height: 540, frameRate: 24 },
    fair: { width: 640, height: 360, frameRate: 20 },
    poor: { width: 320, height: 180, frameRate: 12 },
    connecting: { width: 640, height: 360, frameRate: 20 },
  };
  return map[quality];
}

/** Prefer the browser's own estimate of link quality when available. */
export function networkQuality(): CallConnectionQuality {
  const conn = (navigator as unknown as {
    connection?: { downlink?: number; effectiveType?: string };
  }).connection;
  if (!conn) return 'good';
  if (conn.effectiveType === '4g' && (conn.downlink ?? 0) > 5) return 'excellent';
  if (conn.effectiveType === '4g') return 'good';
  if (conn.effectiveType === '3g') return 'fair';
  return 'poor';
}

/* ------------------------------- Recording -------------------------------- */

export interface RecordingSession {
  id: string;
  roomId: string;
  hostId: string;
  startedAt: number;
  stoppedAt?: number;
  sizeBytes: number;
  label: string;
}

/**
 * Recording is simulated as a metadata lifecycle: start -> stop -> the blob is
 * "stored locally" (a download link is offered to the host only). Real capture
 * would use MediaRecorder over the composed canvas + mixed audio.
 */
export function startRecording(roomId: string, hostId: string, label: string): RecordingSession {
  const session: RecordingSession = {
    id: uid('rec'),
    roomId,
    hostId,
    startedAt: Date.now(),
    sizeBytes: 0,
    label,
  };
  upsert(TABLES.RECORDINGS, session);
  return session;
}

export function stopRecording(session: RecordingSession): RecordingSession {
  const durationS = (Date.now() - session.startedAt) / 1000;
  // ~1.1 MB per second of 720p recording, as a realistic estimate.
  const finished: RecordingSession = { ...session, stoppedAt: Date.now(), sizeBytes: Math.round(durationS * 1_100_000) };
  upsert(TABLES.RECORDINGS, finished);
  return finished;
}

export function recordings(roomId: string): RecordingSession[] {
  return readTable<RecordingSession>(TABLES.RECORDINGS)
    .filter((r) => r.roomId === roomId && Boolean(r.stoppedAt))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/* ---------------------------------- Call log ------------------------------- */

export interface CallLogEntry {
  id: string;
  roomId: string;
  hostName: string;
  startedAt: number;
  endedAt?: number;
  participants: number;
  recording: boolean;
  label: string;
}

export function logCall(entry: Omit<CallLogEntry, 'id'>): CallLogEntry {
  const row: CallLogEntry = { id: uid('calllog'), ...entry };
  upsert(TABLES.CALL_LOGS, row);
  return row;
}

export function callLog(): CallLogEntry[] {
  return readTable<CallLogEntry>(TABLES.CALL_LOGS)
    .filter((r) => Boolean((r as CallLogEntry).roomId) && Boolean((r as CallLogEntry).hostName))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
}

export { istDateTime };

/* ==========================================================================
 * ROSTER + SIGNALLING (cross-tab)
 *
 * Without a server, tabs on the same machine still need to see each other.
 * localStorage acts as the shared room table and BroadcastChannel carries the
 * low-latency chat/roster pings. Each tab heartbeats its own participant row
 * and prunes rows that stop beating, which is exactly what a real signalling
 * server does with socket liveness - so swapping this out for a socket is a
 * contained change. Remote *video* still requires WebRTC; remote tiles show
 * presence, mic/camera state and speaking status.
 * ========================================================================== */

const ROSTER_PREFIX = 'nexstream:room:';
export const HEARTBEAT_MS = 2000;
const STALE_MS = 8000;

interface RosterRow {
  roomId: string;
  peer: CallParticipant;
  beatAt: number;
}

function rosterKey(roomId: string): string {
  return `${ROSTER_PREFIX}${roomId}:roster`;
}

export function joinRoster(roomId: string, peer: CallParticipant): void {
  const rows = readRoster(roomId).filter((r) => r.peer.id !== peer.id);
  rows.push({ roomId, peer, beatAt: Date.now() });
  localStorage.setItem(rosterKey(roomId), JSON.stringify(rows));
  broadcast(roomId, { type: 'roster', peer });
}

export function heartbeat(roomId: string, peer: CallParticipant): void {
  const rows = readRoster(roomId).map((r) => (r.peer.id === peer.id ? { ...r, peer, beatAt: Date.now() } : r));
  localStorage.setItem(rosterKey(roomId), JSON.stringify(rows));
}

export function leaveRoster(roomId: string, peerId: string): void {
  const rows = readRoster(roomId).filter((r) => r.peer.id !== peerId);
  localStorage.setItem(rosterKey(roomId), JSON.stringify(rows));
  broadcast(roomId, { type: 'leave', peerId });
}

/** Live peers only - stale rows are pruned so a closed tab disappears. */
export function readRoster(roomId: string): RosterRow[] {
  try {
    const raw = localStorage.getItem(rosterKey(roomId));
    if (!raw) return [];
    const rows = JSON.parse(raw) as RosterRow[];
    const fresh = rows.filter((r) => Date.now() - r.beatAt < STALE_MS);
    if (fresh.length !== rows.length) localStorage.setItem(rosterKey(roomId), JSON.stringify(fresh));
    return fresh;
  } catch {
    return [];
  }
}

/* ------------------------- BroadcastChannel plumbing ---------------------- */

export type RoomSignal =
  | { type: 'roster'; peer: CallParticipant }
  | { type: 'leave'; peerId: string }
  | { type: 'chat'; message: CallChatMessage }
  | { type: 'moderation'; action: string; payload?: Record<string, string> }
  | { type: 'reaction'; emoji: string; from: string };

const CHANNELS: Record<string, BroadcastChannel> = {};

function channelFor(roomId: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!CHANNELS[roomId]) CHANNELS[roomId] = new BroadcastChannel(`nexstream-call-${roomId}`);
  return CHANNELS[roomId];
}

export function broadcast(roomId: string, signal: RoomSignal): void {
  channelFor(roomId)?.postMessage(signal);
}

export function listenRoom(roomId: string, handler: (signal: RoomSignal) => void): () => void {
  const channel = channelFor(roomId);
  if (!channel) return () => undefined;
  const listener = (event: MessageEvent) => handler(event.data as RoomSignal);
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}

export function closeChannel(roomId: string): void {
  CHANNELS[roomId]?.close();
  delete CHANNELS[roomId];
}
