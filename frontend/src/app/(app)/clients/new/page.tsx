'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, User, Users } from 'lucide-react';
import { createClient, type GroupType } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: 'leisure_friends', label: 'Friends / Leisure' },
  { value: 'destination_wedding', label: 'Destination Wedding' },
  { value: 'family_reunion', label: 'Family Reunion' },
  { value: 'corporate_offsite', label: 'Corporate Offsite' },
  { value: 'multi_generational', label: 'Multi-Generational' },
  { value: 'other', label: 'Other' },
];

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    clientType: 'individual' as 'individual' | 'group',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    notes: '',
  });
  const [groupForm, setGroupForm] = useState({
    groupType: 'leisure_friends' as GroupType,
    estimatedSize: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateClientId, setDuplicateClientId] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setError(null);
    setDuplicateClientId(null);

    try {
      const client = await createClient({
        clientType: form.clientType,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        notes: form.notes.trim() || undefined,
        groupProfile: form.clientType === 'group' ? {
          groupType: groupForm.groupType,
          estimatedSize: groupForm.estimatedSize ? Number(groupForm.estimatedSize) : undefined,
          notes: groupForm.notes || undefined,
        } : undefined,
      });
      router.push(`/clients/${client.id}`);
    } catch (err) {
      const apiErr = err as { status?: number; data?: { existingClientId?: string } };
      if (apiErr.status === 409 && apiErr.data?.existingClientId) {
        setDuplicateClientId(apiErr.data.existingClientId);
        setError('A client with this email already exists.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create client');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const typeConfig = {
    individual: { label: 'Individual', desc: 'Single traveler', icon: User },
    group: { label: 'Group', desc: 'Friends, weddings, corporate, reunions', icon: Users },
  };

  return (
    <div className="max-w-2xl">
      <Link href="/clients" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">Add Client</h1>
      <p className="mb-8 text-slate-500">Enter your client&apos;s details to get started.</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
          {duplicateClientId && (
            <Link href={`/clients/${duplicateClientId}`} className="ml-2 font-medium underline hover:text-red-900">
              View existing profile
            </Link>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Client Type */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Client Type</h2>
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(typeConfig) as [typeof form.clientType, typeof typeConfig.individual][]).map(([type, cfg]) => {
              const Icon = cfg.icon;
              const active = form.clientType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, clientType: type }))}
                  className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className={`font-medium ${active ? 'text-blue-900' : 'text-slate-900'}`}>{cfg.label}</p>
                    <p className="text-xs text-slate-500">{cfg.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Core Details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 font-semibold text-slate-900">
            {form.clientType === 'group' ? 'Group Details' : 'Client Details'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">First Name *</label>
              <input
                type="text" name="firstName" required value={form.firstName} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="John"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Last Name *</label>
              <input
                type="text" name="lastName" required value={form.lastName} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email *</label>
              <input
                type="email" name="email" required value={form.email} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'group' ? 'organizer@example.com' : 'john@example.com'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel" name="phone" value={form.phone} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          {form.clientType === 'individual' && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date of Birth</label>
              <SingleDatePicker compact value={form.dateOfBirth} onChange={(v) => setForm((f) => ({ ...f, dateOfBirth: v }))} minDate={null} />
            </div>
          )}

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes" value={form.notes} onChange={onChange} rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder={
                form.clientType === 'group' ? 'Annual friends trip, typically luxury beach destinations...' :
                'Prefers business class, anniversary trip in June...'
              }
            />
          </div>
        </div>

        {/* Group-specific section */}
        {form.clientType === 'group' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 font-semibold text-slate-900">Group Details</h2>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Group Type</label>
              <div className="flex flex-wrap gap-2">
                {GROUP_TYPES.map((gt) => (
                  <button
                    key={gt.value}
                    type="button"
                    onClick={() => setGroupForm((f) => ({ ...f, groupType: gt.value }))}
                    className={`inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      groupForm.groupType === gt.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {gt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Estimated Size</label>
              <input
                type="number" min="2" max="500"
                value={groupForm.estimatedSize}
                onChange={(e) => setGroupForm((f) => ({ ...f, estimatedSize: e.target.value }))}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="8"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : `Create ${form.clientType === 'group' ? 'Group' : 'Client'}`}
          </button>
          <Link href="/clients" className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
