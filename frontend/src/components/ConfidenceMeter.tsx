'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import { getTripConfidence } from '@/lib/api-client';
import type { ConfidenceResult, ConfidenceDimension } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Score ring — circular progress indicator
// ---------------------------------------------------------------------------

function ScoreRing({ score, level }: { score: number; level: string }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const colors: Record<string, { stroke: string; bg: string; text: string }> = {
    high: { stroke: 'stroke-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    medium: { stroke: 'stroke-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' },
    low: { stroke: 'stroke-red-500', bg: 'bg-red-50', text: 'text-red-700' },
  };
  const c = colors[level] ?? colors.low;

  return (
    <div className="relative flex items-center justify-center">
      <svg width="96" height="96" className="-rotate-90">
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="6"
          className="stroke-slate-100"
        />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${c.stroke} transition-all duration-700 ease-out`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-2xl font-bold ${c.text}`}>{score}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          / 100
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidence badge — compact inline indicator
// ---------------------------------------------------------------------------

export function ConfidenceBadge({
  score,
  level,
}: {
  score: number;
  level: 'low' | 'medium' | 'high';
}) {
  const styles: Record<string, string> = {
    high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[level]}`}
      title={`Confidence: ${score}/100 (${level})`}
    >
      <Gauge className="h-3 w-3" />
      {score}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dimension row
// ---------------------------------------------------------------------------

function DimensionRow({ dim }: { dim: ConfidenceDimension }) {
  const icons: Record<string, React.ReactNode> = {
    resolved: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    ambiguous: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    missing: <CircleHelp className="h-4 w-4 text-red-400" />,
  };

  const barPercent = Math.round((dim.score / dim.maxScore) * 100);
  const barColor =
    dim.status === 'resolved'
      ? 'bg-emerald-500'
      : dim.status === 'ambiguous'
        ? 'bg-amber-400'
        : 'bg-slate-200';

  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 shrink-0">{icons[dim.status]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800">{dim.label}</span>
          <span className="text-xs tabular-nums text-slate-400">
            {dim.score}/{dim.maxScore}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">{dim.detail}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggested question card
// ---------------------------------------------------------------------------

function QuestionCard({
  dimension,
  question,
}: {
  dimension: string;
  question: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(question);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3.5 py-3">
      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-400">{dimension}</p>
        <p className="mt-0.5 text-sm text-slate-700">{question}</p>
      </div>
      <button
        onClick={handleCopy}
        className="mt-0.5 shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
        title="Copy question"
      >
        {copied ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ConfidenceMeter panel
// ---------------------------------------------------------------------------

export default function ConfidenceMeter({ tripId }: { tripId: string }) {
  const [data, setData] = useState<ConfidenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getTripConfidence(tripId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load confidence');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Calculating confidence...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-red-500">{error || 'Unable to compute confidence.'}</p>
        <button
          onClick={load}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const levelLabel: Record<string, string> = {
    high: 'High Confidence',
    medium: 'Medium Confidence',
    low: 'Low Confidence',
  };
  const levelDescription: Record<string, string> = {
    high: 'You have enough information to build strong recommendations.',
    medium: 'Some gaps remain — consider clarifying before running analysis.',
    low: 'Key information is missing. Follow up with the client before proceeding.',
  };

  const sortedDimensions = [...data.dimensions].sort((a, b) => a.score - b.score);
  const displayDimensions = showAll ? sortedDimensions : sortedDimensions.slice(0, 5);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header with score */}
      <div className="flex items-center gap-5 border-b border-slate-100 px-6 py-5">
        <ScoreRing score={data.score} level={data.level} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">
              {levelLabel[data.level]}
            </h3>
            <button
              onClick={load}
              className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              title="Refresh score"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {levelDescription[data.level]}
          </p>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />
              {data.resolvedFields.length} clear
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {data.ambiguousFields.length} ambiguous
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <CircleHelp className="h-3 w-3" />
              {data.missingFields.length} missing
            </span>
          </div>
        </div>
      </div>

      {/* Dimensions breakdown */}
      <div className="px-6 py-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Dimension Breakdown
        </h4>
        <div className="divide-y divide-slate-100">
          {displayDimensions.map((dim) => (
            <DimensionRow key={dim.key} dim={dim} />
          ))}
        </div>
        {sortedDimensions.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {showAll ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show fewer
              </>
            ) : (
              <>
                <ChevronRight className="h-3.5 w-3.5" />
                Show all {sortedDimensions.length} dimensions
              </>
            )}
          </button>
        )}
      </div>

      {/* Suggested follow-up questions */}
      {data.suggestedQuestions.length > 0 && (
        <div className="border-t border-slate-100 px-6 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Suggested Follow-Up Questions
          </h4>
          <div className="space-y-2">
            {data.suggestedQuestions.map((sq, i) => (
              <QuestionCard key={i} dimension={sq.dimension} question={sq.question} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
