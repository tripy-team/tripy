'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Video, Wifi, WifiOff } from 'lucide-react';
import CallControls from './CallControls';
import LiveTranscript from './LiveTranscript';
import LiveExtractions from './LiveExtractions';
import ReactiveQuestions from './ReactiveQuestions';
import PostCallReview from './PostCallReview';
import ProfileDelta from './ProfileDelta';
import type { ReactiveQuestionWithMeta } from './ReactiveQuestions';
import { AudioCapturePipeline, RemoteAudioCapture } from '@/lib/audio-capture';
import { CactusWSClient } from '@/lib/cactus-ws';
import type {
  TranscriptChunk,
  ProfileExtraction,
  ReactiveQuestion,
  FinalEvent,
} from '@/lib/cactus-ws';
import { VideoFrameCapture } from '@/lib/video-frame-capture';
import {
  LiveKitSession,
  buildJoinUrl,
  buildRoomName,
  fetchAdvisorToken,
} from '@/lib/livekit-room';
import { startLiveCall } from '@/lib/live-call-api';
import { createMeetingInvitation } from '@/lib/api-client';

// Parakeet hallucinates filler words during silence and quiet audio. The
// backend attaches the recent peak audio RMS to each chunk; we hide filler-
// only chunks decoded from sub-speech-level audio. Real client answers
// ("yeah") come with speech-level RMS and still pass through.
const FILLER_SPEECH_RMS_THRESHOLD = 2500;
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'yeah', 'yep', 'yup', 'ya',
  'uh', 'uhh', 'um', 'umm', 'er', 'erm',
  'hmm', 'hm', 'mm', 'mmm', 'mhm', 'mmhmm', 'uhhuh',
  'ok', 'okay', 'k',
  'oh', 'ah', 'hi', 'hello', 'bye', 'thanks',
]);

function normalizeFiller(text: string): string | null {
  const cleaned = text.trim().replace(/[.,!?;:\-]/g, '').toLowerCase();
  return FILLER_WORDS.has(cleaned) ? cleaned : null;
}

function isPhantomFiller(chunk: TranscriptChunk): boolean {
  if (!normalizeFiller(chunk.text)) return false;
  if (chunk.recentPeakRms === undefined) return false;
  return chunk.recentPeakRms < FILLER_SPEECH_RMS_THRESHOLD;
}

export interface LiveCallConfig {
  clientId: string;
  meetingId: string;
  clientName: string;
  existingPreferences: Record<string, unknown>;
  cactusWsUrl: string;
  tripContext?: {
    destinations: string;
    travelDates: string;
    travelerNames: string;
    status: string;
  } | null;
}

type CallPhase = 'setup' | 'connecting' | 'active' | 'ended';
type LivePanel = 'transcript' | 'extractions' | 'questions';

interface LiveCallViewProps {
  config: LiveCallConfig;
  onCallEnd: (finalData: FinalEvent) => void;
  onCommitSuggestions: (suggestions: FinalEvent['commitReady']) => Promise<void>;
}

export default function LiveCallView({
  config,
  onCallEnd,
  onCommitSuggestions,
}: LiveCallViewProps) {
  const [phase, setPhase] = useState<CallPhase>('setup');
  const [activePanel, setActivePanel] = useState<LivePanel>('questions');

  // Media
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);

  // Cactus data
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [partial, setPartial] = useState<{ speaker: TranscriptChunk['speaker']; text: string } | null>(null);
  const [extractions, setExtractions] = useState<ProfileExtraction[]>([]);
  const [questions, setQuestions] = useState<ReactiveQuestionWithMeta[]>([]);
  const [contradictions, setContradictions] = useState<FinalEvent['contradictions']>([]);
  const [finalData, setFinalData] = useState<FinalEvent | null>(null);
  const [cactusStatus, setCactusStatus] = useState<string>('disconnected');

  // Refs for cleanup
  const cactusClientRef = useRef<CactusWSClient | null>(null);
  const localCaptureRef = useRef<AudioCapturePipeline | null>(null);
  const remoteCaptureRef = useRef<AudioCapturePipeline | null>(null);
  const videoFrameCaptureRef = useRef<VideoFrameCapture | null>(null);
  const livekitSessionRef = useRef<LiveKitSession | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Shared AudioContext, created synchronously in the startCall click handler
  // so it inherits the user-gesture activation required to leave 'suspended'
  // state. Reused across local + remote capture pipelines.
  const audioContextRef = useRef<AudioContext | null>(null);

  // Gemma 4 vision
  const [visualInsight, setVisualInsight] = useState<string | null>(null);

  // LiveKit
  const [joinLink, setJoinLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  const roomNameRef = useRef<string>(
    buildRoomName(config.clientId, config.meetingId),
  );

  // New question/extraction toast
  const [newQuestionCount, setNewQuestionCount] = useState<number | null>(null);
  const [newExtractionCount, setNewExtractionCount] = useState<number | null>(null);

  useEffect(() => {
    if (newQuestionCount !== null) {
      const t = setTimeout(() => setNewQuestionCount(null), 4000);
      return () => clearTimeout(t);
    }
  }, [newQuestionCount]);

  useEffect(() => {
    if (newExtractionCount !== null) {
      const t = setTimeout(() => setNewExtractionCount(null), 4000);
      return () => clearTimeout(t);
    }
  }, [newExtractionCount]);

  // Duration timer
  useEffect(() => {
    if (phase === 'active') {
      durationIntervalRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [phase]);

  // Attach local preview once the <video> has mounted. The element is only
  // rendered in the active phase, so we can't set srcObject from the
  // LiveKit onConnected callback directly — the ref would still be null.
  useEffect(() => {
    if (phase !== 'active' || !localVideoRef.current || !localStream) return;
    localVideoRef.current.srcObject = localStream;
  }, [phase, localStream]);

  // Attach the client's remote video once the <video> mounts (hasRemoteVideo
  // flips the conditional render).
  useEffect(() => {
    if (!hasRemoteVideo || !remoteVideoRef.current || !remoteStream) return;
    remoteVideoRef.current.srcObject = remoteStream;
    void remoteVideoRef.current.play().catch(() => {});
  }, [hasRemoteVideo, remoteStream]);

  // If the user clicks End Call before Cactus emits its final event, endCall's
  // closure captured finalData=null and the parent was never notified. Once
  // finalData lands, call onCallEnd so the transcript/suggestions get persisted.
  const notifiedEndRef = useRef(false);
  useEffect(() => {
    if (phase === 'ended' && finalData && !notifiedEndRef.current) {
      notifiedEndRef.current = true;
      onCallEnd(finalData);
    }
  }, [phase, finalData, onCallEnd]);

  const startCall = useCallback(async () => {
    console.log('[LiveCallView] Start Call clicked');
    // Create + prime the AudioContext synchronously here, while the click
    // gesture activation is still live. Doing this later (after awaits) can
    // leave the context in 'suspended' state with no way to resume, which
    // silently drops all captured audio.
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }
    console.log(
      `[LiveCallView] AudioContext created, state=${audioContextRef.current.state}, sampleRate=${audioContextRef.current.sampleRate}`,
    );
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current
        .resume()
        .then(() =>
          console.log(
            `[LiveCallView] AudioContext resumed, state=${audioContextRef.current?.state}`,
          ),
        )
        .catch((e) => console.error('[LiveCallView] resume failed', e));
    }

    setPhase('connecting');

    try {
      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl) {
        throw new Error(
          'NEXT_PUBLIC_LIVEKIT_URL is not set. Check frontend/.env.local',
        );
      }

      // 1. Persist the session row so transcript chunks can be saved later
      try {
        await startLiveCall(config.clientId, config.meetingId);
      } catch (e) {
        console.warn('[LiveCallView] startLiveCall failed; continuing', e);
      }

      // 2. Mint LiveKit token (auth'd, verifies advisor owns the client)
      const roomName = roomNameRef.current;
      const { token, joinLink: signedParts } = await fetchAdvisorToken({
        roomName,
        participantName: 'Advisor',
        clientId: config.clientId,
      });

      // 3. Generate a signed shareable link for the client (shown in the UI below)
      setJoinLink(buildJoinUrl(roomName, config.clientName, signedParts));

      // 4. Connect to the Cactus WS up front so it's ready when remote audio
      //    starts flowing. Remote audio (the client's voice) is piped in, not
      //    the advisor's mic.
      const cactusClient = new CactusWSClient({
        url: config.cactusWsUrl,
        clientName: config.clientName,
        existingPreferences: config.existingPreferences,
        tripContext: config.tripContext,
        onTranscript: (chunk) => {
          if (isPhantomFiller(chunk)) {
            console.log('[transcript] hide phantom filler', chunk.text, 'rms=', chunk.recentPeakRms);
            return;
          }
          setTranscript((prev) => [...prev, chunk]);
          // Clear any stale partial for this speaker — the decoder just
          // confirmed text, so what was pending has been absorbed.
          setPartial((cur) => (cur && cur.speaker === chunk.speaker ? null : cur));
        },
        onPartial: (p) => {
          setPartial(p.text ? { speaker: p.speaker, text: p.text } : null);
        },
        onExtraction: (exts) => {
          setExtractions((prev) => [...prev, ...exts]);
          setContradictions([]);
          setNewExtractionCount(exts.length);
        },
        onQuestions: (qs) => {
          const withMeta: ReactiveQuestionWithMeta[] = qs.map((q) => ({
            ...q,
            isNew: true,
            timestamp: Date.now(),
          }));
          setQuestions((prev) => [
            ...withMeta,
            ...prev.map((p) => ({ ...p, isNew: false })),
          ]);
          setNewQuestionCount(qs.length);
        },
        onFinal: (data) => {
          setFinalData(data);
          setContradictions(data.contradictions);
        },
        onStatus: (status) => {
          setCactusStatus(status);
          if (status === 'ready') {
            setPhase('active');
          }
        },
        onVisualInsight: (insight) => {
          setVisualInsight(insight);
        },
        onError: (err) => {
          console.error('Cactus WS error:', err);
          setCactusStatus('error');
        },
        onClose: () => {
          setCactusStatus('disconnected');
        },
      });

      cactusClient.connect();
      cactusClientRef.current = cactusClient;

      // 5. Join the LiveKit room — publishes advisor's mic+camera and sets up
      //    handlers for when the client's tracks arrive.
      const lkSession = new LiveKitSession();
      livekitSessionRef.current = lkSession;

      await lkSession.connect(livekitUrl, token, {
        onConnected: () => {
          const localPreview = lkSession.getLocalPreviewStream();
          if (localPreview) {
            setLocalStream(localPreview);

            // Pipe the advisor's own mic into Cactus so their side of the
            // conversation gets transcribed too. AudioContext ignores video
            // tracks on the stream, so reusing the preview stream is fine.
            console.log(
              `[LiveCallView] onConnected — cactusSocket=${!!cactusClient.socket} (readyState=${cactusClient.socket?.readyState}), existingLocalCapture=${!!localCaptureRef.current}`,
            );
            if (cactusClient.socket && !localCaptureRef.current) {
              const localCapture = new AudioCapturePipeline('local');
              void localCapture
                .start(
                  localPreview,
                  () => cactusClient.socket,
                  audioContextRef.current ?? undefined,
                )
                .catch((e) =>
                  console.error('[LiveCallView] local capture start failed', e),
                );
              localCaptureRef.current = localCapture;
            } else if (!cactusClient.socket) {
              console.warn(
                '[LiveCallView] Cactus socket not available — advisor audio will not be transcribed',
              );
            }
          }
        },
        onRemoteAudio: (remoteAudioStream) => {
          // This is the CLIENT's voice — pipe straight into Gemma 4
          if (!cactusClient.socket) return;
          if (remoteCaptureRef.current) {
            remoteCaptureRef.current.stop();
          }
          const capture = new AudioCapturePipeline('remote');
          void capture.start(
            remoteAudioStream,
            () => cactusClient.socket,
            audioContextRef.current ?? undefined,
          );
          remoteCaptureRef.current = capture;
        },
        onRemoteVideo: (videoEl) => {
          // The <video> in the tile renders conditionally on hasRemoteVideo,
          // so remoteVideoRef.current is null at this moment. Stash the stream
          // in state and let a useEffect attach it after the element mounts.
          const stream = videoEl.srcObject as MediaStream | null;
          setRemoteStream(stream);
          setHasRemoteVideo(true);

          // Start Gemma 4 vision frame capture on the CLIENT's video. The
          // detached videoEl from LiveKit already has the track attached, so
          // it's fine to pass it directly.
          if (videoFrameCaptureRef.current) {
            videoFrameCaptureRef.current.stop();
          }
          const frameCapture = new VideoFrameCapture(
            videoEl,
            (dataUrl) => cactusClient.sendVideoFrame(dataUrl),
            { intervalMs: 5000, maxWidth: 512, quality: 0.7 },
          );
          frameCapture.start();
          videoFrameCaptureRef.current = frameCapture;
        },
        onRemoteDisconnect: () => {
          setHasRemoteVideo(false);
          setRemoteStream(null);
          remoteCaptureRef.current?.stop();
          remoteCaptureRef.current = null;
          videoFrameCaptureRef.current?.stop();
          videoFrameCaptureRef.current = null;
        },
        onError: (err) => {
          console.error('LiveKit error:', err);
        },
      });
    } catch (err) {
      console.error('Failed to start call:', err);
      setPhase('setup');
    }
  }, [config]);

  const endCall = useCallback(() => {
    remoteCaptureRef.current?.stop();
    remoteCaptureRef.current = null;
    localCaptureRef.current?.stop();
    localCaptureRef.current = null;
    videoFrameCaptureRef.current?.stop();
    videoFrameCaptureRef.current = null;

    cactusClientRef.current?.sendStop();

    void livekitSessionRef.current?.disconnect();
    livekitSessionRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }

    // Detach streams from the <video> elements so the browser stops rendering
    // the (now-dead) frames. LiveKit's disconnect() stops the tracks but the
    // srcObject reference can keep the last frame pinned on screen.
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setRemoteStream(null);
    setHasRemoteVideo(false);

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Persistence (POST /live/stop) is owned by the parent's onCallEnd
    // handler so it can await the request and then refresh the meeting view.
    setPhase('ended');
    if (finalData) {
      notifiedEndRef.current = true;
      onCallEnd(finalData);
      return;
    }

    // If Cactus hasn't emitted its 'final' event yet, wait briefly for it —
    // that event carries the commitReady suggestions and contradictions the
    // stop endpoint needs. If it never arrives (socket dead, server
    // unreachable), synthesize a best-effort FinalEvent from local state so
    // the parent's onCallEnd still fires and the user lands back on the
    // client page. Otherwise they get stuck on the "Finalizing…" screen.
    setTimeout(() => {
      if (notifiedEndRef.current) return;
      notifiedEndRef.current = true;
      onCallEnd({
        type: 'final',
        transcript,
        learned: {},
        confidenceMap: {},
        evidenceMap: {},
        contradictions: contradictions ?? [],
        commitReady: [],
      });
    }, 3000);
  }, [localStream, finalData, onCallEnd, transcript, contradictions]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    livekitSessionRef.current?.setMicEnabled(!next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const next = !isCameraOff;
    livekitSessionRef.current?.setCameraEnabled(!next);
    setIsCameraOff(next);
  }, [isCameraOff]);

  const togglePause = useCallback(() => {
    if (localCaptureRef.current) {
      if (isPaused) {
        localCaptureRef.current.resume();
      } else {
        localCaptureRef.current.pause();
      }
      setIsPaused(!isPaused);
    }
  }, [isPaused]);

  const handleUseQuestion = useCallback(
    (questionText: string, _category: string, _targetFields: string[]) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.questionText === questionText ? { ...q, isUsed: true } : q,
        ),
      );
    },
    [],
  );

  const handleCommit = useCallback(async () => {
    if (finalData) {
      await onCommitSuggestions(finalData.commitReady);
    }
  }, [finalData, onCommitSuggestions]);

  const handleEmailLink = useCallback(
    async (overrideEmail?: string) => {
      setEmailStatus('sending');
      setEmailError(null);
      try {
        await createMeetingInvitation(
          config.clientId,
          config.meetingId,
          overrideEmail ? { recipientEmail: overrideEmail } : {},
        );
        setEmailStatus('sent');
        setTimeout(() => setEmailStatus('idle'), 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The /invitations route returns 400 when neither the client record
        // nor the request body carries an email. Prompt for one and retry.
        if (/email is required/i.test(message)) {
          const entered = window.prompt(
            `No email on file for ${config.clientName}. Enter an email to send the join link to:`,
          );
          if (entered && entered.trim()) {
            await handleEmailLink(entered.trim());
            return;
          }
          setEmailStatus('idle');
          return;
        }
        console.error('[LiveCallView] email invitation failed', err);
        setEmailError(message || 'Failed to send email');
        setEmailStatus('error');
        setTimeout(() => setEmailStatus('idle'), 4000);
      }
    },
    [config.clientId, config.meetingId, config.clientName],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      remoteCaptureRef.current?.stop();
      localCaptureRef.current?.stop();
      videoFrameCaptureRef.current?.stop();
      cactusClientRef.current?.disconnect();
      void livekitSessionRef.current?.disconnect();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  // ── Setup phase ──
  if (phase === 'setup') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <Video className="h-8 w-8 text-blue-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            Start Live Call with {config.clientName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            AI will transcribe the conversation and extract preferences in real-time
          </p>
          <button
            onClick={startCall}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700"
          >
            <Video className="h-4 w-4" />
            Start Call
          </button>
        </div>
      </div>
    );
  }

  // ── Connecting phase ──
  if (phase === 'connecting') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm font-medium text-slate-600">
            Connecting to AI transcription engine...
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Setting up camera and microphone
          </p>
        </div>
      </div>
    );
  }

  // ── Ended phase ──
  // Render unconditionally once phase flips to 'ended' — otherwise, if the
  // user ends the call before Cactus emits its final event, we'd fall through
  // to the active-call render below and the video/timer would appear to keep
  // running even though everything's been torn down.
  if (phase === 'ended') {
    if (finalData) {
      return (
        <PostCallReview
          duration={duration}
          clientName={config.clientName}
          transcript={transcript}
          finalData={finalData}
          onCommit={handleCommit}
          onDismiss={() => {}}
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-900">Call Ended</h2>
          <p className="mt-2 text-sm text-slate-500">
            Finalizing transcript and suggestions…
          </p>
          <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  // ── Active call phase ──
  return (
    <div className="flex h-full flex-col">
      {/* Top bar: live indicator */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-xs font-semibold text-red-600">LIVE</span>
          {cactusStatus === 'ready' ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-red-500" />
          )}
        </div>
        <span className="text-xs text-slate-500">
          AI Transcription {isPaused ? '(Paused)' : 'Active'}
        </span>
      </div>

      {/* Main content: video + transcript on left, AI sidebar on right */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Video + Transcript */}
        <div className="flex w-1/2 flex-col border-r border-slate-200">
          {/* Video area */}
          <div className="relative bg-slate-900 p-2" style={{ minHeight: '280px' }}>
            {/* Remote video (large) */}
            <div className="flex h-48 items-center justify-center rounded-lg bg-slate-800">
              {hasRemoteVideo ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full rounded-lg object-cover"
                />
              ) : (
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
                    <span className="text-2xl font-bold text-slate-400">
                      {config.clientName.charAt(0)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {config.clientName}
                  </p>
                </div>
              )}
            </div>

            {/* Local video (small, bottom right) */}
            <div className="absolute bottom-3 right-3 h-24 w-32 overflow-hidden rounded-lg border-2 border-slate-700 bg-slate-900 shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            </div>

            {/* Gemma 4 vision insight strip */}
            {visualInsight && (
              <div className="absolute left-3 top-3 max-w-[70%] rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-emerald-200 backdrop-blur-sm">
                <span className="mr-1 font-bold text-emerald-300">Gemma 4</span>
                {visualInsight}
              </div>
            )}

            {/* Shareable client join link — visible while waiting for the client */}
            {joinLink && !hasRemoteVideo && (
              <div className="absolute bottom-3 left-3 max-w-[80%] rounded-md bg-black/70 px-3 py-2 text-[11px] text-slate-100 backdrop-blur-sm">
                <div className="mb-1 font-semibold text-blue-300">
                  Send this link to {config.clientName}:
                </div>
                <div className="flex items-center gap-2">
                  <code className="truncate rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-200">
                    {joinLink}
                  </code>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(joinLink);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      } catch {
                        /* ignore clipboard errors */
                      }
                    }}
                    className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
                  >
                    {linkCopied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleEmailLink()}
                    disabled={emailStatus === 'sending'}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {emailStatus === 'sending'
                      ? 'Sending…'
                      : emailStatus === 'sent'
                      ? 'Sent!'
                      : emailStatus === 'error'
                      ? 'Retry'
                      : 'Email'}
                  </button>
                </div>
                {emailStatus === 'error' && emailError && (
                  <div className="mt-1 text-[10px] text-red-300">
                    {emailError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Call controls */}
          <div className="border-t border-slate-800 bg-slate-900 px-4 py-2">
            <CallControls
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              isPaused={isPaused}
              duration={duration}
              onToggleMute={toggleMute}
              onToggleCamera={toggleCamera}
              onTogglePause={togglePause}
              onEndCall={endCall}
            />
          </div>
        </div>

        {/* Right: AI Sidebar */}
        <div className="flex w-1/2 flex-col bg-slate-50">
          {/* Sidebar tabs */}
          <div className="flex border-b border-slate-200 bg-white">
            {(
              [
                { key: 'questions' as LivePanel, label: 'Questions', count: questions.filter((q) => !q.isUsed).length },
                { key: 'extractions' as LivePanel, label: 'Extractions', count: extractions.length },
                { key: 'transcript' as LivePanel, label: 'Transcript', count: transcript.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActivePanel(tab.key)}
                className={`flex-1 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activePanel === tab.key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-bold text-blue-700">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="relative flex-1 overflow-y-auto p-4">
            {activePanel === 'questions' && (
              <ReactiveQuestions
                questions={questions}
                onUseQuestion={handleUseQuestion}
              />
            )}

            {activePanel === 'extractions' && (
              <LiveExtractions
                extractions={extractions}
                contradictions={contradictions}
              />
            )}

            {activePanel === 'transcript' && (
              <LiveTranscript
                chunks={transcript}
                clientName={config.clientName}
              />
            )}

            {/* Toasts */}
            {newQuestionCount !== null && activePanel !== 'questions' && (
              <div className="sticky bottom-4 z-10 flex justify-center">
                <button
                  onClick={() => {
                    setActivePanel('questions');
                    setNewQuestionCount(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-600/25 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                  {newQuestionCount} new question{newQuestionCount !== 1 ? 's' : ''} suggested
                </button>
              </div>
            )}

            {newExtractionCount !== null && activePanel !== 'extractions' && (
              <div className="sticky bottom-14 z-10 flex justify-center">
                <button
                  onClick={() => {
                    setActivePanel('extractions');
                    setNewExtractionCount(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-600/25 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                  {newExtractionCount} preference{newExtractionCount !== 1 ? 's' : ''} extracted
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
