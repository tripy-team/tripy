'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ShieldAlert,
  Send,
  Inbox,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  MessageSquarePlus,
  Languages,
  FileText,
} from 'lucide-react';
import {
  getOperationsDashboard,
  getReminders,
  translateClientRequest,
} from '@/lib/api-client';
import type {
  OperationsDashboardData,
  VendorRequestReminder,
  TranslatorResult,
} from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  needs_advisor_review: 'bg-amber-100 text-amber-700',
  needs_client_approval: 'bg-purple-100 text-purple-700',
  approved_to_send: 'bg-blue-100 text-blue-700',
  sent_to_vendor: 'bg-cyan-100 text-cyan-700',
  awaiting_vendor_response: 'bg-yellow-100 text-yellow-700',
  follow_up_needed: 'bg-orange-100 text-orange-700',
  confirmed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  complete: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  href,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  href?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    green: 'bg-green-50 text-green-600',
  };

  const content = (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color] ?? colorMap.blue}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function TranslatorPanel({
  clientName,
  onCreateRequest,
}: {
  clientName?: string;
  onCreateRequest: (suggestion: { requestType: string; vendorAsk: string }) => void;
}) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<TranslatorResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    try {
      const res = await translateClientRequest({ vagueRequest: input.trim(), clientName });
      setResult(res);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Languages className="h-5 w-5 text-indigo-500" />
        <h2 className="font-semibold text-slate-900">Client → Vendor Translator</h2>
      </div>
      <div className="p-5">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
            placeholder='e.g. "Make their anniversary special"'
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={handleTranslate}
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Translate
          </button>
        </div>

        {result && (
          <div className="mt-4 space-y-3">
            {result.suggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                      {s.category}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        s.specificity === 'high'
                          ? 'bg-green-100 text-green-700'
                          : s.specificity === 'medium'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {s.specificity} specificity
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{s.vendorAsk}</p>
                </div>
                <button
                  onClick={() => onCreateRequest(s)}
                  className="ml-3 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Create Request
                </button>
              </div>
            ))}

            {result.clarifyingQuestions.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-700 mb-1">
                  Consider asking the client:
                </p>
                <ul className="space-y-1">
                  {result.clarifyingQuestions.map((q, i) => (
                    <li key={i} className="text-xs text-amber-600">
                      • {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClientOperationsPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string;
}) {
  const [dashboard, setDashboard] = useState<OperationsDashboardData | null>(null);
  const [reminders, setReminders] = useState<VendorRequestReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, rems] = await Promise.all([
        getOperationsDashboard(clientId),
        getReminders({ status: 'pending', dueBefore: new Date().toISOString(), clientId }),
      ]);
      setDashboard(dash);
      setReminders(rems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [clientId]);

  const handleCreateFromTranslation = (suggestion: {
    requestType: string;
    vendorAsk: string;
  }) => {
    const tripId = dashboard?.tripSummaries[0]?.tripRequestId;
    if (!tripId) return;
    window.location.href = `/operations/vendor-requests/new?tripRequestId=${tripId}&requestType=${suggestion.requestType}&details=${encodeURIComponent(suggestion.vendorAsk)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading operations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!dashboard) return null;

  const hasActivity =
    dashboard.totalOpenRequests > 0 ||
    dashboard.tripSummaries.length > 0 ||
    dashboard.recentActivity.length > 0;

  if (!hasActivity && reminders.length === 0) {
    return (
      <div className="py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-slate-200" />
        <p className="mt-4 text-sm text-slate-500">
          No operations activity for this client yet.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Vendor requests and trip operations will appear here once created.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Operations</h2>
          <p className="text-sm text-slate-500">
            Vendor requests, approvals, and trip readiness
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/operations/templates"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" />
            Templates
          </Link>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Open Requests"
          value={dashboard.totalOpenRequests}
          icon={Inbox}
          color="blue"
        />
        <StatCard
          label="Overdue"
          value={dashboard.overdueRequests}
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          label="Due Reminders"
          value={dashboard.pendingReminders}
          icon={Clock}
          color="amber"
        />
        <StatCard
          label="Awaiting Approval"
          value={dashboard.awaitingApproval}
          icon={ShieldAlert}
          color="purple"
        />
      </div>

      {/* Due Reminders Banner */}
      {reminders.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">
              {reminders.length} Reminder{reminders.length !== 1 ? 's' : ''} Due Now
            </h3>
          </div>
          <div className="space-y-2">
            {reminders.slice(0, 5).map((rem) => (
              <Link
                key={rem.id}
                href={`/operations/vendor-requests/${rem.vendorRequestId}`}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm hover:bg-amber-100 transition-colors"
              >
                <div>
                  <span className="font-medium text-slate-900">
                    {rem.vendorRequest?.vendorName}
                  </span>
                  <span className="ml-2 text-slate-500">
                    {rem.vendorRequest?.requestType?.replace(/_/g, ' ')}
                  </span>
                  {rem.label && (
                    <span className="ml-2 text-xs text-amber-600">{rem.label}</span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trip Operations Table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Trip Operations</h2>
              <span className="text-xs text-slate-500">
                {dashboard.tripSummaries.length} trips with requests
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {dashboard.tripSummaries.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-green-300" />
                  <p className="mt-3 text-sm text-slate-500">
                    No active vendor requests. You&apos;re all caught up!
                  </p>
                </div>
              ) : (
                dashboard.tripSummaries.map((trip) => (
                  <Link
                    key={trip.tripRequestId}
                    href={`/trip-requests/${trip.tripRequestId}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {trip.tripTitle}
                        </p>
                        {trip.atRisk && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            At Risk
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Departs{' '}
                        {new Date(trip.departureDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {trip.openRequests > 0 && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
                          {trip.openRequests} open
                        </span>
                      )}
                      {trip.overdueRequests > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
                          {trip.overdueRequests} overdue
                        </span>
                      )}
                      {trip.awaitingApproval > 0 && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700">
                          {trip.awaitingApproval} pending
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Translator */}
          <TranslatorPanel clientName={clientName} onCreateRequest={handleCreateFromTranslation} />

          {/* Recent Activity */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Recent Activity</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {dashboard.recentActivity.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  No recent activity
                </div>
              ) : (
                dashboard.recentActivity.slice(0, 10).map((evt) => (
                  <Link
                    key={evt.id}
                    href={`/operations/vendor-requests/${evt.vendorRequestId}`}
                    className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
                      <MessageSquarePlus className="h-3 w-3 text-slate-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700">{evt.description}</p>
                      <p className="text-xs text-slate-400">
                        {evt.vendorName} ·{' '}
                        {new Date(evt.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar — 1 column */}
        <div className="space-y-6">
          {/* Status Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Request Status</h2>
            </div>
            <div className="p-4 space-y-2">
              {Object.entries(dashboard.requestsByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="text-sm font-medium text-slate-700">{count}</span>
                </div>
              ))}
              {Object.keys(dashboard.requestsByStatus).length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">No requests yet</p>
              )}
            </div>
          </div>

          {/* Top Vendors */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Vendor Scores</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {dashboard.topVendors.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-500">
                  No vendor data yet
                </div>
              ) : (
                dashboard.topVendors.map((v) => (
                  <div key={v.vendorName} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{v.vendorName}</p>
                      <p className="text-xs text-slate-500">
                        {v.totalRequests} request{v.totalRequests !== 1 ? 's' : ''}
                        {v.confidence && (
                          <span className="ml-1 text-slate-400">
                            · {v.confidence} confidence
                          </span>
                        )}
                      </p>
                    </div>
                    {v.score !== null ? (
                      <div className="flex items-center gap-1">
                        {v.score >= 70 ? (
                          <TrendingUp className="h-4 w-4 text-green-500" />
                        ) : v.score >= 40 ? (
                          <TrendingUp className="h-4 w-4 text-amber-500" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        )}
                        <span
                          className={`text-sm font-bold ${
                            v.score >= 70
                              ? 'text-green-600'
                              : v.score >= 40
                                ? 'text-amber-600'
                                : 'text-red-600'
                          }`}
                        >
                          {v.score}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
