'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Star,
  DollarSign,
  Users,
  Lightbulb,
  Copy,
  Check,
  FileText,
  Award,
  AlertTriangle,
  Info,
  AlertCircle,
  Sparkles,
  Download,
  Share2,
} from 'lucide-react';
import {
  getRecommendationRun,
  selectRecommendationOption,
  generateMemo,
} from '@/lib/api-client';
import type {
  RecommendationRun,
  RecommendationOption,
  TravelerAllocation,
  RecommendationInsight,
  RecommendationMemo,
} from '@/lib/api-client';

function StrategyTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    points_only: 'bg-purple-50 text-purple-700 border-purple-200',
    cash_only: 'bg-green-50 text-green-700 border-green-200',
    mixed: 'bg-blue-50 text-blue-700 border-blue-200',
    hold_and_wait: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  const labels: Record<string, string> = {
    points_only: 'Points Only',
    cash_only: 'Cash Only',
    mixed: 'Mixed',
    hold_and_wait: 'Hold & Wait',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${styles[type] ?? styles.mixed}`}>
      {labels[type] ?? type}
    </span>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="h-5 w-5 text-red-500" />;
  if (severity === 'warning') return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <Info className="h-5 w-5 text-blue-500" />;
}

function PaymentTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    points: 'bg-purple-50 text-purple-700',
    cash: 'bg-green-50 text-green-700',
    mixed: 'bg-blue-50 text-blue-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[type] ?? styles.cash}`}>
      {type}
    </span>
  );
}

export default function RecommendationRunPage() {
  const params = useParams();
  const runId = params.id as string;

  const [run, setRun] = useState<RecommendationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingMemo, setGeneratingMemo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [memoTab, setMemoTab] = useState<'internal' | 'client' | 'email'>('internal');

  const load = useCallback(async () => {
    try {
      const data = await getRecommendationRun(runId);
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recommendation');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSelectOption = async (optionId: string) => {
    try {
      const updated = await selectRecommendationOption(runId, optionId);
      setRun(updated);
    } catch (err) {
      console.error('Failed to select option:', err);
    }
  };

  const handleGenerateMemo = async () => {
    setGeneratingMemo(true);
    try {
      const memo = await generateMemo(runId);
      setRun((prev) => (prev ? { ...prev, memo } : prev));
    } catch (err) {
      console.error('Failed to generate memo:', err);
    } finally {
      setGeneratingMemo(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading recommendation...</span>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Recommendation not found'}</p>
        <Link href="/trip-requests" className="font-medium text-blue-600 hover:text-blue-700">
          Back to trip requests
        </Link>
      </div>
    );
  }

  const top = run.topRecommendation;
  const alternatives = run.alternatives ?? [];
  const insights = run.insights ?? [];
  const tripReq = run.tripRequest;

  return (
    <div className="max-w-6xl">
      {/* Back link */}
      {tripReq && (
        <Link
          href={`/trip-requests/${tripReq.id}`}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {tripReq.title}
        </Link>
      )}

      {/* ================ HEADER ================ */}
      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {tripReq?.title ?? 'Recommendation Results'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {tripReq && (
                <>
                  <span>{tripReq.originAirports?.join(', ')} → {tripReq.destinationAirports?.join(', ')}</span>
                  <span>&middot;</span>
                  {tripReq.departureDate && (
                    <span>
                      {new Date(tripReq.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {tripReq.returnDate && ` – ${new Date(tripReq.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </span>
                  )}
                  <span>&middot;</span>
                  <span>{tripReq.travelerCount} traveler{tripReq.travelerCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Export PDF
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Share2 className="h-4 w-4" />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* ================ TOP RECOMMENDATION ================ */}
      {top && (
        <div className="mb-6 rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/80 to-white p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-xl font-bold text-slate-900">{top.strategyTitle}</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                  <Award className="h-3 w-3" />
                  RECOMMENDED
                </span>
              </div>
              <div className="flex items-center gap-3">
                <StrategyTypeBadge type={top.strategyType} />
                {top.summary && (
                  <span className="text-sm text-slate-500">{top.summary}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">Total Cash Cost</p>
              <p className="text-3xl font-bold text-slate-900">
                ${top.totalCashCost.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 border-t border-blue-100 pt-4">
            <div>
              <p className="text-xs text-slate-500">Points Used</p>
              <p className="text-sm font-medium text-slate-900">{top.pointsUsedSummary}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Score</p>
              <div className="flex items-center gap-1">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${Math.min(top.score * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-slate-700">
                  {(top.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================ TRAVELER ALLOCATION TABLE ================ */}
      {top?.travelerAllocations && top.travelerAllocations.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <Users className="h-5 w-5 text-slate-400" />
              Traveler Allocation
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left font-medium text-slate-600">Traveler</th>
                  <th className="px-5 py-3 text-left font-medium text-slate-600">Payment</th>
                  <th className="px-5 py-3 text-left font-medium text-slate-600">Program</th>
                  <th className="px-5 py-3 text-right font-medium text-slate-600">Points</th>
                  <th className="px-5 py-3 text-right font-medium text-slate-600">Cash</th>
                  <th className="px-5 py-3 text-right font-medium text-slate-600">Taxes</th>
                  <th className="px-5 py-3 text-left font-medium text-slate-600">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {top.travelerAllocations.map((alloc: TravelerAllocation) => (
                  <tr key={alloc.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-900">
                      {alloc.travelerName}
                    </td>
                    <td className="px-5 py-3.5">
                      <PaymentTypeBadge type={alloc.paymentType} />
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{alloc.program ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right text-slate-900">
                      {alloc.pointsUsed != null ? alloc.pointsUsed.toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-900">
                      ${alloc.cashAmount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-600">
                      ${alloc.taxes.toLocaleString()}
                    </td>
                    <td className="max-w-xs truncate px-5 py-3.5 text-slate-500">
                      {alloc.rationale ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ================ PORTFOLIO INSIGHTS ================ */}
        <div className="lg:col-span-2 space-y-4">
          {insights.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                <Lightbulb className="h-5 w-5 text-slate-400" />
                Portfolio Insights
              </h2>
              <div className="space-y-3">
                {insights.map((insight: RecommendationInsight) => {
                  const borderColors: Record<string, string> = {
                    info: 'border-l-blue-500',
                    warning: 'border-l-amber-500',
                    critical: 'border-l-red-500',
                  };
                  return (
                    <div
                      key={insight.id}
                      className={`rounded-lg border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${borderColors[insight.severity] ?? borderColors.info}`}
                    >
                      <div className="flex items-start gap-3">
                        <SeverityIcon severity={insight.severity} />
                        <div>
                          <p className="font-medium text-slate-900">{insight.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{insight.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Why This Won */}
          {top?.whyChosen && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                <Sparkles className="h-5 w-5 text-blue-500" />
                Why This Strategy Won
              </h3>
              <p className="text-sm leading-relaxed text-slate-600">{top.whyChosen}</p>
            </div>
          )}
        </div>

        {/* ================ ALTERNATIVE STRATEGIES ================ */}
        <div>
          <h2 className="mb-3 font-semibold text-slate-900">Alternative Strategies</h2>
          {alternatives.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
              <p className="text-sm text-slate-400">No alternatives available</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alternatives.map((alt: RecommendationOption) => (
                <div
                  key={alt.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">{alt.strategyTitle}</h3>
                    <StrategyTypeBadge type={alt.strategyType} />
                  </div>
                  <p className="text-xl font-bold text-slate-900">
                    ${alt.totalCashCost.toLocaleString()}
                  </p>
                  {alt.summary && (
                    <p className="mt-1 text-xs text-slate-500">{alt.summary}</p>
                  )}
                  {alt.whyNotChosen && (
                    <p className="mt-2 text-xs italic text-slate-400">{alt.whyNotChosen}</p>
                  )}
                  <button
                    onClick={() => handleSelectOption(alt.id)}
                    className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  >
                    Select This Strategy
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ================ CLIENT MEMO ================ */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <FileText className="h-5 w-5 text-slate-400" />
            Client Memo
          </h2>
          {!run.memo && (
            <button
              onClick={handleGenerateMemo}
              disabled={generatingMemo}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {generatingMemo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate Memo
            </button>
          )}
        </div>

        {run.memo ? (
          <div>
            {/* Memo Tabs */}
            <div className="flex border-b border-slate-100">
              {(['internal', 'client', 'email'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setMemoTab(tab)}
                  className={`px-5 py-3 text-sm font-medium transition-colors ${
                    memoTab === tab
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab === 'internal'
                    ? 'Internal Summary'
                    : tab === 'client'
                      ? 'Client Summary'
                      : 'Email Draft'}
                </button>
              ))}
            </div>

            <div className="p-5">
              {(() => {
                const content =
                  memoTab === 'internal'
                    ? run.memo.internalSummary
                    : memoTab === 'client'
                      ? run.memo.clientSummary
                      : run.memo.emailDraft;

                if (!content) {
                  return <p className="text-sm text-slate-400">Not yet generated.</p>;
                }

                return (
                  <div>
                    <div className="mb-3 flex justify-end">
                      <button
                        onClick={() => copyToClipboard(content, memoTab)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {copiedField === memoTab ? (
                          <>
                            <Check className="h-4 w-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy to clipboard
                          </>
                        )}
                      </button>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {content}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">
              Generate a memo to share with your client or team.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
