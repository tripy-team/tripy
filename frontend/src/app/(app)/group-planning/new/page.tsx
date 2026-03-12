'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserPlus,
  Plane,
  Building2,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  ArrowRight,
  Loader2,
  MapPin,
  Calendar,
  X,
  Globe,
  Info,
} from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { groupPlanning } from '@/lib/api';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

// ---------------------------------------------------------------------------
// Local draft types (not yet persisted)
// ---------------------------------------------------------------------------

interface BalanceDraft {
  id: string;
  program: string;
  currencyType: 'airline_miles' | 'hotel_points' | 'bank_points';
  balance: number;
}

interface PreferencesDraft {
  maxCashContribution: number | null;
  maxPointValueContributionUsd: number | null;
  usePointsPriority: 'low' | 'medium' | 'high';
  allowTransferPartners: boolean;
  allowHotelPoints: boolean;
  allowFlightPoints: boolean;
}

interface TravelerDraft {
  id: string;
  displayName: string;
  originAirport: string;
  cabinPreference: string;
  hotelPreference: string;
  cashBudget: number | null;
  balances: BalanceDraft[];
  preferences: PreferencesDraft;
  isExpanded: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 0;
function localId() {
  return `draft-${Date.now()}-${_nextId++}`;
}

const EMPTY_PREFERENCES: PreferencesDraft = {
  maxCashContribution: null,
  maxPointValueContributionUsd: null,
  usePointsPriority: 'medium',
  allowTransferPartners: true,
  allowHotelPoints: true,
  allowFlightPoints: true,
};

function newTraveler(): TravelerDraft {
  return {
    id: localId(),
    displayName: '',
    originAirport: '',
    cabinPreference: 'economy',
    hotelPreference: 'standard',
    cashBudget: null,
    balances: [],
    preferences: { ...EMPTY_PREFERENCES },
    isExpanded: true,
  };
}

const LOYALTY_PROGRAMS = [
  { value: 'chase_ur', label: 'Chase Ultimate Rewards', type: 'bank_points' as const },
  { value: 'amex_mr', label: 'Amex Membership Rewards', type: 'bank_points' as const },
  { value: 'citi_typ', label: 'Citi ThankYou Points', type: 'bank_points' as const },
  { value: 'capital_one', label: 'Capital One Miles', type: 'bank_points' as const },
  { value: 'bilt', label: 'Bilt Rewards', type: 'bank_points' as const },
  { value: 'united', label: 'United MileagePlus', type: 'airline_miles' as const },
  { value: 'american', label: 'American AAdvantage', type: 'airline_miles' as const },
  { value: 'delta', label: 'Delta SkyMiles', type: 'airline_miles' as const },
  { value: 'southwest', label: 'Southwest Rapid Rewards', type: 'airline_miles' as const },
  { value: 'alaska', label: 'Alaska Mileage Plan', type: 'airline_miles' as const },
  { value: 'marriott', label: 'Marriott Bonvoy', type: 'hotel_points' as const },
  { value: 'hilton', label: 'Hilton Honors', type: 'hotel_points' as const },
  { value: 'hyatt', label: 'World of Hyatt', type: 'hotel_points' as const },
  { value: 'ihg', label: 'IHG One Rewards', type: 'hotel_points' as const },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewGroupTripPage() {
  const router = useRouter();

  // Trip basics
  const [tripName, setTripName] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Travelers
  const [travelers, setTravelers] = useState<TravelerDraft[]>([newTraveler()]);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  // ---- destination helpers --------------------------------------------------

  function removeDestination(city: string) {
    setDestinations((prev) => prev.filter((c) => c !== city));
  }

  // ---- traveler CRUD helpers ------------------------------------------------

  function updateTraveler(id: string, patch: Partial<TravelerDraft>) {
    setTravelers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  function removeTraveler(id: string) {
    setTravelers((prev) => prev.filter((t) => t.id !== id));
  }

  function addTraveler() {
    setTravelers((prev) => [...prev, newTraveler()]);
  }

  function toggleExpand(id: string) {
    updateTraveler(id, {
      isExpanded: !travelers.find((t) => t.id === id)?.isExpanded,
    });
  }

  // ---- balance helpers ------------------------------------------------------

  function addBalance(travelerId: string) {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return {
          ...t,
          balances: [
            ...t.balances,
            { id: localId(), program: '', currencyType: 'bank_points', balance: 0 },
          ],
        };
      }),
    );
  }

  function updateBalance(
    travelerId: string,
    balanceId: string,
    patch: Partial<BalanceDraft>,
  ) {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return {
          ...t,
          balances: t.balances.map((b) =>
            b.id === balanceId ? { ...b, ...patch } : b,
          ),
        };
      }),
    );
  }

  function removeBalance(travelerId: string, balanceId: string) {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return { ...t, balances: t.balances.filter((b) => b.id !== balanceId) };
      }),
    );
  }

  // ---- preference helpers ---------------------------------------------------

  function updatePreferences(
    travelerId: string,
    patch: Partial<PreferencesDraft>,
  ) {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return { ...t, preferences: { ...t.preferences, ...patch } };
      }),
    );
  }

  // ---- submit ---------------------------------------------------------------

  const canSubmit =
    tripName.trim() !== '' &&
    destinations.length > 0 &&
    startDate !== '' &&
    endDate !== '' &&
    travelers.length > 0 &&
    travelers.every((t) => t.displayName.trim() !== '');

  async function handleSubmit() {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      setProgress('Creating trip...');
      const trip = await groupPlanning.createTrip({
        name: tripName.trim(),
        destination: destinations.join(', '),
        startDate,
        endDate,
      });

      for (let i = 0; i < travelers.length; i++) {
        const t = travelers[i];
        setProgress(`Adding traveler ${i + 1} of ${travelers.length}...`);

        const created = await groupPlanning.addTraveler(trip.id, {
          displayName: t.displayName.trim(),
          originAirport: t.originAirport || undefined,
          cabinPreference: t.cabinPreference as 'economy' | 'premium_economy' | 'business' | 'first',
          hotelPreference: t.hotelPreference as 'budget' | 'standard' | 'luxury',
          cashBudget: t.cashBudget ?? undefined,
        });

        for (const b of t.balances) {
          if (!b.program || b.balance <= 0) continue;
          const program = LOYALTY_PROGRAMS.find((p) => p.value === b.program);
          await groupPlanning.addBalance(trip.id, created.id, {
            program: b.program,
            currencyType: program?.type ?? b.currencyType,
            balance: b.balance,
          });
        }

        const p = t.preferences;
        const hasCustomPrefs =
          p.maxCashContribution !== null ||
          p.maxPointValueContributionUsd !== null ||
          p.usePointsPriority !== 'medium' ||
          !p.allowTransferPartners ||
          !p.allowHotelPoints ||
          !p.allowFlightPoints;

        if (hasCustomPrefs) {
          await groupPlanning.upsertPreferences(trip.id, created.id, {
            maxCashContribution: p.maxCashContribution ?? undefined,
            maxPointValueContributionUsd: p.maxPointValueContributionUsd ?? undefined,
            usePointsPriority: p.usePointsPriority,
            allowTransferPartners: p.allowTransferPartners,
            allowHotelPoints: p.allowHotelPoints,
            allowFlightPoints: p.allowFlightPoints,
          });
        }
      }

      setProgress('Running optimization...');
      await groupPlanning.optimize(trip.id);
      router.push(`/group-planning/${trip.id}/results`);
    } catch (err: unknown) {
      console.error('Error creating group trip:', err);
      setError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
      setProgress('');
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalBalances = travelers.reduce((sum, t) => sum + t.balances.length, 0);

  return (
    <div className="min-h-full p-6 md:p-8 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-2 font-medium">
            <Users className="w-4 h-4" />
            <span>Group Planning</span>
          </div>
          <h1 className="text-3xl md:text-4xl tracking-tight text-slate-900 font-bold">
            Plan a Group Trip
          </h1>
          <p className="text-slate-500 mt-1">
            Add travelers, their points, and shared destinations — Tripy optimizes for the whole group.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* ============================================================== */}
          {/* LEFT COLUMN — Main Form                                        */}
          {/* ============================================================== */}
          <div className="lg:col-span-2 space-y-6">

            {/* ---- Trip Name ---- */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="space-y-2">
                <label className="block text-xs text-slate-500 font-medium uppercase tracking-wider">
                  Trip Name
                </label>
                <input
                  type="text"
                  value={tripName}
                  onChange={(e) => setTripName(e.target.value)}
                  placeholder="e.g., Summer Japan 2026, Europe Family Trip"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium text-slate-900"
                />
              </div>
            </div>

            {/* ---- Shared Destinations ---- */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl text-slate-900 font-semibold">Shared Destinations</h2>
                  <p className="text-sm text-slate-500">Where is the group meeting up?</p>
                </div>
              </div>

              <div className="mt-2 mb-6 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  Add the cities everyone will visit together. Each traveler&apos;s starting airport is set in their profile below — you don&apos;t need to include start or end locations here.
                </p>
              </div>

              <div className="relative">
                {/* Timeline connector line */}
                {destinations.length > 0 && (
                  <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-blue-200 z-0" />
                )}

                <div className="space-y-0 relative z-10">
                  {/* Destinations list */}
                  {destinations.map((city, index) => (
                    <div key={city} className="flex gap-6 py-3">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full bg-blue-500 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                          <span className="text-[8px] text-white font-bold">{index + 1}</span>
                        </div>
                      </div>
                      <div className="flex-1 -mt-0.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-slate-900 font-medium flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            {city}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDestination(city)}
                            className="px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            title="Remove destination"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add destination button + dropdown */}
                  <div className="flex gap-6 py-3">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-white border-2 border-dashed border-slate-300 z-10" />
                    </div>
                    <div className="flex-1 -mt-0.5 relative">
                      <button
                        type="button"
                        onClick={() => setShowAddDestination(!showAddDestination)}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        {destinations.length === 0 ? 'Add a Destination' : 'Add Another Destination'}
                      </button>

                      {showAddDestination && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => {
                              setShowAddDestination(false);
                              setNewCity('');
                            }}
                          />
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-50">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                                Search for a city
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddDestination(false);
                                  setNewCity('');
                                }}
                                className="text-slate-400 hover:text-slate-600"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <DestinationAutocomplete
                              value={newCity}
                              onChange={setNewCity}
                              autoFocus
                              onSelect={(city) => {
                                if (city && !destinations.includes(city)) {
                                  setDestinations((prev) => [...prev, city]);
                                  setNewCity('');
                                  setShowAddDestination(false);
                                }
                              }}
                              placeholder="e.g., Paris, Tokyo, Rome..."
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {destinations.length === 0 && (
                <p className="mt-4 text-xs text-slate-400">
                  Add at least one destination where the group will meet.
                </p>
              )}
            </div>

            {/* ---- Dates ---- */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl text-slate-900 font-semibold">Trip Dates</h2>
                  <p className="text-sm text-slate-500">When should the group be there?</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500 font-medium uppercase tracking-wider">
                    Start Date
                  </label>
                  <SingleDatePicker
                    value={startDate}
                    onChange={setStartDate}
                    minDate={new Date().toISOString().split('T')[0]}
                    placeholder="Select date"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs text-slate-500 font-medium uppercase tracking-wider">
                    End Date
                  </label>
                  <SingleDatePicker
                    value={endDate}
                    onChange={setEndDate}
                    minDate={startDate || new Date().toISOString().split('T')[0]}
                    placeholder="Select date"
                  />
                </div>
              </div>
            </div>

            {/* ---- Travelers ---- */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl text-slate-900 font-semibold">
                      Travelers
                      <span className="ml-2 text-sm font-normal text-slate-400">
                        ({travelers.length})
                      </span>
                    </h2>
                    <p className="text-sm text-slate-500">Each person&apos;s starting airport, preferences, and points</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addTraveler}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  Add Traveler
                </button>
              </div>

              {travelers.length === 0 && (
                <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center shadow-sm">
                  <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm mb-4">
                    No travelers yet. Add at least one to get started.
                  </p>
                  <button
                    type="button"
                    onClick={addTraveler}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add First Traveler
                  </button>
                </div>
              )}

              <div className="space-y-4">
                {travelers.map((traveler, idx) => (
                  <TravelerCard
                    key={traveler.id}
                    index={idx}
                    traveler={traveler}
                    onUpdate={(patch) => updateTraveler(traveler.id, patch)}
                    onRemove={() => removeTraveler(traveler.id)}
                    onToggle={() => toggleExpand(traveler.id)}
                    onAddBalance={() => addBalance(traveler.id)}
                    onUpdateBalance={(bid, patch) =>
                      updateBalance(traveler.id, bid, patch)
                    }
                    onRemoveBalance={(bid) => removeBalance(traveler.id, bid)}
                    onUpdatePreferences={(patch) =>
                      updatePreferences(traveler.id, patch)
                    }
                    canRemove={travelers.length > 1}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ============================================================== */}
          {/* RIGHT COLUMN — Summary & Submit                                */}
          {/* ============================================================== */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-24 space-y-4">

              {/* Trip summary */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <h3 className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-4">Trip Summary</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Globe className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {destinations.length > 0 ? destinations.join(' → ') : 'No destinations yet'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {destinations.length} destination{destinations.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-700">
                      {startDate && endDate
                        ? `${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : 'Dates not set'}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-slate-700">
                        {travelers.length} traveler{travelers.length !== 1 ? 's' : ''}
                      </p>
                      {travelers.filter((t) => t.displayName).length > 0 && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {travelers
                            .filter((t) => t.displayName)
                            .map((t) => t.displayName)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  {totalBalances > 0 && (
                    <div className="flex items-start gap-3">
                      <CreditCard className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-700">
                        {totalBalances} point balance{totalBalances !== 1 ? 's' : ''} across group
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit button */}
              <button
                type="button"
                disabled={!canSubmit || isSubmitting}
                onClick={handleSubmit}
                className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base font-semibold shadow-lg shadow-blue-500/20"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {progress}
                  </>
                ) : (
                  <>
                    <Users className="w-5 h-5" />
                    Optimize Group Trip
                  </>
                )}
              </button>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}

              <p className="text-xs text-slate-500 text-center">
                Tripy finds the best flights and split for your group, using everyone&apos;s points to save cash.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Traveler Card
// ===========================================================================

interface TravelerCardProps {
  index: number;
  traveler: TravelerDraft;
  onUpdate: (patch: Partial<TravelerDraft>) => void;
  onRemove: () => void;
  onToggle: () => void;
  onAddBalance: () => void;
  onUpdateBalance: (id: string, patch: Partial<BalanceDraft>) => void;
  onRemoveBalance: (id: string) => void;
  onUpdatePreferences: (patch: Partial<PreferencesDraft>) => void;
  canRemove: boolean;
}

function TravelerCard({
  index,
  traveler,
  onUpdate,
  onRemove,
  onToggle,
  onAddBalance,
  onUpdateBalance,
  onRemoveBalance,
  onUpdatePreferences,
  canRemove,
}: TravelerCardProps) {
  const [showPrefs, setShowPrefs] = useState(false);

  const initials = traveler.displayName
    ? traveler.displayName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : String(index + 1);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {traveler.displayName || `Traveler ${index + 1}`}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {[
              traveler.originAirport && `Flies from ${traveler.originAirport}`,
              traveler.balances.length > 0 &&
                `${traveler.balances.length} point balance${traveler.balances.length !== 1 ? 's' : ''}`,
              traveler.cabinPreference !== 'economy' && traveler.cabinPreference.replace('_', ' '),
            ]
              .filter(Boolean)
              .join(' · ') || 'Tap to edit'}
          </p>
        </div>

        {canRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {traveler.isExpanded ? (
          <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
        )}
      </button>

      {/* Expanded body */}
      {traveler.isExpanded && (
        <div className="border-t border-slate-100 px-6 py-5 space-y-6">
          {/* Basic info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Name
              </label>
              <input
                type="text"
                value={traveler.displayName}
                onChange={(e) => onUpdate({ displayName: e.target.value })}
                placeholder="Full name"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Plane className="w-3.5 h-3.5 text-slate-400" />
                Starting Airport
              </label>
              <AirportAutocomplete
                value={traveler.originAirport}
                onValueChange={(v) => onUpdate({ originAirport: v })}
                placeholder="e.g., SEA, MIA, JFK"
              />
              <p className="text-[11px] text-slate-400">Where this traveler departs from</p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Plane className="w-3.5 h-3.5 text-slate-400" />
                Cabin Preference
              </label>
              <select
                value={traveler.cabinPreference}
                onChange={(e) => onUpdate({ cabinPreference: e.target.value })}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              >
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                Hotel Preference
              </label>
              <select
                value={traveler.hotelPreference}
                onChange={(e) => onUpdate({ hotelPreference: e.target.value })}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              >
                <option value="budget">Budget</option>
                <option value="standard">Standard</option>
                <option value="luxury">Luxury</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                Cash Budget (USD)
              </label>
              <input
                type="number"
                min={0}
                value={traveler.cashBudget ?? ''}
                onChange={(e) =>
                  onUpdate({
                    cashBudget:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                onWheel={(e) => e.currentTarget.blur()}
                placeholder="Optional"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              />
            </div>
          </div>

          {/* Points / Balances */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Points &amp; Miles
              </h3>
              <button
                type="button"
                onClick={onAddBalance}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Balance
              </button>
            </div>

            {traveler.balances.length === 0 ? (
              <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
                <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">
                  No loyalty balances yet.{' '}
                  <button
                    type="button"
                    onClick={onAddBalance}
                    className="text-blue-600 hover:underline"
                  >
                    Add one
                  </button>
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {traveler.balances.map((bal) => (
                  <div
                    key={bal.id}
                    className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3"
                  >
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        value={bal.program}
                        onChange={(e) => {
                          const prog = LOYALTY_PROGRAMS.find(
                            (p) => p.value === e.target.value,
                          );
                          onUpdateBalance(bal.id, {
                            program: e.target.value,
                            currencyType: prog?.type ?? bal.currencyType,
                          });
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                      >
                        <option value="">Select program</option>
                        <optgroup label="Bank Points">
                          {LOYALTY_PROGRAMS.filter(
                            (p) => p.type === 'bank_points',
                          ).map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Airline Miles">
                          {LOYALTY_PROGRAMS.filter(
                            (p) => p.type === 'airline_miles',
                          ).map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Hotel Points">
                          {LOYALTY_PROGRAMS.filter(
                            (p) => p.type === 'hotel_points',
                          ).map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <input
                        type="number"
                        min={0}
                        value={bal.balance || ''}
                        onChange={(e) =>
                          onUpdateBalance(bal.id, {
                            balance: Number(e.target.value),
                          })
                        }
                        onWheel={(e) => e.currentTarget.blur()}
                        placeholder="Points balance"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveBalance(bal.id)}
                      className="mt-1 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Contribution Preferences (progressive disclosure) */}
          <div>
            <button
              type="button"
              onClick={() => setShowPrefs(!showPrefs)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showPrefs ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              Contribution Preferences
            </button>

            {showPrefs && (
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">
                      Max Cash Contribution (USD)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={traveler.preferences.maxCashContribution ?? ''}
                      onChange={(e) =>
                        onUpdatePreferences({
                          maxCashContribution:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="No limit"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">
                      Max Points Value (USD equiv.)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={
                        traveler.preferences.maxPointValueContributionUsd ?? ''
                      }
                      onChange={(e) =>
                        onUpdatePreferences({
                          maxPointValueContributionUsd:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="No limit"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">
                      Points Usage Priority
                    </label>
                    <select
                      value={traveler.preferences.usePointsPriority}
                      onChange={(e) =>
                        onUpdatePreferences({
                          usePointsPriority: e.target.value as
                            | 'low'
                            | 'medium'
                            | 'high',
                        })
                      }
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                    >
                      <option value="low">Low — prefer cash</option>
                      <option value="medium">Medium — balanced</option>
                      <option value="high">High — use points first</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
                  <ToggleField
                    label="Allow Transfer Partners"
                    checked={traveler.preferences.allowTransferPartners}
                    onChange={(v) =>
                      onUpdatePreferences({ allowTransferPartners: v })
                    }
                  />
                  <ToggleField
                    label="Allow Hotel Points"
                    checked={traveler.preferences.allowHotelPoints}
                    onChange={(v) =>
                      onUpdatePreferences({ allowHotelPoints: v })
                    }
                  />
                  <ToggleField
                    label="Allow Flight Points"
                    checked={traveler.preferences.allowFlightPoints}
                    onChange={(v) =>
                      onUpdatePreferences({ allowFlightPoints: v })
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Toggle Field (small reusable)
// ===========================================================================

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
      </div>
      <span className="text-xs text-slate-600">{label}</span>
    </label>
  );
}
