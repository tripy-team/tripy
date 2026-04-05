'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createTripRequest, getClients, getHouseholds } from '@/lib/api-client';
import type { Client, Household } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

export default function NewTripRequestPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    entityType: 'client' as 'client' | 'household',
    entityId: '',
    title: '',
    originAirports: '',
    destinationAirports: '',
    departureDate: '',
    returnDate: '',
    travelerCount: '1',
    cabinPreference: '',
    flexibilityDays: '',
    budgetUsd: '',
    notes: '',
  });

  useEffect(() => {
    Promise.all([getClients().catch(() => []), getHouseholds().catch(() => [])]).then(
      ([c, h]) => {
        setClients(c);
        setHouseholds(h);
      },
    );
  }, []);

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const trip = await createTripRequest({
        clientId: form.entityType === 'client' && form.entityId ? form.entityId : undefined,
        householdId: form.entityType === 'household' && form.entityId ? form.entityId : undefined,
        title: form.title.trim(),
        originAirports: form.originAirports
          .split(',')
          .map((a) => a.trim().toUpperCase())
          .filter(Boolean),
        destinationAirports: form.destinationAirports
          .split(',')
          .map((a) => a.trim().toUpperCase())
          .filter(Boolean),
        departureDate: form.departureDate,
        returnDate: form.returnDate || undefined,
        travelerCount: parseInt(form.travelerCount) || 1,
        cabinPreference: form.cabinPreference || undefined,
        flexibilityDays: form.flexibilityDays ? parseInt(form.flexibilityDays) : undefined,
        budgetUsd: form.budgetUsd ? parseFloat(form.budgetUsd) : undefined,
        notes: form.notes.trim() || undefined,
      });
      router.push(`/trip-requests/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <Link
        href="/trip-requests"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to trip requests
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">New Trip Request</h1>
      <p className="mb-8 text-slate-500">Set up a trip to analyze the best redemption strategies.</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Client / Household selection */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Who is this trip for?</h2>
          <div className="mb-4 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="client"
                checked={form.entityType === 'client'}
                onChange={onChange}
                className="text-blue-600"
              />
              Client
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="household"
                checked={form.entityType === 'household'}
                onChange={onChange}
                className="text-blue-600"
              />
              Household
            </label>
          </div>
          <select
            name="entityId"
            value={form.entityId}
            onChange={onChange}
            className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">
              Select a {form.entityType === 'client' ? 'client' : 'household'}...
            </option>
            {form.entityType === 'client'
              ? clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))
              : households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
          </select>
        </div>

        {/* Trip details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Trip Details</h2>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Trip Title *</label>
            <input
              type="text"
              name="title"
              required
              value={form.title}
              onChange={onChange}
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Smith Family Hawaii Trip"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Origin Airports *
              </label>
              <input
                type="text"
                name="originAirports"
                required
                value={form.originAirports}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="JFK, EWR"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Destination Airports *
              </label>
              <input
                type="text"
                name="destinationAirports"
                required
                value={form.destinationAirports}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="HNL, OGG"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Departure Date *
              </label>
              <SingleDatePicker
                compact
                value={form.departureDate}
                onChange={(v) => setForm((f) => ({ ...f, departureDate: v }))}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Return Date</label>
              <SingleDatePicker
                compact
                value={form.returnDate}
                onChange={(v) => setForm((f) => ({ ...f, returnDate: v }))}
                defaultFocusedDate={form.departureDate}
                markedDate={form.departureDate}
                markedDateLabel="Departure date"
                minDate={form.departureDate || undefined}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Travelers</label>
              <input
                type="number"
                name="travelerCount"
                min="1"
                value={form.travelerCount}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Cabin</label>
              <select
                name="cabinPreference"
                value={form.cabinPreference}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">Any</option>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Flexibility (days)
              </label>
              <input
                type="number"
                name="flexibilityDays"
                min="0"
                value={form.flexibilityDays}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="3"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Budget (USD)
            </label>
            <input
              type="number"
              name="budgetUsd"
              min="0"
              step="0.01"
              value={form.budgetUsd}
              onChange={onChange}
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="5000"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={onChange}
              rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Any special requirements or preferences..."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !form.title.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Trip Request'
            )}
          </button>
          <Link
            href="/trip-requests"
            className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
