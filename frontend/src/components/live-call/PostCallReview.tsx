'use client';

import { useState } from 'react';
import { Clock, FileText, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import ProfileDelta from './ProfileDelta';
import type { FinalEvent, TranscriptChunk } from '@/lib/cactus-ws';

interface PostCallReviewProps {
  duration: number;
  clientName: string;
  transcript: TranscriptChunk[];
  finalData: FinalEvent;
  onCommit: () => Promise<void>;
  onDismiss: () => void;
}

export default function PostCallReview({
  duration,
  clientName,
  transcript,
  finalData,
  onCommit,
  onDismiss,
}: PostCallReviewProps) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [committing, setCommitting] = useState(false);

  const handleCommit = async () => {
    setCommitting(true);
    try {
      await onCommit();
    } finally {
      setCommitting(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    return `${m} minute${m !== 1 ? 's' : ''}`;
  };

  return (
    <div className="space-y-4">
      {/* Call Summary Header */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-blue-100 p-2">
            <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Call Ended
            </h2>
            <p className="text-sm text-slate-600">
              {formatDuration(duration)} with {clientName}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat
            label="Preferences Learned"
            value={Object.keys(finalData.learned).length}
          />
          <Stat
            label="High Confidence"
            value={
              Object.values(finalData.confidenceMap).filter((c) => c >= 0.8)
                .length
            }
          />
          <Stat
            label="Contradictions"
            value={finalData.contradictions.length}
            warn={finalData.contradictions.length > 0}
          />
        </div>
      </div>

      {/* Profile Delta */}
      <ProfileDelta
        finalData={finalData}
        onCommitAll={handleCommit}
        onDismiss={onDismiss}
        committing={committing}
      />

      {/* Full Transcript */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="flex w-full items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">
              Full Transcript ({transcript.length} segments)
            </span>
          </div>
          {showTranscript ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showTranscript && (
          <div className="max-h-64 overflow-y-auto border-t border-slate-100 px-4 py-3">
            <div className="space-y-2">
              {transcript.map((chunk, i) => (
                <div key={i} className="text-xs">
                  <span
                    className={`font-medium ${
                      chunk.speaker === 'advisor'
                        ? 'text-blue-600'
                        : chunk.speaker === 'client'
                          ? 'text-emerald-600'
                          : 'text-slate-500'
                    }`}
                  >
                    {chunk.speaker === 'advisor'
                      ? 'You'
                      : chunk.speaker === 'client'
                        ? clientName
                        : 'Unknown'}
                    :
                  </span>{' '}
                  <span className="text-slate-700">{chunk.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2 text-center">
      <p
        className={`text-xl font-bold ${warn ? 'text-amber-600' : 'text-slate-900'}`}
      >
        {value}
      </p>
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
    </div>
  );
}
