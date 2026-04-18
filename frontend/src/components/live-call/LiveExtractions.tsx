'use client';

import { Brain, Check, AlertTriangle } from 'lucide-react';
import type { ProfileExtraction } from '@/lib/cactus-ws';

interface LiveExtractionsProps {
  extractions: ProfileExtraction[];
  contradictions: Array<{
    field: string;
    previous: unknown;
    new: unknown;
    evidence: string;
  }>;
}

export default function LiveExtractions({
  extractions,
  contradictions,
}: LiveExtractionsProps) {
  if (extractions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Brain className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-500">
            No preferences extracted yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            As the client speaks, preferences will be extracted automatically
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-emerald-600" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Live Extractions ({extractions.length})
        </span>
      </div>

      {contradictions.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {contradictions.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
            >
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-medium text-amber-700">Contradiction</span>
              </div>
              <p className="mt-1 text-xs text-amber-700">
                <span className="font-medium">{fieldLabel(c.field)}</span>: was{' '}
                <span className="line-through">{String(c.previous)}</span>, now{' '}
                <span className="font-medium">{String(c.new)}</span>
              </p>
              <p className="mt-0.5 text-[10px] text-amber-600 italic">
                &ldquo;{c.evidence}&rdquo;
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {extractions.map((ext, i) => (
          <div
            key={`${ext.targetField}-${i}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-slate-700">
                  {fieldLabel(ext.targetField)}
                </span>
              </div>
              <ConfidenceBadge confidence={ext.confidence} />
            </div>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatValue(ext.suggestedValue)}
            </p>
            {ext.evidence && (
              <p className="mt-0.5 text-[10px] text-slate-500 italic">
                &ldquo;{ext.evidence}&rdquo;
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? 'bg-emerald-100 text-emerald-700'
      : confidence >= 0.6
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {pct}%
    </span>
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
