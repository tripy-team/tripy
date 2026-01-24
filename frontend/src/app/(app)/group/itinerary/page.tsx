'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  MapPin,
  Plane,
  Hotel,
  Clock,
  CheckCircle,
  Share2,
  Download,
  Utensils,
  Camera,
  Sun,
} from 'lucide-react';
import { getItinerary, getTrip } from '@/lib/api';
import { formatAirportDisplay, getCityMapForCodes, isLikelyAirportCode } from '@/lib/airport-formatter';

type EventType = 'flight' | 'arrival' | 'hotel' | 'activity' | 'free';

interface DayEvent {
  id: string;
  type: EventType;
  time: string;
  title: string;
  description: string;
  details?: string;
  icon: typeof Plane;
  status: 'confirmed' | 'booked' | 'planned';
}

interface Day {
  day: number;
  date: string;
  events: DayEvent[];
}

// Build a simple day-by-day timeline from itinerary route + trip dates, or return sample data
function buildDaysFromItinerary(
  trip: { title?: string; startDate?: string; endDate?: string; start_date?: string; end_date?: string } | null,
  itineraryItems: { route?: unknown; cities?: unknown; name?: string }[] | null,
  codeToCity?: Record<string, string>
): Day[] {
  const routeItem = itineraryItems?.find(
    (i) => (i.route && Array.isArray(i.route) && i.route.length > 0) || (i.cities && Array.isArray(i.cities) && i.cities.length > 0)
  );
  const route = (routeItem?.route || routeItem?.cities || []) as Array<string | { name: string; days?: number }>;
  const cityNames = route
    .map((c) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
    .map((name) => formatAirportDisplay(name, codeToCity?.[name.trim().toUpperCase()]));
  const rawStart = (trip as Record<string, unknown>)?.start_date ?? trip?.startDate ?? (trip as Record<string, unknown>)?.end_date ?? trip?.endDate;
  const rawEnd = (trip as Record<string, unknown>)?.end_date ?? trip?.endDate ?? (trip as Record<string, unknown>)?.start_date ?? trip?.startDate;

  if (cityNames.length === 0 || rawStart == null || String(rawStart).trim() === '') {
    return getSampleDays();
  }

  const startDate = new Date(String(rawStart));
  const endDate = rawEnd != null && String(rawEnd).trim() !== '' ? new Date(String(rawEnd)) : new Date(startDate.getTime() + (cityNames.length + 1) * 24 * 60 * 60 * 1000);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const days: Day[] = [];
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  let dayNum = 1;
  const d = new Date(startDate);

  // Day 1: outbound flight
  days.push({
    day: dayNum++,
    date: fmt(d),
    events: [
      {
        id: 'e-out',
        type: 'flight',
        time: '—',
        title: `Flight to ${cityNames[0] || 'destination'}`,
        description: 'Details will appear once booking is complete',
        icon: Plane,
        status: 'planned',
      },
    ],
  });
  d.setDate(d.getDate() + 1);

  // Middle days: arrival + city stay (simplified: one city per "block" for now)
  for (let i = 0; i < cityNames.length && dayNum <= totalDays; i++) {
    const city = cityNames[i];
    const isFirst = i === 0;
    const events: DayEvent[] = [];

    if (isFirst) {
      events.push({
        id: `e-arr-${i}`,
        type: 'arrival',
        time: '—',
        title: `Arrive in ${city}`,
        description: 'Airport arrival',
        icon: MapPin,
        status: 'planned',
      });
    }

    events.push({
      id: `e-city-${i}`,
      type: 'activity',
      time: 'All Day',
      title: city,
      description: `Exploring ${city}`,
      icon: Sun,
      status: 'planned',
    });

    days.push({ day: dayNum++, date: fmt(d), events });
    d.setDate(d.getDate() + 1);
  }

  // Last day: return flight
  if (dayNum <= totalDays) {
    days.push({
      day: dayNum,
      date: fmt(d),
      events: [
        {
          id: 'e-return',
          type: 'flight',
          time: '—',
          title: 'Flight home',
          description: 'Return flight details will appear once booked',
          icon: Plane,
          status: 'planned',
        },
      ],
    });
  }

  return days.length > 0 ? days : getSampleDays();
}

function getSampleDays(): Day[] {
  return [
    {
      day: 1,
      date: 'Mon, Oct 14',
      events: [
        {
          id: 'e1',
          type: 'flight',
          time: '18:30',
          title: 'Flight to Paris',
          description: 'Air France AF007 • JFK Terminal 1',
          details: 'Seat 12A, 12B, 12C',
          icon: Plane,
          status: 'confirmed',
        },
      ],
    },
    {
      day: 2,
      date: 'Tue, Oct 15',
      events: [
        {
          id: 'e2',
          type: 'arrival',
          time: '08:15',
          title: 'Arrive in Paris',
          description: 'Charles de Gaulle (CDG) Terminal 2E',
          icon: MapPin,
          status: 'confirmed',
        },
        {
          id: 'e3',
          type: 'hotel',
          time: '15:00',
          title: 'Check-in: Hyatt Regency Paris Étoile',
          description: '3 Place du Général Kœnig, 75017 Paris',
          details: '2 Rooms • Confirmation #HY88291',
          icon: Hotel,
          status: 'confirmed',
        },
        {
          id: 'e4',
          type: 'activity',
          time: '19:00',
          title: "Welcome Dinner",
          description: "Le Relais de l'Entrecôte",
          icon: Utensils,
          status: 'planned',
        },
      ],
    },
    {
      day: 3,
      date: 'Wed, Oct 16',
      events: [
        {
          id: 'e5',
          type: 'activity',
          time: '10:00',
          title: 'Louvre Museum Tour',
          description: 'Skip-the-line tickets included',
          icon: Camera,
          status: 'booked',
        },
        {
          id: 'e6',
          type: 'activity',
          time: '14:30',
          title: 'Seine River Cruise',
          description: 'Bateaux Parisiens',
          icon: Sun,
          status: 'planned',
        },
      ],
    },
    {
      day: 4,
      date: 'Thu, Oct 17',
      events: [
        {
          id: 'e7',
          type: 'free',
          time: 'All Day',
          title: 'Free Exploration Day',
          description: 'Recommended: Montmartre & Sacré-Cœur',
          icon: MapPin,
          status: 'planned',
        },
      ],
    },
    {
      day: 5,
      date: 'Fri, Oct 18',
      events: [
        {
          id: 'e8',
          type: 'flight',
          time: '14:00',
          title: 'Flight to New York',
          description: 'Air France AF008 • CDG Terminal 2E',
          icon: Plane,
          status: 'confirmed',
        },
      ],
    },
  ];
}

export default function GroupItineraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  const [days, setDays] = useState<Day[]>(getSampleDays());
  const [tripTitle, setTripTitle] = useState('Trip Itinerary');
  const [dateRange, setDateRange] = useState('—');
  const [status, setStatus] = useState<'Booked' | 'Planned'>('Planned');
  const [loading, setLoading] = useState(!!tripId);

  useEffect(() => {
    if (!tripId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [tripRes, itineraryRes] = await Promise.all([
          getTrip(tripId).catch(() => null),
          getItinerary(tripId).catch(() => null),
        ]);
        const trip = tripRes as { title?: string; startDate?: string; endDate?: string } | null;
        const items = itineraryRes?.items ?? null;

        if (trip?.title) setTripTitle(trip.title);
        const t = trip as Record<string, unknown> | null;
        const s = (t?.start_date ?? trip?.startDate ?? '') as string;
        const e = (t?.end_date ?? trip?.endDate ?? '') as string;
        if (s || e) setDateRange([s, e].filter(Boolean).join(' – '));

        const codes: string[] = [];
        for (const i of items || []) {
          const r = (i.route || i.cities || (i as { path?: unknown }).path) as Array<string | { name?: string }> | undefined;
          if (Array.isArray(r)) {
            for (const c of r) {
              const n = typeof c === 'string' ? c : c?.name;
              if (n && isLikelyAirportCode(n)) codes.push(n.trim().toUpperCase());
            }
          }
        }
        const codeToCity = await getCityMapForCodes(codes);
        const built = buildDaysFromItinerary(trip, items, codeToCity);
        setDays(built);
        // If we have real itinerary items with route, consider it more "planned" than fully booked
        const hasRoute = items?.some(
          (i) => (i.route && Array.isArray(i.route) && i.route.length > 0) || (i.cities && Array.isArray(i.cities) && i.cities.length > 0)
        );
        setStatus(hasRoute ? 'Planned' : 'Planned');
      } catch (e) {
        console.error('Error loading itinerary:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId]);

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: tripTitle,
        text: `Trip Itinerary: ${tripTitle} • ${dateRange}`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(window.location.href).then(() => {});
    }
  };

  const handleExportPdf = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading itinerary…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-8 bg-neutral-50">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <button
              onClick={() => router.push(tripId ? `/group/dashboard?trip_id=${tripId}` : '/group/dashboard')}
              className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-4 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Dashboard</span>
            </button>

            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-slate-900">Trip Itinerary</h1>
              <span
                className={`px-3 py-1 text-sm font-medium rounded-full flex items-center gap-1.5 ${
                  status === 'Booked' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                {status}
              </span>
            </div>
            <p className="text-slate-600">{tripTitle} • {dateRange}</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleShare}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 font-medium shadow-sm"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <button
              onClick={handleExportPdf}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 font-medium shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </button>
          </div>
        </div>

        {/* Itinerary Timeline */}
        <div className="space-y-8">
          {days.map((day) => (
            <div key={day.day} className="relative">
              {/* Date Header */}
              <div className="sticky top-0 z-10 bg-neutral-50 py-4 mb-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex flex-col items-center justify-center text-white shadow-sm flex-shrink-0">
                  <span className="text-xs font-medium opacity-80">DAY</span>
                  <span className="text-xl font-bold leading-none">{day.day}</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900">{day.date}</h2>
                <div className="h-px bg-slate-200 flex-1 ml-4" />
              </div>

              {/* Events */}
              <div className="ml-6 pl-10 border-l-2 border-slate-200 space-y-8 pb-8">
                {day.events.map((event) => {
                  const Icon = event.icon;
                  return (
                    <div key={event.id} className="relative group">
                      <div className="absolute -left-[49px] top-0 w-4 h-4 rounded-full bg-white border-4 border-blue-600 shadow-sm z-10 group-hover:scale-125 transition-transform" />

                      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-4">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                              event.type === 'flight'
                                ? 'bg-blue-50 text-blue-600'
                                : event.type === 'hotel'
                                  ? 'bg-indigo-50 text-indigo-600'
                                  : event.type === 'arrival'
                                    ? 'bg-emerald-50 text-emerald-600'
                                    : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon className="w-5 h-5" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="text-lg font-bold text-slate-900 truncate">{event.title}</h3>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md">
                                  <Clock className="w-3.5 h-3.5" />
                                  {event.time}
                                </span>
                              </div>
                            </div>

                            <p className="text-slate-600 mb-2">{event.description}</p>

                            {event.details && (
                              <div className="inline-block px-3 py-1 bg-slate-100 text-slate-600 text-sm font-medium rounded-lg">
                                {event.details}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
