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
} from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { groupPlanning } from '@/lib/api';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import CityAutocomplete from '@/components/city-autocomplete';

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
  { value: 'united', label: 'United MileagePlus', type: 'airline_miles' as const },
  { value: 'american', label: 'American AAdvantage', type: 'airline_miles' as const },
  { value: 'delta', label: 'Delta SkyMiles', type: 'airline_miles' as const },
  { value: 'southwest', label: 'Southwest Rapid Rewards', type: 'airline_miles' as const },
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
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Travelers
  const [travelers, setTravelers] = useState<TravelerDraft[]>([newTraveler()]);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

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
    destination.trim() !== '' &&
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
        destination: destination.trim(),
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-blue-100">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">
              Plan a Group Trip
            </h1>
          </div>
          <p className="text-slate-500 ml-[52px]">
            Add travelers, their points balances, and preferences — then let
            Tripy find the optimal plan.
          </p>
        </div>

        {/* ================================================================ */}
        {/* STEP 1 — Trip Basics                                             */}
        {/* ================================================================ */}
        <section className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-1">
            Trip Details
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Where is the group headed?
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Trip Name
              </label>
              <input
                type="text"
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
                placeholder="e.g., Summer Japan 2026"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Destination
              </label>
              <CityAutocomplete
                value={destination}
                onChange={setDestination}
                onSelect={(city) => setDestination(city)}
                placeholder="e.g., Tokyo, Paris, Maui"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
              />
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* STEP 2 — Travelers                                               */}
        {/* ================================================================ */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">
              Travelers
              <span className="ml-2 text-sm font-normal text-slate-400">
                ({travelers.length})
              </span>
            </h2>
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
        </section>

        {/* ================================================================ */}
        {/* Error / Submit                                                   */}
        {/* ================================================================ */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          onClick={handleSubmit}
          className={cn(
            'w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl text-base font-semibold transition-all shadow-sm',
            canSubmit && !isSubmitting
              ? 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed',
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {progress}
            </>
          ) : (
            <>
              Optimize Trip
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
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

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50/60 transition-colors"
      >
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
          {traveler.displayName
            ? traveler.displayName
                .split(' ')
                .map((w) => w[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)
            : index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {traveler.displayName || `Traveler ${index + 1}`}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {[
              traveler.originAirport && `From ${traveler.originAirport}`,
              traveler.balances.length > 0 &&
                `${traveler.balances.length} balance${traveler.balances.length !== 1 ? 's' : ''}`,
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
                Origin Airport
              </label>
              <AirportAutocomplete
                value={traveler.originAirport}
                onValueChange={(v) => onUpdate({ originAirport: v })}
                placeholder="e.g., SFO"
              />
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
