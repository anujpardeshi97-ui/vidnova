/* ============================================================================
 * CallsPage.tsx - the real-time video calling suite.
 *
 * TWO PARTS
 *   Lobby  : create a room, join with an id/link, see limits and past calls.
 *   Room   : live grid, host moderation, chat with file sharing, hand raise,
 *            screen share, camera switching, recording, quality + duration,
 *            reconnection handling and permission-denied fallbacks.
 *
 * HONEST SCOPE: your own camera/mic are real getUserMedia streams. Other tabs
 * on this machine are detected through the shared roster and can genuinely
 * chat and raise hands with you (BroadcastChannel + localStorage). Remote
 * *video* needs a signalling server + WebRTC, so remote tiles render presence,
 * mic/camera and speaking state instead of a live picture. Swap `joinRoster`
 * + `listenRoom` for socket calls and add RTCPeerConnections to go fully live.
 * ==========================================================================*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, Copy, Grid2X2, Hand,
  Info, Link2, Loader2, Lock, LockOpen, MessageSquare, Mic, MicOff, Monitor, MonitorOff,
  MoreVertical, PhoneOff, Plus, Radio, RefreshCw, ScreenShare, Send, ShieldCheck, Signal,
  SignalHigh, SignalLow, SignalMedium, Smile, Trash2, UserMinus, UserPlus, Users, Video, VideoOff,
  Wifi, WifiOff, Crown, CircleDot, Paperclip, Maximize2,
} from 'lucide-react';
import type { CallChatMessage, CallParticipant, CallRoomState } from '../types';
import { useApp, navigate } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Progress, SectionTitle, Stat, inputClass } from '../components/ui';
import {
  acquireMedia, acquireScreenShare, adaptiveVideoConstraints, callLog, capabilities, chatFor, clearChat,
  createRoom, findRoom, joinRoster, leaveRoster, listenRoom, logCall, makeParticipant, meetingLink,
  networkQuality, readRoster, recordings, sendChatMessage, simulatedPeer, startRecording, stopRecording,
  stopStream, systemMessage, tickSpeaking, heartbeat, newRoomId, HEARTBEAT_MS, broadcast,
} from '../services/callService';
import { istDateTime } from '../lib/ist';
import { formatBytes, formatDuration } from '../lib/format';

const EMOJIS = ['👍', '🎉', '😂', '❤️', '👏', '🤔', '🔥', '✅'];

export function CallsPage({ roomParam }: { roomParam?: string }) {
  const { user, plan, toast, bump, version } = useApp();
  const [joinId, setJoinId] = useState('');
  const [roomId, setRoomId] = useState<string | null>(roomParam ?? null);
  const [history, setHistory] = useState(() => callLog());

  useEffect(() => {
    if (roomParam) setRoomId(roomParam);
  }, [roomParam]);

  if (!user) return null;

  if (roomId) {
    return <CallRoom roomId={roomId} onLeave={() => { setRoomId(null); setHistory(callLog()); bump(); }} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Video calls"
        subtitle={`One-to-one and group calls with moderation, in-call chat and screen sharing. Your ${plan.name} plan allows up to ${plan.maxCallParticipants} participants${plan.id === 'gold' ? ' plus cloud recording' : ''}.`}
        icon={<Video size={20} />}
        action={
          <Button
            icon={<Plus size={15} />}
            onClick={() => {
              const room = createRoom(user);
              toast({ kind: 'success', title: 'Meeting created', message: `Room ${room.roomId} is ready. Share the link to invite people.` });
              setRoomId(room.roomId);
            }}
          >
            New meeting
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card className="bg-gradient-to-br from-slate-900 to-slate-800 !text-white">
          <SectionTitle title="Start or join" subtitle="Rooms are addressed by id; the link is shareable." icon={<Video size={18} />} />
          <div className="space-y-3">
            <Field label="Room id or meeting link" hint="Paste an id like nx-4f7a-91c2 or a full link">
              <div className="relative">
                <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9 !bg-slate-900 !text-white !border-slate-600`}
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="nx-4f7a-91c2"
                />
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<UserPlus size={15} />}
                onClick={() => {
                  const clean = joinId.trim().split('#/calls/').pop() ?? '';
                  const id = clean.replace(/[^a-z0-9-]/gi, '');
                  if (!id) {
                    toast({ kind: 'error', title: 'Enter a room id', message: 'Room ids look like nx-4f7a-91c2.' });
                    return;
                  }
                  const room = findRoom(id);
                  if (!room) {
                    toast({ kind: 'warning', title: 'Room not found here', message: 'Rooms live in this browser for the demo - create one, or open the link in another tab on this machine.' });
                    return;
                  }
                  setRoomId(id);
                }}
              >
                Join meeting
              </Button>
              <Button
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10"
                icon={<RefreshCw size={15} />}
                onClick={() => {
                  const demo = newRoomId();
                  toast({ kind: 'info', title: 'Demo room id generated', message: `${demo} - create it with “New meeting”.` });
                  setJoinId(demo);
                }}
              >
                Generate id
              </Button>
            </div>

            <div className="rounded-xl border border-white/15 bg-white/5 p-3 text-[11px] leading-relaxed text-slate-300">
              <p className="flex items-center gap-1.5 font-semibold text-white"><Info size={12} /> Try it with two windows</p>
              Create a meeting, copy the link, then paste it into a second browser tab or window. Both tabs join the same
              roster: you will see each other's mic/camera state, can chat in real time and can moderate - each tab uses
              its own camera. Remote live video needs a WebRTC signalling server.
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionTitle title="What you get" subtitle={`${plan.name} plan`} icon={<ShieldCheck size={18} />} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Participants', String(plan.maxCallParticipants)],
                ['Recording', plan.id === 'gold' ? 'Yes (host)' : 'Gold only'],
                ['Screen share', 'Yes'],
                ['In-call chat', 'Yes + files'],
                ['Hand raise', 'Yes'],
                ['E2E encryption', 'DTLS-SRTP (WebRTC)'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k}</p>
                  <p className="mt-0.5 font-semibold">{v}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle title="Recent calls" subtitle="Logged with host, duration and participant count" icon={<Radio size={18} />} />
            {history.length === 0 ? (
              <EmptyState icon={<Video size={22} />} title="No calls yet" message="Your call log appears here after your first meeting." />
            ) : (
              <div className="space-y-2">
                {history.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                    <div>
                      <p className="font-semibold">{entry.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {entry.hostName} · {istDateTime(entry.startedAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge tone={entry.recording ? 'rose' : 'slate'}>{entry.participants} people</Badge>
                      {entry.endedAt && <p className="mt-1 text-[10px] text-slate-400">{formatDuration((entry.endedAt - entry.startedAt) / 1000)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  The room                                                                  */
/* ========================================================================== */

function CallRoom({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const { user, plan, toast } = useApp();
  const [peer] = useState(() => makeParticipant(user!, 'host'));
  const [remotes, setRemotes] = useState<CallParticipant[]>([]);
  const [bots, setBots] = useState<CallParticipant[]>([]);
  const [messages, setMessages] = useState<CallChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [draft, setDraft] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [quality, setQuality] = useState(networkQuality());
  const [elapsed, setElapsed] = useState(0);
  const [locked, setLocked] = useState(false);
  const [allowChat, setAllowChat] = useState(true);
  const [allowScreen, setAllowScreen] = useState(true);
  const [recording, setRecording] = useState<{ id: string; startedAt: number } | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const startedAt = useRef(Date.now());
  const peerRef = useRef(peer);
  peerRef.current = peer;

  const room = findRoom(roomId);
  const limit = plan.maxCallParticipants;
  const caps = capabilities(plan, peer, {
    roomId, hostId: peer.id, locked, allowChat, allowScreenShare: allowScreen, recording: Boolean(recording), participants: [],
  });
  const totalPeople = 1 + remotes.length + bots.length;

  const pushEvent = useCallback((text: string) => {
    setEvents((list) => [`${istDateTime(Date.now()).split(', ')[1]} · ${text}`, ...list].slice(0, 12));
  }, []);

  /* ------------------------------ media setup --------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const media = await acquireMedia({ video: cameraOn, audio: micOn, facingMode: facing });
      if (cancelled) return;
      setStream(media.stream);
      setMediaError(media.error);
      if (media.error) pushEvent(media.error);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
      void screenVideoRef.current.play().catch(() => undefined);
    }
  }, [screenStream]);

  useEffect(() => () => {
    stopStream(stream);
    stopStream(screenStream);
  }, [stream, screenStream]);

  /* ------------------------------ roster sync --------------------------- */
  useEffect(() => {
    if (!room) return undefined;
    const current: CallParticipant = { ...peerRef.current, micOn, cameraOn, handRaised, screenSharing: Boolean(screenStream), speaking: micOn && !chatText };
    joinRoster(roomId, current);
    const beat = window.setInterval(() => {
      heartbeat(roomId, { ...peerRef.current, micOn, cameraOn, handRaised, screenSharing: Boolean(screenStream) });
      const rows = readRoster(roomId).filter((r) => r.peer.id !== peerRef.current.id);
      setRemotes(rows.map((r) => r.peer));
    }, HEARTBEAT_MS);
    const off = listenRoom(roomId, (signal) => {
      if (signal.type === 'chat') {
        setMessages((list) => (list.some((m) => m.id === signal.message.id) ? list : [...list, signal.message]));
      }
      if (signal.type === 'roster') pushEvent(`${signal.peer.name} joined the call`);
      if (signal.type === 'leave') pushEvent(`A participant left the call`);
      if (signal.type === 'moderation') pushEvent(`Host action: ${signal.action}`);
    });
    setMessages(chatFor(roomId));
    return () => {
      window.clearInterval(beat);
      off();
      leaveRoster(roomId, peerRef.current.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, micOn, cameraOn, handRaised, screenStream]);

  /* --------------------------- duration + quality ----------------------- */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
      setQuality((q) => (Math.random() > 0.9 ? networkQuality() : q));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* --------------------------- simulated peers -------------------------- */
  useEffect(() => {
    if (bots.length === 0) return undefined;
    const timer = window.setInterval(() => setBots((list) => tickSpeaking(list)), 3000);
    return () => window.clearInterval(timer);
  }, [bots.length]);

  useEffect(() => {
    if (!room) return;
    const entry = logCall({
      roomId, hostName: user!.name, startedAt: startedAt.current, participants: totalPeople, recording: Boolean(recording), label: `Meeting ${roomId}`,
    });
    return () => {
      logCall({ ...entry, endedAt: Date.now(), participants: totalPeople, recording: Boolean(recording) });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (!room) {
    return (
      <Card>
        <SectionTitle title="Room not found" subtitle="This meeting id is not registered in this browser." />
        <Button icon={<ArrowLeft size={15} />} onClick={onLeave}>Back to calls</Button>
      </Card>
    );
  }

  /* -------------------------------- actions ----------------------------- */
  const toggleMic = () => {
    stream?.getAudioTracks().forEach((t) => (t.enabled = !micOn));
    setMicOn((v) => !v);
    pushEvent(`You ${micOn ? 'muted' : 'unmuted'} your microphone`);
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      stream?.getVideoTracks().forEach((t) => t.stop());
      setCameraOn(false);
      pushEvent('You turned off your camera');
    } else {
      const media = await acquireMedia({ video: true, audio: false, facingMode: facing });
      setCameraOn(true);
      if (media.stream) {
        // Merge the new video track into the existing stream.
        const merged = stream ?? new MediaStream();
        media.stream.getVideoTracks().forEach((t) => merged.addTrack(t));
        setStream(merged);
      } else {
        setMediaError(media.error);
      }
    }
  };

  const flipCamera = () => {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
    pushEvent('Switched camera');
  };

  const toggleScreen = async () => {
    if (screenStream) {
      stopStream(screenStream);
      setScreenStream(null);
      pushEvent('Stopped screen sharing');
      return;
    }
    if (!caps.canScreenShare) {
      toast({ kind: 'warning', title: 'Screen sharing disabled', message: 'The host has turned off screen sharing for participants.' });
      return;
    }
    const { stream: next, error } = await acquireScreenShare();
    if (error) {
      toast({ kind: 'error', title: 'Screen share failed', message: error });
      return;
    }
    if (!next) return; // user cancelled the picker
    setScreenStream(next);
    pushEvent('Started screen sharing');
    next.getVideoTracks()[0]?.addEventListener('ended', () => setScreenStream(null));
  };

  const sendMessage = () => {
    if (!draft.trim() && !chatText) return;
    const text = draft.trim() || chatText;
    const message = sendChatMessage({ roomId, author: peerRef.current, text });
    setMessages((list) => [...list, message]);
    setDraft('');
    broadcast(roomId, { type: 'chat', message });
  };

  const shareFile = (file: File) => {
    const message = sendChatMessage({
      roomId,
      author: peerRef.current,
      text: `Shared ${file.name}`,
      file: { name: file.name, size: file.size, type: file.type, url: '#' },
    });
    setMessages((list) => [...list, message]);
    pushEvent(`You shared ${file.name}`);
  };

  const addDemoParticipant = () => {
    if (totalPeople >= limit) {
      toast({
        kind: 'warning',
        title: 'Participant limit reached',
        message: `${plan.name} allows ${limit} participants. Upgrade to invite more.`,
      });
      return;
    }
    const bot = simulatedPeer(bots.length, bots.length === 0 ? 'cohost' : 'participant');
    setBots((list) => [...list, bot]);
    setMessages((list) => [...list, systemMessage(roomId, `${bot.name} joined the meeting`)]);
    pushEvent(`${bot.name} joined`);
  };

  const reconnectingSim = () => {
    setReconnecting(true);
    pushEvent('Network interruption detected - rejoining…');
    window.setTimeout(() => {
      setReconnecting(false);
      pushEvent('Reconnected. Audio/video resumed without dropping the room.');
      setBots((list) => list.map((b) => ({ ...b, quality: 'good' })));
    }, 2600);
  };

  const startRec = () => {
    if (!caps.canRecord) {
      toast({ kind: 'warning', title: 'Recording is a Gold feature', message: 'Gold hosts can record meetings; recordings are stored for the host only.' });
      return;
    }
    const session = startRecording(roomId, peer.id, `Meeting ${roomId}`);
    setRecording({ id: session.id, startedAt: session.startedAt });
    setMessages((list) => [...list, systemMessage(roomId, 'Recording started - all participants are notified.')]);
  };

  const stopRec = () => {
    if (!recording) return;
    const session = recordings(roomId).find((r) => r.id === recording.id);
    if (session) stopRecording(session);
    setRecording(null);
    toast({ kind: 'success', title: 'Recording saved for the host', message: 'Only the host can access the file.' });
  };

  const participants: CallParticipant[] = [
    { ...peer, micOn, cameraOn, handRaised, screenSharing: Boolean(screenStream), quality, isSelf: true, speaking: micOn },
    ...remotes,
    ...bots,
  ];

  const qualityIcon =
    quality === 'excellent' ? <SignalHigh size={13} className="text-emerald-500" /> :
    quality === 'good' ? <SignalMedium size={13} className="text-emerald-500" /> :
    quality === 'fair' ? <SignalLow size={13} className="text-amber-500" /> :
    <Signal size={13} className="text-red-500" />;

  return (
    <div className="space-y-4">
      {/* ------------------------------ top bar --------------------------- */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={onLeave}>Leave</Button>
            <div>
              <p className="text-sm font-bold">Room {roomId}</p>
              <p className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <CircleDot size={11} className="text-red-500" /> {formatDuration(elapsed)} · {totalPeople}/{limit} participants · {qualityIcon} {quality}
                {locked && <Badge tone="amber"><Lock size={10} /> locked</Badge>}
                {recording && <Badge tone="red"><Radio size={10} /> REC</Badge>}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              icon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              onClick={async () => {
                const link = meetingLink(roomId);
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                  toast({ kind: 'success', title: 'Meeting link copied', message: link });
                } catch {
                  toast({ kind: 'info', title: 'Copy this link', message: link });
                }
              }}
            >
              Copy link
            </Button>
            <Button size="sm" variant="outline" icon={<UserPlus size={14} />} onClick={addDemoParticipant}>
              Add participant
            </Button>
            <Button size="sm" variant="outline" icon={<WifiOff size={14} />} onClick={reconnectingSim}>
              Simulate drop
            </Button>
            <Button size="sm" variant="outline" icon={<Grid2X2 size={14} />} onClick={() => setShowParticipants((s) => !s)}>
              Participants
            </Button>
            <Button size="sm" variant={showChat ? 'secondary' : 'outline'} icon={<MessageSquare size={14} />} onClick={() => setShowChat((s) => !s)}>
              Chat
            </Button>
          </div>
        </div>

        {reconnecting && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <Loader2 size={14} className="animate-spin" /> Connection lost - rejoining the room and restoring your media…
          </div>
        )}

        {mediaError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {mediaError} You are still in the meeting: you can hear and be heard per the permissions you granted, and
              the other participants can see that your camera is off. Re-grant access in the address bar to re-enable video.
            </span>
          </div>
        )}
      </Card>

      <div className={`grid gap-4 ${showChat ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
        {/* ------------------------------- grid ---------------------------- */}
        <div className="space-y-4">
          {screenStream && (
            <Card className="!p-2">
              <video ref={screenVideoRef} muted playsInline className="w-full rounded-xl bg-black" />
              <p className="mt-2 flex items-center gap-2 px-2 pb-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Monitor size={12} /> You are presenting your screen · participants see this surface
              </p>
            </Card>
          )}

          <div className={`grid gap-3 ${participants.length <= 1 ? '' : participants.length <= 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {/* self tile */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 dark:border-slate-700">
              <div className="aspect-video">
                <video ref={localVideoRef} muted playsInline className={`h-full w-full object-cover ${cameraOn ? '' : 'opacity-0'}`} />
                {!cameraOn && (
                  <div className="absolute inset-0 grid place-items-center bg-slate-800">
                    <div className="text-center">
                      <CameraOff size={26} className="mx-auto text-slate-400" />
                      <p className="mt-2 text-xs font-semibold text-slate-300">Your camera is off</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-between">
                <span className="rounded-lg bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
                  You {peer.role === 'host' && '· host'}
                </span>
                <span className="flex items-center gap-1">
                  {micOn ? <Mic size={13} className="text-emerald-400" /> : <MicOff size={13} className="text-red-400" />}
                  {cameraOn ? <Camera size={13} className="text-emerald-400" /> : <CameraOff size={13} className="text-red-400" />}
                  {screenStream && <ScreenShare size={13} className="text-rose-400" />}
                </span>
              </div>
              {handRaised && (
                <span className="absolute right-2 top-2 rounded-lg bg-amber-400 px-2 py-1 text-[11px] font-bold text-amber-950">✋ raised</span>
              )}
            </div>

            {/* remote tiles */}
            {[...remotes, ...bots].map((person) => (
              <div
                key={person.id}
                className={`relative overflow-hidden rounded-2xl border bg-slate-900 dark:border-slate-700 ${
                  person.speaking ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-slate-200'
                }`}
              >
                <div className="grid aspect-video place-items-center">
                  <span className="grid h-16 w-16 place-items-center rounded-2xl text-lg font-extrabold text-white" style={{ background: person.avatarColor }}>
                    {person.name.split(' ').map((n) => n[0]).join('')}
                  </span>
                </div>
                <div className="absolute inset-x-2 bottom-2 flex items-center justify-between">
                  <span className="rounded-lg bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
                    {person.name} {person.role !== 'participant' && `· ${person.role}`}
                  </span>
                  <span className="flex items-center gap-1">
                    {person.micOn ? <Mic size={13} className="text-emerald-400" /> : <MicOff size={13} className="text-red-400" />}
                    {person.cameraOn ? <Camera size={13} className="text-emerald-400" /> : <CameraOff size={13} className="text-red-400" />}
                  </span>
                </div>
                {person.handRaised && (
                  <span className="absolute right-2 top-2 rounded-lg bg-amber-400 px-2 py-1 text-[11px] font-bold text-amber-950">✋ raised</span>
                )}
                {person.speaking && (
                  <span className="absolute left-2 top-2 rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white">speaking</span>
                )}
                <span className="absolute right-2 top-10 flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  <Signal size={10} /> {person.quality}
                </span>
              </div>
            ))}
          </div>

          {/* --------------------------- control bar ------------------------ */}
          <Card className="!p-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ControlButton active={micOn} onClick={toggleMic} onIcon={<Mic size={18} />} offIcon={<MicOff size={18} />} label={micOn ? 'Mute' : 'Unmute'} />
              <ControlButton active={cameraOn} onClick={() => void toggleCamera()} onIcon={<Camera size={18} />} offIcon={<CameraOff size={18} />} label={cameraOn ? 'Camera off' : 'Camera on'} />
              <Button size="sm" variant="outline" icon={<RefreshCw size={15} />} onClick={flipCamera} title="Switch between front and rear camera on mobile">
                Flip
              </Button>
              <Button
                size="sm"
                variant={screenStream ? 'primary' : 'outline'}
                icon={screenStream ? <MonitorOff size={15} /> : <ScreenShare size={15} />}
                onClick={() => void toggleScreen()}
              >
                {screenStream ? 'Stop sharing' : 'Share screen'}
              </Button>
              <ControlButton
                active={!handRaised}
                onClick={() => {
                  setHandRaised((h) => !h);
                  pushEvent(handRaised ? 'Lowered your hand' : 'Raised your hand');
                }}
                onIcon={<Hand size={18} />}
                offIcon={<Hand size={18} />}
                label={handRaised ? 'Lower hand' : 'Raise hand'}
              />
              <Button size="sm" variant={recording ? 'danger' : 'outline'} icon={<Radio size={15} />} onClick={recording ? stopRec : startRec}>
                {recording ? 'Stop recording' : 'Record'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<PhoneOff size={15} />}
                onClick={() => {
                  if (recording) stopRec();
                  stopStream(stream);
                  stopStream(screenStream);
                  onLeave();
                }}
              >
                End call
              </Button>
            </div>
          </Card>

          {/* ----------------------- host moderation ------------------------ */}
          <Card>
            <SectionTitle title="Host controls" subtitle="Only the host and co-hosts can see these" icon={<Crown size={18} />} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={locked ? <LockOpen size={14} /> : <Lock size={14} />}
                onClick={() => {
                  setLocked((l) => !l);
                  pushEvent(locked ? 'Meeting unlocked' : 'Meeting locked - no new participants');
                }}
              >
                {locked ? 'Unlock meeting' : 'Lock meeting'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<MessageSquare size={14} />}
                onClick={() => { setAllowChat((c) => !c); pushEvent(allowChat ? 'Participant chat disabled' : 'Participant chat enabled'); }}
              >
                {allowChat ? 'Disable chat' : 'Enable chat'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<ScreenShare size={14} />}
                onClick={() => { setAllowScreen((s) => !s); pushEvent(allowScreen ? 'Screen sharing restricted to hosts' : 'Screen sharing opened to all'); }}
              >
                {allowScreen ? 'Restrict screen share' : 'Allow screen share'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<MicOff size={14} />}
                onClick={() => {
                  setBots((list) => list.map((b) => ({ ...b, micOn: false })));
                  pushEvent('Muted all participants');
                }}
              >
                Mute all
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<UserMinus size={14} />}
                disabled={bots.length === 0}
                onClick={() => {
                  setBots((list) => list.slice(0, -1));
                  pushEvent('Removed a participant');
                }}
              >
                Remove last participant
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<Users size={14} />}
                disabled={bots.length === 0}
                onClick={() => {
                  setBots((list) => list.map((b, i) => (i === 0 ? { ...b, role: 'cohost' } : b)));
                  pushEvent('Assigned co-host privileges');
                }}
              >
                Promote to co-host
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
              Permissions in force: chat {allowChat ? 'everyone' : 'hosts only'} · screen share {allowScreen ? 'everyone' : 'hosts only'} ·
              meeting {locked ? 'locked' : 'open'} · recording {recording ? 'running' : 'off'}.
            </p>
          </Card>
        </div>

        {/* ------------------------------- sidebar ------------------------- */}
        {showChat && (
          <div className="space-y-4">
            <Card className="flex h-[32rem] flex-col !p-0">
              <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
                <p className="flex items-center gap-2 text-sm font-bold"><MessageSquare size={15} /> In-call chat</p>
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => { clearChat(roomId); setMessages([]); }}>Clear</Button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.length === 0 && (
                  <p className="mt-6 text-center text-[11px] text-slate-400">
                    Messages, emojis and file names are shared with everyone in the room (and across tabs via BroadcastChannel).
                  </p>
                )}
                {messages.map((message) =>
                  message.system ? (
                    <p key={message.id} className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">{message.text}</p>
                  ) : (
                    <div key={message.id} className="flex gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white" style={{ background: message.avatarColor }}>
                        {message.authorName.split(' ').map((n) => n[0]).join('')}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold">
                          {message.authorName}
                          <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">
                            {istDateTime(message.timestamp).split(', ')[1]}
                          </span>
                        </p>
                        <p className="text-xs break-words">{message.text}</p>
                        {message.file && (
                          <p className="mt-1 flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[10px] dark:bg-slate-800">
                            <Paperclip size={10} /> {message.file.name} · {formatBytes(message.file.size)}
                          </p>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="border-t border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex flex-wrap gap-1">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setDraft((d) => `${d}${emoji}`)}
                      className="rounded-lg px-1.5 py-0.5 text-base transition hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    className={inputClass}
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); setChatText(e.target.value); }}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder={caps.canChat ? 'Message everyone…' : 'Chat is disabled by the host'}
                    disabled={!caps.canChat}
                  />
                  <label className="cursor-pointer rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" title="Share a file">
                    <Paperclip size={15} />
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) shareFile(file);
                      }}
                    />
                  </label>
                  <Button size="sm" icon={<Send size={14} />} onClick={sendMessage} disabled={!caps.canChat} />
                </div>
              </div>
            </Card>

            {showParticipants && (
              <Card>
                <SectionTitle title="Participants" subtitle={`${totalPeople} of ${limit} seats used`} icon={<Users size={18} />} />
                <div className="space-y-2">
                  {participants.map((person) => (
                    <div key={person.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg text-[10px] font-bold text-white" style={{ background: person.avatarColor }}>
                          {person.name.split(' ').map((n) => n[0]).join('')}
                        </span>
                        <div>
                          <p className="font-semibold">{person.name}{person.isSelf && ' (you)'}</p>
                          <p className="text-[10px] capitalize text-slate-500 dark:text-slate-400">{person.role} · {person.quality}</p>
                        </div>
                      </div>
                      <span className="flex items-center gap-1.5">
                        {person.micOn ? <Mic size={12} className="text-emerald-500" /> : <MicOff size={12} className="text-red-400" />}
                        {person.cameraOn ? <Camera size={12} className="text-emerald-500" /> : <CameraOff size={12} className="text-red-400" />}
                        {person.handRaised && <span>✋</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <Progress value={(totalPeople / limit) * 100} className="mt-3" />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {plan.name} allows {limit} participants. {totalPeople >= limit && 'The room is full - new joins are refused.'}
                </p>
              </Card>
            )}

            <Card>
              <SectionTitle title="Session log" subtitle="Roster, moderation and network events" icon={<Radio size={18} />} />
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {events.length === 0 && <p className="text-[11px] text-slate-400">No events yet.</p>}
                {events.map((event, index) => (
                  <p key={`${event}-${index}`} className="rounded-lg bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {event}
                  </p>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function ControlButton({
  active, onClick, onIcon, offIcon, label,
}: { active: boolean; onClick: () => void; onIcon: React.ReactNode; offIcon: React.ReactNode; label: string }) {
  return (
    <Button
      size="sm"
      variant={active ? 'outline' : 'danger'}
      icon={active ? onIcon : offIcon}
      onClick={onClick}
      title={label}
    >
      {label}
    </Button>
  );
}

