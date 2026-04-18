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

  // Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);

  // Cactus data
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [extractions, setExtractions] = useState<ProfileExtraction[]>([]);
  const [questions, setQuestions] = useState<ReactiveQuestionWithMeta[]>([]);
  const [contradictions, setContradictions] = useState<FinalEvent['contradictions']>([]);
  const [finalData, setFinalData] = useState<FinalEvent | null>(null);
  const [cactusStatus, setCactusStatus] = useState<string>('disconnected');

  // Refs for cleanup
  const cactusClientRef = useRef<CactusWSClient | null>(null);
  const localCaptureRef = useRef<AudioCapturePipeline | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const startCall = useCallback(async () => {
    setPhase('connecting');

    try {
      // Get local media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Connect to Cactus WebSocket
      const cactusClient = new CactusWSClient({
        url: config.cactusWsUrl,
        clientName: config.clientName,
        existingPreferences: config.existingPreferences,
        tripContext: config.tripContext,
        onTranscript: (chunk) => {
          setTranscript((prev) => [...prev, chunk]);
        },
        onExtraction: (exts) => {
          setExtractions((prev) => [...prev, ...exts]);
          setContradictions([]); // Will be updated from final data
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

            // Start audio capture pipeline
            const localCapture = new AudioCapturePipeline('local');
            localCapture.start(stream, cactusClient.socket!);
            localCaptureRef.current = localCapture;
          }
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
    } catch (err) {
      console.error('Failed to start call:', err);
      setPhase('setup');
    }
  }, [config]);

  const endCall = useCallback(() => {
    // Stop audio capture
    if (localCaptureRef.current) {
      localCaptureRef.current.stop();
      localCaptureRef.current = null;
    }

    // Send stop to Cactus and wait for final data
    if (cactusClientRef.current) {
      cactusClientRef.current.sendStop();
    }

    // Stop local media
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }

    setPhase('ended');
    if (finalData) {
      onCallEnd(finalData);
    }
  }, [localStream, finalData, onCallEnd]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  }, [localStream]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localCaptureRef.current?.stop();
      cactusClientRef.current?.disconnect();
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
  if (phase === 'ended' && finalData) {
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

          {/* Live transcript */}
          <div className="flex-1 overflow-y-auto bg-white">
            <LiveTranscript
              chunks={transcript}
              clientName={config.clientName}
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
