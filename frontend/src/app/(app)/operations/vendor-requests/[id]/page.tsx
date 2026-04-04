'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  ClipboardCopy,
  ChevronDown,
  ChevronUp,
  Bell,
  BellOff,
  TrendingUp,
  TrendingDown,
  FileText,
  History,
} from 'lucide-react';
import {
  getVendorRequest,
  getWorkflowInfo,
  transitionWorkflow as apiTransitionWorkflow,
  generateDraft,
  updateReminder,
  getVendorStats,
} from '@/lib/api-client';
import type {
  VendorRequest,
  VendorRequestDraft,
  VendorRequestReminder,
  VendorRequestApproval,
  VendorRequestStatus,
  WorkflowInfo,
  VendorStats,
  DraftTone,
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

const URGENCY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const TONE_LABELS: Record<DraftTone, string> = {
  gentle_nudge: 'Gentle Nudge',
  firm_reminder: 'Firm Reminder',
  escalation: 'Escalation',
  urgent_deadline: 'Urgent Deadline',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status] || 'bg-slate-100'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Workflow Controls
// ---------------------------------------------------------------------------

function WorkflowPanel({
  request,
  workflow,
  onTransition,
  transitioning,
}: {
  request: VendorRequest;
  workflow: WorkflowInfo | null;
  onTransition: (status: VendorRequestStatus, notes?: string) => void;
  transitioning: boolean;
}) {
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  if (!workflow) return null;

  const getTransitionLabel = (s: VendorRequestStatus) => {
    const labels: Record<string, string> = {
      draft: 'Move to Draft',
      needs_advisor_review: 'Request Advisor Review',
      needs_client_approval: 'Request Client Approval',
      approved_to_send: 'Approve to Send',
      sent_to_vendor: 'Mark as Sent',
      awaiting_vendor_response: 'Awaiting Response',
      follow_up_needed: 'Needs Follow-up',
      confirmed: 'Mark Confirmed',
      declined: 'Mark Declined',
      complete: 'Mark Complete',
      cancelled: 'Cancel',
    };
    return labels[s] || s.replace(/_/g, ' ');
  };

  const getButtonStyle = (s: VendorRequestStatus) => {
    if (s === 'cancelled') return 'border-red-200 text-red-700 hover:bg-red-50';
    if (s === 'confirmed' || s === 'complete') return 'bg-green-600 text-white hover:bg-green-700';
    if (s === 'approved_to_send' || s === 'sent_to_vendor') return 'bg-blue-600 text-white hover:bg-blue-700';
    return 'border-slate-200 text-slate-700 hover:bg-slate-50';
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className="font-semibold text-slate-900">Workflow</h3>
        <StatusBadge status={request.status} />
      </div>
      <div className="p-5">
        {workflow.availableTransitions.length === 0 ? (
          <p className="text-sm text-slate-500">No further transitions available.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {workflow.availableTransitions.map((s) => (
                <button
                  key={s}
                  onClick={() => onTransition(s, notes || undefined)}
                  disabled={transitioning}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${getButtonStyle(s)}`}
                >
                  {transitioning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  {getTransitionLabel(s)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="mt-3 text-xs text-slate-500 hover:text-slate-700"
            >
              {showNotes ? 'Hide notes' : 'Add transition notes'}
            </button>
            {showNotes && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for this transition..."
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                rows={2}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reminders Panel
// ---------------------------------------------------------------------------

function RemindersPanel({
  reminders,
  vendorRequestId,
  onUpdate,
}: {
  reminders: VendorRequestReminder[];
  vendorRequestId: string;
  onUpdate: () => void;
}) {
  const [acting, setActing] = useState<string | null>(null);

  const handleAction = async (action: 'complete' | 'snooze' | 'dismiss', reminderId: string) => {
    setActing(reminderId);
    try {
      const snoozedUntil =
        action === 'snooze'
          ? new Date(Date.now() + 24 * 3600_000).toISOString()
          : undefined;
      await updateReminder(vendorRequestId, action, reminderId, snoozedUntil);
      onUpdate();
    } finally {
      setActing(null);
    }
  };

  const pending = reminders.filter((r) => r.status === 'pending');
  const past = reminders.filter((r) => r.status !== 'pending');

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Bell className="h-4 w-4 text-amber-500" />
        <h3 className="font-semibold text-slate-900">Reminders</h3>
        <span className="ml-auto text-xs text-slate-500">{pending.length} active</span>
      </div>
      <div className="divide-y divide-slate-100">
        {reminders.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-slate-500">
            No reminders
          </div>
        ) : (
          <>
            {pending.map((rem) => {
              const isDue = new Date(rem.remindAt) <= new Date();
              return (
                <div key={rem.id} className={`px-5 py-3 ${isDue ? 'bg-amber-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {rem.label || 'Follow-up reminder'}
                      </p>
                      <p className={`text-xs ${isDue ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                        {isDue ? 'Due now' : `Due ${new Date(rem.remindAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAction('complete', rem.id)}
                        disabled={acting === rem.id}
                        className="rounded p-1 text-green-600 hover:bg-green-50"
                        title="Complete"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleAction('snooze', rem.id)}
                        disabled={acting === rem.id}
                        className="rounded p-1 text-amber-600 hover:bg-amber-50"
                        title="Snooze 24h"
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleAction('dismiss', rem.id)}
                        disabled={acting === rem.id}
                        className="rounded p-1 text-slate-400 hover:bg-slate-50"
                        title="Dismiss"
                      >
                        <BellOff className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {past.length > 0 && (
              <div className="px-5 py-2">
                <p className="text-xs text-slate-400 mb-1">{past.length} completed/resolved</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft Generator
// ---------------------------------------------------------------------------

function DraftsPanel({
  drafts,
  vendorRequestId,
  onUpdate,
}: {
  drafts: VendorRequestDraft[];
  vendorRequestId: string;
  onUpdate: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [selectedTone, setSelectedTone] = useState<DraftTone>('gentle_nudge');
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateDraft(vendorRequestId, selectedTone);
      onUpdate();
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (text: string, draftId: string) => {
    navigator.clipboard.writeText(text);
    setCopied(draftId);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <MessageSquare className="h-4 w-4 text-blue-500" />
        <h3 className="font-semibold text-slate-900">Follow-Up Drafts</h3>
        <span className="ml-auto text-xs text-slate-500">{drafts.length} draft{drafts.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="p-5">
        {/* Generate controls */}
        <div className="flex gap-2 mb-4">
          <select
            value={selectedTone}
            onChange={(e) => setSelectedTone(e.target.value as DraftTone)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-300 focus:outline-none"
          >
            {(Object.entries(TONE_LABELS) as [DraftTone, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            Draft Follow-Up
          </button>
        </div>

        {/* Draft list */}
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-lg border border-slate-100 bg-slate-50">
              <button
                onClick={() =>
                  setExpandedDraft(expandedDraft === draft.id ? null : draft.id)
                }
                className="flex w-full items-center justify-between px-4 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    {TONE_LABELS[draft.tone] || draft.tone}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(draft.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {expandedDraft === draft.id ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {expandedDraft === draft.id && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {editingDraft === draft.id ? (
                    <>
                      <textarea
                        value={editedText}
                        onChange={(e) => setEditedText(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:border-blue-300 focus:outline-none"
                        rows={8}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handleCopy(editedText, draft.id)}
                          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                        >
                          <ClipboardCopy className="h-3 w-3" />
                          {copied === draft.id ? 'Copied!' : 'Copy Edited'}
                        </button>
                        <button
                          onClick={() => setEditingDraft(null)}
                          className="rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">
                        {draft.editedBody || draft.generatedBody}
                      </pre>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() =>
                            handleCopy(draft.editedBody || draft.generatedBody, draft.id)
                          }
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
                        >
                          <ClipboardCopy className="h-3 w-3" />
                          {copied === draft.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingDraft(draft.id);
                            setEditedText(draft.editedBody || draft.generatedBody);
                          }}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
                        >
                          <FileText className="h-3 w-3" />
                          Edit
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {drafts.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">
              No drafts yet. Generate one above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Score Panel
// ---------------------------------------------------------------------------

function VendorScorePanel({ vendorName }: { vendorName: string }) {
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVendorStats(vendorName)
      .then((data) => setStats(data as VendorStats))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vendorName]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!stats || stats.totalRequests === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <TrendingUp className="h-4 w-4 text-slate-400" />
          <h3 className="font-semibold text-slate-900">Vendor Score</h3>
        </div>
        <div className="px-5 py-6 text-center text-sm text-slate-500">
          Not enough data for {vendorName}
        </div>
      </div>
    );
  }

  const scoreColor =
    (stats.score ?? 0) >= 70
      ? 'text-green-600'
      : (stats.score ?? 0) >= 40
        ? 'text-amber-600'
        : 'text-red-600';

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <TrendingUp className="h-4 w-4 text-green-500" />
        <h3 className="font-semibold text-slate-900">Vendor Score</h3>
        {stats.confidence && (
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {stats.confidence} confidence
          </span>
        )}
      </div>
      <div className="p-5">
        {stats.score !== null && (
          <div className="mb-4 text-center">
            <span className={`text-4xl font-bold ${scoreColor}`}>{stats.score}</span>
            <span className="text-sm text-slate-400">/100</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-slate-500">Total Requests</p>
            <p className="font-medium text-slate-900">{stats.totalRequests}</p>
          </div>
          <div>
            <p className="text-slate-500">Confirmed</p>
            <p className="font-medium text-green-600">{stats.confirmedCount}</p>
          </div>
          <div>
            <p className="text-slate-500">Avg Response</p>
            <p className="font-medium text-slate-900">
              {stats.avgResponseHours !== null
                ? `${Math.round(stats.avgResponseHours)}h`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Avg Follow-ups</p>
            <p className="font-medium text-slate-900">
              {stats.avgFollowUps !== null ? stats.avgFollowUps.toFixed(1) : '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Declined</p>
            <p className="font-medium text-red-600">{stats.declinedCount}</p>
          </div>
          <div>
            <p className="text-slate-500">Overdue</p>
            <p className="font-medium text-amber-600">{stats.overdueCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval History
// ---------------------------------------------------------------------------

function ApprovalHistory({ approvals }: { approvals: VendorRequestApproval[] }) {
  if (approvals.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <History className="h-4 w-4 text-slate-500" />
        <h3 className="font-semibold text-slate-900">Approval History</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {approvals.map((a) => (
          <div key={a.id} className="px-5 py-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={a.fromStatus} />
              <span className="text-xs text-slate-400">→</span>
              <StatusBadge status={a.toStatus} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span>
                {new Date(a.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              {a.notes && <span className="text-slate-400">— {a.notes}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function VendorRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [request, setRequest] = useState<VendorRequest | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [req, wf] = await Promise.all([
        getVendorRequest(id),
        getWorkflowInfo(id),
      ]);
      setRequest(req);
      setWorkflow(wf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTransition = async (toStatus: VendorRequestStatus, notes?: string) => {
    setTransitioning(true);
    try {
      await apiTransitionWorkflow(id, toStatus, notes);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setTransitioning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading request...</span>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="py-32 text-center">
        <p className="text-red-600 mb-4">{error || 'Not found'}</p>
        <button
          onClick={() => router.back()}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          Go Back
        </button>
      </div>
    );
  }

  const isOverdue =
    request.dueDate &&
    new Date(request.dueDate) < new Date() &&
    !['confirmed', 'declined', 'complete', 'cancelled'].includes(request.status);

  return (
    <div className="max-w-7xl">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/operations"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Operations
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {request.requestType.replace(/_/g, ' ')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {request.vendorName}
              {request.tripRequest && (
                <>
                  {' '}
                  · Trip:{' '}
                  <Link
                    href={`/trip-requests/${request.tripRequest.id}`}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    {request.tripRequest.title}
                  </Link>
                </>
              )}
              {request.client && (
                <> · {request.client.firstName} {request.client.lastName}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={request.status} />
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${URGENCY_COLORS[request.urgency] || ''}`}>
              {request.urgency}
            </span>
            {isOverdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3 w-3" />
                Overdue
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Request Details */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Request Details</h3>
            </div>
            <div className="p-5 space-y-4">
              {request.requestDetails && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Details</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {request.requestDetails}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-slate-500">Vendor Contact</p>
                  <p className="text-slate-700">{request.vendorContact || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Due Date</p>
                  <p className={`${isOverdue ? 'text-red-600 font-medium' : 'text-slate-700'}`}>
                    {request.dueDate
                      ? new Date(request.dueDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Follow-up Count</p>
                  <p className="text-slate-700">{request.followUpCount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Date Sent</p>
                  <p className="text-slate-700">
                    {request.dateSent
                      ? new Date(request.dateSent).toLocaleDateString()
                      : 'Not sent yet'}
                  </p>
                </div>
              </div>
              {request.internalNotes && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Internal Notes</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">
                    {request.internalNotes}
                  </p>
                </div>
              )}
              {request.finalOutcome && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Final Outcome</p>
                  <p className="text-sm text-slate-700">{request.finalOutcome}</p>
                </div>
              )}
            </div>
          </div>

          {/* Workflow */}
          <WorkflowPanel
            request={request}
            workflow={workflow}
            onTransition={handleTransition}
            transitioning={transitioning}
          />

          {/* Drafts */}
          <DraftsPanel
            drafts={request.drafts || []}
            vendorRequestId={id}
            onUpdate={load}
          />

          {/* Approval History */}
          <ApprovalHistory approvals={request.approvals || []} />

          {/* Timeline */}
          {request.timeline && request.timeline.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="font-semibold text-slate-900">Timeline</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {request.timeline.map((evt) => (
                  <div key={evt.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                    <div>
                      <p className="text-sm text-slate-700">{evt.description}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(evt.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Reminders */}
          <RemindersPanel
            reminders={request.reminders || []}
            vendorRequestId={id}
            onUpdate={load}
          />

          {/* Vendor Score */}
          <VendorScorePanel vendorName={request.vendorName} />
        </div>
      </div>
    </div>
  );
}
