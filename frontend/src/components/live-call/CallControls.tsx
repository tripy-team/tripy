'use client';

import { Mic, MicOff, Video, VideoOff, PhoneOff, Pause, Play } from 'lucide-react';

interface CallControlsProps {
  isMuted: boolean;
  isCameraOff: boolean;
  isPaused: boolean;
  duration: number;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onTogglePause: () => void;
  onEndCall: () => void;
}

export default function CallControls({
  isMuted,
  isCameraOff,
  isPaused,
  duration,
  onToggleMute,
  onToggleCamera,
  onTogglePause,
  onEndCall,
}: CallControlsProps) {
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center justify-center gap-3 rounded-xl bg-slate-900 px-4 py-3">
      <span className="mr-2 font-mono text-sm text-slate-400">
        {formatDuration(duration)}
      </span>

      <button
        onClick={onToggleMute}
        className={`rounded-full p-2.5 transition-colors ${
          isMuted
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-slate-700 text-white hover:bg-slate-600'
        }`}
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>

      <button
        onClick={onToggleCamera}
        className={`rounded-full p-2.5 transition-colors ${
          isCameraOff
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-slate-700 text-white hover:bg-slate-600'
        }`}
        title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
      >
        {isCameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
      </button>

      <button
        onClick={onTogglePause}
        className={`rounded-full p-2.5 transition-colors ${
          isPaused
            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
            : 'bg-slate-700 text-white hover:bg-slate-600'
        }`}
        title={isPaused ? 'Resume transcription' : 'Pause transcription'}
      >
        {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>

      <button
        onClick={onEndCall}
        className="rounded-full bg-red-600 p-2.5 text-white transition-colors hover:bg-red-700"
        title="End call"
      >
        <PhoneOff className="h-4 w-4" />
      </button>
    </div>
  );
}
