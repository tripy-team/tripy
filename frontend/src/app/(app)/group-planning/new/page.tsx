'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Loader2,
  MapPin,
  Calendar,
  X,
  Globe,
  Info,
  User,
  BedDouble,
  DoorOpen,
} from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { groupPlanning, users as usersAPI, isAuthenticated as checkIsAuthenticated } from '@/lib/api';
import AirportAutocomplete from '@/components/ui/AirportAutocomplete';
import { DestinationAutocomplete } from '@/components/ui/DestinationAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';
import { ALL_LOYALTY_PROGRAMS, getProgramCategory, isValidProgram, type ProgramCategory } from '@/lib/loyalty-programs';
import { getWalletAccounts, type WalletAccount } from '@/lib/wallet-client';

// ---------------------------------------------------------------------------
// Local draft types (not yet persisted)
// ---------------------------------------------------------------------------

interface BalanceDraft {
  id: string;
  program: string;
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
  returnAirport: string;
  isRoundTrip: boolean;
  cabinPreference: string;
  hotelPreference: string;
  cashBudget: number | null;
  balances: BalanceDraft[];
  preferences: PreferencesDraft;
  isExpanded: boolean;
  isOwner: boolean;
}

interface RoomDraft {
  id: string;
  label: string;
  capacity: number;
  hotelPreference: string;
  travelerIds: string[];
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

function newTraveler(isOwner = false): TravelerDraft {
  return {
    id: localId(),
    displayName: '',
    originAirport: '',
    returnAirport: '',
    isRoundTrip: true,
    cabinPreference: 'economy',
    hotelPreference: 'standard',
    cashBudget: null,
    balances: [],
    preferences: { ...EMPTY_PREFERENCES },
    isExpanded: true,
    isOwner,
  };
}

const QUICK_ADD_PROGRAMS = [
  'Chase Ultimate Rewards',
  'Amex Membership Rewards',
  'Capital One Miles',
  'Delta SkyMiles',
  'United MileagePlus',
  'American Airlines AAdvantage',
];

const CABIN_OPTIONS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

const HOTEL_OPTIONS = [
  { value: 'budget', label: 'Budget' },
  { value: 'standard', label: 'Standard' },
  { value: 'luxury', label: 'Luxury' },
];

function getCategoryColor(category: ProgramCategory): string {
  switch (category) {
    case 'airline':
      return 'bg-purple-50 text-purple-600';
    case 'hotel':
      return 'bg-amber-50 text-amber-600';
    default:
      return 'bg-blue-50 text-blue-600';
  }
}

function getCategoryIcon(category: ProgramCategory) {
  switch (category) {
    case 'airline':
      return Plane;
    case 'hotel':
      return Building2;
    default:
      return CreditCard;
  }
}

function programToCurrencyType(program: string): 'airline_miles' | 'hotel_points' | 'bank_points' {
  const cat = getProgramCategory(program);
  if (cat === 'airline') return 'airline_miles';
  if (cat === 'hotel') return 'hotel_points';
  return 'bank_points';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewGroupTripPage() {
  const router = useRouter();

  // Trip basics
  const [destinations, setDestinations] = useState<string[]>([]);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Per-leg departure dates: legDates[i] = departure date from destinations[i]
  // For a single destination, legDates is unused (endDate = departure from that city).
  // For multiple destinations, legDates[0..n-2] = departure from dest 0..n-2,
  // and endDate = departure from the last destination.
  const [legDates, setLegDates] = useState<string[]>([]);

  // Hotels & room assignments (on by default)
  const [includeHotels, setIncludeHotels] = useState(true);
  const [rooms, setRooms] = useState<RoomDraft[]>([]);

  // Travelers — start with one blank traveler; the profile loader will populate it
  const [travelers, setTravelers] = useState<TravelerDraft[]>([newTraveler(true)]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  // ---- load signed-in user's profile into the first traveler ----------------

  useEffect(() => {
    const loadProfile = async () => {
      try {
        if (!checkIsAuthenticated()) {
          setTravelers((prev) => {
            const first = prev[0];
            if (!first) return prev;
            return [{ ...first, isOwner: false }, ...prev.slice(1)];
          });
          return;
        }

        const [profile, syncedWalletAccounts] = await Promise.all([
          usersAPI.getProfile(),
          getWalletAccounts().catch(() => [] as WalletAccount[]),
        ]);
        const syncedBalances = syncedWalletAccounts
          .filter((account) => account.enabledForOptimization && account.balance > 0)
          .map((account) => ({
            id: `wallet-${account.id}`,
            program: account.programName,
            balance: account.balance,
          }));

        setTravelers((prev) => {
          const first = prev[0];
          if (!first || !first.isOwner) return prev;

          const patch: Partial<TravelerDraft> = {};

          if (profile.name && !first.displayName) {
            patch.displayName = profile.name;
          }
          if (profile.default_home_airport && !first.originAirport) {
            patch.originAirport = profile.default_home_airport;
            if (first.isRoundTrip) {
              patch.returnAirport = profile.default_home_airport;
            }
          }
          if (profile.flight_class && first.cabinPreference === 'economy') {
            patch.cabinPreference = profile.flight_class;
          }
          if (profile.hotel_class && first.hotelPreference === 'standard') {
            patch.hotelPreference = profile.hotel_class;
          }

          // Import the user's loyalty balances
          if (first.balances.length === 0) {
            if (syncedBalances.length > 0) {
              patch.balances = syncedBalances;
            } else if (profile.credit_cards && profile.credit_cards.length > 0) {
              patch.balances = profile.credit_cards
                .filter((c) => c.points > 0 && (c.owner === 'me' || !c.owner))
                .map((c) => ({
                  id: c.id || localId(),
                  program: c.program,
                  balance: c.points,
                }));
            }
          }

          if (Object.keys(patch).length === 0) return prev;

          return [{ ...first, ...patch }, ...prev.slice(1)];
        });
      } catch (err) {
        console.error('[GroupPlanning] Error loading profile:', err);
      } finally {
        setIsLoadingProfile(false);
      }
    };

    loadProfile();
  }, []);

  // ---- destination helpers --------------------------------------------------

  function removeDestination(index: number) {
    setDestinations((prev) => prev.filter((_, i) => i !== index));
    setLegDates((prev) => {
      const next = [...prev];
      // Remove the leg date at this index (if it exists)
      if (index < next.length) {
        next.splice(index, 1);
      }
      return next;
    });
  }

  function updateLegDate(index: number, date: string) {
    setLegDates((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = date;
      return next;
    });
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
    setTravelers((prev) => {
      const collapsed = prev.map((t) => ({ ...t, isExpanded: false }));
      return [newTraveler(), ...collapsed];
    });
  }

  function toggleExpand(id: string) {
    updateTraveler(id, {
      isExpanded: !travelers.find((t) => t.id === id)?.isExpanded,
    });
  }

  // ---- balance helpers ------------------------------------------------------

  function addBalanceToTraveler(travelerId: string, program: string, balance: number) {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return {
          ...t,
          balances: [
            ...t.balances,
            { id: localId(), program, balance },
          ],
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

  // ---- room helpers ---------------------------------------------------------

  function addRoom() {
    setRooms((prev) => [
      ...prev,
      {
        id: localId(),
        label: `Room ${prev.length + 1}`,
        capacity: 2,
        hotelPreference: 'standard',
        travelerIds: [],
      },
    ]);
  }

  function removeRoom(roomId: string) {
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  }

  function updateRoom(roomId: string, patch: Partial<RoomDraft>) {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    );
  }

  function assignTravelerToRoom(travelerId: string, roomId: string) {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id === roomId) {
          if (r.travelerIds.includes(travelerId)) return r;
          if (r.travelerIds.length >= r.capacity) return r;
          return { ...r, travelerIds: [...r.travelerIds, travelerId] };
        }
        return { ...r, travelerIds: r.travelerIds.filter((id) => id !== travelerId) };
      }),
    );
  }

  function unassignTraveler(travelerId: string) {
    setRooms((prev) =>
      prev.map((r) => ({
        ...r,
        travelerIds: r.travelerIds.filter((id) => id !== travelerId),
      })),
    );
  }

  const assignedTravelerIds = useMemo(
    () => new Set(rooms.flatMap((r) => r.travelerIds)),
    [rooms],
  );

  const unassignedTravelers = useMemo(
    () => travelers.filter((t) => !assignedTravelerIds.has(t.id)),
    [travelers, assignedTravelerIds],
  );

  // When a traveler is removed, clean them from rooms too
  useEffect(() => {
    const validIds = new Set(travelers.map((t) => t.id));
    setRooms((prev) =>
      prev.map((r) => ({
        ...r,
        travelerIds: r.travelerIds.filter((id) => validIds.has(id)),
      })),
    );
  }, [travelers]);

  // ---- submit ---------------------------------------------------------------

  const canSubmit =
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
        name: destinations.length > 0 ? `Group Trip to ${destinations.join(', ')}` : 'Group Trip',
        destination: destinations.join(', '),
        startDate,
        endDate,
        includeHotels,
      });

      for (let i = 0; i < travelers.length; i++) {
        const t = travelers[i];
        setProgress(`Adding traveler ${i + 1} of ${travelers.length}...`);

        const effectiveReturn = t.isRoundTrip ? t.originAirport : t.returnAirport;

        const assignedRoom = includeHotels
          ? rooms.find((r) => r.travelerIds.includes(t.id))
          : undefined;

        const created = await groupPlanning.addTraveler(trip.id, {
          displayName: t.displayName.trim(),
          originAirport: t.originAirport || undefined,
          returnAirport: effectiveReturn || undefined,
          cabinPreference: t.cabinPreference as 'economy' | 'premium_economy' | 'business' | 'first',
          hotelPreference: (assignedRoom?.hotelPreference ?? 'standard') as 'budget' | 'standard' | 'luxury',
          roomShareGroupId: assignedRoom?.id,
          cashBudget: t.cashBudget ?? undefined,
        });

        for (const b of t.balances) {
          if (!b.program || b.balance <= 0) continue;
          await groupPlanning.addBalance(trip.id, created.id, {
            program: b.program,
            currencyType: programToCurrencyType(b.program),
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
  const totalPoints = travelers.reduce(
    (sum, t) => sum + t.balances.reduce((s, b) => s + b.balance, 0),
    0,
  );

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
            Add travelers, their points, and shared destinations — TripsHacker optimizes for the whole group.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* ============================================================== */}
          {/* LEFT COLUMN — Main Form                                        */}
          {/* ============================================================== */}
          <div className="lg:col-span-2 space-y-6">

            {/* ---- Shared Destinations & Dates ---- */}
            <div className="relative z-40 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Globe className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl text-slate-900 font-semibold">Shared Destinations</h2>
                  <p className="text-sm text-slate-500">Build your group itinerary by adding destinations and dates</p>
                </div>
              </div>

              <div className="relative">
                {/* Timeline connector line */}
                <div className="absolute left-[11px] top-8 bottom-8 w-0.5 bg-blue-200 z-0" />

                <div className="space-y-0 relative z-10">
                  {/* GROUP ARRIVAL — fixed top row */}
                  <div className="flex gap-6 pb-4">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-blue-600 border-4 border-white shadow-sm z-10" />
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                      <div>
                        <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                          Group Arrival Date
                        </label>
                        <SingleDatePicker
                          value={startDate}
                          onChange={(date) => setStartDate(date)}
                          minDate={new Date().toISOString().split('T')[0]}
                          placeholder="When does the group arrive?"
                        />
                      </div>
                      {/* When no destinations, show final departure date here */}
                      {destinations.length === 0 && (
                        <div>
                          <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                            Final Departure Date
                          </label>
                          <SingleDatePicker
                            value={endDate}
                            onChange={(date) => setEndDate(date)}
                            minDate={startDate || new Date().toISOString().split('T')[0]}
                            placeholder="When does the group leave?"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* DESTINATION ROWS */}
                  {destinations.map((city, index) => {
                    const isLast = index === destinations.length - 1;

                    return (
                      <div key={`dest-${index}`} className="flex gap-6 py-4">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center">
                          <div className="w-6 h-6 rounded-full bg-blue-500 border-4 border-white shadow-sm z-10 flex items-center justify-center">
                            <span className="text-[8px] text-white font-bold">{index + 1}</span>
                          </div>
                        </div>

                        {/* Content: city + departure date side by side */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 -mt-1">
                          <div>
                            <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                              Destination {index + 1}
                            </label>
                            <div className="flex gap-2">
                              <div className="flex-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-slate-900 font-medium flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                {city}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeDestination(index)}
                                className="px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                title="Remove destination"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs text-slate-500 mb-2 uppercase font-bold tracking-wider">
                              {isLast ? 'Final Departure' : `Depart for ${destinations[index + 1]}`}
                            </label>
                            {isLast ? (
                              <SingleDatePicker
                                value={endDate}
                                onChange={(date) => setEndDate(date)}
                                minDate={
                                  index === 0
                                    ? startDate || new Date().toISOString().split('T')[0]
                                    : legDates[index - 1] || startDate || new Date().toISOString().split('T')[0]
                                }
                                placeholder="When does the group leave?"
                              />
                            ) : (
                              <SingleDatePicker
                                value={legDates[index] || ''}
                                onChange={(date) => updateLegDate(index, date)}
                                minDate={
                                  index === 0
                                    ? startDate || new Date().toISOString().split('T')[0]
                                    : legDates[index - 1] || startDate || new Date().toISOString().split('T')[0]
                                }
                                placeholder="Select date"
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* ADD DESTINATION */}
                  <div className="flex gap-6 py-4">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-white border-2 border-dashed border-slate-300 z-10" />
                    </div>
                    <div className="flex-1 -mt-1 relative">
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

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-500">
                  Each traveler&apos;s starting airport is set in their profile below — add only the cities everyone will visit together here.
                </p>
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
                    isLoading={traveler.isOwner && isLoadingProfile}
                    onUpdate={(patch) => updateTraveler(traveler.id, patch)}
                    onRemove={() => removeTraveler(traveler.id)}
                    onToggle={() => toggleExpand(traveler.id)}
                    onAddBalance={(program, balance) =>
                      addBalanceToTraveler(traveler.id, program, balance)
                    }
                    onRemoveBalance={(bid) => removeBalance(traveler.id, bid)}
                    onUpdatePreferences={(patch) =>
                      updatePreferences(traveler.id, patch)
                    }
                    canRemove={travelers.length > 1}
                    destinations={destinations}
                  />
                ))}
              </div>
            </div>

            {/* ---- Hotels & Room Assignments ---- */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Toggle header */}
              <button
                type="button"
                onClick={() => setIncludeHotels(!includeHotels)}
                className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
                    <BedDouble className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl text-slate-900 font-semibold">Hotels &amp; Room Assignments</h2>
                    <p className="text-sm text-slate-500">Optionally add hotel rooms and assign travelers to share</p>
                  </div>
                </div>
                <div
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                    includeHotels ? 'bg-indigo-500' : 'bg-slate-200',
                  )}
                  role="switch"
                  aria-checked={includeHotels}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      includeHotels ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </div>
              </button>

              {/* Room assignment body */}
              {includeHotels && (
                <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-5">
                  {/* Info */}
                  <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-indigo-700">
                      Create rooms, pick a hotel tier for each, then drag or click travelers into the rooms they&apos;ll share. Unassigned travelers won&apos;t get hotel bookings.
                    </p>
                  </div>

                  {/* Unassigned travelers pool */}
                  {travelers.length > 0 && (
                    <div>
                      <h3 className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">
                        {unassignedTravelers.length > 0
                          ? `Unassigned Travelers (${unassignedTravelers.length})`
                          : 'All travelers assigned'}
                      </h3>
                      {unassignedTravelers.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {unassignedTravelers.map((t) => {
                            const initials = t.displayName
                              ? t.displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
                              : '?';
                            return (
                              <div
                                key={t.id}
                                className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-sm cursor-default"
                              >
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center text-white text-[10px] font-bold">
                                  {initials}
                                </div>
                                <span className="font-medium text-amber-800 text-xs">{t.displayName || `Traveler`}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          Everyone has a room!
                        </p>
                      )}
                    </div>
                  )}

                  {/* Room cards */}
                  <div className="space-y-4">
                    {rooms.map((room, roomIdx) => {
                      const roomTravelers = travelers.filter((t) =>
                        room.travelerIds.includes(t.id),
                      );
                      const spotsLeft = room.capacity - roomTravelers.length;

                      return (
                        <div
                          key={room.id}
                          className="border border-slate-200 rounded-xl bg-slate-50/50 overflow-hidden"
                        >
                          {/* Room header */}
                          <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center gap-3">
                            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                              <DoorOpen className="w-4 h-4 text-indigo-600" />
                            </div>
                            <input
                              type="text"
                              value={room.label}
                              onChange={(e) => updateRoom(room.id, { label: e.target.value })}
                              className="flex-1 bg-transparent text-sm font-semibold text-slate-900 focus:outline-none focus:ring-0 border-none p-0"
                              placeholder={`Room ${roomIdx + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeRoom(room.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Remove room"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Room settings */}
                          <div className="px-4 py-3 space-y-3">
                            <div className="flex flex-wrap items-center gap-4">
                              {/* Capacity */}
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                                  Capacity
                                </label>
                                <div className="flex items-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateRoom(room.id, {
                                        capacity: Math.max(1, room.capacity - 1),
                                      })
                                    }
                                    disabled={room.capacity <= 1 || room.capacity <= roomTravelers.length}
                                    className="w-7 h-7 flex items-center justify-center rounded-l-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold"
                                  >
                                    −
                                  </button>
                                  <div className="w-10 h-7 flex items-center justify-center border-t border-b border-slate-200 bg-white text-sm font-semibold text-slate-900">
                                    {room.capacity}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateRoom(room.id, {
                                        capacity: room.capacity + 1,
                                      })
                                    }
                                    className="w-7 h-7 flex items-center justify-center rounded-r-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 text-sm font-bold"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Hotel tier */}
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-500 font-medium uppercase tracking-wider">Tier</label>
                                <div className="flex gap-1">
                                  {HOTEL_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => updateRoom(room.id, { hotelPreference: opt.value })}
                                      className={cn(
                                        'px-3 py-1 rounded-lg text-xs font-medium transition-all',
                                        room.hotelPreference === opt.value
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100',
                                      )}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Assigned travelers */}
                            <div>
                              <p className="text-xs text-slate-500 mb-2 font-medium">
                                Guests ({roomTravelers.length}/{room.capacity})
                              </p>
                              <div className="min-h-[52px] flex flex-wrap items-start gap-2 p-3 bg-white border-2 border-dashed border-slate-200 rounded-xl transition-colors">
                                {roomTravelers.length === 0 && (
                                  <p className="text-xs text-slate-400 self-center w-full text-center py-1">
                                    Click a traveler below to assign them here
                                  </p>
                                )}
                                {roomTravelers.map((t) => {
                                  const initials = t.displayName
                                    ? t.displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
                                    : '?';
                                  return (
                                    <div
                                      key={t.id}
                                      className="group inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-xs"
                                    >
                                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold">
                                        {initials}
                                      </div>
                                      <span className="font-medium text-indigo-800">
                                        {t.displayName}
                                        {t.isOwner && (
                                          <span className="ml-1 text-[9px] text-indigo-500">(you)</span>
                                        )}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => unassignTraveler(t.id)}
                                        className="ml-0.5 p-0.5 rounded-full text-indigo-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                                        title="Remove from room"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Assignable traveler list for this room */}
                              {spotsLeft > 0 && unassignedTravelers.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {unassignedTravelers.map((t) => {
                                    const initials = t.displayName
                                      ? t.displayName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
                                      : '?';
                                    return (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => assignTravelerToRoom(t.id, room.id)}
                                        className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 bg-white border border-slate-200 rounded-full text-xs text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-all"
                                        title={`Add ${t.displayName || 'traveler'} to ${room.label}`}
                                      >
                                        <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-[9px] font-bold">
                                          {initials}
                                        </div>
                                        <span className="font-medium">{t.displayName || 'Traveler'}</span>
                                        <Plus className="w-3 h-3 ml-0.5 text-slate-400" />
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add room button */}
                  <button
                    type="button"
                    onClick={addRoom}
                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-indigo-200 rounded-xl text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add a Room
                  </button>
                </div>
              )}
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
                  {(startDate || endDate) && (
                    <div className="flex items-start gap-3">
                      <Calendar className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-700">
                        {startDate && endDate
                          ? `${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : startDate
                            ? `Arrives ${new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                            : `Departs ${new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      </p>
                    </div>
                  )}
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
                      <div>
                        <p className="text-sm text-slate-700">
                          {totalPoints.toLocaleString()} total points
                        </p>
                        <p className="text-xs text-slate-400">
                          {totalBalances} balance{totalBalances !== 1 ? 's' : ''} across group
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <BedDouble className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-slate-700">
                        {includeHotels
                          ? `${rooms.length} room${rooms.length !== 1 ? 's' : ''}`
                          : 'No hotels'}
                      </p>
                      {includeHotels && rooms.length > 0 && (
                        <p className="text-xs text-slate-400">
                          {assignedTravelerIds.size} of {travelers.length} assigned
                        </p>
                      )}
                    </div>
                  </div>
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
                TripsHacker finds the best flights and split for your group, using everyone&apos;s points to save cash.
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
  isLoading?: boolean;
  onUpdate: (patch: Partial<TravelerDraft>) => void;
  onRemove: () => void;
  onToggle: () => void;
  onAddBalance: (program: string, balance: number) => void;
  onRemoveBalance: (id: string) => void;
  onUpdatePreferences: (patch: Partial<PreferencesDraft>) => void;
  canRemove: boolean;
  destinations: string[];
}

function TravelerCard({
  index,
  traveler,
  isLoading,
  onUpdate,
  onRemove,
  onToggle,
  onAddBalance,
  onRemoveBalance,
  onUpdatePreferences,
  canRemove,
  destinations,
}: TravelerCardProps) {
  const [showPrefs, setShowPrefs] = useState(false);
  const [showAddPointsModal, setShowAddPointsModal] = useState(false);
  const [newCategory, setNewCategory] = useState<'credit' | 'airline'>('credit');
  const [newProgram, setNewProgram] = useState('');
  const [newPoints, setNewPoints] = useState('');
  const [programSearchQuery, setProgramSearchQuery] = useState('');
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);

  const filteredPrograms = useMemo(() => {
    return ALL_LOYALTY_PROGRAMS.filter((p) => {
      const matchesCategory = p.category === newCategory || (newCategory === 'credit' && p.category === 'hotel');
      const matchesSearch =
        !programSearchQuery ||
        p.label.toLowerCase().includes(programSearchQuery.toLowerCase());
      const notAlreadyAdded = !traveler.balances.some((b) => b.program === p.value || b.program === p.label);
      return matchesCategory && matchesSearch && notAlreadyAdded;
    });
  }, [newCategory, programSearchQuery, traveler.balances]);

  function handleProgramSelect(programValue: string) {
    setNewProgram(programValue);
    const info = ALL_LOYALTY_PROGRAMS.find((p) => p.value === programValue);
    setProgramSearchQuery(info?.label ?? programValue);
    setShowProgramDropdown(false);
  }

  function handleAddPoints() {
    if (!newProgram || !newPoints) return;
    onAddBalance(newProgram, parseInt(newPoints.replace(/,/g, '')) || 0);
    resetAddModal();
  }

  function resetAddModal() {
    setShowAddPointsModal(false);
    setNewProgram('');
    setNewPoints('');
    setNewCategory('credit');
    setProgramSearchQuery('');
    setShowProgramDropdown(false);
  }

  const initials = traveler.displayName
    ? traveler.displayName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : String(index + 1);

  const totalTravelerPoints = traveler.balances.reduce((s, b) => s + b.balance, 0);

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Collapsed header */}
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
          className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50/60 transition-colors cursor-pointer"
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {isLoading ? 'Loading your profile...' : traveler.displayName || `Traveler ${index + 1}`}
              </p>
              {traveler.isOwner && !isLoading && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold uppercase tracking-wider flex-shrink-0">
                  <User className="w-2.5 h-2.5" />
                  You
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {[
                traveler.originAirport && (
                  traveler.isRoundTrip
                    ? `${traveler.originAirport} (round trip)`
                    : traveler.returnAirport
                      ? `${traveler.originAirport} → ${traveler.returnAirport}`
                      : `From ${traveler.originAirport}`
                ),
                traveler.balances.length > 0 &&
                  `${totalTravelerPoints.toLocaleString()} pts`,
                traveler.cabinPreference !== 'economy' && traveler.cabinPreference.replace('_', ' '),
              ]
                .filter(Boolean)
                .join(' · ') || 'Tap to edit'}
            </p>
          </div>

          {canRemove && !traveler.isOwner && (
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
        </div>

        {/* Expanded body */}
        {traveler.isExpanded && (
          <div className="border-t border-slate-100 px-6 py-5 space-y-6">
            {/* ---- Basic info ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <label className="block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  value={traveler.displayName}
                  onChange={(e) => onUpdate({ displayName: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Plane className="w-3.5 h-3.5 text-slate-400" />
                  Flying from
                </label>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1">
                    <AirportAutocomplete
                      value={traveler.originAirport}
                      onValueChange={(v) => {
                        if (traveler.isRoundTrip) {
                          onUpdate({ originAirport: v, returnAirport: v });
                        } else {
                          onUpdate({ originAirport: v });
                        }
                      }}
                      placeholder="e.g., SEA, JFK"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextRoundTrip = !traveler.isRoundTrip;
                      onUpdate({
                        isRoundTrip: nextRoundTrip,
                        returnAirport: nextRoundTrip ? traveler.originAirport : '',
                      });
                    }}
                    title={traveler.isRoundTrip ? 'Round trip — click for one-way / different return' : 'One-way / different return — click for round trip'}
                    className="px-3 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors text-base font-semibold"
                  >
                    {traveler.isRoundTrip ? '⇄' : '→'}
                  </button>
                  <div className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600 flex items-center truncate">
                    {destinations.length > 0 ? destinations.join(' · ') : (
                      <span className="text-slate-400 italic">Add a destination above</span>
                    )}
                  </div>
                </div>
                {!traveler.isRoundTrip && (
                  <div className="pt-2 space-y-2">
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Return to a different airport
                    </label>
                    <AirportAutocomplete
                      value={traveler.returnAirport}
                      onValueChange={(v) => onUpdate({ returnAirport: v })}
                      placeholder="e.g., LAX, ORD, BOS"
                    />
                  </div>
                )}
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
                      cashBudget: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="Optional"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                />
              </div>
            </div>

            {/* ---- Travel Style (pill buttons like solo) ---- */}
            <div className="space-y-5">
              <div>
                <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Cabin Class</label>
                <div className="flex flex-wrap gap-2">
                  {CABIN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdate({ cabinPreference: opt.value })}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                        traveler.cabinPreference === opt.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* ---- Points & Miles (solo-style) ---- */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800">Points &amp; Miles</h3>
                <button
                  type="button"
                  onClick={() => setShowAddPointsModal(true)}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>

              {traveler.balances.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {traveler.balances.map((bal) => {
                      const category = getProgramCategory(bal.program) ?? 'credit';
                      const Icon = getCategoryIcon(category);
                      return (
                        <div key={bal.id} className="flex items-center justify-between text-sm group">
                          <div className="flex items-center gap-2 truncate">
                            <div className={cn('w-5 h-5 rounded flex items-center justify-center flex-shrink-0', getCategoryColor(category))}>
                              <Icon className="w-3 h-3" />
                            </div>
                            <span className="text-slate-600 truncate">
                              {ALL_LOYALTY_PROGRAMS.find((p) => p.value === bal.program)?.label ?? bal.program}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-900 font-medium">{bal.balance.toLocaleString()}</span>
                            <button
                              type="button"
                              onClick={() => onRemoveBalance(bal.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-opacity"
                              title="Remove"
                            >
                              <X className="w-3 h-3 text-red-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-sm text-slate-600">Total</span>
                    <span className="text-lg font-bold text-blue-600">{totalTravelerPoints.toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-2">
                    <CreditCard className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-xs text-slate-500 mb-1">No points added yet</p>
                  <p className="text-[11px] text-slate-400 mb-3">Add loyalty programs to optimize with points</p>
                  <button
                    type="button"
                    onClick={() => setShowAddPointsModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors font-medium"
                  >
                    Add Points
                  </button>
                </div>
              )}

              {/* Quick Add */}
              {QUICK_ADD_PROGRAMS.some(
                (name) => !traveler.balances.some((b) => b.program === name || ALL_LOYALTY_PROGRAMS.find((p) => p.label === name)?.value === b.program),
              ) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs text-slate-500 mb-2 font-medium">Quick Add</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_ADD_PROGRAMS.filter(
                      (name) => !traveler.balances.some((b) => b.program === name || ALL_LOYALTY_PROGRAMS.find((p) => p.label === name)?.value === b.program),
                    )
                      .slice(0, 4)
                      .map((programName) => {
                        const programInfo = ALL_LOYALTY_PROGRAMS.find(
                          (p) => p.value === programName || p.label === programName,
                        );
                        if (!programInfo) return null;
                        return (
                          <button
                            key={programInfo.value}
                            type="button"
                            onClick={() => {
                              setNewProgram(programInfo.value);
                              setNewCategory(programInfo.category === 'hotel' ? 'credit' : (programInfo.category as 'credit' | 'airline'));
                              setProgramSearchQuery(programInfo.label);
                              setShowAddPointsModal(true);
                            }}
                            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all"
                          >
                            {programInfo.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* ---- Contribution Preferences ---- */}
            <div>
              <button
                type="button"
                onClick={() => setShowPrefs(!showPrefs)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                {showPrefs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Contribution Preferences
              </button>

              {showPrefs && (
                <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
                  {/* Points priority as pill buttons */}
                  <div>
                    <label className="block text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">
                      Points Usage Priority
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 'low', label: 'Prefer Cash' },
                        { value: 'medium', label: 'Balanced' },
                        { value: 'high', label: 'Use Points First' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onUpdatePreferences({ usePointsPriority: opt.value as 'low' | 'medium' | 'high' })
                          }
                          className={cn(
                            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                            traveler.preferences.usePointsPriority === opt.value
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Budget caps */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-600">Max Cash Contribution</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                        <input
                          type="number"
                          min={0}
                          value={traveler.preferences.maxCashContribution ?? ''}
                          onChange={(e) =>
                            onUpdatePreferences({
                              maxCashContribution: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          onWheel={(e) => e.currentTarget.blur()}
                          placeholder="No limit"
                          className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-600">Max Points Value (USD)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                        <input
                          type="number"
                          min={0}
                          value={traveler.preferences.maxPointValueContributionUsd ?? ''}
                          onChange={(e) =>
                            onUpdatePreferences({
                              maxPointValueContributionUsd: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          onWheel={(e) => e.currentTarget.blur()}
                          placeholder="No limit"
                          className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3 pt-1">
                    <ToggleSwitch
                      label="Allow Transfer Partners"
                      description="Let the optimizer transfer points between programs"
                      checked={traveler.preferences.allowTransferPartners}
                      onChange={(v) => onUpdatePreferences({ allowTransferPartners: v })}
                    />
                    <ToggleSwitch
                      label="Allow Hotel Points"
                      description="Use hotel loyalty points for bookings"
                      checked={traveler.preferences.allowHotelPoints}
                      onChange={(v) => onUpdatePreferences({ allowHotelPoints: v })}
                    />
                    <ToggleSwitch
                      label="Allow Flight Points"
                      description="Use airline miles for flight bookings"
                      checked={traveler.preferences.allowFlightPoints}
                      onChange={(v) => onUpdatePreferences({ allowFlightPoints: v })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Points Modal */}
      {showAddPointsModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={resetAddModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl text-slate-900 font-semibold">
                  Add Loyalty Program
                </h2>
                <button
                  type="button"
                  onClick={resetAddModal}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>
              {traveler.displayName && (
                <p className="text-sm text-slate-500 mt-1">
                  For {traveler.displayName}
                </p>
              )}
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-6">
              <div className="space-y-5">
                {/* Category Toggle */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'credit', label: 'Credit Card / Hotel', icon: CreditCard },
                      { value: 'airline', label: 'Airline', icon: Plane },
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setNewCategory(value as 'credit' | 'airline');
                          setNewProgram('');
                          setProgramSearchQuery('');
                        }}
                        className={cn(
                          'px-4 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2',
                          newCategory === value
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-slate-300',
                        )}
                      >
                        <Icon className={cn('w-5 h-5', newCategory === value ? 'text-blue-600' : 'text-slate-600')} />
                        <span className={cn('text-xs font-medium', newCategory === value ? 'text-blue-600' : 'text-slate-600')}>
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Program Dropdown */}
                <div className="relative">
                  <label className="block text-sm text-slate-600 mb-2 font-medium">
                    Program Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={programSearchQuery || (newProgram ? ALL_LOYALTY_PROGRAMS.find((p) => p.value === newProgram)?.label ?? '' : '')}
                      onChange={(e) => {
                        setProgramSearchQuery(e.target.value);
                        setShowProgramDropdown(true);
                        if (e.target.value !== (ALL_LOYALTY_PROGRAMS.find((p) => p.value === newProgram)?.label ?? '')) {
                          setNewProgram('');
                        }
                      }}
                      onFocus={() => setShowProgramDropdown(true)}
                      placeholder="Search or select a program..."
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent pr-10"
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />

                    {showProgramDropdown && filteredPrograms.length > 0 && (
                      <div
                        className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {filteredPrograms.map((program) => {
                          const Icon = getCategoryIcon(program.category);
                          return (
                            <button
                              key={program.value}
                              type="button"
                              onClick={() => handleProgramSelect(program.value)}
                              className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-b-0 flex items-center gap-3"
                            >
                              <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center', getCategoryColor(program.category))}>
                                <Icon className="w-3 h-3" />
                              </div>
                              <span className="text-sm font-medium text-slate-900">{program.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {newProgram && !isValidProgram(newProgram) && (
                    <p className="text-xs text-red-500 mt-1">Please select a valid program from the list</p>
                  )}
                </div>

                {/* Points Balance */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-medium">Points Balance</label>
                  <input
                    type="number"
                    value={newPoints}
                    onChange={(e) => setNewPoints(e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="e.g., 150000"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-4 border-t border-slate-200 flex-shrink-0">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={resetAddModal}
                  className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddPoints}
                  disabled={!newProgram.trim() || !newPoints.trim() || !isValidProgram(newProgram)}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Program
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Toggle Switch (matches solo page style)
// ===========================================================================

function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none group">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
        <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5" />
      </div>
      <div>
        <span className="text-sm text-slate-700 font-medium group-hover:text-slate-900 transition-colors">
          {label}
        </span>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
}
