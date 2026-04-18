'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plane,
  Search,
  Loader2,
  Calendar,
  MapPin,
  Mail,
  Phone,
  User,
  Users,
  Filter,
  Plus,
  X,
  Crown,
  UserPlus,
  Minus,
  Hash,
  Globe,
  Video,
} from 'lucide-react';
import { getTripRequests, getClients, createTripRequest, createMeetingSession } from '@/lib/api-client';
import type { TripRequest, Client, TripRequestCreatePayload } from '@/lib/api-client';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

type StatusFilter = 'all' | 'draft' | 'analyzing' | 'complete' | 'archived';

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

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  draft: { bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' },
  analyzing: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  complete: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  archived: { bg: 'bg-slate-50', text: 'text-slate-500', dot: 'bg-slate-300' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const EMPTY_FORM = {
  sharedDestinations: [] as string[],
  leaderStartingCity: [] as string[],
  leaderEndingCity: [] as string[],
  leaderReturnToStart: true,
  departureDate: '',
  returnDate: '',
  cabinPreference: '',
  flexibilityDays: '',
  notes: '',
};

export default function TripsPage() {
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Trip creation state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [tripForm, setTripForm] = useState(EMPTY_FORM);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  // Per-traveler state
  const [travelers, setTravelers] = useState<TravelerEntry[]>([]);
  const [activeTravelerDropdown, setActiveTravelerDropdown] = useState<string | null>(null);
  const [travelerClientSearch, setTravelerClientSearch] = useState('');
  const travelerIdRef = useRef(0);

  useEffect(() => {
    Promise.all([
      getTripRequests(),
      getClients().catch(() => []),
    ])
      .then(([t, c]) => {
        setTrips(t);
        setClients(c);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
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

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

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

  const isFormValid = useMemo(() => {
    if (!selectedClient) return false;
    if (tripForm.sharedDestinations.length === 0) return false;
    if (tripForm.leaderStartingCity.length === 0) return false;
    if (!tripForm.departureDate) return false;
    for (const t of travelers) {
      if (!t.useLeaderCities) {
        if (t.startingCity.length === 0) return false;
        if (!t.returnToStart && t.endingCity.length === 0) return false;
      }
    }
    return true;
  }, [selectedClient, tripForm, travelers]);

  const resetForm = useCallback(() => {
    setTripForm(EMPTY_FORM);
    setSelectedClient(null);
    setClientSearch('');
    setTravelers([]);
    setActiveTravelerDropdown(null);
    setTravelerClientSearch('');
  }, []);

  const handleCreateTrip = async () => {
    if (!isFormValid || !selectedClient) return;
    setSaving(true);
    try {
      const leaderEndingCity = tripForm.leaderReturnToStart
        ? tripForm.leaderStartingCity
        : tripForm.leaderEndingCity;

      let notes = tripForm.notes.trim() || undefined;

      const flightPlan = {
        sharedDestinations: tripForm.sharedDestinations,
        leader: {
          clientId: selectedClient.id,
          clientName: `${selectedClient.firstName} ${selectedClient.lastName}`,
          startingCity: tripForm.leaderStartingCity,
          endingCity: leaderEndingCity,
        },
        travelers: travelers.map((t) => {
          const effectiveStarting = t.useLeaderCities
            ? tripForm.leaderStartingCity
            : t.startingCity;
          const effectiveEnding = t.useLeaderCities
            ? leaderEndingCity
            : t.returnToStart
              ? t.startingCity
              : t.endingCity;
          return {
            id: t.id,
            type: t.type,
            clientId: t.client?.id || null,
            clientName: t.client
              ? `${t.client.firstName} ${t.client.lastName}`
              : null,
            quantity: t.quantity,
            useLeaderCities: t.useLeaderCities,
            startingCity: effectiveStarting,
            endingCity: effectiveEnding,
          };
        }),
      };

      const flightPlanJson = JSON.stringify(flightPlan);
      notes = notes
        ? `[FLIGHT_PLAN:${flightPlanJson}]\n${notes}`
        : `[FLIGHT_PLAN:${flightPlanJson}]`;

      const payload: TripRequestCreatePayload = {
        clientId: selectedClient.id,
        title: tripForm.sharedDestinations.length > 0
          ? `Trip to ${tripForm.sharedDestinations.join(', ')}`
          : 'Trip Request',
        originAirports: tripForm.leaderStartingCity,
        destinationAirports: tripForm.sharedDestinations,
        departureDate: tripForm.departureDate,
        returnDate: tripForm.returnDate || undefined,
        travelerCount: totalTravelerCount,
        cabinPreference: tripForm.cabinPreference || undefined,
        flexibilityDays: tripForm.flexibilityDays ? parseInt(tripForm.flexibilityDays) : undefined,
        notes,
      };

      await createTripRequest(payload);
      const refreshed = await getTripRequests();
      setTrips(refreshed);
      resetForm();
      setShowCreateForm(false);
    } catch (err) {
      console.error('Failed to create trip:', err);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    return trips.filter((trip) => {
      if (statusFilter !== 'all' && trip.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const clientName = trip.client
          ? `${trip.client.firstName} ${trip.client.lastName}`.toLowerCase()
          : '';
        const title = trip.title.toLowerCase();
        const destinations = Array.isArray(trip.destinationAirports)
          ? trip.destinationAirports.join(' ').toLowerCase()
          : '';
        if (!clientName.includes(q) && !title.includes(q) && !destinations.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [trips, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: trips.length };
    for (const t of trips) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }
    return counts;
  }, [trips]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Trips</h1>
          <p className="mt-1 text-sm text-slate-500">
            All trip requests across your clients
          </p>
        </div>
        <Link
          href="/trips/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Trip
        </Link>
      </div>

      {/* Create Trip Form */}
      {showCreateForm && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">New Trip Request</h2>
            <button
              onClick={() => { setShowCreateForm(false); resetForm(); }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Group Leader Selection */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Crown className="h-3.5 w-3.5 text-amber-500" />
                Group Leader (Client) *
              </label>
              {selectedClient ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-white p-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                    {selectedClient.firstName?.[0]}{selectedClient.lastName?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {selectedClient.firstName} {selectedClient.lastName}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
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
                      placeholder="Search for a client to assign as group leader..."
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setShowClientDropdown(true);
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  {showClientDropdown && (
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

            {/* Shared Destinations */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Globe className="h-3.5 w-3.5 text-blue-500" />
                Shared Destinations *
              </label>
              <p className="mb-1.5 text-[11px] text-slate-500">
                Cities all travelers are going to (e.g. NYC)
              </p>
              <MultiAirportAutocomplete
                value={tripForm.sharedDestinations}
                onChange={(airports) => setTripForm((f) => ({ ...f, sharedDestinations: airports }))}
                placeholder="Search destination cities..."
                maxSelections={10}
              />
            </div>

            {/* Travel Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Departure Date *</label>
                <SingleDatePicker
                  compact
                  value={tripForm.departureDate}
                  onChange={(v) => setTripForm((f) => ({ ...f, departureDate: v }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Return Date</label>
                <SingleDatePicker
                  compact
                  value={tripForm.returnDate}
                  onChange={(v) => setTripForm((f) => ({ ...f, returnDate: v }))}
                  defaultFocusedDate={tripForm.departureDate}
                  markedDate={tripForm.departureDate}
                  markedDateLabel="Departure date"
                  minDate={tripForm.departureDate || undefined}
                />
              </div>
            </div>

            {/* Travelers Section */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Users className="h-3.5 w-3.5 text-blue-500" />
                  Travelers &amp; Flight Cities
                  <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {totalTravelerCount} total
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addTraveler}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <UserPlus className="h-3 w-3" />
                    Add Traveler
                  </button>
                  <button
                    type="button"
                    onClick={addBulkGroup}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    <Hash className="h-3 w-3" />
                    Bulk Group
                  </button>
                </div>
              </div>

              {tripForm.sharedDestinations.length > 0 && (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs text-blue-700">
                    Everyone flying to <span className="font-semibold">{tripForm.sharedDestinations.join(', ')}</span>
                  </span>
                </div>
              )}

              {/* Group Leader row */}
              {selectedClient && (
                <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
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
                      <label className="mb-1 block text-[11px] font-medium text-slate-600">Starting City *</label>
                      <MultiAirportAutocomplete
                        value={tripForm.leaderStartingCity}
                        onChange={(airports) => setTripForm((f) => ({ ...f, leaderStartingCity: airports }))}
                        placeholder="Flying from..."
                        maxSelections={3}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-600">Ending City</label>
                      {tripForm.leaderReturnToStart ? (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="flex-1 text-xs text-slate-500">
                            {tripForm.leaderStartingCity.length > 0
                              ? tripForm.leaderStartingCity.join(', ')
                              : 'Same as starting city'}
                          </span>
                        </div>
                      ) : (
                        <MultiAirportAutocomplete
                          value={tripForm.leaderEndingCity}
                          onChange={(airports) => setTripForm((f) => ({ ...f, leaderEndingCity: airports }))}
                          placeholder="Returning to..."
                          maxSelections={3}
                        />
                      )}
                    </div>
                  </div>
                  <label className="mt-2 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tripForm.leaderReturnToStart}
                      onChange={(e) => setTripForm((f) => ({ ...f, leaderReturnToStart: e.target.checked }))}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-600">Return to starting city</span>
                  </label>
                </div>
              )}

              {/* Additional Travelers */}
              {travelers.map((traveler, idx) => (
                <div key={traveler.id} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
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
                          className="rounded-l-lg px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 transition-colors"
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
                          className="rounded-r-lg px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-[11px] text-slate-500">travelers</span>
                    </div>
                  )}

                  {/* City Configuration */}
                  <div className="mt-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={traveler.useLeaderCities}
                        onChange={(e) => updateTraveler(traveler.id, { useLeaderCities: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-[11px] text-slate-600">
                        Same cities as {selectedClient ? selectedClient.firstName : 'Leader'}
                      </span>
                    </label>
                  </div>

                  {!traveler.useLeaderCities && (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-slate-500">Starting City <span className="text-red-500">*</span></label>
                          <MultiAirportAutocomplete
                            value={traveler.startingCity}
                            onChange={(airports) => updateTraveler(traveler.id, { startingCity: airports })}
                            placeholder="Flying from..."
                            maxSelections={3}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium text-slate-500">Ending City <span className="text-red-500">*</span></label>
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
                              onChange={(airports) => updateTraveler(traveler.id, { endingCity: airports })}
                              placeholder="Returning to..."
                              maxSelections={3}
                            />
                          )}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={traveler.returnToStart}
                          onChange={(e) => updateTraveler(traveler.id, { returnToStart: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[11px] text-slate-600">Return to starting city</span>
                      </label>
                    </div>
                  )}
                </div>
              ))}

              {travelers.length === 0 && selectedClient && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Add individual travelers or a bulk group to book for multiple people.
                </p>
              )}
            </div>

            {/* Extra options */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Cabin</label>
                <select
                  value={tripForm.cabinPreference}
                  onChange={(e) => setTripForm((f) => ({ ...f, cabinPreference: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Any</option>
                  <option value="economy">Economy</option>
                  <option value="premium_economy">Premium Economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Flexibility (days)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="3"
                  value={tripForm.flexibilityDays}
                  onChange={(e) => setTripForm((f) => ({ ...f, flexibilityDays: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
              <textarea
                value={tripForm.notes}
                onChange={(e) => setTripForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Any special requirements..."
                className="block w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleCreateTrip}
              disabled={saving || !isFormValid}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
              Create Trip
            </button>
            <button
              onClick={() => { setShowCreateForm(false); resetForm(); }}
              className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 border border-slate-200"
            >
              Cancel
            </button>
            {!selectedClient && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <Crown className="h-3 w-3" />
                Select a group leader to continue
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by client, trip title, or destination..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          {(['all', 'draft', 'analyzing', 'complete', 'archived'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              {statusCounts[s] ? ` (${statusCounts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Trip Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
          <Plane className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">
            {trips.length === 0 ? 'No trips yet' : 'No trips match your search'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {trips.length === 0
              ? 'Click "New Trip" above to create your first trip.'
              : 'Try adjusting your search or filters.'}
          </p>
          {trips.length === 0 && (
            <Link
              href="/trips/new"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Create a trip request
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((trip) => {
            const style = STATUS_STYLES[trip.status] ?? STATUS_STYLES.draft;
            const origins = Array.isArray(trip.originAirports)
              ? trip.originAirports.join(', ')
              : trip.originAirports;
            const destinations = Array.isArray(trip.destinationAirports)
              ? trip.destinationAirports.join(', ')
              : trip.destinationAirports;

            return (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
              >
                {/* Header */}
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                      {trip.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <MapPin className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">
                        {origins} → {destinations}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`ml-2 flex-shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${style.bg} ${style.text}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {trip.status}
                  </span>
                </div>

                {/* Dates */}
                <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar className="h-3 w-3 flex-shrink-0" />
                  <span>
                    {formatDateShort(trip.departureDate)}
                    {trip.returnDate ? ` – ${formatDateShort(trip.returnDate)}` : ''}
                  </span>
                  {trip.travelerCount > 1 && (
                    <>
                      <span className="text-slate-300">·</span>
                      <Users className="h-3 w-3 flex-shrink-0" />
                      <span>{trip.travelerCount} travelers</span>
                    </>
                  )}
                </div>

                {/* Client Info */}
                {trip.client ? (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                        {trip.client.firstName?.[0]}
                        {trip.client.lastName?.[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {trip.client.firstName} {trip.client.lastName}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {trip.client.email && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 truncate">
                              <Mail className="h-3 w-3 flex-shrink-0" />
                              {trip.client.email}
                            </span>
                          )}
                          {trip.client.phone && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              {trip.client.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <User className="h-3.5 w-3.5" />
                      No client assigned
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Created {formatDate(trip.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    {trip.client && (
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            const destinations = Array.isArray(trip.destinationAirports)
                              ? trip.destinationAirports.join(', ')
                              : trip.destinationAirports || '';
                            const title = `Live Call — ${trip.title}`;
                            const session = await createMeetingSession(trip.client!.id, title);
                            // Navigate to meeting page — trip context will be passed via URL params
                            window.location.href = `/clients/${trip.client!.id}/meeting/${session.id}?tripId=${trip.id}&destinations=${encodeURIComponent(destinations)}&dates=${encodeURIComponent(trip.departureDate + (trip.returnDate ? ' to ' + trip.returnDate : ''))}`;
                          } catch (err) {
                            console.error('Failed to start call from trip:', err);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                      >
                        <Video className="h-3 w-3" />
                        Call Client
                      </button>
                    )}
                    {trip.cabinPreference && (
                      <span className="capitalize">{trip.cabinPreference.replace('_', ' ')}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
