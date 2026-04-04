'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Search,
  Loader2,
  RefreshCw,
  ClipboardList,
  Filter,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  MessageSquare,
  Archive,
} from 'lucide-react';
import { getVendorRequests, archiveVendorRequest } from '@/lib/api-client';
import type { VendorRequest, VendorRequestStatus, VendorRequestUrgency } from '@/lib/api-client';

const STATUS_CONFIG: Record<VendorRequestStatus, { label: string; className: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600', icon: ClipboardList },
  needs_advisor_review: { label: 'Advisor Review', className: 'bg-indigo-50 text-indigo-700', icon: ClipboardList },
  needs_client_approval: { label: 'Client Approval', className: 'bg-violet-50 text-violet-700', icon: ClipboardList },
  approved_to_send: { label: 'Approved', className: 'bg-cyan-50 text-cyan-700', icon: CheckCircle2 },
  sent_to_vendor: { label: 'Sent', className: 'bg-blue-50 text-blue-700', icon: Send },
  awaiting_vendor_response: { label: 'Awaiting Reply', className: 'bg-amber-50 text-amber-700', icon: Clock },
  follow_up_needed: { label: 'Follow-up Needed', className: 'bg-orange-50 text-orange-700', icon: MessageSquare },
  confirmed: { label: 'Confirmed', className: 'bg-green-50 text-green-700', icon: CheckCircle2 },
  declined: { label: 'Declined', className: 'bg-red-50 text-red-700', icon: XCircle },
  complete: { label: 'Complete', className: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500', icon: XCircle },
};

const URGENCY_CONFIG: Record<VendorRequestUrgency, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-600' },
  medium: { label: 'Medium', className: 'bg-blue-50 text-blue-700' },
  high: { label: 'High', className: 'bg-orange-50 text-orange-700' },
  urgent: { label: 'Urgent', className: 'bg-red-50 text-red-700' },
};

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

const TERMINAL_STATUSES: VendorRequestStatus[] = ['confirmed', 'declined', 'complete', 'cancelled'];

function StatusBadge({ status }: { status: VendorRequestStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: VendorRequestUrgency }) {
  const config = URGENCY_CONFIG[urgency];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function isOverdue(vr: VendorRequest): boolean {
  if (!vr.dueDate) return false;
  if (TERMINAL_STATUSES.includes(vr.status)) return false;
  return new Date(vr.dueDate) < new Date();
}

function dueDateDisplay(dueDate?: string | null) {
  if (!dueDate) return '—';
  const d = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diffDays < 0) return <span className="font-medium text-red-600">{formatted} (overdue)</span>;
  if (diffDays === 0) return <span className="font-medium text-amber-600">{formatted} (today)</span>;
  if (diffDays <= 2) return <span className="font-medium text-amber-600">{formatted} ({diffDays}d)</span>;
  return <span className="text-slate-600">{formatted}</span>;
}

type StatusFilter = VendorRequestStatus | 'all' | 'overdue';

export default function VendorRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<VendorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<VendorRequestUrgency | 'all'>('all');
  const [archiving, setArchiving] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getVendorRequests()
      .then(setRequests)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setArchiving(id);
    try {
      await archiveVendorRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Failed to archive:', err);
    } finally {
      setArchiving(null);
    }
  };

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter === 'overdue') {
        if (!isOverdue(r)) return false;
      } else if (statusFilter !== 'all' && r.status !== statusFilter) {
        return false;
      }
      if (urgencyFilter !== 'all' && r.urgency !== urgencyFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const clientName = r.client ? `${r.client.firstName} ${r.client.lastName}` : '';
        const tripTitle = r.tripRequest?.title || '';
        return (
          r.vendorName.toLowerCase().includes(q) ||
          clientName.toLowerCase().includes(q) ||
          tripTitle.toLowerCase().includes(q) ||
          (REQUEST_TYPE_LABELS[r.requestType]?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [requests, statusFilter, urgencyFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length, overdue: 0 };
    for (const r of requests) {
      c[r.status] = (c[r.status] || 0) + 1;
      if (isOverdue(r)) c.overdue++;
    }
    return c;
  }, [requests]);

  const activeStatuses: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `All (${counts.all || 0})` },
    { key: 'overdue', label: `Overdue (${counts.overdue || 0})` },
    { key: 'awaiting_vendor_response', label: `Awaiting (${counts.awaiting_vendor_response || 0})` },
    { key: 'follow_up_needed', label: `Follow-up (${counts.follow_up_needed || 0})` },
    { key: 'sent_to_vendor', label: `Sent (${counts.sent_to_vendor || 0})` },
    { key: 'draft', label: `Draft (${counts.draft || 0})` },
    { key: 'confirmed', label: `Confirmed (${counts.confirmed || 0})` },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading vendor requests...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error}</p>
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

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendor Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track and manage requests to hotels, DMCs, transport, and other suppliers.
          </p>
        </div>
        <Link
          href="/vendor-requests/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Request
        </Link>
      </div>

      {/* Overdue alert */}
      {counts.overdue > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-800">
              {counts.overdue} overdue request{counts.overdue !== 1 ? 's' : ''} need attention
            </p>
            <p className="text-xs text-red-600">
              Requests past their due date that haven&apos;t been resolved.
            </p>
          </div>
          <button
            onClick={() => setStatusFilter('overdue')}
            className="ml-auto rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
          >
            View overdue
          </button>
        </div>
      )}

      {/* Filters */}
      {requests.length > 0 && (
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by vendor, client, trip, or type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value as VendorRequestUrgency | 'all')}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All urgency</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
            {activeStatuses.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s.key
                    ? s.key === 'overdue'
                      ? 'bg-red-600 text-white'
                      : 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {requests.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <ClipboardList className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No vendor requests yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Create your first vendor request to start tracking communications with hotels, DMCs, and suppliers.
          </p>
          <Link
            href="/vendor-requests/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create First Request
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Vendor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Trip / Client</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Urgency</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Due Date</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-3 text-center font-medium text-slate-600">Follow-ups</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((vr) => {
                const overdue = isOverdue(vr);
                return (
                  <tr
                    key={vr.id}
                    onClick={() => router.push(`/vendor-requests/${vr.id}`)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${overdue ? 'bg-red-50/40' : ''}`}
                  >
                    <td className="px-4 py-3.5">
                      <div>
                        <span className="font-medium text-slate-900">{vr.vendorName}</span>
                        {vr.vendorContact && (
                          <p className="mt-0.5 truncate max-w-[200px] text-xs text-slate-500">{vr.vendorContact}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {REQUEST_TYPE_LABELS[vr.requestType] || vr.requestType}
                    </td>
                    <td className="px-4 py-3.5">
                      <div>
                        <p className="truncate max-w-[180px] text-slate-900">{vr.tripRequest?.title || '—'}</p>
                        {vr.client && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {vr.client.firstName} {vr.client.lastName}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <UrgencyBadge urgency={vr.urgency} />
                    </td>
                    <td className="px-4 py-3.5">{dueDateDisplay(vr.dueDate)}</td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={vr.status} />
                    </td>
                    <td className="px-4 py-3.5 text-center text-slate-600">
                      {vr.followUpCount > 0 ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-medium text-orange-700">
                          {vr.followUpCount}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <button
                        onClick={(e) => handleArchive(e, vr.id)}
                        disabled={archiving === vr.id}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Archive"
                      >
                        {archiving === vr.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No vendor requests match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
