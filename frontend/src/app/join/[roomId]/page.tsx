'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Loader2,
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  ShieldCheck,
} from 'lucide-react';
import { LiveKitSession, fetchClientToken } from '@/lib/livekit-room';

type Phase =
  | 'consent'
  | 'idle'
  | 'connecting'
  | 'live'
  | 'ended'
  | 'error'
  | 'invalid';

export default function ClientJoinPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();

  const initialName = searchParams.get('name') ?? 'Client';
  const clientId = searchParams.get('clientId') ?? '';
  const expStr = searchParams.get('exp') ?? '';
  const sig = searchParams.get('sig') ?? '';

  const linkValid = Boolean(
    clientId && expStr && sig && Number(expStr) > Math.floor(Date.now() / 1000),
  );

  const [name, setName] = useState(initialName);
  const [phase, setPhase] = useState<Phase>(linkValid ? 'consent' : 'invalid');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(
    null,
  );

  const sessionRef = useRef<LiveKitSession | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteContainerRef = useRef<HTMLDivElement | null>(null);

  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? '';

  useEffect(() => {
    return () => {
      void sessionRef.current?.disconnect();
    };
  }, []);

  // Attach the local preview once the <video> has mounted (phase === 'live').
  useEffect(() => {
    if (phase !== 'live' || !localVideoRef.current || !localStream) return;
    localVideoRef.current.srcObject = localStream;
  }, [phase, localStream]);

  // Attach the advisor's video once the remote container has mounted. The
  // onRemoteVideo callback can fire before React has committed the 'live'
  // render, so we defer the DOM work to this effect.
  useEffect(() => {
    if (phase !== 'live' || !remoteVideoEl || !remoteContainerRef.current) {
      return;
    }
    const container = remoteContainerRef.current;
    container.innerHTML = '';
    remoteVideoEl.className = 'h-full w-full object-cover rounded-lg';
    remoteVideoEl.muted = false;
    remoteVideoEl.autoplay = true;
    remoteVideoEl.playsInline = true;
    container.appendChild(remoteVideoEl);
    void remoteVideoEl.play().catch(() => {});
  }, [phase, remoteVideoEl]);

  const join = async () => {
    if (!livekitUrl) {
      setErrorMsg('LiveKit is not configured. Ask the advisor for a new link.');
      setPhase('error');
      return;
    }
    setPhase('connecting');
    setErrorMsg(null);

    try {
      const { token } = await fetchClientToken({
        roomName: roomId,
        participantName: name || 'Client',
        clientId,
        exp: Number(expStr),
        sig,
      });

      const session = new LiveKitSession();
      sessionRef.current = session;

      await session.connect(livekitUrl, token, {
        onConnected: () => {
          setLocalStream(session.getLocalPreviewStream());
          setPhase('live');
        },
        onRemoteVideo: (videoEl) => {
          setRemoteVideoEl(videoEl);
        },
        onRemoteDisconnect: () => {
          setPhase('ended');
        },
        onError: (e) => {
          setErrorMsg(e.message);
          setPhase('error');
        },
      });
    } catch (e) {
      setErrorMsg((e as Error).message);
      setPhase('error');
    }
  };

  const leave = async () => {
    await sessionRef.current?.disconnect();
    setPhase('ended');
  };

  const toggleMute = () => {
    const next = !isMuted;
    sessionRef.current?.setMicEnabled(!next);
    setIsMuted(next);
  };

  const toggleCamera = () => {
    const next = !isCameraOff;
    sessionRef.current?.setCameraEnabled(!next);
    setIsCameraOff(next);
  };

  if (phase === 'invalid') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md rounded-xl border border-red-900 bg-red-950/40 p-6 text-center">
          <h1 className="text-lg font-semibold text-red-300">
            This link isn&apos;t valid
          </h1>
          <p className="mt-2 text-sm text-red-200/70">
            It may have expired or been copied incorrectly. Please ask your
            travel advisor to send you a new one.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'consent') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600/20">
            <ShieldCheck className="h-6 w-6 text-blue-400" />
          </div>
          <h1 className="text-lg font-semibold text-white">
            Before you join
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            This call uses AI to help your travel advisor understand your
            preferences. During the call:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>
                Your audio is transcribed and analysed so the advisor can
                capture your travel preferences accurately.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>
                Occasional video frames are analysed to add context (e.g. who
                is on the call with you). Video is not recorded.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>
                You can mute, turn off video, or leave at any time. Analysis
                stops the moment you hang up.
              </span>
            </li>
          </ul>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mt-6 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setPhase('idle')}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Not right now
            </button>
            <button
              onClick={join}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
            >
              <Video className="h-4 w-4" />
              I agree, join call
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            By joining you consent to the use of your audio and video by your
            travel advisor&apos;s AI assistant for this call.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'idle') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4 text-center text-sm text-slate-400">
        You can close this tab and return later via the same link.
      </div>
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-400" />
          <p className="mt-3 text-sm text-slate-300">Connecting…</p>
        </div>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-white">Call ended</h1>
          <p className="mt-1 text-sm text-slate-400">You can close this tab.</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md rounded-xl border border-red-900 bg-red-950/40 p-6 text-center">
          <h1 className="text-lg font-semibold text-red-300">
            Couldn&apos;t connect
          </h1>
          <p className="mt-1 text-sm text-red-200/70">{errorMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      <div className="flex flex-1 items-center justify-center p-4">
        <div
          ref={remoteContainerRef}
          className="relative flex h-full w-full max-w-5xl items-center justify-center overflow-hidden rounded-2xl bg-slate-900"
        >
          <p className="text-sm text-slate-500">Waiting for advisor&apos;s video…</p>
        </div>
      </div>
      <div className="absolute bottom-6 right-6 h-32 w-44 overflow-hidden rounded-lg border-2 border-slate-700 bg-slate-900 shadow-xl">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex items-center justify-center gap-3 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <button
          onClick={toggleMute}
          className={`flex h-11 w-11 items-center justify-center rounded-full ${
            isMuted ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-200'
          }`}
          aria-label="Toggle mute"
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          onClick={toggleCamera}
          className={`flex h-11 w-11 items-center justify-center rounded-full ${
            isCameraOff ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-200'
          }`}
          aria-label="Toggle camera"
        >
          {isCameraOff ? (
            <VideoOff className="h-5 w-5" />
          ) : (
            <Video className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={leave}
          className="flex h-11 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium text-white"
        >
          <PhoneOff className="h-5 w-5" />
          Leave
        </button>
      </div>
    </div>
  );
}
