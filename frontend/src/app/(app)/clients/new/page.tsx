'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/api-client';

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const client = await createClient({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        notes: form.notes.trim() || undefined,
      });
      router.push(`/clients/${client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <Link
        href="/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">Add Client</h1>
      <p className="mb-8 text-slate-500">Enter your client&apos;s details to get started.</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 font-semibold text-slate-900">Client Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">First Name *</label>
              <input
                type="text"
                name="firstName"
                required
                value={form.firstName}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="John"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Last Name *</label>
              <input
                type="text"
                name="lastName"
                required
                value={form.lastName}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Date of Birth</label>
            <input
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={onChange}
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={onChange}
              rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Prefers business class, anniversary trip in June..."
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !form.firstName.trim() || !form.lastName.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Client'
            )}
          </button>
          <Link
            href="/clients"
            className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
