'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Loader2,
  Send,
  X,
  Plane,
  Plus,
  Check,
  ArrowLeft,
  ArrowRight,
  Mail,
  Users,
  MapPin,
  Calendar,
} from 'lucide-react';
import {
  createClientTrip,
  sendIntakeInvitations,
  type TripRequest,
  type IntakeInvitation,
  type Client,
} from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface StepDef {
  id: string;
  label: string;
  icon: React.ElementType;
}

const STEPS: StepDef[] = [
  { id: 'recipient', label: 'Recipient', icon: Mail },
  { id: 'trip', label: 'Trip Selection', icon: MapPin },
  { id: 'details', label: 'Trip Details', icon: Calendar },
  { id: 'review', label: 'Review & Send', icon: Send },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  client: Client;
  existingTrips: TripRequest[];
  onCreated: (invitation: IntakeInvitation, trip?: TripRequest) => void;
  onCancel: () => void;
}

type TripMode = 'existing' | 'new';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TripIntakePanel({ client, existingTrips, onCreated, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  function splitAirports(value: string): string[] {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  // Steps that are only relevant when creating a new trip
  const visibleSteps = useMemo(() => {
    if (tripMode === 'existing') {
      return STEPS.filter((s) => s.id !== 'details');
    }
    return STEPS;
  }, [tripMode]);

  const canGoNext = step < visibleSteps.length - 1;
  const canGoPrev = step > 0;
  const goNext = () => canGoNext && setStep((s) => s + 1);
  const goPrev = () => canGoPrev && setStep((s) => s - 1);

  // Helper styling (matching intake form)
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';

  // Step completion
  const filledSteps = visibleSteps.map((s) => {
    switch (s.id) {
      case 'recipient':
        return !!recipientEmail.trim();
      case 'trip':
        return tripMode === 'existing' ? !!selectedTripId : !!title.trim();
      case 'details':
        return !!(destinationAirports.trim() && departureDate);
      case 'review':
        return false;
      default:
        return false;
    }
  });

  const completedStepCount = filledSteps.filter(Boolean).length;
  const progressPct = Math.round((completedStepCount / visibleSteps.length) * 100);

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

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    const currentStep = visibleSteps[step];
    if (!currentStep) return null;

    switch (currentStep.id) {
      case 'recipient':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Recipient Email *</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="client@email.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Recipient Name</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>
        );

      case 'trip':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Which trip is this for?</label>
              <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
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
                    No trips yet &mdash; switch to &ldquo;Create new trip&rdquo; to start one.
                  </p>
                ) : (
                  <select
                    value={selectedTripId}
                    onChange={(e) => setSelectedTripId(e.target.value)}
                    className={inputCls}
                  >
                    {existingTrips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.departureDate
                          ? ` — ${new Date(t.departureDate).toLocaleDateString()}`
                          : ''}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Trip Title *</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Italy honeymoon, Japan family trip..."
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'details':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Origin Airport(s)</label>
                <input
                  type="text"
                  value={originAirports}
                  onChange={(e) => setOriginAirports(e.target.value)}
                  placeholder="JFK, EWR"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-slate-400">Comma-separated IATA codes</p>
              </div>
              <div>
                <label className={labelCls}>Destination Airport(s) *</label>
                <input
                  type="text"
                  value={destinationAirports}
                  onChange={(e) => setDestinationAirports(e.target.value)}
                  placeholder="FCO, VCE"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Departure Date *</label>
                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Return Date</label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Travelers</label>
                <input
                  type="number"
                  min={1}
                  value={travelerCount}
                  onChange={(e) => setTravelerCount(parseInt(e.target.value || '1', 10))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Budget (USD)</label>
                <input
                  type="number"
                  min={0}
                  value={budgetCash}
                  onChange={(e) => setBudgetCash(e.target.value)}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any context to include with the intake form..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      case 'review':
        const selectedTrip =
          tripMode === 'existing'
            ? existingTrips.find((t) => t.id === selectedTripId)
            : null;
        return (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Summary</h3>

              <div className="grid grid-cols-[120px,1fr] gap-2 text-sm">
                <span className="font-medium text-slate-500">Send to:</span>
                <span className="text-slate-900">
                  {recipientName && `${recipientName} — `}{recipientEmail}
                </span>

                <span className="font-medium text-slate-500">Trip:</span>
                <span className="text-slate-900">
                  {tripMode === 'existing'
                    ? selectedTrip?.title || 'Selected trip'
                    : title || 'New trip'}
                </span>

                {tripMode === 'new' && destinationAirports && (
                  <>
                    <span className="font-medium text-slate-500">Destinations:</span>
                    <span className="text-slate-900">{destinationAirports}</span>
                  </>
                )}

                {tripMode === 'new' && departureDate && (
                  <>
                    <span className="font-medium text-slate-500">Dates:</span>
                    <span className="text-slate-900">
                      {departureDate}
                      {returnDate ? ` → ${returnDate}` : ''}
                    </span>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <p className="text-xs text-slate-400">
              {tripMode === 'new'
                ? 'A new trip will be added to the Trips tab and linked to this intake form.'
                : 'This intake will be linked to the selected trip.'}
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8">
      <div ref={topRef} className="relative flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <Plane className="h-4.5 w-4.5 text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">New Trip Intake Form</h2>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal body */}
        <div className="overflow-y-auto p-6">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                {completedStepCount} of {visibleSteps.length} sections filled
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex gap-6">
            {/* Step Sidebar */}
            <nav className="hidden w-52 shrink-0 md:block">
              <div className="space-y-1">
                {visibleSteps.map((s, i) => {
                  const Icon = s.icon;
                  const isCurrent = i === step;
                  const isFilled = filledSteps[i];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStep(i)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                        isCurrent
                          ? 'bg-blue-50 text-blue-700'
                          : isFilled
                            ? 'text-slate-700 hover:bg-slate-50'
                            : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          isCurrent
                            ? 'text-blue-600'
                            : isFilled
                              ? 'text-green-500'
                              : 'text-slate-300'
                        }`}
                      />
                      {s.label}
                      {isFilled && !isCurrent && (
                        <Check className="ml-auto h-3.5 w-3.5 text-green-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Form Content */}
            <div className="min-w-0 flex-1">
              {/* Mobile step indicator */}
              <div className="mb-4 flex items-center gap-2 md:hidden">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  {step + 1}/{visibleSteps.length}
                </span>
                <span className="text-sm font-medium text-slate-700">
                  {visibleSteps[step].label}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
                  {(() => {
                    const Icon = visibleSteps[step].icon;
                    return <Icon className="h-5 w-5 text-blue-600" />;
                  })()}
                  {visibleSteps[step].label}
                </h2>

                {renderStep()}
              </div>

              {/* Navigation */}
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>

                  {step === visibleSteps.length - 1 ? (
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sending || !recipientEmail.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {sending ? 'Sending...' : 'Send Form'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={!canGoNext}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
