'use client';

import { Mic } from 'lucide-react';

interface SpeakerIndicatorProps {
  speaker: 'advisor' | 'client' | 'both' | 'silence' | 'unknown';
  advisorName?: string;
  clientName?: string;
}

export default function SpeakerIndicator({
  speaker,
  advisorName = 'You',
  clientName = 'Client',
}: SpeakerIndicatorProps) {
  if (speaker === 'silence') return null;

  const label =
    speaker === 'advisor'
      ? advisorName
      : speaker === 'client'
        ? clientName
        : speaker === 'both'
          ? 'Both speaking'
          : 'Speaking...';

  const color =
    speaker === 'advisor'
      ? 'bg-blue-500'
      : speaker === 'client'
        ? 'bg-emerald-500'
        : 'bg-purple-500';

  return (
    <div className="flex items-center gap-1.5">
      <span className={`relative flex h-2.5 w-2.5`}>
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
        />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
      </span>
      <Mic className="h-3 w-3 text-slate-500" />
      <span className="text-xs font-medium text-slate-600">{label}</span>
    </div>
  );
}
