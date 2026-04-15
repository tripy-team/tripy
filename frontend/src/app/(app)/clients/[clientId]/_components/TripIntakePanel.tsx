'use client';

import { useState } from 'react';
import { Loader2, Send, X, Plane, Plus } from 'lucide-react';
import {
  createClientTrip,
  sendIntakeInvitations,
  type TripRequest,
  type IntakeInvitation,
  type Client,
} from '@/lib/api-client';

interface Props {
  client: Client;
  existingTrips: TripRequest[];
  onCreated: (invitation: IntakeInvitation, trip?: TripRequest) => void;
  onCancel: () => void;
}

type TripMode = 'existing' | 'new';

export default function TripIntakePanel({ client, existingTrips, onCreated, onCancel }: Props) {
  const [recipientEmail, setRecipientEmail] = useState(client.email ?? '');
  const [recipientName, setRecipientName] = useState(
    `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim(),
  );

  const [tripMode, setTripMode] = useState<TripMode>(existingTrips.length > 0 ? 'existing' : 'new');
  const [selectedTripId, setSelectedTripId] = useState<string>(existingTrips[0]?.id ?? '');

  // New trip fields
  const [title, setTitle] = useState('');
  const [originAirports, setOriginAirports] = useState('');
  const [destinationAirports, setDestinationAirports] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [travelerCount, setTravelerCount] = useState(1);
  const [budgetCash, setBudgetCash] = useState('');
  const [notes, setNotes] = useState('');

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function splitAirports(value: string): string[] {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  async function handleSend() {
    setError(null);
    if (!recipientEmail.trim()) {
      setError('Recipient email is required.');
      return;
    }

    let tripForIntake: TripRequest | undefined;

    if (tripMode === 'new') {
      if (!title.trim()) {
        setError('Trip title is required.');
        return;
      }
      const destArr = splitAirports(destinationAirports);
      if (destArr.length === 0) {
        setError('At least one destination airport is required.');
        return;
      }
      if (!departureDate) {
        setError('Departure date is required.');
        return;
      }
    } else if (!selectedTripId) {
      setError('Please select a trip.');
      return;
    }

    setSending(true);
    try {
      if (tripMode === 'new') {
        tripForIntake = await createClientTrip(client.id, {
          title: title.trim(),
          originAirports: splitAirports(originAirports),
          destinationAirports: splitAirports(destinationAirports),
          departureDate,
          returnDate: returnDate || undefined,
          travelerCount: travelerCount || 1,
          budgetCash: budgetCash ? Math.round(parseFloat(budgetCash) * 100) : undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        tripForIntake = existingTrips.find((t) => t.id === selectedTripId);
      }

      const [invitation] = await sendIntakeInvitations(client.id, [
        {
          email: recipientEmail.trim(),
          name: recipientName.trim() || undefined,
          formVariant: 'individual',
        },
      ]);

      onCreated(invitation, tripForIntake);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send trip intake form.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
            <Plane className="h-4.5 w-4.5 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-900">New Trip Intake Form</h3>
        </div>
        <button
          onClick={onCancel}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-6 p-5">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Recipient */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Recipient email</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="client@email.com"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Recipient name</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Optional"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Trip selection */}
        <div>
          <label className="mb-2 block text-xs font-medium text-slate-700">Which trip is this for?</label>
          <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setTripMode('existing')}
              disabled={existingTrips.length === 0}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tripMode === 'existing'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Link to existing trip
            </button>
            <button
              type="button"
              onClick={() => setTripMode('new')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tripMode === 'new'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <Plus className="h-3 w-3" />
                Create new trip
              </span>
            </button>
          </div>

          {tripMode === 'existing' ? (
            existingTrips.length === 0 ? (
              <p className="text-sm text-slate-500">
                No trips yet — switch to &ldquo;Create new trip&rdquo; to start one.
              </p>
            ) : (
              <select
                value={selectedTripId}
                onChange={(e) => setSelectedTripId(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {existingTrips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.departureDate ? ` — ${new Date(t.departureDate).toLocaleDateString()}` : ''}
                  </option>
                ))}
              </select>
            )
          ) : (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">Trip title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Italy honeymoon, Japan family trip…"
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Origin airport(s)</label>
                  <input
                    type="text"
                    value={originAirports}
                    onChange={(e) => setOriginAirports(e.target.value)}
                    placeholder="JFK, EWR"
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Destination airport(s)</label>
                  <input
                    type="text"
                    value={destinationAirports}
                    onChange={(e) => setDestinationAirports(e.target.value)}
                    placeholder="FCO, VCE"
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Departure date</label>
                  <input
                    type="date"
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Return date</label>
                  <input
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Travelers</label>
                  <input
                    type="number"
                    min={1}
                    value={travelerCount}
                    onChange={(e) => setTravelerCount(parseInt(e.target.value || '1', 10))}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">Budget (USD)</label>
                  <input
                    type="number"
                    min={0}
                    value={budgetCash}
                    onChange={(e) => setBudgetCash(e.target.value)}
                    placeholder="Optional"
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any context to include with the intake form…"
                  className="block w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-400">
            {tripMode === 'new'
              ? 'A new trip will be added to the Trips tab and linked to this intake form.'
              : 'This intake will be linked to the selected trip.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !recipientEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Sending…' : 'Send form'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
