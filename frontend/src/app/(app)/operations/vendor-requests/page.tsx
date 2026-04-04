'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  Plus,
  Filter,
  ChevronRight,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { getVendorRequests } from '@/lib/api-client';
import type { VendorRequest } from '@/lib/api-client';

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
  low: 'text-slate-500',
  medium: 'text-blue-600',
  high: 'text-orange-600',
  urgent: 'text-red-600',
};

const FILTER_STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'needs_advisor_review', label: 'Needs Advisor Review' },
  { value: 'needs_client_approval', label: 'Needs Client Approval' },
  { value: 'approved_to_send', label: 'Approved to Send' },
  { value: 'sent_to_vendor', label: 'Sent to Vendor' },
  { value: 'awaiting_vendor_response', label: 'Awaiting Response' },
  { value: 'follow_up_needed', label: 'Follow-up Needed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
  { value: 'complete', label: 'Complete' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function VendorRequestsListPage() {
  const [requests, setRequests] = useState<VendorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (searchTerm.trim()) params.vendorName = searchTerm.trim();
      const data = await getVendorRequests(params);
      setRequests(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  const handleSearch = () => {
    load();
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link
          href="/operations"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Operations
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendor Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            {requests.length} request{requests.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/operations/vendor-requests/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Request
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by vendor name..."
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
        >
          {FILTER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center">
          <Filter className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">No vendor requests found</p>
          <Link
            href="/operations/vendor-requests/new"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create your first request
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
          {requests.map((req) => {
            const isOverdue =
              req.dueDate &&
              new Date(req.dueDate) < new Date() &&
              !['confirmed', 'declined', 'complete', 'cancelled'].includes(req.status);
            const pendingReminders = req.reminders?.length ?? 0;

            return (
              <Link
                key={req.id}
                href={`/operations/vendor-requests/${req.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {req.requestType.replace(/_/g, ' ')}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[req.status] || 'bg-slate-100'}`}
                    >
                      {req.status.replace(/_/g, ' ')}
                    </span>
                    {isOverdue && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        Overdue
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {req.vendorName}
                    {req.tripRequest && <> · {req.tripRequest.title}</>}
                    {req.client && (
                      <> · {req.client.firstName} {req.client.lastName}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-medium ${URGENCY_COLORS[req.urgency] || 'text-slate-500'}`}
                  >
                    {req.urgency}
                  </span>
                  {pendingReminders > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {pendingReminders}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
