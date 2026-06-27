'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plane,
  Hotel,
  Heart,
  Calendar,
  MapPin,
  Users,
  DollarSign,
  StickyNote,
  Plus,
  X,
  Crown,
  UserPlus,
  Hash,
  Globe,
  Minus,
  Search,
  Mail,
  Phone,
} from 'lucide-react';
import { createTripRequest, getClients, getClientBalances } from '@/lib/api-client';
import type { Client, TripRequestCreatePayload, LoyaltyBalance } from '@/lib/api-client';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CABIN_OPTIONS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
  { value: 'flexible', label: 'Flexible' },
];

const HOTEL_STYLES = [
  'Boutique',
  'Resort',
  'Major Chain',
  'All-Inclusive',
  'Vacation Rental / Airbnb',
  'Villa / Private',
  'Eco-Lodge',
  'Hostel / Budget',
  'Luxury / 5-Star',
  'Bed & Breakfast',
];

const PACE_OPTIONS = [
  { value: 'relaxed', label: 'Relaxed — Plenty of downtime' },
  { value: 'moderate', label: 'Moderate — Mix of activities and rest' },
  { value: 'active', label: 'Active — Packed mornings, relaxed evenings' },
  { value: 'packed', label: 'Packed — Go-go-go, see everything' },
];

const TRIP_TYPE_OPTIONS = [
  { value: 'leisure', label: 'Leisure' },
  { value: 'business', label: 'Business' },
  { value: 'honeymoon', label: 'Honeymoon' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'family_vacation', label: 'Family Vacation' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'group', label: 'Group Trip' },
  { value: 'other', label: 'Other' },
];

const EXPERIENCE_SUGGESTIONS = [
  'Beach & Relaxation',
  'Fine Dining',
  'Cultural / Historical Sites',
  'Wildlife / Safari',
  'Skiing / Snow Sports',
  'Scuba Diving / Snorkeling',
  'Spa & Wellness',
  'Nightlife',
  'Hiking / Nature',
  'City Exploration',
  'Wine / Food Tours',
  'Shopping',
  'Water Sports',
  'Photography',
  'Family Activities',
  'Art & Museums',
  'Festivals / Events',
  'Road Trips',
];

const BUDGET_CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CAD', label: 'CAD (C$)' },
  { value: 'AUD', label: 'AUD (A$)' },
  { value: 'JPY', label: 'JPY (¥)' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepDef {
  id: string;
  label: string;
  icon: React.ElementType;
}

const STEPS: StepDef[] = [
  { id: 'overview', label: 'Trip Overview', icon: MapPin },
  { id: 'dates', label: 'Travel Dates', icon: Calendar },
  { id: 'travelers', label: 'Travelers & Routes', icon: Users },
  { id: 'flights', label: 'Flight Preferences', icon: Plane },
  { id: 'budget', label: 'Budget & Points', icon: DollarSign },
  { id: 'accommodation', label: 'Accommodation', icon: Hotel },
  { id: 'experiences', label: 'Activities & Interests', icon: Heart },
  { id: 'notes', label: 'Notes & Requests', icon: StickyNote },
];

type TravelerEntry = {
  id: string;
  type: 'individual' | 'bulk';
  client: Client | null;
  quantity: number;
  useLeaderCities: boolean;
  startingCity: string[];
  endingCity: string[];
  returnToStart: boolean;
};

interface TripFormData {
  tripType: string;
  tripName: string;
  destinations: string[];
  departureDate: string;
  returnDate: string;
  flexibilityDays: string;
  leaderStartingCity: string[];
  leaderEndingCity: string[];
  leaderReturnToStart: boolean;
  cabinPreference: string;
  budgetAmount: string;
  budgetCurrency: string;
  budgetNotes: string;
  hotelStyles: string[];
  accommodationNotes: string;
  travelPace: string;
  desiredExperiences: string[];
  notes: string;
}

const EMPTY_FORM: TripFormData = {
  tripType: '',
  tripName: '',
  destinations: [],
  departureDate: '',
  returnDate: '',
  flexibilityDays: '',
  leaderStartingCity: [],
  leaderEndingCity: [],
  leaderReturnToStart: true,
  cabinPreference: '',
  budgetAmount: '',
  budgetCurrency: 'USD',
  budgetNotes: '',
  hotelStyles: [],
  accommodationNotes: '',
  travelPace: '',
  desiredExperiences: [],
  notes: '',
};

// ---------------------------------------------------------------------------
// Local-dev convenience: type "joe" into the Trip Name field to auto-fill the
// whole form with realistic dummy data so you don't have to retype everything
// when testing. Only active in development builds (`npm run dev`) — never ships
// to production.
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === 'development';
const DUMMY_TRIGGER = 'joe';

const DUMMY_FORM: TripFormData = {
  tripType: 'honeymoon',
  tripName: 'Joe & Dummy — Italy Honeymoon',
  destinations: ['FCO', 'VCE'],
  departureDate: '2026-09-15',
  returnDate: '2026-09-25',
  flexibilityDays: '3',
  leaderStartingCity: ['SFO'],
  leaderEndingCity: ['SFO'],
  leaderReturnToStart: true,
  cabinPreference: 'business',
  budgetAmount: '15000',
  budgetCurrency: 'USD',
  budgetNotes: 'Flexible if it means lie-flat seats on the long-haul legs.',
  hotelStyles: ['Boutique', 'Luxury / 5-Star'],
  accommodationNotes: 'Central location, walkable to old town. King bed.',
  travelPace: 'moderate',
  desiredExperiences: ['Fine Dining', 'Cultural / Historical Sites', 'Wine / Food Tours'],
  notes: 'Celebrating our honeymoon — anything special the hotels can do is a plus.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TripForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TripFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Client state
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // Traveler state
  const [travelers, setTravelers] = useState<TravelerEntry[]>([]);
  const [activeTravelerDropdown, setActiveTravelerDropdown] = useState<string | null>(null);
  const [travelerClientSearch, setTravelerClientSearch] = useState('');
  const travelerIdRef = useRef(0);

  // Point balance state for trip constraints
  type PointBalanceEntry = {
    loyaltyProgramId: string;
    programName: string;
    storedBalance: number;
    overrideBalance: string;
    enabled: boolean;
  };
  const [pointBalances, setPointBalances] = useState<PointBalanceEntry[]>([]);
  const [pointBalancesLoading, setPointBalancesLoading] = useState(false);

  useEffect(() => {
    getClients()
      .then(setClients)
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
      const target = e.target as HTMLElement;
      if (!target.closest('[data-traveler-dropdown]')) {
        setActiveTravelerDropdown(null);
        setTravelerClientSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  // Fetch client loyalty balances when client is selected
  useEffect(() => {
    if (!selectedClient) {
      setPointBalances([]);
      return;
    }
    setPointBalancesLoading(true);
    getClientBalances(selectedClient.id)
      .then((balances) => {
        setPointBalances(
          balances.map((b) => ({
            loyaltyProgramId: b.loyaltyProgramId,
            programName: b.loyaltyProgram?.name ?? b.programName ?? 'Unknown',
            storedBalance: b.balance,
            overrideBalance: String(b.balance),
            enabled: true,
          })),
        );
      })
      .catch(() => setPointBalances([]))
      .finally(() => setPointBalancesLoading(false));
  }, [selectedClient]);

  const set = useCallback(<K extends keyof TripFormData>(key: K, value: TripFormData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleArrayItem = useCallback((key: 'hotelStyles' | 'desiredExperiences', item: string) => {
    setForm((f) => {
      const arr = f[key];
      return {
        ...f,
        [key]: arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item],
      };
    });
  }, []);

  // Local-dev only: fill every field with dummy data and pick the first
  // available client as the lead traveler so the form can be submitted in a
  // couple of clicks. Triggered by typing "joe" into the Trip Name field.
  const fillDummyData = useCallback(() => {
    setForm(DUMMY_FORM);
    setSelectedClient((cur) => cur ?? clients[0] ?? null);
  }, [clients]);

  // Client search
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

  // Traveler helpers
  const addTraveler = () => {
    travelerIdRef.current += 1;
    setTravelers((prev) => [
      ...prev,
      {
        id: `t-${travelerIdRef.current}`,
        type: 'individual',
        client: null,
        quantity: 1,
        useLeaderCities: true,
        startingCity: [],
        endingCity: [],
        returnToStart: true,
      },
    ]);
  };

  const addBulkGroup = () => {
    travelerIdRef.current += 1;
    setTravelers((prev) => [
      ...prev,
      {
        id: `t-${travelerIdRef.current}`,
        type: 'bulk',
        client: null,
        quantity: 10,
        useLeaderCities: true,
        startingCity: [],
        endingCity: [],
        returnToStart: true,
      },
    ]);
  };

  const removeTraveler = (id: string) => {
    setTravelers((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTraveler = (id: string, updates: Partial<TravelerEntry>) => {
    setTravelers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const totalTravelerCount = useMemo(() => {
    return 1 + travelers.reduce((sum, t) => sum + t.quantity, 0);
  }, [travelers]);

  const filteredTravelerClients = useMemo(() => {
    const selectedIds = new Set<string>();
    if (selectedClient) selectedIds.add(selectedClient.id);
    for (const t of travelers) {
      if (t.client) selectedIds.add(t.client.id);
    }
    let available = clients.filter((c) => !selectedIds.has(c.id));
    if (travelerClientSearch.trim()) {
      const q = travelerClientSearch.toLowerCase();
      available = available.filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q),
      );
    }
    return available;
  }, [clients, selectedClient, travelers, travelerClientSearch]);

  // Navigation
  const canGoNext = step < STEPS.length - 1;
  const canGoPrev = step > 0;
  const goNext = () => canGoNext && setStep((s) => s + 1);
  const goPrev = () => canGoPrev && setStep((s) => s - 1);

  // Validation
  const isFormValid = useMemo(() => {
    if (!selectedClient) return false;
    if (form.destinations.length === 0) return false;
    if (form.leaderStartingCity.length === 0) return false;
    if (!form.departureDate) return false;
    for (const t of travelers) {
      if (!t.useLeaderCities) {
        if (t.startingCity.length === 0) return false;
        if (!t.returnToStart && t.endingCity.length === 0) return false;
      }
    }
    return true;
  }, [selectedClient, form, travelers]);

  // Submit
  const handleCreateTrip = async () => {
    if (!isFormValid || !selectedClient) return;
    setSaving(true);
    setSaveError(null);
    try {
      const leaderEndingCity = form.leaderReturnToStart
        ? form.leaderStartingCity
        : form.leaderEndingCity;

      const flightPlan = {
        sharedDestinations: form.destinations,
        leader: {
          clientId: selectedClient.id,
          clientName: `${selectedClient.firstName} ${selectedClient.lastName}`,
          startingCity: form.leaderStartingCity,
          endingCity: leaderEndingCity,
        },
        travelers: travelers.map((t) => {
          const effectiveStarting = t.useLeaderCities ? form.leaderStartingCity : t.startingCity;
          const effectiveEnding = t.useLeaderCities
            ? leaderEndingCity
            : t.returnToStart
              ? t.startingCity
              : t.endingCity;
          return {
            id: t.id,
            type: t.type,
            clientId: t.client?.id || null,
            clientName: t.client ? `${t.client.firstName} ${t.client.lastName}` : null,
            quantity: t.quantity,
            useLeaderCities: t.useLeaderCities,
            startingCity: effectiveStarting,
            endingCity: effectiveEnding,
          };
        }),
      };

      // Build enriched notes with all extra form data
      const extraParts: string[] = [];
      extraParts.push(`[FLIGHT_PLAN:${JSON.stringify(flightPlan)}]`);
      if (form.tripType) extraParts.push(`[TRIP_TYPE:${form.tripType}]`);
      if (form.travelPace) extraParts.push(`[TRAVEL_PACE:${form.travelPace}]`);
      if (form.hotelStyles.length > 0)
        extraParts.push(`[HOTEL_STYLES:${form.hotelStyles.join(',')}]`);
      if (form.desiredExperiences.length > 0)
        extraParts.push(`[EXPERIENCES:${form.desiredExperiences.join(',')}]`);
      if (form.accommodationNotes.trim())
        extraParts.push(`[ACCOMMODATION_NOTES:${form.accommodationNotes.trim()}]`);
      if (form.budgetNotes.trim())
        extraParts.push(`[BUDGET_NOTES:${form.budgetNotes.trim()}]`);

      const metaBlock = extraParts.join('\n');
      const userNotes = form.notes.trim();
      const combinedNotes = userNotes ? `${metaBlock}\n${userNotes}` : metaBlock;

      const payload: TripRequestCreatePayload = {
        clientId: selectedClient.id,
        title:
          form.tripName.trim() ||
          (form.destinations.length > 0
            ? `Trip to ${form.destinations.join(', ')}`
            : 'Trip Request'),
        originAirports: form.leaderStartingCity,
        destinationAirports: form.destinations,
        departureDate: form.departureDate,
        returnDate: form.returnDate || undefined,
        travelerCount: totalTravelerCount,
        cabinPreference: form.cabinPreference || undefined,
        flexibilityDays: form.flexibilityDays ? parseInt(form.flexibilityDays) : undefined,
        budgetCash: form.budgetAmount ? parseInt(form.budgetAmount) : undefined,
        pointBalances: pointBalances
          .filter((pb) => pb.enabled && pb.overrideBalance && parseInt(pb.overrideBalance) > 0)
          .map((pb) => ({
            loyaltyProgramId: pb.loyaltyProgramId,
            programName: pb.programName,
            balance: parseInt(pb.overrideBalance),
          })),
        notes: combinedNotes,
      };

      await createTripRequest(payload);
      window.location.href = '/trips';
    } catch (err) {
      console.error('Failed to create trip:', err);
      setSaveError('Failed to create trip. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Helper class shorthands (matching intake form styling)
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';
  const chipCls = (active: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    }`;
  const radioRowCls = (active: boolean) =>
    `flex w-full items-center rounded-lg border px-4 py-3 text-left text-sm transition-colors cursor-pointer ${
      active
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
    }`;

  // ---------------------------------------------------------------------------
  // Step completion tracking
  // ---------------------------------------------------------------------------

  const filledSteps = STEPS.map((s) => {
    switch (s.id) {
      case 'overview':
        return !!(selectedClient && form.destinations.length > 0);
      case 'dates':
        return !!form.departureDate;
      case 'travelers':
        return form.leaderStartingCity.length > 0;
      case 'flights':
        return !!form.cabinPreference;
      case 'budget':
        return !!form.budgetAmount;
      case 'accommodation':
        return form.hotelStyles.length > 0;
      case 'experiences':
        return form.desiredExperiences.length > 0 || !!form.travelPace;
      case 'notes':
        return !!form.notes.trim();
      default:
        return false;
    }
  });

  const completedStepCount = filledSteps.filter(Boolean).length;
  const progressPct = Math.round((completedStepCount / STEPS.length) * 100);

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    switch (STEPS[step].id) {

      // ── Step 1: Trip Overview ───────────────────────────────────────────────
      case 'overview':
        return (
          <div className="space-y-6">
            {/* Client / Group Leader */}
            <div>
              <label className={labelCls}>
                <span className="inline-flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-amber-500" />
                  Client / Group Leader *
                </span>
              </label>
              {selectedClient ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                    {selectedClient.firstName?.[0]}{selectedClient.lastName?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {selectedClient.firstName} {selectedClient.lastName}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3">
                      {selectedClient.email && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <Mail className="h-3 w-3" /> {selectedClient.email}
                        </span>
                      )}
                      {selectedClient.phone && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <Phone className="h-3 w-3" /> {selectedClient.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedClient(null); setClientSearch(''); }}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div ref={clientDropdownRef} className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder={clientsLoading ? 'Loading clients...' : 'Search for a client...'}
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setShowClientDropdown(true);
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                      disabled={clientsLoading}
                      className={`w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 ${clientsLoading ? 'opacity-60' : ''}`}
                    />
                  </div>
                  {showClientDropdown && !clientsLoading && (
                    <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {filteredClients.length === 0 ? (
                        <div className="px-4 py-3 text-center text-sm text-slate-400">
                          No clients found
                        </div>
                      ) : (
                        filteredClients.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedClient(c);
                              setClientSearch('');
                              setShowClientDropdown(false);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-blue-50"
                          >
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                              {c.firstName?.[0]}{c.lastName?.[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">
                                {c.firstName} {c.lastName}
                              </p>
                              {c.email && (
                                <p className="truncate text-xs text-slate-500">{c.email}</p>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Trip Type */}
            <div>
              <label className={labelCls}>What kind of trip is this?</label>
              <div className="flex flex-wrap gap-2">
                {TRIP_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('tripType', opt.value)}
                    className={chipCls(form.tripType === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Trip Name */}
            <div>
              <label className={labelCls}>Trip Name</label>
              <input
                type="text"
                value={form.tripName}
                onChange={(e) => {
                  const value = e.target.value;
                  // Dev shortcut: typing "joe" auto-fills the whole form.
                  if (IS_DEV && value.trim().toLowerCase() === DUMMY_TRIGGER) {
                    fillDummyData();
                    return;
                  }
                  set('tripName', value);
                }}
                placeholder="e.g. Summer Italy Trip, Smith Honeymoon..."
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-400">
                Optional — we&apos;ll generate one from the destinations if left blank
              </p>
              {IS_DEV && (
                <p className="mt-1 text-xs text-amber-500">
                  Dev shortcut: type &quot;joe&quot; here to auto-fill dummy data.
                </p>
              )}
            </div>

            {/* Destinations */}
            <div>
              <label className={labelCls}>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                  Destinations *
                </span>
              </label>
              <MultiAirportAutocomplete
                value={form.destinations}
                onChange={(airports) => set('destinations', airports)}
                placeholder="Search destination cities..."
                maxSelections={10}
              />
              <p className="mt-1 text-xs text-slate-400">
                Cities the travelers are visiting
              </p>
            </div>
          </div>
        );

      // ── Step 2: Travel Dates ────────────────────────────────────────────────
      case 'dates':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Departure Date *</label>
                <SingleDatePicker
                  value={form.departureDate}
                  onChange={(v) => set('departureDate', v)}
                />
              </div>
              <div>
                <label className={labelCls}>Return Date</label>
                <SingleDatePicker
                  value={form.returnDate}
                  onChange={(v) => set('returnDate', v)}
                  defaultFocusedDate={form.departureDate}
                  markedDate={form.departureDate}
                  markedDateLabel="Departure date"
                  minDate={form.departureDate || undefined}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Date Flexibility (days)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 3 — how many days can dates shift?"
                value={form.flexibilityDays}
                onChange={(e) => set('flexibilityDays', e.target.value)}
                className={`max-w-xs ${inputCls}`}
              />
              <p className="mt-1 text-xs text-slate-400">
                How many days can the departure/return shift for better deals?
              </p>
            </div>
          </div>
        );

      // ── Step 3: Travelers & Routes ──────────────────────────────────────────
      case 'travelers':
        return (
          <div className="space-y-6">
            {form.destinations.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
                <Globe className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-xs text-blue-700">
                  Everyone flying to{' '}
                  <span className="font-semibold">{form.destinations.join(', ')}</span>
                </span>
              </div>
            )}

            {/* Group Leader */}
            {selectedClient ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                    {selectedClient.firstName?.[0]}{selectedClient.lastName?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {selectedClient.firstName} {selectedClient.lastName}
                    </p>
                    <p className="text-[10px] text-slate-500">Group Leader</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    <Crown className="h-2.5 w-2.5" />
                    Leader
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">
                      Starting City *
                    </label>
                    <MultiAirportAutocomplete
                      value={form.leaderStartingCity}
                      onChange={(airports) => set('leaderStartingCity', airports)}
                      placeholder="Flying from..."
                      maxSelections={3}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">
                      Ending City
                    </label>
                    {form.leaderReturnToStart ? (
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="flex-1 text-xs text-slate-500">
                          {form.leaderStartingCity.length > 0
                            ? form.leaderStartingCity.join(', ')
                            : 'Same as starting city'}
                        </span>
                      </div>
                    ) : (
                      <MultiAirportAutocomplete
                        value={form.leaderEndingCity}
                        onChange={(airports) => set('leaderEndingCity', airports)}
                        placeholder="Returning to..."
                        maxSelections={3}
                      />
                    )}
                  </div>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.leaderReturnToStart}
                    onChange={(e) => set('leaderReturnToStart', e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-slate-600">Return to starting city</span>
                </label>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                <p className="text-sm text-amber-700">
                  Select a client in the Trip Overview step first
                </p>
              </div>
            )}

            {/* Additional Travelers */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  Additional Travelers
                  <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {totalTravelerCount} total
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addTraveler}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  >
                    <UserPlus className="h-3 w-3" />
                    Add Traveler
                  </button>
                  <button
                    type="button"
                    onClick={addBulkGroup}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
                  >
                    <Hash className="h-3 w-3" />
                    Bulk Group
                  </button>
                </div>
              </div>

              {travelers.map((traveler, idx) => (
                <div
                  key={traveler.id}
                  className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {traveler.type === 'bulk' ? 'Bulk Group' : `Traveler ${idx + 2}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTraveler(traveler.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {traveler.type === 'individual' ? (
                    <div className="space-y-2">
                      {traveler.client ? (
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                            {traveler.client.firstName?.[0]}{traveler.client.lastName?.[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800">
                              {traveler.client.firstName} {traveler.client.lastName}
                            </p>
                            {traveler.client.email && (
                              <p className="text-[11px] text-slate-500">{traveler.client.email}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => updateTraveler(traveler.id, { client: null })}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative" data-traveler-dropdown>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              placeholder="Search for a client..."
                              value={activeTravelerDropdown === traveler.id ? travelerClientSearch : ''}
                              onChange={(e) => {
                                setTravelerClientSearch(e.target.value);
                                setActiveTravelerDropdown(traveler.id);
                              }}
                              onFocus={() => setActiveTravelerDropdown(traveler.id)}
                              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                            />
                          </div>
                          {activeTravelerDropdown === traveler.id && (
                            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                              {filteredTravelerClients.length === 0 ? (
                                <div className="px-4 py-2 text-center text-xs text-slate-400">
                                  No clients found
                                </div>
                              ) : (
                                filteredTravelerClients.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      updateTraveler(traveler.id, { client: c });
                                      setActiveTravelerDropdown(null);
                                      setTravelerClientSearch('');
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-blue-50"
                                  >
                                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                                      {c.firstName?.[0]}{c.lastName?.[0]}
                                    </div>
                                    <span className="truncate font-medium text-slate-700">
                                      {c.firstName} {c.lastName}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-slate-600">Quantity:</label>
                      <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            updateTraveler(traveler.id, {
                              quantity: Math.max(1, traveler.quantity - 1),
                            })
                          }
                          className="rounded-l-lg px-2.5 py-1.5 text-slate-500 transition-colors hover:bg-slate-50"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={traveler.quantity}
                          onChange={(e) =>
                            updateTraveler(traveler.id, {
                              quantity: Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="w-20 border-x border-slate-200 py-1.5 text-center text-sm font-medium text-slate-800 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateTraveler(traveler.id, {
                              quantity: traveler.quantity + 1,
                            })
                          }
                          className="rounded-r-lg px-2.5 py-1.5 text-slate-500 transition-colors hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-[11px] text-slate-500">travelers</span>
                    </div>
                  )}

                  {/* City Configuration */}
                  <div className="mt-2.5">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={traveler.useLeaderCities}
                        onChange={(e) =>
                          updateTraveler(traveler.id, { useLeaderCities: e.target.checked })
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-600">
                        Same cities as{' '}
                        {selectedClient ? selectedClient.firstName : 'Leader'}
                      </span>
                    </label>
                  </div>

                  {!traveler.useLeaderCities && (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-slate-500">
                            Starting City <span className="text-red-500">*</span>
                          </label>
                          <MultiAirportAutocomplete
                            value={traveler.startingCity}
                            onChange={(airports) =>
                              updateTraveler(traveler.id, { startingCity: airports })
                            }
                            placeholder="Flying from..."
                            maxSelections={3}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-slate-500">
                            Ending City <span className="text-red-500">*</span>
                          </label>
                          {traveler.returnToStart ? (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <span className="flex-1 text-[11px] text-slate-500">
                                {traveler.startingCity.length > 0
                                  ? traveler.startingCity.join(', ')
                                  : 'Same as starting city'}
                              </span>
                            </div>
                          ) : (
                            <MultiAirportAutocomplete
                              value={traveler.endingCity}
                              onChange={(airports) =>
                                updateTraveler(traveler.id, { endingCity: airports })
                              }
                              placeholder="Returning to..."
                              maxSelections={3}
                            />
                          )}
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={traveler.returnToStart}
                          onChange={(e) =>
                            updateTraveler(traveler.id, { returnToStart: e.target.checked })
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[11px] text-slate-600">Return to starting city</span>
                      </label>
                    </div>
                  )}
                </div>
              ))}

              {travelers.length === 0 && selectedClient && (
                <p className="mt-1 text-xs text-slate-400">
                  Add individual travelers or a bulk group to book for multiple people.
                </p>
              )}
            </div>
          </div>
        );

      // ── Step 4: Flight Preferences ──────────────────────────────────────────
      case 'flights':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Preferred cabin class</label>
              <div className="flex flex-wrap gap-2">
                {CABIN_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => set('cabinPreference', c.value)}
                    className={chipCls(form.cabinPreference === c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      // ── Step 5: Budget & Points ────────────────────────────────────────────
      case 'budget':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Total Cash Budget</label>
              <div className="flex gap-3">
                <select
                  value={form.budgetCurrency}
                  onChange={(e) => set('budgetCurrency', e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {BUDGET_CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 5000"
                  value={form.budgetAmount}
                  onChange={(e) => set('budgetAmount', e.target.value)}
                  className={`max-w-xs ${inputCls}`}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Maximum out-of-pocket cash for this trip (flights, hotels, activities, etc.)
              </p>
            </div>

            {/* Points Balances */}
            <div>
              <label className={labelCls}>Points & Miles Available</label>
              {!selectedClient ? (
                <p className="text-sm text-slate-400">Select a client first to see their loyalty balances.</p>
              ) : pointBalancesLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading balances…
                </div>
              ) : pointBalances.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No loyalty balances on file for this client. Add balances on the client profile to use points for this trip.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">
                    Toggle which balances to use and adjust amounts available for this trip.
                  </p>
                  {pointBalances.map((pb, idx) => (
                    <div
                      key={pb.loyaltyProgramId}
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                        pb.enabled
                          ? 'border-blue-200 bg-blue-50/50'
                          : 'border-slate-200 bg-slate-50 opacity-60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPointBalances((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, enabled: !p.enabled } : p,
                            ),
                          );
                        }}
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                          pb.enabled
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {pb.enabled && <Check className="h-3 w-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-700">{pb.programName}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          ({pb.storedBalance.toLocaleString()} on file)
                        </span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={pb.overrideBalance}
                        disabled={!pb.enabled}
                        onChange={(e) => {
                          setPointBalances((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, overrideBalance: e.target.value } : p,
                            ),
                          );
                        }}
                        className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <span className="text-xs text-slate-400 w-8">pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Budget Notes</label>
              <textarea
                value={form.budgetNotes}
                onChange={(e) => set('budgetNotes', e.target.value)}
                rows={3}
                placeholder="e.g. Flexible on flights but want to save on accommodation, willing to splurge on dining..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      // ── Step 6: Accommodation ───────────────────────────────────────────────
      case 'accommodation':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Preferred hotel styles for this trip</label>
              <div className="flex flex-wrap gap-2">
                {HOTEL_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => toggleArrayItem('hotelStyles', style)}
                    className={chipCls(form.hotelStyles.includes(style))}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Accommodation notes</label>
              <textarea
                value={form.accommodationNotes}
                onChange={(e) => set('accommodationNotes', e.target.value)}
                rows={3}
                placeholder="e.g. Need connecting rooms, prefer ocean view, want a hotel with pool for the kids..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      // ── Step 7: Activities & Interests ──────────────────────────────────────
      case 'experiences':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>What do they want to do on this trip?</label>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_SUGGESTIONS.map((exp) => (
                  <button
                    key={exp}
                    type="button"
                    onClick={() => toggleArrayItem('desiredExperiences', exp)}
                    className={chipCls(form.desiredExperiences.includes(exp))}
                  >
                    {exp}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Desired pace for this trip</label>
              <div className="space-y-2">
                {PACE_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('travelPace', p.value)}
                    className={radioRowCls(form.travelPace === p.value)}
                  >
                    {form.travelPace === p.value && (
                      <Check className="mr-2 h-4 w-4 text-blue-600" />
                    )}
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      // ── Step 8: Notes & Special Requests ────────────────────────────────────
      case 'notes':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Additional Notes & Special Requests</label>
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={6}
                placeholder="Any special requirements, celebrations, dietary needs, accessibility needs, or anything else we should know about this trip..."
                className={`resize-none ${inputCls}`}
              />
            </div>
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
    <div ref={topRef} className="max-w-4xl">
      {/* Header */}
      <Link
        href="/trips"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Trips
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Plan a New Trip</h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedClient
              ? `For ${selectedClient.firstName} ${selectedClient.lastName}`
              : 'Fill in the details to create a trip request'}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            {completedStepCount} of {STEPS.length} sections filled
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
        <nav className="hidden w-56 shrink-0 md:block">
          <div className="space-y-1">
            {STEPS.map((s, i) => {
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
              {step + 1}/{STEPS.length}
            </span>
            <span className="text-sm font-medium text-slate-700">{STEPS[step].label}</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
              {(() => {
                const Icon = STEPS[step].icon;
                return <Icon className="h-5 w-5 text-blue-600" />;
              })()}
              {STEPS[step].label}
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
              <Link
                href="/trips"
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Cancel
              </Link>

              {step === STEPS.length - 1 ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={handleCreateTrip}
                    disabled={saving || !isFormValid}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plane className="h-4 w-4" />
                    )}
                    {saving ? 'Creating...' : 'Create Trip'}
                  </button>
                  {saveError && <span className="text-xs text-red-600">{saveError}</span>}
                  {!isFormValid && !saving && (
                    <span className="text-xs text-amber-600">
                      {!selectedClient
                        ? 'Select a client in Trip Overview'
                        : form.destinations.length === 0
                          ? 'Add destinations in Trip Overview'
                          : form.leaderStartingCity.length === 0
                            ? 'Set starting city in Travelers & Routes'
                            : !form.departureDate
                              ? 'Set departure date in Travel Dates'
                              : 'Fill in required fields'}
                    </span>
                  )}
                </div>
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
  );
}
