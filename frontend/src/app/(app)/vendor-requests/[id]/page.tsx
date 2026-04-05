'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Save,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Plus,
  Archive,
  AlertTriangle,
  User,
  Plane,
} from 'lucide-react';
import {
  getVendorRequest,
  updateVendorRequest,
  archiveVendorRequest,
  transitionWorkflow,
  getWorkflowInfo,
} from '@/lib/api-client';
import type {
  VendorRequest,
  VendorRequestStatus,
  VendorRequestUrgency,
  WorkflowInfo,
} from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  room_upgrade: 'Room Upgrade',
  early_check_in: 'Early Check-in',
  late_check_out: 'Late Check-out',
  connecting_rooms: 'Connecting Rooms',
  airport_transfer: 'Airport Transfer',
  amenity_request: 'Amenity Request',
  dining_request: 'Dining Request',
  celebration_request: 'Celebration Request',
  quote_request: 'Quote Request',
  custom_request: 'Custom Request',
};

const STATUS_LABELS: Record<VendorRequestStatus, string> = {
  draft: 'Draft',
  needs_advisor_review: 'Advisor Review',
  needs_client_approval: 'Client Approval',
  approved_to_send: 'Approved to Send',
  sent_to_vendor: 'Sent to Vendor',
  awaiting_vendor_response: 'Awaiting Reply',
  follow_up_needed: 'Follow-up Needed',
  confirmed: 'Confirmed',
  declined: 'Declined',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  needs_advisor_review: 'bg-indigo-50 text-indigo-700',
  needs_client_approval: 'bg-violet-50 text-violet-700',
  approved_to_send: 'bg-cyan-50 text-cyan-700',
  sent_to_vendor: 'bg-blue-50 text-blue-700',
  awaiting_vendor_response: 'bg-amber-50 text-amber-700',
  follow_up_needed: 'bg-orange-50 text-orange-700',
  confirmed: 'bg-green-50 text-green-700',
  declined: 'bg-red-50 text-red-700',
  complete: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const URGENCY_OPTIONS: { value: VendorRequestUrgency; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const TERMINAL_STATUSES: VendorRequestStatus[] = ['confirmed', 'declined', 'complete', 'cancelled'];

function StatusIcon({ status }: { status: VendorRequestStatus }) {
  switch (status) {
    case 'confirmed':
    case 'complete':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'declined':
    case 'cancelled':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'awaiting_vendor_response':
      return <Clock className="h-5 w-5 text-amber-500" />;
    case 'follow_up_needed':
      return <MessageSquare className="h-5 w-5 text-orange-500" />;
    case 'sent_to_vendor':
      return <Send className="h-5 w-5 text-blue-500" />;
    default:
      return <Clock className="h-5 w-5 text-slate-400" />;
  }
}

function isOverdue(vr: VendorRequest): boolean {
  if (!vr.dueDate) return false;
  if (TERMINAL_STATUSES.includes(vr.status)) return false;
  return new Date(vr.dueDate) < new Date();
}

function transitionButtonStyle(status: VendorRequestStatus) {
  if (status === 'confirmed' || status === 'complete')
    return 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100';
  if (status === 'declined' || status === 'cancelled')
    return 'border-red-200 bg-white text-red-600 hover:bg-red-50';
  if (status === 'sent_to_vendor')
    return 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600';
  if (status === 'follow_up_needed')
    return 'bg-orange-600 text-white hover:bg-orange-700 border-orange-600';
  if (status === 'awaiting_vendor_response')
    return 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
}

export default function VendorRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [vr, setVr] = useState<VendorRequest | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [archivingReq, setArchivingReq] = useState(false);

  const [form, setForm] = useState({
    vendorName: '',
    vendorContact: '',
    requestDetails: '',
    urgency: 'medium' as VendorRequestUrgency,
    dueDate: '',
    followUpCount: 0,
    internalNotes: '',
    finalOutcome: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [data, wf] = await Promise.all([
        getVendorRequest(requestId),
        getWorkflowInfo(requestId).catch(() => null),
      ]);
      setVr(data);
      setWorkflow(wf);
      setForm({
        vendorName: data.vendorName,
        vendorContact: data.vendorContact || '',
        requestDetails: data.requestDetails || '',
        urgency: data.urgency,
        dueDate: data.dueDate ? data.dueDate.split('T')[0] : '',
        followUpCount: data.followUpCount,
        internalNotes: data.internalNotes || '',
        finalOutcome: data.finalOutcome || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateVendorRequest(requestId, {
        vendorName: form.vendorName,
        vendorContact: form.vendorContact || undefined,
        requestDetails: form.requestDetails || undefined,
        urgency: form.urgency,
        dueDate: form.dueDate || undefined,
        followUpCount: form.followUpCount,
        internalNotes: form.internalNotes || undefined,
        finalOutcome: form.finalOutcome || undefined,
      });
      setVr(updated);
      setEditing(false);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (toStatus: VendorRequestStatus) => {
    setTransitioning(true);
    try {
      const updated = await transitionWorkflow(requestId, toStatus);
      setVr(updated);
      const wf = await getWorkflowInfo(requestId).catch(() => null);
      setWorkflow(wf);
    } catch (err) {
      console.error('Failed to transition:', err);
    } finally {
      setTransitioning(false);
    }
  };

  const handleArchive = async () => {
    setArchivingReq(true);
    try {
      await archiveVendorRequest(requestId);
      router.push('/vendor-requests');
    } catch (err) {
      console.error('Failed to archive:', err);
    } finally {
      setArchivingReq(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading vendor request...</span>
      </div>
    );
  }

  if (error || !vr) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Request not found'}</p>
        <Link href="/vendor-requests" className="font-medium text-blue-600 hover:text-blue-700">
          Back to vendor requests
        </Link>
      </div>
    );
  }

  const overdue = isOverdue(vr);
  const isTerminal = TERMINAL_STATUSES.includes(vr.status);
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';

  return (
    <div className="max-w-4xl">
      <Link
        href="/vendor-requests"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to vendor requests
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-4">
          <StatusIcon status={vr.status} />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{vr.vendorName}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {REQUEST_TYPE_LABELS[vr.requestType] || vr.requestType}
              {' · '}
              Created {new Date(vr.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
          )}
          <button
            onClick={handleArchive}
            disabled={archivingReq}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {archivingReq ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Archive
          </button>
        </div>
      </div>

      {/* Overdue warning */}
      {overdue && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <p className="text-sm font-medium text-red-800">
            This request is overdue — due{' '}
            {vr.dueDate && new Date(vr.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
      )}

      {/* Workflow transitions */}
      {!editing && !isTerminal && workflow && workflow.availableTransitions.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {workflow.availableTransitions.map((toStatus) => (
            <button
              key={toStatus}
              onClick={() => handleTransition(toStatus)}
              disabled={transitioning}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium disabled:opacity-60 ${transitionButtonStyle(toStatus)}`}
            >
              {toStatus === 'sent_to_vendor' && <Send className="h-3.5 w-3.5" />}
              {toStatus === 'follow_up_needed' && <Plus className="h-3.5 w-3.5" />}
              {toStatus === 'awaiting_vendor_response' && <Clock className="h-3.5 w-3.5" />}
              {toStatus === 'confirmed' && <CheckCircle2 className="h-3.5 w-3.5" />}
              {(toStatus === 'declined' || toStatus === 'cancelled') && <XCircle className="h-3.5 w-3.5" />}
              {STATUS_LABELS[toStatus] || toStatus}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-6">
          {editing ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Vendor & Request</h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Vendor Name *</label>
                      <input type="text" value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Vendor Contact</label>
                      <input type="text" value={form.vendorContact} onChange={(e) => setForm((f) => ({ ...f, vendorContact: e.target.value }))} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Request Details</label>
                    <textarea rows={4} value={form.requestDetails} onChange={(e) => setForm((f) => ({ ...f, requestDetails: e.target.value }))} className={inputCls + ' resize-none'} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Urgency</label>
                      <select value={form.urgency} onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value as VendorRequestUrgency }))} className={inputCls + ' bg-white'}>
                        {URGENCY_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Due Date</label>
                      <SingleDatePicker compact value={form.dueDate} onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))} minDate={null} />
                    </div>
                    <div>
                      <label className={labelCls}>Follow-up Count</label>
                      <input type="number" min="0" value={form.followUpCount} onChange={(e) => setForm((f) => ({ ...f, followUpCount: parseInt(e.target.value) || 0 }))} className={inputCls} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Notes & Outcome</h2>
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Internal Notes</label>
                    <textarea rows={3} value={form.internalNotes} onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))} className={inputCls + ' resize-none'} placeholder="Internal team notes..." />
                  </div>
                  <div>
                    <label className={labelCls}>Final Outcome</label>
                    <textarea rows={3} value={form.finalOutcome} onChange={(e) => setForm((f) => ({ ...f, finalOutcome: e.target.value }))} className={inputCls + ' resize-none'} placeholder="Record the final resolution..." />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Changes
                </button>
                <button onClick={() => { setEditing(false); loadData(); }} className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Request Details</h2>
                {vr.requestDetails ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{vr.requestDetails}</p>
                ) : (
                  <p className="text-sm italic text-slate-400">No details provided</p>
                )}
              </div>

              {vr.internalNotes && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-800">Internal Notes</h2>
                  <p className="whitespace-pre-wrap text-sm text-amber-900">{vr.internalNotes}</p>
                </div>
              )}

              {vr.finalOutcome && (
                <div className="rounded-xl border border-green-200 bg-green-50/50 p-6 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-800">Final Outcome</h2>
                  <p className="whitespace-pre-wrap text-sm text-green-900">{vr.finalOutcome}</p>
                </div>
              )}

              {/* Timeline */}
              {vr.timeline && vr.timeline.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Activity Timeline</h2>
                  <div className="space-y-3">
                    {vr.timeline.map((event) => (
                      <div key={event.id} className="flex items-start gap-3 text-sm">
                        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-700">{event.description}</p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {new Date(event.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</h3>
            <div className="flex items-center gap-2">
              <StatusIcon status={vr.status} />
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[vr.status] || STATUS_STYLES.draft}`}>
                {STATUS_LABELS[vr.status] || vr.status}
              </span>
            </div>
            {vr.followUpCount > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {vr.followUpCount} follow-up{vr.followUpCount !== 1 ? 's' : ''} logged
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Details</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Urgency</dt>
                <dd className="mt-0.5 font-medium capitalize text-slate-900">{vr.urgency}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Due Date</dt>
                <dd className={`mt-0.5 font-medium ${overdue ? 'text-red-600' : 'text-slate-900'}`}>
                  {vr.dueDate ? new Date(vr.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Date Sent</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {vr.dateSent ? new Date(vr.dateSent).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </dd>
              </div>
              {vr.vendorContact && (
                <div>
                  <dt className="text-slate-500">Contact</dt>
                  <dd className="mt-0.5 break-all font-medium text-slate-900">{vr.vendorContact}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Trip & Client</h3>
            <div className="space-y-3">
              {vr.tripRequest && (
                <Link
                  href={`/trip-requests/${vr.tripRequest.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 p-3 text-sm hover:bg-slate-50"
                >
                  <Plane className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-slate-900">{vr.tripRequest.title}</span>
                </Link>
              )}
              {vr.client && (
                <Link
                  href={`/clients/${vr.client.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 p-3 text-sm hover:bg-slate-50"
                >
                  <User className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-slate-900">
                    {vr.client.firstName} {vr.client.lastName}
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
