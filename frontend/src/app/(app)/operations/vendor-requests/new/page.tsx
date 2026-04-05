'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  FileText,
  Send,
} from 'lucide-react';
import {
  getTripRequests,
  getVendorTemplates,
  createVendorRequest,
  createVendorRequestFromTemplate,
} from '@/lib/api-client';
import type {
  TripRequest,
  VendorRequestTemplate,
  VendorRequestType,
  VendorRequestUrgency,
} from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

const REQUEST_TYPES: { value: VendorRequestType; label: string }[] = [
  { value: 'early_check_in', label: 'Early Check-In' },
  { value: 'late_check_out', label: 'Late Check-Out' },
  { value: 'room_upgrade', label: 'Room Upgrade' },
  { value: 'celebration_request', label: 'Celebration Amenity' },
  { value: 'airport_transfer', label: 'Airport Transfer' },
  { value: 'connecting_rooms', label: 'Connecting Rooms' },
  { value: 'dining_request', label: 'Dining Request' },
  { value: 'amenity_request', label: 'Amenity Request' },
  { value: 'quote_request', label: 'Quote Request' },
  { value: 'custom_request', label: 'Custom' },
];

export default function NewVendorRequestPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [templates, setTemplates] = useState<VendorRequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [tripRequestId, setTripRequestId] = useState(searchParams.get('tripRequestId') || '');
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [requestType, setRequestType] = useState<VendorRequestType>(
    (searchParams.get('requestType') as VendorRequestType) || 'custom_request',
  );
  const [requestDetails, setRequestDetails] = useState(
    searchParams.get('details') || '',
  );
  const [urgency, setUrgency] = useState<VendorRequestUrgency>('medium');
  const [dueDate, setDueDate] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  useEffect(() => {
    Promise.all([getTripRequests(), getVendorTemplates()])
      .then(([t, tmpl]) => {
        setTrips(t);
        setTemplates(tmpl);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setRequestType(tmpl.requestType);
      setRequestDetails(tmpl.defaultBody);
      setUrgency(tmpl.defaultUrgency);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripRequestId || !vendorName) return;

    setSaving(true);
    try {
      let result;
      if (selectedTemplate) {
        result = await createVendorRequestFromTemplate({
          templateId: selectedTemplate,
          tripRequestId,
          vendorName,
          vendorContact: vendorContact || undefined,
          dueDate: dueDate || undefined,
          variables: {
            vendorName,
            vendorContact,
          },
        });
      } else {
        result = await createVendorRequest({
          tripRequestId,
          vendorName,
          vendorContact: vendorContact || undefined,
          requestType,
          requestDetails: requestDetails || undefined,
          urgency,
          dueDate: dueDate || undefined,
          internalNotes: internalNotes || undefined,
        });
      }
      router.push(`/operations/vendor-requests/${result.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <Link
          href="/operations/vendor-requests"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Vendor Requests
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 mb-6">New Vendor Request</h1>

      {/* Template Picker */}
      {templates.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-700">Start from Template</h3>
          </div>
          <select
            value={selectedTemplate}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
          >
            <option value="">— Blank request —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.scope === 'system' ? '⚙ ' : '🏢 '} {t.title} ({t.requestType.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Trip Request <span className="text-red-500">*</span>
            </label>
            <select
              value={tripRequestId}
              onChange={(e) => setTripRequestId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
            >
              <option value="">Select a trip...</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} — {t.status}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Vendor Name <span className="text-red-500">*</span>
              </label>
              <input
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                required
                placeholder="e.g. Four Seasons Maui"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Contact Name/Email
              </label>
              <input
                value={vendorContact}
                onChange={(e) => setVendorContact(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Request Type
              </label>
              <select
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as VendorRequestType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Urgency
              </label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as VendorRequestUrgency)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Due Date
              </label>
              <SingleDatePicker
                compact
                value={dueDate}
                onChange={setDueDate}
                minDate={null}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Request Details
            </label>
            <textarea
              value={requestDetails}
              onChange={(e) => setRequestDetails(e.target.value)}
              rows={4}
              placeholder="Describe what you need from the vendor..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Internal Notes
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Private notes (not shared with vendor)..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || !tripRequestId || !vendorName}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Create Request
          </button>
          <Link
            href="/operations/vendor-requests"
            className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
