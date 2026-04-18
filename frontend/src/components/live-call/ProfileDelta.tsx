'use client';

import { ArrowRight, Check, AlertTriangle } from 'lucide-react';
import type { FinalEvent } from '@/lib/cactus-ws';

interface ProfileDeltaProps {
  finalData: FinalEvent;
  onCommitAll: () => void;
  onDismiss: () => void;
  committing?: boolean;
}

export default function ProfileDelta({
  finalData,
  onCommitAll,
  onDismiss,
  committing = false,
}: ProfileDeltaProps) {
  const { learned, confidenceMap, evidenceMap, contradictions, commitReady } = finalData;
  const learnedEntries = Object.entries(learned);

  if (learnedEntries.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-500">
          No new preferences were detected during this call.
        </p>
        <button
          onClick={onDismiss}
          className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            Profile Updates
          </h3>
          <p className="text-xs text-slate-500">
            {learnedEntries.length} preference{learnedEntries.length !== 1 ? 's' : ''}{' '}
            learned from this call
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            +{learnedEntries.length} fields
          </span>
        </div>
      </div>

      {contradictions.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-semibold text-amber-700">
              Contradictions Detected
            </span>
          </div>
          {contradictions.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
            >
              <span className="font-medium text-amber-800">{fieldLabel(c.field)}</span>:{' '}
              <span className="text-amber-600 line-through">{String(c.previous)}</span>
              <ArrowRight className="mx-1 inline h-3 w-3 text-amber-500" />
              <span className="font-medium text-amber-800">{String(c.new)}</span>
              <p className="mt-0.5 text-amber-600 italic">&ldquo;{c.evidence}&rdquo;</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {commitReady.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  {fieldLabel(item.targetField)}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    item.confidence >= 0.8
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {Math.round(item.confidence * 100)}%
                </span>
              </div>
              <p className="text-sm font-medium text-slate-900">
                {formatValue(item.suggestedValue)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500 italic">
                {item.evidence}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={onCommitAll}
          disabled={committing}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {committing ? 'Saving...' : `Save ${commitReady.length} to Profile`}
        </button>
        <button
          onClick={onDismiss}
          className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Review Later
        </button>
      </div>
    </div>
  );
}

function fieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
