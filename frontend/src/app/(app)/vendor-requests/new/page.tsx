'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Send, Save } from 'lucide-react';
import {
  createVendorRequest,
  getTripRequests,
  getClients,
} from '@/lib/api-client';
import type {
  TripRequest,
  Client,
  VendorRequestType,
  VendorRequestUrgency,
} from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

const REQUEST_TYPES: { value: VendorRequestType; label: string }[] = [
  { value: 'room_upgrade', label: 'Room Upgrade' },
  { value: 'early_check_in', label: 'Early Check-in' },
  { value: 'late_check_out', label: 'Late Check-out' },
  { value: 'connecting_rooms', label: 'Connecting Rooms' },
  { value: 'airport_transfer', label: 'Airport Transfer' },
  { value: 'amenity_request', label: 'Amenity Request' },
  { value: 'dining_request', label: 'Dining Request' },
  { value: 'celebration_request', label: 'Celebration Request' },
  { value: 'quote_request', label: 'Quote Request' },
  { value: 'custom_request', label: 'Custom Request' },
];

const URGENCY_OPTIONS: { value: VendorRequestUrgency; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export default function NewVendorRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillTripId = searchParams.get('tripId');

  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    tripRequestId: prefillTripId || '',
    clientId: '',
    vendorName: '',
    vendorContact: '',
    requestType: 'custom_request' as VendorRequestType,
    requestDetails: '',
    urgency: 'medium' as VendorRequestUrgency,
    dueDate: '',
    internalNotes: '',
  });

  useEffect(() => {
    Promise.all([
      getTripRequests().catch(() => []),
      getClients().catch(() => []),
    ]).then(([t, c]) => {
      setTrips(t);
      setClients(c);
      if (prefillTripId) {
        const trip = t.find((tr: TripRequest) => tr.id === prefillTripId);
        if (trip?.clientId) {
          setForm((f) => ({ ...f, clientId: trip.clientId || '' }));
        }
      }
      setLoading(false);
    });
  }, [prefillTripId]);

  const handleTripChange = (tripId: string) => {
    setForm((f) => ({ ...f, tripRequestId: tripId }));
    const trip = trips.find((t) => t.id === tripId);
    if (trip?.clientId) {
      setForm((f) => ({ ...f, clientId: trip.clientId || '' }));
    }
  };

  const handleSubmit = async () => {
    if (!form.tripRequestId || !form.vendorName || !form.requestType) {
      setError('Please fill in all required fields.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createVendorRequest({
        tripRequestId: form.tripRequestId,
        clientId: form.clientId || undefined,
        vendorName: form.vendorName.trim(),
        vendorContact: form.vendorContact.trim() || undefined,
        requestType: form.requestType,
        requestDetails: form.requestDetails.trim() || undefined,
        urgency: form.urgency,
        dueDate: form.dueDate || undefined,
        internalNotes: form.internalNotes.trim() || undefined,
      });
      router.push(`/vendor-requests/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading...</span>
      </div>
    );
  }

  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';

  return (
    <div className="max-w-3xl">
      <Link
        href="/vendor-requests"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to vendor requests
      </Link>

      <h1 className="mb-1 text-2xl font-bold text-slate-900">New Vendor Request</h1>
      <p className="mb-8 text-sm text-slate-500">
        Create a new request to send to a hotel, DMC, transport vendor, or other supplier.
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Trip & Client */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Trip & Client</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Trip *</label>
              <select
                value={form.tripRequestId}
                onChange={(e) => handleTripChange(e.target.value)}
                className={inputCls + ' bg-white'}
              >
                <option value="">Select a trip...</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.client ? ` — ${t.client.firstName} ${t.client.lastName}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Client</label>
              <select
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                className={inputCls + ' bg-white'}
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Vendor Info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Vendor Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Vendor Name *</label>
              <input
                type="text"
                placeholder="e.g., Four Seasons Bali"
                value={form.vendorName}
                onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Vendor Contact</label>
              <input
                type="text"
                placeholder="e.g., reservations@fourseasons.com"
                value={form.vendorContact}
                onChange={(e) => setForm((f) => ({ ...f, vendorContact: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Request Details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Request Details</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Request Type *</label>
                <select
                  value={form.requestType}
                  onChange={(e) => setForm((f) => ({ ...f, requestType: e.target.value as VendorRequestType }))}
                  className={inputCls + ' bg-white'}
                >
                  {REQUEST_TYPES.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Urgency</label>
                <select
                  value={form.urgency}
                  onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value as VendorRequestUrgency }))}
                  className={inputCls + ' bg-white'}
                >
                  {URGENCY_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Request Details</label>
              <textarea
                rows={3}
                placeholder="Describe what you're requesting from the vendor..."
                value={form.requestDetails}
                onChange={(e) => setForm((f) => ({ ...f, requestDetails: e.target.value }))}
                className={inputCls + ' resize-none'}
              />
            </div>

            <div>
              <label className={labelCls}>Due Date</label>
              <SingleDatePicker
                compact
                value={form.dueDate}
                onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))}
                minDate={null}
                className="max-w-xs"
              />
            </div>
          </div>
        </div>

        {/* Internal Notes */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-900">Internal Notes</h2>
          <textarea
            rows={3}
            placeholder="Notes visible only to your team..."
            value={form.internalNotes}
            onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value }))}
            className={inputCls + ' resize-none'}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving || !form.tripRequestId || !form.vendorName}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Create Request
          </button>
          <Link
            href="/vendor-requests"
            className="px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
