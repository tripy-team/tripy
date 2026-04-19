'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import SpeakerIndicator from './SpeakerIndicator';
import type { TranscriptChunk } from '@/lib/cactus-ws';

interface LiveTranscriptProps {
  chunks: TranscriptChunk[];
  clientName: string;
}

export default function LiveTranscript({ chunks, clientName }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chunks]);

  if (chunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-500">
            Waiting for conversation...
          </p>
          <p className="mt-1 text-xs text-slate-400">
            The transcript will appear here as you speak
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      {chunks.map((chunk, i) => {
        const prev = i > 0 ? chunks[i - 1] : null;
        const showSpeaker = !prev || prev.speaker !== chunk.speaker;
        return (
          <div
            key={i}
            className={`rounded-lg px-3 py-1.5 ${
              chunk.speaker === 'advisor'
                ? 'bg-blue-50 border border-blue-100'
                : chunk.speaker === 'client'
                  ? 'bg-emerald-50 border border-emerald-100'
                  : 'bg-slate-50 border border-slate-100'
            }`}
          >
            {showSpeaker && (
              <div className="mb-0.5 flex items-center justify-between">
                <SpeakerIndicator
                  speaker={chunk.speaker}
                  clientName={clientName}
                />
                <span className="text-[10px] text-slate-400">
                  {formatTimestamp(chunk.startMs)}
                </span>
              </div>
            )}
            <p className="text-sm text-slate-700">{chunk.text}</p>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
