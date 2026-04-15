'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  User,
  Plane,
  Mail,
  Phone,
  Clock,
  CreditCard,
  ChevronRight,
  Loader2,
  StickyNote,
  BarChart3,
  Coins,
  Copy,
  Hash,
  Sparkles,
  Hotel,
  Utensils,
  Car,
  Sun,
  Moon,
  Sunset,
  DollarSign,
  Star,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Wallet,
  Route,
  Train,
  Navigation,
  AlertCircle,
  CheckCircle2,
  Info,
  MessageSquare,
  Send,
  ThumbsUp,
  ThumbsDown,
  Target,
  RefreshCw,
  Shield,
  HelpCircle,
  Zap,
  Trash2,
  Plus,
  Search,
  X,
  UserPlus,
  ExternalLink,
  Globe,
  Ticket,
  Camera,
  Landmark,
  Mountain,
  Palette,
  Map as MapIcon,
  Eye,
  Ship,
  Bus,
  Footprints,
  Gauge,
  Timer,
  Trophy,
} from 'lucide-react';
import {
  getTripRequest,
  getTripConfidence,
  generateTripItinerary,
  getSavedItinerary,
  createMeetingSession,
  getMeetingSessions,
  getMeetingSession,
  appendMeetingEntry,
  generateMeetingQuestions,
  updateMeetingProfileSuggestion,
  commitMeetingSuggestions,
  getMeetingCommitPreview,
  addTripTraveler,
  removeTripTraveler,
  getClients,
  searchTripFlights,
  searchTripHotels,
  getClientPreferences,
} from '@/lib/api-client';
import type { ItineraryProgressUpdate, ClientPreference } from '@/lib/api-client';
import type { CashHotelResult, AwardHotelResult } from '@/lib/hotel-search';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import type {
  TripRequest,
  TripTraveler,
  Client,
  ConfidenceResult,
  GeneratedItinerary,
  ItineraryHotelRecommendation,
  MeetingSession,
  MeetingQuestionSuggestion,
  MeetingProfileSuggestion,
  MeetingEntryItem,
  AnsweredQuestionPayload,
  MeetingCommitPreviewItem,
  TravelerFlightGroup,
  TravelerFlightSegment,
  CashFlightOption,
  AwardFlightOption,
  TravelerHotelGroup,
  ScoredHotel,
} from '@/lib/api-client';
import { ConfidenceBadge } from '@/components/ConfidenceMeter';

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-700' },
  analyzing: { bg: 'bg-amber-50', text: 'text-amber-700' },
  complete: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-500' },
};

type TripTab = 'overview' | 'discovery' | 'flights' | 'hotels' | 'budget';

const TABS: { key: TripTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <Info className="h-4 w-4" /> },
  { key: 'discovery', label: 'Discovery', icon: <MessageSquare className="h-4 w-4" /> },
  { key: 'flights', label: 'Flights', icon: <Plane className="h-4 w-4" /> },
  { key: 'hotels', label: 'Hotels', icon: <Hotel className="h-4 w-4" /> },
  { key: 'budget', label: 'Budget & Points', icon: <Wallet className="h-4 w-4" /> },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tipToString(tip: any): string {
  if (typeof tip === 'string') return tip;
  if (tip && typeof tip === 'object' && typeof tip.tip === 'string') return tip.tip;
  return JSON.stringify(tip);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseMultiCityLegs(notes: string | undefined) {
  if (!notes) return null;
  const match = notes.match(/\[MULTI_CITY:(\[.*?\])\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as { leg: number; from: string[]; to: string[]; date: string }[];
  } catch {
    return null;
  }
}

type TravelerFlightData = {
  id: string;
  type: 'individual' | 'bulk';
  clientId: string | null;
  clientName: string | null;
  quantity: number;
  flightConfig: 'sameAsLeader' | 'sameAs' | 'custom';
  sameAsId: string | null;
  customTripType: string | null;
  customLegs: { leg: number; from: string[]; to: string[]; date: string }[] | null;
};

function parseTravelerFlights(notes: string | undefined): TravelerFlightData[] | null {
  if (!notes) return null;
  const match = notes.match(/\[TRAVELER_FLIGHTS:(\[[\s\S]*?\])\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as TravelerFlightData[];
  } catch {
    return null;
  }
}

type TravelerRouteInfo = {
  leader: {
    clientId: string;
    clientName: string;
    startingCity: string[];
    endingCity: string[];
  };
  travelers: {
    id: string;
    type: string;
    clientId: string;
    clientName: string;
    quantity: number;
    useLeaderCities: boolean;
    startingCity: string[];
    endingCity: string[];
  }[];
};

function parseTravelerRoutes(notes: string | undefined): TravelerRouteInfo | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/\[MULTI_CITY:\[.*?\]\]\s*/g, '')
    .replace(/\[TRAVELER_FLIGHTS:\[[\s\S]*?\]\]\s*/g, '')
    .replace(/\[FLIGHT_PLAN:[\s\S]*?\]\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && parsed.leader) {
      return parsed as TravelerRouteInfo;
    }
  } catch {
    const match = cleaned.match(/\{[\s\S]*"leader"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed?.leader) return parsed as TravelerRouteInfo;
      } catch { /* ignore */ }
    }
  }
  return null;
}

const TRANSPORT_ICONS: Record<string, React.ReactNode> = {
  airport_transfer: <Car className="h-4 w-4" />,
  car_rental: <Car className="h-4 w-4" />,
  ride_service: <Navigation className="h-4 w-4" />,
  train: <Train className="h-4 w-4" />,
  private_car: <Car className="h-4 w-4" />,
  shuttle: <Route className="h-4 w-4" />,
};

function EmptyTabState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16">
      <div className="mb-3 rounded-xl bg-slate-100 p-4 text-slate-400">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-1 max-w-sm text-center text-xs text-slate-400">{subtitle}</p>
    </div>
  );
}

function SectionLoadingState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 py-16">
      <div className="relative mb-3 rounded-xl bg-blue-100 p-4 text-blue-500">
        {icon}
        <Loader2 className="absolute -right-1 -top-1 h-4 w-4 animate-spin text-blue-600" />
      </div>
      <p className="text-sm font-medium text-blue-800">{title}</p>
      <p className="mt-1 text-xs text-blue-500">This section is being generated...</p>
    </div>
  );
}

export default function TripDetailPage() {
  const params = useParams();
  const tripId = params.id as string;

  const [trip, setTrip] = useState<TripRequest | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TripTab>('overview');
  const [clientPreferences, setClientPreferences] = useState<ClientPreference | null>(null);
  const [itinerary, setItinerary] = useState<GeneratedItinerary | null>(null);
  const [generatingItinerary, setGeneratingItinerary] = useState(false);
  const [itineraryError, setItineraryError] = useState<string | null>(null);
  const [completedSections, setCompletedSections] = useState<string[]>([]);
  const [pendingSections, setPendingSections] = useState<string[]>([]);

  const handleAddTraveler = async (
    clientId: string,
    options?: {
      originAirports?: string[];
      destinationAirports?: string[];
      useLeaderCities?: boolean;
    },
  ) => {
    try {
      const newTraveler = await addTripTraveler(tripId, clientId, options);
      const refreshed = await getTripRequest(tripId);
      setTrip(refreshed);
      return newTraveler;
    } catch (err) {
      console.error('Failed to add traveler:', err);
      throw err;
    }
  };

  const handleRemoveTraveler = async (travelerId: string) => {
    try {
      await removeTripTraveler(tripId, travelerId);
      const refreshed = await getTripRequest(tripId);
      setTrip(refreshed);
    } catch (err) {
      console.error('Failed to remove traveler:', err);
      throw err;
    }
  };

  const handleGenerateItinerary = async () => {
    if (!tripId) return;
    setGeneratingItinerary(true);
    setItineraryError(null);
    setCompletedSections([]);
    setPendingSections(['flights', 'hotels']);
    try {
      const result = await generateTripItinerary(tripId, (update: ItineraryProgressUpdate) => {
        setCompletedSections(update.completedSections);
        setPendingSections(update.pendingSections);
        setItinerary((prev) => ({
          summary: '',
          flights: [],
          hotels: [],
          budgetBreakdown: {
            totalEstimatedCash: 0,
            totalPointsUsed: [],
            flightsCash: 0,
            flightsPoints: '',
            hotelsCash: 0,
            hotelsPoints: '',
            savings: '',
          },
          pointsStrategy: '',
          tips: [],
          ...prev,
          ...update.partialItinerary,
        }));
      });
      setItinerary(result);
      setCompletedSections(['flights', 'hotels']);
      setPendingSections([]);
    } catch (err) {
      setItineraryError(err instanceof Error ? err.message : 'Failed to generate itinerary');
    } finally {
      setGeneratingItinerary(false);
    }
  };

  useEffect(() => {
    if (!tripId) return;

    Promise.all([
      getTripRequest(tripId),
      getTripConfidence(tripId).catch(() => null),
      getSavedItinerary(tripId).catch(() => null),
    ])
      .then(([tripData, conf, savedItinerary]) => {
        setTrip(tripData);
        setConfidence(conf);
        if (savedItinerary) {
          setItinerary(savedItinerary);
          setCompletedSections(['flights', 'hotels']);
          setPendingSections([]);
        }
        // Fetch client preferences once we know the client
        if (tripData.clientId) {
          getClientPreferences(tripData.clientId).then(setClientPreferences).catch(() => {});
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tripId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="max-w-5xl">
        <Link
          href="/trips"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to trips
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <Plane className="mx-auto h-10 w-10 text-red-300" />
          <p className="mt-3 text-sm font-medium text-red-700">
            {error || 'Trip not found'}
          </p>
          <Link
            href="/trips"
            className="mt-4 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Back to all trips
          </Link>
        </div>
      </div>
    );
  }

  const multiCityLegs = parseMultiCityLegs(trip.notes ?? undefined);
  const isMultiCity = !!multiCityLegs;
  const statusStyle = STATUS_STYLES[trip.status] ?? STATUS_STYLES.draft;

  const origins = Array.isArray(trip.originAirports)
    ? trip.originAirports.join(', ')
    : trip.originAirports;
  const destinations = Array.isArray(trip.destinationAirports)
    ? trip.destinationAirports.join(', ')
    : trip.destinationAirports;

  const travelerFlights = parseTravelerFlights(trip.notes ?? undefined);
  const travelerRoutes = parseTravelerRoutes(trip.notes ?? undefined);
  const rawNotes = trip.notes
    ?.replace(/\[MULTI_CITY:\[.*?\]\]\s*/g, '')
    .replace(/\[TRAVELER_FLIGHTS:\[[\s\S]*?\]\]\s*/g, '')
    .replace(/\[FLIGHT_PLAN:[\s\S]*?\]\s*/g, '')
    .trim();

  const cleanNotes = (() => {
    if (!rawNotes) return undefined;
    try {
      const parsed = JSON.parse(rawNotes);
      if (typeof parsed === 'object' && parsed !== null) return undefined;
    } catch {
      // not JSON — keep it
    }
    return rawNotes.replace(/\{\s*"leader"\s*:[\s\S]*?"travelers"\s*:\s*\[[\s\S]*?\]\s*\}/g, '').trim() || undefined;
  })();

  return (
    <div className="max-w-5xl">
      <Link
        href="/trips"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to trips
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{trip.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
            >
              {trip.status}
            </span>
            {isMultiCity && (
              <span className="inline-flex items-center rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                Multi-City
              </span>
            )}
            {confidence && (
              <ConfidenceBadge score={confidence.score} level={confidence.level} />
            )}
            <span className="text-xs text-slate-400">
              {origins} → {destinations}
            </span>
            <span className="text-xs text-slate-400">
              {formatDateShort(trip.departureDate)}
              {trip.returnDate ? ` – ${formatDateShort(trip.returnDate)}` : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trip.client && (
            <Link
              href={`/clients/${trip.client.id}?tab=trips`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              View Client
              <ChevronRight className="ml-0.5 inline h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Generate Itinerary Banner */}
      {!itinerary && !generatingItinerary && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2.5">
              <Sparkles className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Generate Full Trip Plan</p>
              <p className="text-xs text-slate-500">
                Search for live flight and hotel options with AI-powered scoring
              </p>
            </div>
          </div>
          <button
            onClick={handleGenerateItinerary}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Sparkles className="h-4 w-4" />
            Generate Plan
          </button>
        </div>
      )}

      {generatingItinerary && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="mb-3 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-semibold text-blue-900">Generating your trip plan...</p>
              <p className="text-xs text-blue-600">
                {completedSections.length === 0
                  ? 'Starting up — searching flights and hotels'
                  : `${completedSections.length} of 3 sections ready`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'flights', label: 'Flights', icon: <Plane className="h-3.5 w-3.5" /> },
              { key: 'hotels', label: 'Hotels', icon: <Hotel className="h-3.5 w-3.5" /> },
            ].map((section) => {
              const done = completedSections.includes(section.key);
              return (
                <div
                  key={section.key}
                  className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-center transition-all ${
                    done
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-white/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    {section.icon}
                  </div>
                  <span className="text-[10px] font-medium leading-tight">{section.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {itineraryError && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{itineraryError}</p>
          <button
            onClick={handleGenerateItinerary}
            className="ml-auto text-xs font-medium text-red-700 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const tabSectionMap: Record<string, string> = {
              flights: 'flights',
              hotels: 'hotels',
            };
            const sectionKey = tabSectionMap[tab.key];
            const sectionDone = sectionKey ? completedSections.includes(sectionKey) : false;
            const sectionLoading = generatingItinerary && sectionKey ? !sectionDone && pendingSections.includes(sectionKey) : false;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                {tab.icon}
                {tab.label}
                {sectionLoading && (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                )}
                {sectionDone && generatingItinerary && (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {activeTab === 'overview' && (
            <OverviewTab
              trip={trip}
              itinerary={itinerary}
              multiCityLegs={multiCityLegs}
              isMultiCity={isMultiCity}
              origins={origins}
              destinations={destinations}
              travelerFlights={travelerFlights}
              travelerRoutes={travelerRoutes}
              cleanNotes={cleanNotes}
              confidence={confidence}
              onAddTraveler={handleAddTraveler}
              onRemoveTraveler={handleRemoveTraveler}
            />
          )}
          {activeTab === 'discovery' && (
            <DiscoveryTab trip={trip} />
          )}
          {activeTab === 'flights' && (
            generatingItinerary && !completedSections.includes('flights') ? (
              <SectionLoadingState icon={<Plane className="h-8 w-8" />} title="Searching flights..." />
            ) : (
              <FlightsTab
                itinerary={itinerary}
                trip={trip}
                multiCityLegs={multiCityLegs}
                isMultiCity={isMultiCity}
                origins={origins}
                destinations={destinations}
                travelerFlights={travelerFlights}
                tripId={tripId}
                onFlightsUpdated={(flights) => {
                  setItinerary((prev) => prev ? { ...prev, travelerFlights: flights } : prev);
                }}
              />
            )
          )}
          {activeTab === 'hotels' && (
            generatingItinerary && !completedSections.includes('hotels') ? (
              <SectionLoadingState icon={<Hotel className="h-8 w-8" />} title="Searching hotels..." />
            ) : (
              <HotelsTab
                itinerary={itinerary}
                tripId={tripId}
                onHotelsUpdated={(hotels) => {
                  setItinerary((prev) => prev ? { ...prev, travelerHotels: hotels } : prev);
                }}
              />
            )
          )}
          {activeTab === 'budget' && <BudgetTab itinerary={itinerary} trip={trip} />}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Client Card */}
          {trip.client ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Client
              </h3>
              <Link href={`/clients/${trip.client.id}`} className="group block">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-sm font-semibold text-blue-700">
                    {trip.client.firstName?.[0]}
                    {trip.client.lastName?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                      {trip.client.firstName} {trip.client.lastName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {trip.client.clientType === 'individual' ? 'Individual' : 'Business'}
                    </p>
                  </div>
                </div>
              </Link>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {trip.client.email && (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <span className="truncate">{trip.client.email}</span>
                  </div>
                )}
                {trip.client.phone && (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    <span>{trip.client.phone}</span>
                  </div>
                )}
              </div>
              {trip.client.loyaltyBalances && trip.client.loyaltyBalances.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-slate-500">Points</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {trip.client.loyaltyBalances.map((bal: { id: string; balance: number; loyaltyProgram?: { name: string }; programName?: string }) => (
                      <span
                        key={bal.id}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px]"
                      >
                        <span className="font-medium text-slate-600">
                          {bal.loyaltyProgram?.name ?? bal.programName}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {bal.balance.toLocaleString()}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Client
              </h3>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <User className="h-4 w-4" />
                No client assigned
              </div>
            </div>
          )}

          {/* Client Preferences Snapshot */}
          {trip.client && clientPreferences && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Preferences
                </h3>
                <Link
                  href={`/clients/${trip.client.id}?tab=preferences`}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Edit
                </Link>
              </div>
              <div className="space-y-2">
                {clientPreferences.preferredCabin && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Plane className="h-3 w-3" /> Cabin
                    </span>
                    <span className="font-medium capitalize text-slate-700">
                      {clientPreferences.preferredCabin.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {clientPreferences.prefersNonstop !== undefined && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Nonstop</span>
                    <span className="font-medium text-slate-700">
                      {clientPreferences.prefersNonstop ? 'Preferred' : 'Flexible'}
                    </span>
                  </div>
                )}
                {clientPreferences.preferredAirlines && clientPreferences.preferredAirlines.length > 0 && (
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <span className="shrink-0 text-slate-500">Airlines</span>
                    <span className="text-right font-medium text-slate-700">
                      {clientPreferences.preferredAirlines.slice(0, 3).join(', ')}
                      {clientPreferences.preferredAirlines.length > 3 && ` +${clientPreferences.preferredAirlines.length - 3} more`}
                    </span>
                  </div>
                )}
                {clientPreferences.preferredHotelTypes && clientPreferences.preferredHotelTypes.length > 0 && (
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 shrink-0 text-slate-500">
                      <Hotel className="h-3 w-3" /> Hotels
                    </span>
                    <span className="text-right font-medium text-slate-700">
                      {clientPreferences.preferredHotelTypes.slice(0, 2).join(', ')}
                      {clientPreferences.preferredHotelTypes.length > 2 && ` +${clientPreferences.preferredHotelTypes.length - 2}`}
                    </span>
                  </div>
                )}
                {clientPreferences.budgetSensitivity && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Budget Style</span>
                    <span className="font-medium capitalize text-slate-700">
                      {clientPreferences.budgetSensitivity.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {clientPreferences.activityPreferences && clientPreferences.activityPreferences.length > 0 && (
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <span className="shrink-0 text-slate-500">Activities</span>
                    <span className="text-right font-medium text-slate-700">
                      {clientPreferences.activityPreferences.slice(0, 2).join(', ')}
                      {clientPreferences.activityPreferences.length > 2 && ` +${clientPreferences.activityPreferences.length - 2}`}
                    </span>
                  </div>
                )}
                {clientPreferences.dealbreakers && clientPreferences.dealbreakers.length > 0 && (
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <span className="shrink-0 text-red-400">Dealbreakers</span>
                    <span className="text-right font-medium text-red-600">
                      {clientPreferences.dealbreakers.slice(0, 2).join(', ')}
                      {clientPreferences.dealbreakers.length > 2 && ` +${clientPreferences.dealbreakers.length - 2}`}
                    </span>
                  </div>
                )}
                {clientPreferences.lastUpdatedSource && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <span className="text-[10px] text-slate-400">
                      Last updated via{' '}
                      <span className="font-medium">
                        {clientPreferences.lastUpdatedSource === 'intake' ? 'intake form' : clientPreferences.lastUpdatedSource}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Timeline
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Created</span>
                <span className="font-medium text-slate-700">
                  {formatDateShort(trip.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Last Updated</span>
                <span className="font-medium text-slate-700">
                  {formatDateShort(trip.updatedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Departure</span>
                <span className="font-medium text-slate-700">
                  {formatDateShort(trip.departureDate)}
                </span>
              </div>
              {trip.returnDate && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Return</span>
                  <span className="font-medium text-slate-700">
                    {formatDateShort(trip.returnDate)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          {itinerary && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Plan Summary
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Plane className="h-3 w-3" /> Flights
                  </span>
                  <span className="font-medium text-slate-700">{itinerary.flights.length}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Hotel className="h-3 w-3" /> Hotels
                  </span>
                  <span className="font-medium text-slate-700">{
                    (itinerary.travelerHotels?.[0]?.stays?.reduce((sum, s) => sum + (s.scoredOptions?.length ?? 0), 0) ?? 0) ||
                    itinerary.hotels.length
                  }</span>
                </div>
 
                {itinerary.budgetBreakdown.totalEstimatedCash > 0 && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-slate-600">
                        <DollarSign className="h-3 w-3" /> Est. Total
                      </span>
                      <span className="font-bold text-slate-900">
                        ${itinerary.budgetBreakdown.totalEstimatedCash.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Actions
            </h3>
            <div className="space-y-2">
              {itinerary ? (
                <button
                  onClick={handleGenerateItinerary}
                  disabled={generatingItinerary}
                  className="flex w-full items-center justify-between rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Regenerate Plan
                  </span>
                  {generatingItinerary && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              ) : (
                <button
                  onClick={handleGenerateItinerary}
                  disabled={generatingItinerary}
                  className="flex w-full items-center justify-between rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Generate Plan
                  </span>
                  {generatingItinerary && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              )}
              {trip.client && (
                <Link
                  href={`/clients/${trip.client.id}?tab=trips`}
                  className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  View in Client
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   TAB COMPONENTS
   ========================================================================== */

function OverviewTab({
  trip,
  itinerary,
  multiCityLegs,
  isMultiCity,
  origins,
  destinations,
  travelerFlights,
  travelerRoutes,
  cleanNotes,
  confidence,
  onAddTraveler,
  onRemoveTraveler,
}: {
  trip: TripRequest;
  itinerary: GeneratedItinerary | null;
  multiCityLegs: { leg: number; from: string[]; to: string[]; date: string }[] | null;
  isMultiCity: boolean;
  origins: string;
  destinations: string;
  travelerFlights: TravelerFlightData[] | null;
  travelerRoutes: TravelerRouteInfo | null;
  cleanNotes: string | undefined;
  confidence: ConfidenceResult | null;
  onAddTraveler: (clientId: string, options?: { originAirports?: string[]; destinationAirports?: string[]; useLeaderCities?: boolean }) => Promise<TripTraveler>;
  onRemoveTraveler: (travelerId: string) => Promise<void>;
}) {
  const travelers = trip.travelers ?? [];
  const leaderCities = travelerRoutes?.leader;
  const defaultOrigins = trip.originAirports ?? [];
  const defaultDestinations = trip.destinationAirports ?? [];

  function getTravelerRoute(traveler: TripTraveler) {
    const isLeader = traveler.clientId === trip.clientId;
    if (isLeader && leaderCities) {
      return { start: leaderCities.startingCity, end: leaderCities.endingCity };
    }
    const match = travelerRoutes?.travelers.find(
      (t) => t.clientId === traveler.clientId,
    );
    if (match) {
      if (match.useLeaderCities && leaderCities) {
        return { start: leaderCities.startingCity, end: leaderCities.endingCity };
      }
      return { start: match.startingCity, end: match.endingCity };
    }
    return { start: defaultOrigins, end: defaultDestinations };
  }

  return (
    <>
      {/* AI Summary */}
      {itinerary && (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-emerald-900">Trip Summary</h2>
          </div>
          <p className="text-sm leading-relaxed text-emerald-800">{itinerary.summary}</p>
          {itinerary.tips.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t border-emerald-200/60 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Quick Tips</p>
              {itinerary.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-emerald-700">
                  <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <span>{tipToString(tip)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group Members */}
      <GroupMembersSection
        trip={trip}
        onAddTraveler={onAddTraveler}
        onRemoveTraveler={onRemoveTraveler}
      />

      {/* Confidence Breakdown */}
      {confidence && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Confidence Breakdown
          </h2>
          <div className="space-y-3">
            {confidence.dimensions.map((dim) => {
              const pct = dim.maxScore > 0 ? (dim.score / dim.maxScore) * 100 : 0;
              const statusColors: Record<string, string> = {
                resolved: 'text-emerald-600',
                ambiguous: 'text-amber-600',
                missing: 'text-red-500',
              };
              return (
                <div key={dim.key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{dim.label}</span>
                    <span className={`text-xs font-medium ${statusColors[dim.status] ?? 'text-slate-500'}`}>
                      {dim.status}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        dim.status === 'resolved'
                          ? 'bg-emerald-500'
                          : dim.status === 'ambiguous'
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function GroupMembersSection({
  trip,
  onAddTraveler,
  onRemoveTraveler,
}: {
  trip: TripRequest;
  onAddTraveler: (clientId: string, options?: { originAirports?: string[]; destinationAirports?: string[]; useLeaderCities?: boolean }) => Promise<TripTraveler>;
  onRemoveTraveler: (travelerId: string) => Promise<void>;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingClients, setLoadingClients] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const [pendingClient, setPendingClient] = useState<Client | null>(null);
  const [useLeaderCities, setUseLeaderCities] = useState(true);
  const [originAirports, setOriginAirports] = useState<string[]>([]);
  const [destinationAirports, setDestinationAirports] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const leaderOrigins = Array.isArray(trip.originAirports) ? trip.originAirports as string[] : [];
  const leaderDestinations = Array.isArray(trip.destinationAirports) ? trip.destinationAirports as string[] : [];
  const leaderClient = trip.travelers?.find((t) => t.clientId === trip.clientId)?.client ?? trip.client;
  const leaderName = leaderClient ? leaderClient.firstName : 'Leader';

  const existingClientIds = new Set(
    trip.travelers?.map((t) => t.clientId) ?? [],
  );
  if (trip.clientId) existingClientIds.add(trip.clientId);

  const filteredClients = allClients
    .filter((c) => !existingClientIds.has(c.id))
    .filter((c) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    });

  const handleOpenAdd = async () => {
    setShowAddForm(true);
    setPendingClient(null);
    setUseLeaderCities(true);
    setOriginAirports([]);
    setDestinationAirports([]);
    setValidationError(null);
    if (allClients.length === 0) {
      setLoadingClients(true);
      try {
        const clients = await getClients();
        setAllClients(clients);
      } catch (err) {
        console.error('Failed to load clients:', err);
      } finally {
        setLoadingClients(false);
      }
    }
  };

  const handleSelectClient = (client: Client) => {
    setPendingClient(client);
    setSearchQuery('');
    setValidationError(null);
  };

  const handleConfirmAdd = async () => {
    if (!pendingClient) return;

    if (!useLeaderCities) {
      if (originAirports.length === 0) {
        setValidationError('Start location is required');
        return;
      }
      if (destinationAirports.length === 0) {
        setValidationError('End location is required');
        return;
      }
    }

    setAdding(true);
    setValidationError(null);
    try {
      await onAddTraveler(pendingClient.id, {
        useLeaderCities,
        originAirports: useLeaderCities ? leaderOrigins : originAirports,
        destinationAirports: useLeaderCities ? leaderDestinations : destinationAirports,
      });
      setPendingClient(null);
      setUseLeaderCities(true);
      setOriginAirports([]);
      setDestinationAirports([]);
      setShowAddForm(false);
    } catch {
      // error handled upstream
    } finally {
      setAdding(false);
    }
  };

  const handleCancelAdd = () => {
    setShowAddForm(false);
    setPendingClient(null);
    setUseLeaderCities(true);
    setOriginAirports([]);
    setDestinationAirports([]);
    setSearchQuery('');
    setValidationError(null);
  };

  const handleRemove = async (travelerId: string) => {
    setRemoving(travelerId);
    try {
      await onRemoveTraveler(travelerId);
    } catch {
      // error handled upstream
    } finally {
      setRemoving(null);
    }
  };

  const rawTravelers = trip.travelers ?? [];
  const leaderAlreadyIncluded = rawTravelers.some((t) => t.clientId === trip.clientId);
  const travelers = leaderAlreadyIncluded
    ? rawTravelers
    : trip.clientId && leaderClient
      ? [
          {
            id: `leader-${trip.clientId}`,
            clientId: trip.clientId,
            client: leaderClient,
            useLeaderCities: true,
            originAirports: leaderOrigins,
            destinationAirports: leaderDestinations,
            travelerType: 'adult',
          } as unknown as TripTraveler,
          ...rawTravelers,
        ]
      : rawTravelers;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Group Members</h2>
        <button
          onClick={showAddForm ? handleCancelAdd : handleOpenAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
        >
          {showAddForm ? (
            <>
              <X className="h-3.5 w-3.5" />
              Cancel
            </>
          ) : (
            <>
              <UserPlus className="h-3.5 w-3.5" />
              Add Member
            </>
          )}
        </button>
      </div>

      {/* Add Member Form */}
      {showAddForm && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          {!pendingClient ? (
            <>
              <p className="mb-2 text-xs font-medium text-slate-600">Step 1: Select a client</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search clients by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  autoFocus
                />
              </div>

              {loadingClients ? (
                <div className="mt-3 flex items-center justify-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="text-xs text-slate-500">Loading clients...</span>
                </div>
              ) : (
                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">
                      {searchQuery ? 'No matching clients found' : 'No clients available to add'}
                    </p>
                  ) : (
                    filteredClients.slice(0, 10).map((client) => (
                      <button
                        key={client.id}
                        onClick={() => handleSelectClient(client)}
                        className="flex w-full items-center gap-3 rounded-lg bg-white p-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                          {client.firstName?.[0]}
                          {client.lastName?.[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {client.firstName} {client.lastName}
                          </p>
                          <p className="truncate text-xs text-slate-500">{client.email}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium text-slate-600">Step 2: Set travel locations</p>

              {/* Selected client display */}
              <div className="mb-3 flex items-center gap-3 rounded-lg border border-blue-200 bg-white p-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                  {pendingClient.firstName?.[0]}
                  {pendingClient.lastName?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {pendingClient.firstName} {pendingClient.lastName}
                  </p>
                  <p className="truncate text-xs text-slate-500">{pendingClient.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setPendingClient(null); setValidationError(null); }}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="Pick a different client"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* "Same as the leader" checkbox */}
              <label className="mb-3 flex items-center gap-2.5 cursor-pointer rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={useLeaderCities}
                  onChange={(e) => {
                    setUseLeaderCities(e.target.checked);
                    setValidationError(null);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">
                    Same as the leader of the trip
                  </span>
                  {leaderOrigins.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {leaderOrigins.join(', ')} → {leaderDestinations.join(', ')}
                    </p>
                  )}
                </div>
              </label>

              {/* Custom location fields */}
              {!useLeaderCities && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      Start Location <span className="text-red-500">*</span>
                    </label>
                    <MultiAirportAutocomplete
                      value={originAirports}
                      onChange={(v) => { setOriginAirports(v); setValidationError(null); }}
                      placeholder="Flying from..."
                      maxSelections={3}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      End Location <span className="text-red-500">*</span>
                    </label>
                    <MultiAirportAutocomplete
                      value={destinationAirports}
                      onChange={(v) => { setDestinationAirports(v); setValidationError(null); }}
                      placeholder="Flying to..."
                      maxSelections={3}
                    />
                  </div>
                </div>
              )}

              {/* Validation error */}
              {validationError && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {validationError}
                </div>
              )}

              {/* Confirm / Back buttons */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleConfirmAdd}
                  disabled={adding}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                >
                  {adding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add to Trip
                </button>
                <button
                  onClick={() => { setPendingClient(null); setValidationError(null); }}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-white"
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Member List */}
      {travelers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-8 text-center">
          <Users className="mx-auto mb-2 h-7 w-7 text-slate-300" />
          <p className="text-sm text-slate-500">No group members yet</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Add clients to this trip to manage the travel group
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {travelers.map((traveler) => {
            const isRemoving = removing === traveler.id;
            const isLeader = traveler.clientId === trip.clientId;
            const travelerOrigins = Array.isArray(traveler.originAirports)
              ? (traveler.originAirports as string[])
              : isLeader ? leaderOrigins : [];
            const travelerDests = Array.isArray(traveler.destinationAirports)
              ? (traveler.destinationAirports as string[])
              : isLeader ? leaderDestinations : [];
            return (
              <div
                key={traveler.id}
                className={`rounded-lg p-3 transition-colors ${
                  isLeader ? 'bg-blue-50/70' : 'bg-slate-50'
                } ${isRemoving ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                    isLeader ? 'bg-blue-200 text-blue-800' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {traveler.client?.firstName?.[0]}
                    {traveler.client?.lastName?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {traveler.client
                          ? `${traveler.client.firstName} ${traveler.client.lastName}`
                          : 'Unknown traveler'}
                      </p>
                      {isLeader && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          Lead
                        </span>
                      )}
                    </div>
                    {traveler.client?.email && (
                      <p className="truncate text-xs text-slate-500">{traveler.client.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {traveler.client && (
                      <Link
                        href={`/clients/${traveler.client.id}`}
                        className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                      >
                        View
                      </Link>
                    )}
                    {!isLeader && (
                      <button
                        onClick={() => handleRemove(traveler.id)}
                        disabled={isRemoving}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Remove from group"
                      >
                        {isRemoving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {/* Traveler locations */}
                {(travelerOrigins.length > 0 || travelerDests.length > 0) && (
                  <div className="ml-12 mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <MapPin className="h-3 w-3 flex-shrink-0" />
                    <span>
                      {travelerOrigins.join(', ') || '—'} → {travelerDests.join(', ') || '—'}
                    </span>
                    {!isLeader && traveler.useLeaderCities && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        Same as leader
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Loyalty summary for all travelers */}
      {travelers.some((t) => t.client?.loyaltyBalances && t.client.loyaltyBalances.length > 0) && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-slate-500">Group Loyalty Balances</span>
          </div>
          <div className="space-y-2">
            {travelers
              .filter((t) => t.client?.loyaltyBalances && t.client.loyaltyBalances.length > 0)
              .map((traveler) => (
                <div key={traveler.id} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[11px] font-medium text-slate-600">
                    {traveler.client?.firstName}:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {traveler.client!.loyaltyBalances!.map((bal: { id: string; balance: number; loyaltyProgram?: { name: string }; programName?: string }) => (
                      <span
                        key={bal.id}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px]"
                      >
                        <span className="font-medium text-amber-700">
                          {bal.loyaltyProgram?.name ?? bal.programName}
                        </span>
                        <span className="font-semibold text-amber-900">
                          {bal.balance.toLocaleString()}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlightsTab({
  itinerary,
  trip,
  multiCityLegs,
  isMultiCity,
  origins,
  destinations,
  travelerFlights: _legacyTravelerFlights,
  tripId,
  onFlightsUpdated,
}: {
  itinerary: GeneratedItinerary | null;
  trip: TripRequest;
  multiCityLegs: { leg: number; from: string[]; to: string[]; date: string }[] | null;
  isMultiCity: boolean;
  origins: string;
  destinations: string;
  travelerFlights: TravelerFlightData[] | null;
  tripId: string;
  onFlightsUpdated?: (flights: TravelerFlightGroup[]) => void;
}) {
  const [flights, setFlights] = useState<TravelerFlightGroup[]>(itinerary?.travelerFlights ?? []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const didAutoSearch = useRef(false);

  useEffect(() => {
    if (itinerary?.travelerFlights) {
      setFlights(itinerary.travelerFlights);
    }
  }, [itinerary?.travelerFlights]);

  const hasRealFlights = flights.length > 0 &&
    flights.some((g) => g.segments.some((s) => s.cashOptions.length > 0 || s.awardOptions.length > 0));

  const handleSearchFlights = async () => {
    setLoading(true);
    setSearchError(null);
    try {
      const results = await searchTripFlights(tripId);
      setFlights(results);
      onFlightsUpdated?.(results);

      const anyOptions = results.some((g) =>
        g.segments.some((s) => s.cashOptions.length > 0 || s.awardOptions.length > 0),
      );
      if (!anyOptions && results.length > 0) {
        setSearchError(
          'Flight search completed but no pricing was found for this route and date. ' +
          'Try adjusting the dates or airports, then refresh.'
        );
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to search flights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasRealFlights && !didAutoSearch.current && !loading) {
      didAutoSearch.current = true;
      handleSearchFlights();
    }
  }, []);

  if (!itinerary && !hasRealFlights) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16">
          <div className="mb-3 rounded-xl bg-slate-100 p-4 text-slate-400">
            <Plane className="h-8 w-8" />
          </div>
          <p className="text-sm font-medium text-slate-600">No flight recommendations yet</p>
          <p className="mt-1 mb-4 max-w-sm text-center text-xs text-slate-400">
            Search for real flight pricing from Google Flights and award availability, or generate a full trip plan.
          </p>
          <button
            onClick={handleSearchFlights}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching Flights…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Search Flights
              </>
            )}
          </button>
          {searchError && (
            <p className="mt-3 text-xs text-red-600">{searchError}</p>
          )}
        </div>
      </div>
    );
  }

  if (hasRealFlights) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Flight Results</h2>
            <p className="text-xs text-slate-500">
              {flights.length} traveler{flights.length !== 1 ? 's' : ''} with flight options
            </p>
          </div>
          <button
            onClick={handleSearchFlights}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh Flights
              </>
            )}
          </button>
        </div>
        {searchError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-700">{searchError}</p>
          </div>
        )}
        <div className="space-y-6">
          {flights.map((group) => (
            <TravelerFlightSection key={group.travelerId} group={group} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16">
        <div className="mb-3 rounded-xl bg-slate-100 p-4 text-slate-400">
          <Plane className="h-8 w-8" />
        </div>
        <p className="text-sm font-medium text-slate-600">No flight data available</p>
        <p className="mt-1 mb-4 max-w-sm text-center text-xs text-slate-400">
          Search for flights with real pricing and award availability.
        </p>
        <button
          onClick={handleSearchFlights}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching Flights…
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Search Flights
            </>
          )}
        </button>
        {searchError && (
          <p className="mt-3 text-xs text-red-600">{searchError}</p>
        )}
      </div>
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '--';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatFlightTime(timeStr: string): string {
  if (!timeStr) return '';
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) return timeStr;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function TravelerFlightSection({ group }: { group: TravelerFlightGroup }) {
  const initials = group.travelerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Traveler Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-700">
          {initials}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{group.travelerName}</p>
          <p className="text-[11px] text-slate-500">
            {group.travelerId === 'leader' ? 'Lead Traveler' : 'Traveler'}
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {group.segments.map((segment, idx) => (
          <SegmentSection key={idx} segment={segment} />
        ))}
      </div>
    </div>
  );
}

function SegmentSection({ segment }: { segment: TravelerFlightSegment }) {
  const topCash = segment.cashOptions.slice(0, 5);
  const topAward = segment.awardOptions.slice(0, 5);
  const hasCash = segment.cashOptions.length > 0;
  const hasAward = segment.awardOptions.length > 0;
  const bestCash = segment.cashOptions[0];
  const bestAward = segment.awardOptions[0];

  return (
    <div className="p-5">
      {/* Segment header */}
      <div className="mb-4 flex items-center gap-2">
        <div className={`rounded-lg p-1.5 ${
          segment.segmentLabel === 'Return' ? 'bg-purple-50' : 'bg-blue-50'
        }`}>
          <Plane className={`h-3.5 w-3.5 ${
            segment.segmentLabel === 'Return' ? 'text-purple-600 rotate-180' : 'text-blue-600'
          }`} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{segment.segmentLabel}</p>
          <p className="text-[11px] text-slate-500">
            {segment.origin} → {segment.destination} · {formatDateShort(segment.date)}
          </p>
        </div>
      </div>

      {!hasCash && !hasAward && (
        <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
          No flight results found for this route. Try adjusting dates or airports.
        </p>
      )}

      {/* Best options summary */}
      {(hasCash || hasAward) && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {bestAward && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-600">
                <Coins className="h-3 w-3" /> Best Award
              </div>
              <p className="text-lg font-bold text-amber-900">
                {bestAward.milesRequired.toLocaleString()}
              </p>
              <p className="text-[11px] font-medium text-amber-700">miles</p>
              <p className="mt-1 text-[11px] text-amber-700">{bestAward.program}</p>
              {bestAward.transferSource && bestAward.transferSource !== 'Direct' && (
                <p className="text-[10px] text-amber-600">Transfer from {bestAward.transferSource}</p>
              )}
              <p className="text-[10px] text-amber-600">
                + ${bestAward.taxes} taxes
                {bestAward.seatsRemaining != null && ` · ${bestAward.seatsRemaining} seats left`}
              </p>
              {bestAward.cppValue != null && bestAward.cppValue > 0 && (
                <p className={`mt-1 text-[10px] font-semibold ${
                  bestAward.cppValue >= 1.5 ? 'text-emerald-600' : bestAward.cppValue >= 1.0 ? 'text-amber-700' : 'text-slate-500'
                }`}>
                  {bestAward.cppValue.toFixed(1)}&#162;/pt value
                </p>
              )}
            </div>
          )}
          {bestCash && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <DollarSign className="h-3 w-3" /> Best Cash
              </div>
              <p className="text-lg font-bold text-slate-900">
                ${bestCash.price.toLocaleString()}
              </p>
              <p className="text-[11px] font-medium text-slate-600">{bestCash.cabin}</p>
              <p className="mt-1 text-[11px] text-slate-600">{bestCash.airline}</p>
              <p className="text-[10px] text-slate-500">
                {bestCash.flightNumber} · {bestCash.stops === 0 ? 'Nonstop' : `${bestCash.stops} stop${bestCash.stops > 1 ? 's' : ''}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Award options list */}
      {hasAward && (
        <div className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Coins className="h-3.5 w-3.5 text-amber-500" />
            Award Availability ({topAward.length} program{topAward.length !== 1 ? 's' : ''})
          </h4>
          <div className="space-y-1.5">
            {topAward.map((award, i) => (
              <AwardOptionRow key={i} award={award} isBest={i === 0} />
            ))}
          </div>
          {segment.awardOptions.length > 5 && (
            <p className="mt-2 text-[10px] text-slate-400">
              Showing top {topAward.length} of {segment.awardOptions.length} programs
            </p>
          )}
        </div>
      )}

      {/* Cash options list */}
      {hasCash && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
            Cash Flights ({topCash.length} option{topCash.length !== 1 ? 's' : ''})
          </h4>
          <div className="space-y-2">
            {topCash.map((cash, i) => (
              <CashFlightRow key={i} flight={cash} isBest={i === 0} />
            ))}
          </div>
          {segment.cashOptions.length > 5 && (
            <p className="mt-2 text-[10px] text-slate-400">
              Showing top {topCash.length} of {segment.cashOptions.length} flights
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AwardOptionRow({ award, isBest }: { award: AwardFlightOption; isBest: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
      isBest ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'
    }`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-900">{award.program}</p>
          <p className="text-[10px] text-slate-500">
            {award.isDirect ? 'Direct' : 'Connecting'}
            {award.airlines && ` · ${award.airlines}`}
          </p>
          {award.transferSource && award.transferSource !== 'Direct' && (
            <p className="text-[10px] text-amber-600">Transfer from {award.transferSource}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-right">
        <div>
          <p className="text-sm font-bold text-amber-900">
            {award.milesRequired.toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-500">miles + ${award.taxes}</p>
          {award.cppValue != null && award.cppValue > 0 && (
            <p className={`text-[10px] font-medium ${
              award.cppValue >= 1.5 ? 'text-emerald-600' : award.cppValue >= 1.0 ? 'text-amber-600' : 'text-slate-400'
            }`}>
              {award.cppValue.toFixed(1)}&#162;/pt
            </p>
          )}
        </div>
        {award.seatsRemaining != null && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            award.seatsRemaining <= 2
              ? 'bg-red-50 text-red-700'
              : award.seatsRemaining <= 5
                ? 'bg-amber-50 text-amber-700'
                : 'bg-emerald-50 text-emerald-700'
          }`}>
            {award.seatsRemaining} left
          </span>
        )}
      </div>
    </div>
  );
}

function CashFlightRow({ flight, isBest }: { flight: CashFlightOption; isBest: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${
      isBest ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {flight.airlineLogo && (
            <Image src={flight.airlineLogo} alt={flight.airline} width={20} height={20} className="h-5 w-5 rounded" unoptimized />
          )}
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-slate-900">{flight.airline}</p>
              {flight.isRedeye && (
                <span className="rounded px-1 py-0.5 text-[9px] font-medium bg-indigo-50 text-indigo-600">Red-eye</span>
              )}
              {flight.hasCarrierChange && (
                <span className="rounded px-1 py-0.5 text-[9px] font-medium bg-orange-50 text-orange-600">Carrier change</span>
              )}
            </div>
            <p className="text-[10px] text-slate-500">{flight.flightNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xs font-medium text-slate-800">
              {formatFlightTime(flight.departureTime)}
            </p>
            <p className="text-[10px] text-slate-400">{flight.departureAirport}</p>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-slate-400">{formatDuration(flight.duration)}</p>
            <div className="flex items-center gap-1">
              <div className="h-px w-10 bg-slate-300" />
              <Plane className="h-2.5 w-2.5 text-slate-400" />
            </div>
            <p className="text-[10px] text-slate-400">
              {flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium text-slate-800">
              {formatFlightTime(flight.arrivalTime)}
            </p>
            <p className="text-[10px] text-slate-400">{flight.arrivalAirport}</p>
          </div>
          <div className="min-w-[60px] text-right">
            <p className="text-sm font-bold text-slate-900">${flight.price.toLocaleString()}</p>
            <p className="text-[10px] capitalize text-slate-500">{flight.fareClass}</p>
          </div>
        </div>
      </div>
      {flight.layovers.length > 0 && (
        <div className="mt-1.5 flex gap-2">
          {flight.layovers.map((l, i) => (
            <span key={i} className="text-[10px] text-slate-400">
              {l.airport} ({formatDuration(l.durationMin)})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


function HotelsTab({
  itinerary,
  tripId,
  onHotelsUpdated,
}: {
  itinerary: GeneratedItinerary | null;
  tripId: string;
  onHotelsUpdated?: (hotels: TravelerHotelGroup[]) => void;
}) {
  const [hotels, setHotels] = useState<TravelerHotelGroup[]>(itinerary?.travelerHotels ?? []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const didAutoSearch = useRef(false);

  useEffect(() => {
    if (itinerary?.travelerHotels) {
      setHotels(itinerary.travelerHotels);
    }
  }, [itinerary?.travelerHotels]);

  const hasScored = hotels.length > 0 && hotels.some((g) => g.stays.some((s) => (s.scoredOptions?.length ?? 0) > 0));
  const hasRawOptions = hotels.length > 0 && hotels.some((g) => g.stays.some((s) => s.cashOptions.length > 0 || s.awardOptions.length > 0));
  const legacyHotels = itinerary?.hotels ?? [];

  const handleSearchHotels = async () => {
    setLoading(true);
    setSearchError(null);
    try {
      const results = await searchTripHotels(tripId);
      setHotels(results);
      onHotelsUpdated?.(results);

      const anyOptions = results.some((g) =>
        g.stays.some((s) => s.cashOptions.length > 0 || s.awardOptions.length > 0 || (s.scoredOptions?.length ?? 0) > 0),
      );
      if (!anyOptions && results.length > 0) {
        setSearchError(
          'Hotel search completed but no pricing was found for these destinations and dates. ' +
          'Try adjusting the dates or destinations, then refresh.',
        );
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to search hotels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasScored && !hasRawOptions && !didAutoSearch.current && !loading) {
      didAutoSearch.current = true;
      handleSearchHotels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasScored && !hasRawOptions && legacyHotels.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 py-16">
          <div className="mb-3 rounded-xl bg-slate-100 p-4 text-slate-400">
            <Hotel className="h-8 w-8" />
          </div>
          <p className="text-sm font-medium text-slate-600">No hotel recommendations yet</p>
          <p className="mt-1 mb-4 max-w-sm text-center text-xs text-slate-400">
            Search for real hotel pricing from Google Hotels and award availability.
          </p>
          <button
            onClick={handleSearchHotels}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching Hotels…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Search Hotels
              </>
            )}
          </button>
          {searchError && (
            <p className="mt-3 text-xs text-red-600">{searchError}</p>
          )}
        </div>
      </div>
    );
  }

  if (hasScored) {
    const travelerHotels = hotels;
    const stays = travelerHotels[0]?.stays ?? [];
    return (
      <div className="space-y-6">
        {stays.map((stay, si) => {
          const scored = stay.scoredOptions ?? [];
          if (scored.length === 0) return null;
          return (
            <div key={si} className="space-y-4">
              <div className="flex items-center gap-2">
                <Hotel className="h-4 w-4 text-purple-600" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {stay.destination} · {formatDateShort(stay.checkIn)} – {formatDateShort(stay.checkOut)} ({stay.nights} nights)
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Top {scored.length} hotel{scored.length !== 1 ? 's' : ''} matching your preferences
                  </p>
                </div>
              </div>
              {scored.map((sh, hi) => (
                <ScoredHotelCard key={hi} scored={sh} rank={hi + 1} />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (hasRawOptions) {
    const stays = hotels[0]?.stays ?? [];
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing live pricing from Google Hotels. Generate the full itinerary for AI-ranked recommendations.
          </p>
          <button
            onClick={handleSearchHotels}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Refresh
          </button>
        </div>
        {stays.map((stay, si) => {
          const cash = (stay.cashOptions as CashHotelResult[]) ?? [];
          const award = (stay.awardOptions as AwardHotelResult[]) ?? [];
          if (cash.length === 0 && award.length === 0) return null;
          return (
            <div key={si} className="space-y-3">
              <div className="flex items-center gap-2">
                <Hotel className="h-4 w-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  {stay.destination} · {formatDateShort(stay.checkIn)} – {formatDateShort(stay.checkOut)} ({stay.nights} nights)
                </h2>
              </div>
              {cash.slice(0, 8).map((h, hi) => (
                <RawHotelCard key={`c-${hi}`} hotel={h} nights={stay.nights} />
              ))}
              {award.length > 0 && (
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Award availability
                </div>
              )}
              {award.slice(0, 5).map((h, hi) => (
                <div key={`a-${hi}`} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <p className="text-sm font-semibold text-slate-900">{h.name}</p>
                  <p className="text-xs text-amber-800">
                    {h.pointsTotal.toLocaleString()} pts total · {h.pointsPerNight.toLocaleString()}/night · {h.programDisplayName}
                  </p>
                  {h.surcharge > 0 && (
                    <p className="text-[11px] text-amber-700">+ ${h.surcharge.toLocaleString()} in taxes/fees</p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">Recommended Hotels</h2>
      {legacyHotels.map((hotel, i) => (
        <LegacyHotelCard key={i} hotel={hotel} />
      ))}
    </div>
  );
}

function RawHotelCard({ hotel, nights }: { hotel: CashHotelResult; nights: number }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {hotel.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hotel.thumbnailUrl} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{hotel.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              {hotel.neighborhood ? `${hotel.neighborhood} · ` : ''}
              {hotel.starRating ? `${hotel.starRating}★` : ''}
              {hotel.overallRating != null ? ` · ${hotel.overallRating} rating` : ''}
            </p>
          </div>
          <div className="text-right">
            {hotel.cashTotal != null && (
              <p className="text-sm font-bold text-slate-900">${hotel.cashTotal.toLocaleString()}</p>
            )}
            <p className="text-[11px] text-slate-500">
              ${hotel.cashPerNight.toLocaleString()}/night · {nights}n
            </p>
          </div>
        </div>
        {hotel.bookingUrl && (
          <a
            href={hotel.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700"
          >
            View on Google Hotels →
          </a>
        )}
      </div>
    </div>
  );
}

function ScoredHotelCard({ scored, rank }: { scored: ScoredHotel; rank: number }) {
  const h = scored.hotel;
  const payColor =
    scored.paymentRecommendation === 'points' ? 'text-amber-700 bg-amber-50 border-amber-200'
      : scored.paymentRecommendation === 'mixed' ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
        : 'text-slate-700 bg-slate-50 border-slate-200';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-xs font-bold text-purple-700">
            #{rank}
          </div>
          <div className="flex items-center gap-2">
            {h.thumbnailUrl && (
              <img src={h.thumbnailUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
            )}
            <div>
              <p className="text-sm font-semibold text-slate-900">{h.name}</p>
              <p className="text-xs text-slate-500">
                {h.neighborhood ? `${h.neighborhood} · ` : ''}{h.destination}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {h.starRating != null && (
            <div className="flex items-center gap-0.5">
              {Array.from({ length: h.starRating }).map((_, i) => (
                <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
              ))}
            </div>
          )}
          {h.overallRating != null && (
            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              {h.overallRating}
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
          <span className="text-xs font-bold text-purple-700">{scored.compositeScore}</span>
        </div>
        <div className="flex-1">
          <div className="mb-1 h-1.5 w-full rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-purple-500"
              style={{ width: `${scored.compositeScore}%` }}
            />
          </div>
          <div className="flex gap-3 text-[10px] text-slate-400">
            <span>Value {scored.valueScore}</span>
            <span>Location {scored.locationScore}</span>
            <span>Loyalty {scored.loyaltyScore}</span>
            <span>Preference {scored.preferenceScore}</span>
            <span>Quality {scored.qualityScore}</span>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${payColor}`}>
          {scored.paymentRecommendation === 'points' ? 'Use Points' : scored.paymentRecommendation === 'mixed' ? 'Mixed' : 'Pay Cash'}
        </span>
      </div>

      {scored.highlights.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {scored.highlights.map((hl, i) => (
            <span key={i} className="rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700">
              {hl}
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        {h.awardOption && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-600">
              <Coins className="h-3 w-3" /> Points Option
            </div>
            <p className="text-sm font-bold text-amber-900">
              {h.awardOption.pointsTotal.toLocaleString()} pts total
            </p>
            <p className="text-[11px] text-amber-700">
              {h.awardOption.pointsPerNight.toLocaleString()}/night · {h.awardOption.programDisplayName}
            </p>
            {h.awardOption.transferSources.length > 0 && (
              <p className="text-[10px] text-amber-600">
                Transfer from {h.awardOption.transferSources.map((s) => s.bankDisplayName).join(', ')}
              </p>
            )}
            {h.cppValue != null && (
              <p className="mt-1 text-[10px] font-semibold text-amber-800">{h.cppValue.toFixed(1)} cpp</p>
            )}
          </div>
        )}
        {h.cashTotal != null && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
              <DollarSign className="h-3 w-3" /> Cash Option
            </div>
            <p className="text-sm font-bold text-slate-900">
              ${h.cashTotal.toLocaleString()} total
            </p>
            {h.cashPerNight != null && (
              <p className="text-[11px] text-slate-600">
                ${h.cashPerNight.toLocaleString()}/night
              </p>
            )}
          </div>
        )}
      </div>

      {scored.estimatedSavings != null && scored.estimatedSavings > 0 && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          <Trophy className="h-3.5 w-3.5" />
          Save ~${scored.estimatedSavings.toLocaleString()} by using points
        </div>
      )}

      {scored.rationale && (
        <p className="text-xs leading-relaxed text-slate-600">
          <Lightbulb className="mr-1 inline h-3 w-3 text-amber-500" />
          {scored.rationale}
        </p>
      )}

      {h.bookingUrl && (
        <a
          href={h.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          View on Google Hotels →
        </a>
      )}
    </div>
  );
}

function LegacyHotelCard({ hotel }: { hotel: ItineraryHotelRecommendation }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-purple-50 p-2">
            <Hotel className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{hotel.hotelName}</p>
            <p className="text-xs text-slate-500">
              {hotel.destination} · {hotel.neighborhood}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: hotel.starRating }).map((_, i) => (
            <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ))}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3">
        <div>
          <p className="text-[10px] font-medium text-slate-400">Type</p>
          <p className="text-xs font-semibold capitalize text-slate-800">{hotel.hotelType}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-400">Check-in</p>
          <p className="text-xs font-semibold text-slate-800">{formatDateShort(hotel.checkIn)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-400">Check-out</p>
          <p className="text-xs font-semibold text-slate-800">{formatDateShort(hotel.checkOut)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-400">Nights</p>
          <p className="text-xs font-semibold text-slate-800">{hotel.nightCount}</p>
        </div>
      </div>

      {hotel.highlights.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {hotel.highlights.map((h, i) => (
            <span key={i} className="rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700">
              {h}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {hotel.pointsOption && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-600">
              <Coins className="h-3 w-3" /> Points Option
            </div>
            <p className="text-sm font-bold text-amber-900">
              {hotel.pointsOption.totalPoints.toLocaleString()} pts total
            </p>
            <p className="text-[11px] text-amber-700">
              {hotel.pointsOption.pointsPerNight.toLocaleString()}/night · {hotel.pointsOption.program}
            </p>
            {hotel.pointsOption.transferFrom && (
              <p className="text-[10px] text-amber-600">Transfer from {hotel.pointsOption.transferFrom}</p>
            )}
          </div>
        )}
        {hotel.cashOption && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
              <DollarSign className="h-3 w-3" /> Cash Option
            </div>
            <p className="text-sm font-bold text-slate-900">
              ${hotel.cashOption.estimatedTotal.toLocaleString()} total
            </p>
            <p className="text-[11px] text-slate-600">
              ${hotel.cashOption.estimatedPerNight.toLocaleString()}/night
            </p>
          </div>
        )}
      </div>

      {hotel.whyThisHotel && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          <Lightbulb className="mr-1 inline h-3 w-3 text-amber-500" />
          {hotel.whyThisHotel}
        </p>
      )}
    </div>
  );
}


function computeLiveBudget(itinerary: GeneratedItinerary, trip: TripRequest) {
  const travelerFlights = itinerary.travelerFlights ?? [];
  const travelerHotels = itinerary.travelerHotels ?? [];

  type TravelerCost = {
    travelerId: string;
    travelerName: string;
    flightCash: number;
    flightAward: { program: string; miles: number; taxes: number } | null;
    hotelCash: number;
    hotelAward: { program: string; points: number; programDisplayName: string } | null;
    hotelPaymentRec: string | null;
  };

  const perTraveler: TravelerCost[] = [];

  for (const tg of travelerFlights) {
    let flightCash = 0;
    let bestAward: TravelerCost['flightAward'] = null;
    let totalMiles = 0;
    let totalTaxes = 0;
    let awardProgram = '';

    for (const seg of tg.segments) {
      const cheapestCash = seg.cashOptions.length > 0
        ? seg.cashOptions.reduce((min, o) => (o.price < min.price ? o : min), seg.cashOptions[0])
        : null;
      if (cheapestCash) flightCash += cheapestCash.price;

      const bestAwardOpt = seg.awardOptions.length > 0 ? seg.awardOptions[0] : null;
      if (bestAwardOpt) {
        totalMiles += bestAwardOpt.milesRequired;
        totalTaxes += bestAwardOpt.taxes;
        if (!awardProgram) awardProgram = bestAwardOpt.program;
      }
    }
    if (totalMiles > 0) {
      bestAward = { program: awardProgram, miles: totalMiles, taxes: totalTaxes };
    }

    const existing = perTraveler.find((p) => p.travelerId === tg.travelerId);
    if (existing) {
      existing.flightCash = flightCash;
      existing.flightAward = bestAward;
    } else {
      perTraveler.push({
        travelerId: tg.travelerId,
        travelerName: tg.travelerName,
        flightCash,
        flightAward: bestAward,
        hotelCash: 0,
        hotelAward: null,
        hotelPaymentRec: null,
      });
    }
  }

  for (const hg of travelerHotels) {
    let hotelCash = 0;
    let hotelAward: TravelerCost['hotelAward'] = null;
    let paymentRec: string | null = null;

    for (const stay of hg.stays) {
      const topScored = (stay.scoredOptions ?? [])[0];
      if (topScored) {
        const h = topScored.hotel;
        if (h.cashTotal != null) hotelCash += h.cashTotal;
        if (h.awardOption && !hotelAward) {
          hotelAward = {
            program: h.awardOption.program,
            points: h.awardOption.pointsTotal,
            programDisplayName: h.awardOption.programDisplayName,
          };
        } else if (h.awardOption && hotelAward) {
          hotelAward.points += h.awardOption.pointsTotal;
        }
        if (!paymentRec) paymentRec = topScored.paymentRecommendation;
      }
    }

    const existing = perTraveler.find((p) => p.travelerId === hg.travelerId);
    if (existing) {
      existing.hotelCash = hotelCash;
      existing.hotelAward = hotelAward;
      existing.hotelPaymentRec = paymentRec;
    } else {
      perTraveler.push({
        travelerId: hg.travelerId,
        travelerName: hg.travelerName,
        flightCash: 0,
        flightAward: null,
        hotelCash,
        hotelAward: hotelAward,
        hotelPaymentRec: paymentRec,
      });
    }
  }

  const totalFlightCash = perTraveler.reduce((s, t) => s + t.flightCash, 0);
  const totalHotelCash = perTraveler.reduce((s, t) => s + t.hotelCash, 0);
  const totalCash = totalFlightCash + totalHotelCash;

  const pointsUsedMap = new Map<string, number>();
  for (const t of perTraveler) {
    if (t.flightAward) {
      const key = t.flightAward.program;
      pointsUsedMap.set(key, (pointsUsedMap.get(key) ?? 0) + t.flightAward.miles);
    }
    if (t.hotelAward) {
      const key = t.hotelAward.programDisplayName || t.hotelAward.program;
      pointsUsedMap.set(key, (pointsUsedMap.get(key) ?? 0) + t.hotelAward.points);
    }
  }
  const pointsUsed = Array.from(pointsUsedMap.entries()).map(([program, points]) => ({ program, points }));

  type AvailableBalance = { program: string; balance: number; travelerName: string };
  const availableBalances: AvailableBalance[] = [];
  const travelers = trip.travelers ?? [];
  const seenBalanceIds = new Set<string>();

  for (const traveler of travelers) {
    const balances = traveler.client?.loyaltyBalances ?? [];
    for (const bal of balances) {
      if (seenBalanceIds.has(bal.id)) continue;
      seenBalanceIds.add(bal.id);
      availableBalances.push({
        program: (bal as { loyaltyProgram?: { name: string }; programName?: string }).loyaltyProgram?.name ?? (bal as { programName?: string }).programName ?? 'Unknown',
        balance: bal.balance,
        travelerName: `${traveler.client?.firstName ?? ''} ${traveler.client?.lastName ?? ''}`.trim(),
      });
    }
  }

  if (trip.client?.loyaltyBalances) {
    for (const bal of trip.client.loyaltyBalances) {
      if (seenBalanceIds.has(bal.id)) continue;
      seenBalanceIds.add(bal.id);
      availableBalances.push({
        program: (bal as { loyaltyProgram?: { name: string }; programName?: string }).loyaltyProgram?.name ?? (bal as { programName?: string }).programName ?? 'Unknown',
        balance: bal.balance,
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`.trim(),
      });
    }
  }

  const hasLiveData = travelerFlights.length > 0 || travelerHotels.length > 0;

  return { perTraveler, totalFlightCash, totalHotelCash, totalCash, pointsUsed, availableBalances, hasLiveData };
}

function BudgetTab({ itinerary, trip }: { itinerary: GeneratedItinerary | null; trip: TripRequest }) {
  if (!itinerary) {
    return (
      <EmptyTabState
        icon={<Wallet className="h-8 w-8" />}
        title="No budget breakdown yet"
        subtitle="Generate a trip plan to get a detailed cost analysis with points optimization strategy."
      />
    );
  }

  const live = computeLiveBudget(itinerary, trip);
  const budget = itinerary.budgetBreakdown;

  const flightsCash = live.hasLiveData ? live.totalFlightCash : budget.flightsCash;
  const hotelsCash = live.hasLiveData ? live.totalHotelCash : budget.hotelsCash;
  const totalCash = live.hasLiveData ? live.totalCash : budget.totalEstimatedCash;
  const pointsUsed = live.hasLiveData && live.pointsUsed.length > 0 ? live.pointsUsed : budget.totalPointsUsed;

  const flightsPointsLabel = live.hasLiveData
    ? live.perTraveler
        .filter((t) => t.flightAward)
        .map((t) => `${t.flightAward!.miles.toLocaleString()} ${t.flightAward!.program} miles + $${t.flightAward!.taxes} taxes`)
        .join('; ') || undefined
    : budget.flightsPoints || undefined;

  const hotelsPointsLabel = live.hasLiveData
    ? live.perTraveler
        .filter((t) => t.hotelAward)
        .map((t) => `${t.hotelAward!.points.toLocaleString()} ${t.hotelAward!.programDisplayName} pts`)
        .join('; ') || undefined
    : budget.hotelsPoints || undefined;

  const categories = [
    { label: 'Flights', cash: flightsCash, points: flightsPointsLabel, icon: <Plane className="h-4 w-4" />, color: 'bg-blue-500' },
    { label: 'Hotels', cash: hotelsCash, points: hotelsPointsLabel, icon: <Hotel className="h-4 w-4" />, color: 'bg-purple-500' },
  ];

  const nonZeroCategories = categories.filter((c) => c.cash > 0);

  const pointsSufficiency = pointsUsed.map((pu) => {
    const matching = live.availableBalances.filter(
      (ab) => ab.program.toLowerCase().includes(pu.program.toLowerCase()) || pu.program.toLowerCase().includes(ab.program.toLowerCase()),
    );
    const totalAvailable = matching.reduce((s, m) => s + m.balance, 0);
    return {
      ...pu,
      available: totalAvailable,
      sufficient: totalAvailable >= pu.points,
      shortfall: Math.max(0, pu.points - totalAvailable),
      sources: matching,
    };
  });

  return (
    <div className="space-y-6">
      {/* Total */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Estimated Total Cash Cost</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {totalCash > 0 ? `$${totalCash.toLocaleString()}` : '—'}
            </p>
            {live.hasLiveData && (
              <p className="mt-1 text-[10px] text-blue-600 font-medium">Based on live flight & hotel search results</p>
            )}
          </div>
          {budget.savings && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-right">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                <TrendingUp className="h-3 w-3" /> Savings
              </div>
              <p className="mt-0.5 text-xs font-medium text-emerald-800">{budget.savings}</p>
            </div>
          )}
        </div>

        {pointsUsed.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/60 pt-3">
            {pointsUsed.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs"
              >
                <Coins className="h-3 w-3 text-amber-500" />
                <span className="font-medium text-amber-700">{p.program}</span>
                <span className="font-bold text-amber-900">{p.points.toLocaleString()} pts</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Category Breakdown */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Cost Breakdown</h2>

        {totalCash > 0 && (
          <div className="mb-5 flex h-4 overflow-hidden rounded-full bg-slate-100">
            {nonZeroCategories.map((cat, i) => {
              const pct = (cat.cash / totalCash) * 100;
              return (
                <div
                  key={i}
                  className={`${cat.color} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${cat.label}: $${cat.cash.toLocaleString()}`}
                />
              );
            })}
          </div>
        )}

        <div className="space-y-3">
          {categories.map((cat, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-1.5 text-white ${cat.color}`}>
                  {cat.icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{cat.label}</p>
                  {cat.points && (
                    <p className="text-[11px] text-slate-500">{cat.points}</p>
                  )}
                </div>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {cat.cash > 0 ? `$${cat.cash.toLocaleString()}` : '—'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-Traveler Breakdown */}
      {live.hasLiveData && live.perTraveler.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Per-Traveler Breakdown</h2>
          <div className="space-y-4">
            {live.perTraveler.map((traveler) => {
              const travelerTotal = traveler.flightCash + traveler.hotelCash;
              return (
                <div key={traveler.travelerId} className="rounded-lg border border-slate-100 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-[10px] font-bold text-blue-700">
                      {traveler.travelerName.split(' ').map((n) => n[0]).join('').toUpperCase()}
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{traveler.travelerName}</p>
                    {travelerTotal > 0 && (
                      <span className="ml-auto text-sm font-bold text-slate-900">
                        ${travelerTotal.toLocaleString()} cash
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-blue-50/50 p-3">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-blue-600">
                        <Plane className="h-3 w-3" /> Flights
                      </div>
                      {traveler.flightCash > 0 && (
                        <p className="text-sm font-bold text-slate-900">${traveler.flightCash.toLocaleString()}</p>
                      )}
                      {traveler.flightAward && (
                        <p className="text-[11px] text-amber-700">
                          {traveler.flightAward.miles.toLocaleString()} {traveler.flightAward.program} miles
                          {traveler.flightAward.taxes > 0 && ` + $${traveler.flightAward.taxes}`}
                        </p>
                      )}
                      {!traveler.flightCash && !traveler.flightAward && (
                        <p className="text-[11px] text-slate-400">No data</p>
                      )}
                    </div>
                    <div className="rounded-lg bg-purple-50/50 p-3">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-purple-600">
                        <Hotel className="h-3 w-3" /> Hotels
                      </div>
                      {traveler.hotelCash > 0 && (
                        <p className="text-sm font-bold text-slate-900">${traveler.hotelCash.toLocaleString()}</p>
                      )}
                      {traveler.hotelAward && (
                        <p className="text-[11px] text-amber-700">
                          {traveler.hotelAward.points.toLocaleString()} {traveler.hotelAward.programDisplayName} pts
                        </p>
                      )}
                      {traveler.hotelPaymentRec && (
                        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          traveler.hotelPaymentRec === 'points'
                            ? 'text-amber-700 bg-amber-50 border-amber-200'
                            : traveler.hotelPaymentRec === 'mixed'
                              ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                              : 'text-slate-700 bg-slate-50 border-slate-200'
                        }`}>
                          {traveler.hotelPaymentRec === 'points' ? 'Use Points' : traveler.hotelPaymentRec === 'mixed' ? 'Mixed' : 'Pay Cash'}
                        </span>
                      )}
                      {!traveler.hotelCash && !traveler.hotelAward && (
                        <p className="text-[11px] text-slate-400">No data</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Points & Sufficiency */}
      {(live.availableBalances.length > 0 || pointsSufficiency.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-900">Points Availability</h2>
          </div>

          {pointsSufficiency.length > 0 && (
            <div className="mb-4 space-y-3">
              {pointsSufficiency.map((ps, i) => (
                <div key={i} className={`rounded-lg border p-3 ${
                  ps.sufficient ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {ps.sufficient ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm font-medium text-slate-900">{ps.program}</span>
                    </div>
                    <span className={`text-xs font-semibold ${ps.sufficient ? 'text-emerald-700' : 'text-red-700'}`}>
                      {ps.sufficient ? 'Sufficient' : `Short ${ps.shortfall.toLocaleString()} pts`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-[11px]">
                    <span className="text-slate-600">
                      Need: <span className="font-semibold text-slate-900">{ps.points.toLocaleString()}</span>
                    </span>
                    <span className="text-slate-600">
                      Have: <span className="font-semibold text-slate-900">{ps.available.toLocaleString()}</span>
                    </span>
                  </div>
                  {ps.available > 0 && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200">
                      <div
                        className={`h-1.5 rounded-full transition-all ${ps.sufficient ? 'bg-emerald-500' : 'bg-red-400'}`}
                        style={{ width: `${Math.min(100, (ps.available / ps.points) * 100)}%` }}
                      />
                    </div>
                  )}
                  {ps.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ps.sources.map((src, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] border border-slate-200">
                          <span className="text-slate-500">{src.travelerName}:</span>
                          <span className="font-semibold text-slate-800">{src.balance.toLocaleString()}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {live.availableBalances.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-slate-500">All Loyalty Balances</h3>
              <div className="space-y-2">
                {Array.from(
                  live.availableBalances.reduce((map, b) => {
                    const list = map.get(b.travelerName) ?? [];
                    list.push(b);
                    map.set(b.travelerName, list);
                    return map;
                  }, new Map<string, typeof live.availableBalances>()),
                ).map(([name, balances]) => (
                  <div key={name} className="flex items-start gap-2">
                    <span className="mt-0.5 text-[11px] font-medium text-slate-600 whitespace-nowrap">{name}:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {balances.map((bal, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px]"
                        >
                          <span className="font-medium text-amber-700">{bal.program}</span>
                          <span className="font-semibold text-amber-900">{bal.balance.toLocaleString()}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Points Strategy */}
      {itinerary.pointsStrategy && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-900">Points Strategy</h2>
          </div>
          <p className="text-sm leading-relaxed text-amber-800">{itinerary.pointsStrategy}</p>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   DISCOVERY TAB — AI Meeting Copilot
   ========================================================================== */

const PRIORITY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  high: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  low: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  flight: <Plane className="h-3.5 w-3.5" />,
  hotel: <Hotel className="h-3.5 w-3.5" />,
  budget: <DollarSign className="h-3.5 w-3.5" />,
  dining: <Utensils className="h-3.5 w-3.5" />,
  activities: <Star className="h-3.5 w-3.5" />,
  transportation: <Car className="h-3.5 w-3.5" />,
  general: <HelpCircle className="h-3.5 w-3.5" />,
  loyalty: <Coins className="h-3.5 w-3.5" />,
  accessibility: <Shield className="h-3.5 w-3.5" />,
  family: <Users className="h-3.5 w-3.5" />,
};

function DiscoveryTab({ trip }: { trip: TripRequest }) {
  const clientId = trip.clientId ?? trip.client?.id;

  const [session, setSession] = useState<MeetingSession | null>(null);
  const [questions, setQuestions] = useState<MeetingQuestionSuggestion[]>([]);
  const [suggestions, setSuggestions] = useState<MeetingProfileSuggestion[]>([]);
  const [entries, setEntries] = useState<MeetingEntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sendingAnswer, setSendingAnswer] = useState<string | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [commitPreview, setCommitPreview] = useState<MeetingCommitPreviewItem[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ committed: number; fields: string[] } | null>(null);

  const answeredRef = useRef<HTMLDivElement>(null);

  const initSession = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const sessions = await getMeetingSessions(clientId);
      const tripSession = sessions.find(
        (s) => s.title.includes(trip.id) || s.title.includes(trip.title),
      );

      let activeSession: MeetingSession;
      if (tripSession) {
        activeSession = await getMeetingSession(clientId, tripSession.id);
      } else {
        activeSession = await createMeetingSession(
          clientId,
          `Trip Discovery: ${trip.title}`,
        );
        activeSession = await getMeetingSession(clientId, activeSession.id);
      }

      setSession(activeSession);
      setQuestions(activeSession.questionSuggestions ?? []);
      setSuggestions(activeSession.profileSuggestions ?? []);
      setEntries(activeSession.entries ?? []);

      if (!activeSession.questionSuggestions?.length || activeSession.questionSuggestions.every((q) => q.isUsed)) {
        setGeneratingQuestions(true);
        try {
          const result = await generateMeetingQuestions(clientId, activeSession.id, { followUp: false });
          if (result.questions.length > 0) {
            setQuestions((prev) => [...result.questions, ...prev]);
          }
        } catch (genErr) {
          console.error('Failed to generate questions:', genErr);
        } finally {
          setGeneratingQuestions(false);
        }
      }
    } catch (err) {
      console.error('Failed to init discovery session:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId, trip.id, trip.title]);

  useEffect(() => {
    initSession();
  }, [initSession]);

  const handleGenerateQuestions = async (sessionId?: string, followUp = false) => {
    if (!clientId) return;
    const sid = sessionId ?? session?.id;
    if (!sid) return;
    setGeneratingQuestions(true);
    try {
      let answeredQuestions: AnsweredQuestionPayload[] | undefined;
      if (followUp) {
        const qaEntries = entries.filter(
          (e) => e.role === 'question_answer' && e.metadata?.questionText,
        );
        answeredQuestions = qaEntries.map((e) => ({
          questionText: e.metadata!.questionText as string,
          answer: e.content,
        }));
      }
      const result = await generateMeetingQuestions(clientId, sid, {
        followUp,
        answeredQuestions: followUp ? answeredQuestions : undefined,
      });
      if (result.questions.length > 0) {
        setQuestions((prev) => [...result.questions, ...prev]);
      }
    } catch (err) {
      console.error('Failed to generate questions:', err);
    } finally {
      setGeneratingQuestions(false);
    }
  };

  const handleSendAnswer = async (question: MeetingQuestionSuggestion) => {
    const answer = answers[question.id]?.trim();
    if (!answer || !clientId || !session) return;
    setSendingAnswer(question.id);
    try {
      const result = await appendMeetingEntry(clientId, session.id, {
        role: 'question_answer',
        content: answer,
        metadata: {
          questionText: question.questionText,
          targetFields: question.targetFields,
        },
      });

      setEntries((prev) => [...prev, result]);
      setQuestions((prev) =>
        prev.map((q) => (q.id === question.id ? { ...q, isUsed: true } : q)),
      );
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[question.id];
        return next;
      });

      if (result.extractedSuggestions && result.extractedSuggestions.length > 0) {
        setSuggestions((prev) => [...result.extractedSuggestions!, ...prev]);
      }

      try {
        const followUpResult = await generateMeetingQuestions(clientId, session.id, {
          followUp: true,
          answeredQuestions: [{ questionText: question.questionText, answer, category: question.category }],
        });
        if (followUpResult.questions.length > 0) {
          setQuestions((prev) => [...followUpResult.questions, ...prev]);
        }
      } catch {
        // Follow-up generation is non-blocking
      }
    } catch (err) {
      console.error('Failed to send answer:', err);
    } finally {
      setSendingAnswer(null);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !clientId || !session) return;
    setAddingNote(true);
    try {
      const result = await appendMeetingEntry(clientId, session.id, {
        role: 'advisor_note',
        content: noteText.trim(),
      });
      setEntries((prev) => [...prev, result]);
      setNoteText('');
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setAddingNote(false);
    }
  };

  const handleSuggestionAction = async (suggestion: MeetingProfileSuggestion, action: 'approved' | 'rejected') => {
    if (!clientId || !session) return;
    try {
      const updated = await updateMeetingProfileSuggestion(clientId, session.id, suggestion.id, action);
      setSuggestions((prev) =>
        prev.map((s) => (s.id === suggestion.id ? updated : s)),
      );
    } catch (err) {
      console.error('Failed to update suggestion:', err);
    }
  };

  const handleCommitPreview = async () => {
    if (!clientId || !session) return;
    try {
      const result = await getMeetingCommitPreview(clientId, session.id);
      setCommitPreview(result.preview);
    } catch (err) {
      console.error('Failed to get commit preview:', err);
    }
  };

  const handleCommit = async () => {
    if (!clientId || !session) return;
    setCommitting(true);
    try {
      const result = await commitMeetingSuggestions(clientId, session.id);
      setCommitResult({ committed: result.committed, fields: result.fields });
      setSuggestions((prev) =>
        prev.map((s) =>
          s.status === 'approved' ? { ...s, status: 'committed' as const } : s,
        ),
      );
      setCommitPreview(null);
    } catch (err) {
      console.error('Failed to commit suggestions:', err);
    } finally {
      setCommitting(false);
    }
  };

  if (!clientId) {
    return (
      <EmptyTabState
        icon={<MessageSquare className="h-8 w-8" />}
        title="No client assigned"
        subtitle="Assign a client to this trip to start a discovery session and generate questions."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-slate-500">Setting up discovery session...</span>
      </div>
    );
  }

  const unansweredQuestions = questions.filter((q) => !q.isUsed);
  const answeredQuestionsList = entries.filter((e) => e.role === 'question_answer');
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
  const approvedSuggestions = suggestions.filter((s) => s.status === 'approved');
  const committedSuggestions = suggestions.filter((s) => s.status === 'committed');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Client Discovery</h2>
          <p className="text-xs text-slate-500">
            AI-generated questions to learn your client&apos;s preferences. Answers auto-update their profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {answeredQuestionsList.length > 0 && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              {answeredQuestionsList.length} answered
            </span>
          )}
          {pendingSuggestions.length > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              {pendingSuggestions.length} insights pending
            </span>
          )}
        </div>
      </div>

      {/* Unanswered Questions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Zap className="h-3.5 w-3.5 text-blue-500" />
            Questions to Ask
            {unansweredQuestions.length > 0 && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                {unansweredQuestions.length}
              </span>
            )}
          </h3>
          <button
            onClick={() => handleGenerateQuestions(undefined, answeredQuestionsList.length > 0)}
            disabled={generatingQuestions}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
          >
            {generatingQuestions ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {answeredQuestionsList.length > 0 ? 'More Questions' : 'Generate Questions'}
          </button>
        </div>

        {generatingQuestions && unansweredQuestions.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-4">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <p className="text-xs text-blue-700">Generating personalized questions...</p>
          </div>
        )}

        {unansweredQuestions.length === 0 && !generatingQuestions && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium text-slate-600">All questions answered</p>
            <p className="mt-1 text-xs text-slate-400">
              Click &ldquo;More Questions&rdquo; to generate follow-up questions based on previous answers.
            </p>
          </div>
        )}

        {unansweredQuestions.map((question) => {
          const priorityStyle = PRIORITY_STYLES[question.priority] ?? PRIORITY_STYLES.medium;
          const categoryIcon = CATEGORY_ICONS[question.category] ?? CATEGORY_ICONS.general;
          const isSending = sendingAnswer === question.id;

          return (
            <div key={question.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${priorityStyle.dot}`} />
                      {question.priority}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {categoryIcon}
                      {question.category}
                    </span>
                    {question.targetFields.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                        <Target className="h-2.5 w-2.5" />
                        {question.targetFields.slice(0, 2).join(', ')}
                        {question.targetFields.length > 2 && ` +${question.targetFields.length - 2}`}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-900">{question.questionText}</p>
                  {question.reason && (
                    <p className="mt-1 text-[11px] text-slate-400">{question.reason}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type the client's response..."
                  value={answers[question.id] ?? ''}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendAnswer(question);
                    }
                  }}
                  disabled={isSending}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
                />
                <button
                  onClick={() => handleSendAnswer(question)}
                  disabled={!answers[question.id]?.trim() || isSending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Free-form Note */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <StickyNote className="h-3.5 w-3.5 text-amber-500" />
          Advisor Note
        </h3>
        <p className="mb-2 text-[11px] text-slate-400">
          Capture additional observations or details from your meeting
        </p>
        <div className="flex gap-2">
          <textarea
            placeholder="Type a note from your meeting..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            onClick={handleAddNote}
            disabled={!noteText.trim() || addingNote}
            className="self-end rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </button>
        </div>
      </div>

      {/* Profile Insights */}
      {suggestions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              Extracted Profile Insights
            </h3>
            {approvedSuggestions.length > 0 && !commitResult && (
              <button
                onClick={handleCommitPreview}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3 w-3" />
                Commit {approvedSuggestions.length} to Profile
              </button>
            )}
          </div>

          {commitResult && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-xs text-emerald-700">
                Committed {commitResult.committed} preferences: {commitResult.fields.join(', ')}
              </p>
            </div>
          )}

          {/* Commit Preview Modal */}
          {commitPreview && commitPreview.length > 0 && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="mb-3 text-xs font-semibold text-emerald-800">
                The following preferences will be saved to the client&apos;s profile:
              </p>
              <div className="space-y-2">
                {commitPreview.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-md bg-white p-2.5">
                    <div>
                      <p className="text-xs font-medium text-slate-700">{item.targetField}</p>
                      <p className="text-[11px] text-slate-500">
                        {item.willOverwrite ? 'Overwriting' : 'Setting'}: {JSON.stringify(item.suggestedValue)}
                      </p>
                    </div>
                    <span className="text-[10px] font-medium text-emerald-600">
                      {Math.round(item.confidence * 100)}% confident
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleCommit}
                  disabled={committing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Confirm & Save
                </button>
                <button
                  onClick={() => setCommitPreview(null)}
                  className="rounded-md px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2" ref={answeredRef}>
            {/* Pending suggestions first */}
            {pendingSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={() => handleSuggestionAction(suggestion, 'approved')}
                onReject={() => handleSuggestionAction(suggestion, 'rejected')}
              />
            ))}
            {/* Approved */}
            {approvedSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={() => {}}
                onReject={() => handleSuggestionAction(suggestion, 'rejected')}
              />
            ))}
            {/* Committed */}
            {committedSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={() => {}}
                onReject={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Conversation History */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            Meeting Notes ({entries.length})
          </h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-lg p-3 ${
                  entry.role === 'question_answer'
                    ? 'border border-blue-100 bg-blue-50/50'
                    : entry.role === 'advisor_note'
                    ? 'border border-amber-100 bg-amber-50/50'
                    : 'border border-slate-100 bg-slate-50'
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className={`text-[10px] font-semibold uppercase ${
                    entry.role === 'question_answer' ? 'text-blue-600' : 'text-amber-600'
                  }`}>
                    {entry.role === 'question_answer' ? 'Q&A' : 'Note'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(entry.createdAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {(entry.metadata?.questionText as string | undefined) && (
                  <p className="mb-1 text-[11px] font-medium text-slate-500">
                    Q: {String(entry.metadata?.questionText)}
                  </p>
                )}
                <p className="text-sm text-slate-800">{entry.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onApprove,
  onReject,
}: {
  suggestion: MeetingProfileSuggestion;
  onApprove: () => void;
  onReject: () => void;
}) {
  const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'border-amber-200 bg-amber-50/30', text: 'text-amber-600', label: 'Pending Review' },
    approved: { bg: 'border-emerald-200 bg-emerald-50/30', text: 'text-emerald-600', label: 'Approved' },
    rejected: { bg: 'border-slate-200 bg-slate-50/30', text: 'text-slate-400', label: 'Rejected' },
    committed: { bg: 'border-emerald-200 bg-emerald-50/50', text: 'text-emerald-700', label: 'Saved to Profile' },
  };

  const style = statusStyles[suggestion.status] ?? statusStyles.pending;
  const displayValue =
    typeof suggestion.suggestedValue === 'string'
      ? suggestion.suggestedValue
      : JSON.stringify(suggestion.suggestedValue);

  return (
    <div className={`rounded-lg border p-3 ${style.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">
              {suggestion.targetField.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
            </span>
            <span className={`text-[10px] font-medium ${style.text}`}>
              {style.label}
            </span>
            <span className="text-[10px] text-slate-400">
              {Math.round(suggestion.confidence * 100)}% confident
            </span>
          </div>
          <p className="text-sm font-medium text-slate-900 break-words">{displayValue}</p>
          {suggestion.evidence && (
            <p className="mt-1 text-[11px] text-slate-500">{suggestion.evidence}</p>
          )}
        </div>
        {suggestion.status === 'pending' && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onApprove}
              className="rounded-md p-1.5 text-emerald-500 transition-colors hover:bg-emerald-100"
              title="Approve"
            >
              <ThumbsUp className="h-4 w-4" />
            </button>
            <button
              onClick={onReject}
              className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-100"
              title="Reject"
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
