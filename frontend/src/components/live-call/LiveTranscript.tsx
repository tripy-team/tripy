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

  // Group consecutive chunks by speaker
  const grouped = groupBySpeaker(chunks);

  return (
    <div className="space-y-2 px-3 py-2">
      {grouped.map((group, i) => (
        <div
          key={i}
          className={`rounded-lg px-3 py-2 ${
            group.speaker === 'advisor'
              ? 'bg-blue-50 border border-blue-100'
              : group.speaker === 'client'
                ? 'bg-emerald-50 border border-emerald-100'
                : 'bg-slate-50 border border-slate-100'
          }`}
        >
          <div className="mb-1 flex items-center justify-between">
            <SpeakerIndicator
              speaker={group.speaker}
              clientName={clientName}
            />
            <span className="text-[10px] text-slate-400">
              {formatTimestamp(group.startMs)}
            </span>
          </div>
          <p className="text-sm text-slate-700">{group.text}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

interface TranscriptGroup {
  speaker: TranscriptChunk['speaker'];
  text: string;
  startMs: number;
  endMs: number;
}

function groupBySpeaker(chunks: TranscriptChunk[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];

  for (const chunk of chunks) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === chunk.speaker) {
      last.text += ' ' + chunk.text;
      last.endMs = chunk.endMs;
    } else {
      groups.push({
        speaker: chunk.speaker,
        text: chunk.text,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
      });
    }
  }

  return groups;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
