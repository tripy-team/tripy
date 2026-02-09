'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle,
  CreditCard,
  ArrowRight,
  Plane,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Wallet,
  Car,
  Bus,
  Info,
  Moon,
  Clock,
  ExternalLink,
  Copy,
  Check,
  DollarSign,
  Eye,
  Mail,
  Shield,
  TrendingDown,
  Calendar,
} from 'lucide-react';
import { solo, trips as tripsAPI, destinations as destinationsAPI, type SoloTransferStrategyResponse, type SoloTransferInstruction, type SoloBookingStep, type BookingDetails, type ItineraryRisk, isAuthenticated } from '@/lib/api';
import { calculateServiceFee, SERVICE_FEE_PERCENT, formatDate, tripDurationDays } from '@/lib/utils';
import { trackEvent, EVENTS } from '@/lib/analytics';
import TransferInfoBanner from '@/components/TransferInfoBanner';
import NextSteps from '@/components/NextSteps';
import RiskBadge from '@/components/RiskBadge';
import SignInPrompt from '@/components/SignInPrompt';
import EmailPlanModal from '@/components/EmailPlanModal';

function humanizeProgram(code: string): string {
  const m: Record<string, string> = {
    chase: 'Chase Ultimate Rewards',
    amex: 'Amex Membership Rewards',
    citi: 'Citi ThankYou Rewards',
    capital_one: 'Capital One Miles',
    capitalone: 'Capital One Miles',
    bilt: 'Bilt Rewards',
    bank_of_america: 'Bank of America Points',
    wells_fargo: 'Wells Fargo Points',
    discover: 'Discover Miles',
    us_bank: 'US Bank Rewards',
  };
  return m[String(code || '').toLowerCase()] || String(code || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function humanizeAirline(code: string): string {
  const m: Record<string, string> = {
    // US Airlines
    AA: 'American AAdvantage',
    DL: 'Delta SkyMiles',
    UA: 'United MileagePlus',
    WN: 'Southwest Rapid Rewards',
    B6: 'JetBlue TrueBlue',
    AS: 'Alaska Mileage Plan',
    HA: 'HawaiianMiles',
    // European Airlines
    VS: 'Virgin Atlantic Flying Club',
    BA: 'British Airways Executive Club',
    AF: 'Air France / KLM Flying Blue',
    KL: 'Flying Blue',
    KLM: 'Flying Blue',
    LH: 'Miles & More',
    LX: 'Miles & More',
    IB: 'Iberia Plus',
    AY: 'Finnair Plus',
    TP: 'TAP Miles&Go',
    EI: 'AerClub',
    // Middle East
    EK: 'Emirates Skywards',
    QR: 'Qatar Airways Privilege Club',
    EY: 'Etihad Guest',
    TK: 'Miles&Smiles',
    // Asia Pacific
    NH: 'ANA Mileage Club',
    JL: 'JAL Mileage Bank',
    SQ: 'KrisFlyer',
    CX: 'Asia Miles',
    QF: 'Qantas Frequent Flyer',
    NZ: 'Airpoints',
    KE: 'SKYPASS',
    OZ: 'Asiana Club',
    // Americas
    AC: 'Aeroplan',
    AM: 'Club Premier',
    AV: 'LifeMiles',
  };
  return m[String(code || '').toUpperCase()] || String(code || '').toUpperCase();
}

// Get the airline's actual name (not loyalty program)
function getAirlineName(code: string): string {
  const m: Record<string, string> = {
    // US Airlines
    AA: 'American Airlines',
    DL: 'Delta Air Lines',
    UA: 'United Airlines',
    WN: 'Southwest Airlines',
    B6: 'JetBlue Airways',
    AS: 'Alaska Airlines',
    NK: 'Spirit Airlines',
    F9: 'Frontier Airlines',
    G4: 'Allegiant Air',
    HA: 'Hawaiian Airlines',
    // European Airlines
    VS: 'Virgin Atlantic',
    BA: 'British Airways',
    AF: 'Air France',
    KL: 'KLM Royal Dutch Airlines',
    KLM: 'KLM Royal Dutch Airlines',
    LH: 'Lufthansa',
    LX: 'Swiss International Air Lines',
    OS: 'Austrian Airlines',
    AZ: 'ITA Airways',
    IB: 'Iberia',
    SK: 'Scandinavian Airlines (SAS)',
    AY: 'Finnair',
    TP: 'TAP Air Portugal',
    EI: 'Aer Lingus',
    // Middle East & Africa
    EK: 'Emirates',
    QR: 'Qatar Airways',
    EY: 'Etihad Airways',
    TK: 'Turkish Airlines',
    SA: 'South African Airways',
    ET: 'Ethiopian Airlines',
    // Asia Pacific
    NH: 'All Nippon Airways (ANA)',
    JL: 'Japan Airlines',
    SQ: 'Singapore Airlines',
    CX: 'Cathay Pacific',
    QF: 'Qantas',
    NZ: 'Air New Zealand',
    TG: 'Thai Airways',
    MH: 'Malaysia Airlines',
    GA: 'Garuda Indonesia',
    CI: 'China Airlines',
    BR: 'EVA Air',
    OZ: 'Asiana Airlines',
    KE: 'Korean Air',
    // Americas
    AC: 'Air Canada',
    AM: 'Aeromexico',
    LA: 'LATAM Airlines',
    AV: 'Avianca',
    CM: 'Copa Airlines',
  };
  return m[String(code || '').toUpperCase()] || String(code || '').toUpperCase();
}

interface PaymentRec {
  edge?: unknown[];
  type?: string;
  via?: { source?: string; airline?: string; native?: string };
  miles?: number;
  surcharge?: number;
  mode?: string;
  fare?: number;
  // Flight time fields
  departure_time?: string;
  arrival_time?: string;
  operating_airline?: string;
}

function SoloBookingContent() {
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  const [isPaid, setIsPaid] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [trip, setTrip] = useState<{ startDate?: string; endDate?: string; destinations?: string[]; adults?: number; children?: number } | null>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [destinationMap, setDestinationMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedFlightIdx, setExpandedFlightIdx] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Post-booking workflow state (see docs/KEEP_WATCHING_FEATURE.md for state machine spec)
  const [postBookingState, setPostBookingState] = useState<
    'asking' | 'not_booked' | 'dismissed' | 'booked' | 'email_input' | 'email_pending_verification' | 'monitoring_active'
  >('asking');
  const [monitoringEmail, setMonitoringEmail] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  
  // Action buttons state (moved from results page)
  const [isBooked, setIsBooked] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState<'lock' | 'save' | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  // New solo booking state
  const [selection, setSelection] = useState<{
    itineraryId?: string;
    itinerarySnapshot?: Record<string, unknown>;
    cashPriceAtSelection?: number;
    outOfPocketAtSelection?: number;
  } | null>(null);
  const [transferStrategy, setTransferStrategy] = useState<SoloTransferStrategyResponse | null>(null);
  const [usingSoloApi, setUsingSoloApi] = useState(false);
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!tripId) {
        setLoading(false);
        return;
      }
      try {
        // Auto-unlock transfer instructions
        try {
          await solo.updateStatus(tripId, 'instructions_unlocked', {
            paidAt: new Date().toISOString(),
            amount: 0,
            method: 'free',
          });
        } catch (statusErr) {
          console.log('Could not auto-unlock status:', statusErr);
        }
        
        // Try to get selection from new solo API first
        let usedSoloApi = false;
        try {
          const [selectionRes, tripData] = await Promise.all([
            solo.getSelection(tripId).catch(() => null),
            solo.getTrip(tripId).catch(() => null),
          ]);
          
          if (selectionRes?.itineraryId && selectionRes?.itinerarySnapshot) {
            // Extract only the fields we need for the selection state
            const snapshot = selectionRes.itinerarySnapshot as Record<string, unknown>;
            setSelection({
              itineraryId: selectionRes.itineraryId,
              itinerarySnapshot: snapshot,
              cashPriceAtSelection: selectionRes.cashPriceAtSelection,
              outOfPocketAtSelection: selectionRes.outOfPocketAtSelection,
            });
            setTrip(tripData);
            setUsingSoloApi(true);
            usedSoloApi = true;
            
            // Extract bookingDetails from itinerary snapshot if available
            if (snapshot.bookingDetails) {
              setBookingDetails(snapshot.bookingDetails as BookingDetails);
            }
            
            // Get transfer strategy if we have a selection
            try {
              const strategy = await solo.getTransferStrategy(tripId, selectionRes.itineraryId);
              setTransferStrategy(strategy);
            } catch (strategyErr) {
              console.log('Could not fetch transfer strategy:', strategyErr);
            }
          } else {
            // No selection found - try to get cached optimization results
            console.log('No selection found, trying optimization cache...');
            try {
              const cacheRes = await solo.getOptimizationCache(tripId);
              if (cacheRes?.itineraries && cacheRes.itineraries.length > 0) {
                const bestItinerary = cacheRes.itineraries[0]; // Best OOP itinerary
                
                // Extract bookingDetails from cache or best itinerary
                if (cacheRes.bookingDetails) {
                  setBookingDetails(cacheRes.bookingDetails);
                } else if (bestItinerary.bookingDetails) {
                  setBookingDetails(bestItinerary.bookingDetails);
                }
                
                // Auto-select the best itinerary if none selected
                await solo.selectItinerary(tripId, {
                  itineraryId: bestItinerary.id,
                  itinerarySnapshot: bestItinerary,
                  cashPriceAtSelection: bestItinerary.oopMetrics?.totalCashPrice || 0,
                  outOfPocketAtSelection: bestItinerary.oopMetrics?.totalOutOfPocket || 0,
                });
                
                // Now get the selection we just saved
                const newSelectionRes = await solo.getSelection(tripId);
                if (newSelectionRes?.itineraryId && newSelectionRes?.itinerarySnapshot) {
                  const newSnapshot = newSelectionRes.itinerarySnapshot as Record<string, unknown>;
                  setSelection({
                    itineraryId: newSelectionRes.itineraryId,
                    itinerarySnapshot: newSnapshot,
                    cashPriceAtSelection: newSelectionRes.cashPriceAtSelection,
                    outOfPocketAtSelection: newSelectionRes.outOfPocketAtSelection,
                  });
                  setTrip(tripData);
                  setUsingSoloApi(true);
                  usedSoloApi = true;
                  
                  // Extract bookingDetails from new snapshot if not already set
                  if (!bookingDetails && newSnapshot.bookingDetails) {
                    setBookingDetails(newSnapshot.bookingDetails as BookingDetails);
                  }
                  
                  // Get transfer strategy
                  const strategy = await solo.getTransferStrategy(tripId, newSelectionRes.itineraryId);
                  setTransferStrategy(strategy);
                }
              }
            } catch (cacheErr) {
              console.log('No optimization cache available:', cacheErr);
            }
          }
        } catch (soloErr) {
          console.log('Solo API not available, falling back to legacy:', soloErr);
        }
        
        // Fallback to legacy API if solo API didn't work
        if (!usedSoloApi) {
          const [tripData, destRes] = await Promise.all([
          tripsAPI.get(tripId).catch(() => null),
          destinationsAPI.list(tripId).catch(() => ({ destinations: [] })),
        ]);
        setTrip(tripData ?? null);
        const map = new Map<string, string>();
        (destRes?.destinations || []).forEach((d: { destinationId?: string; name?: string }) => {
          if (d?.destinationId && d?.name) map.set(d.destinationId, d.name);
        });
        setDestinationMap(map);
        }
      } catch (_err) {
        console.log('Error fetching booking data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [tripId]);

  // Persist and restore post-booking workflow state
  useEffect(() => {
    if (!tripId) return;

    // Check for monitoring redirect param (from verification magic link)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const monitoringParam = params.get('monitoring');
      if (monitoringParam === 'activated' || monitoringParam === 'already_verified') {
        setPostBookingState('monitoring_active');
        // Store in localStorage with expiry for staleness check
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(`tripy_monitoring_${tripId}`, JSON.stringify({
          state: 'active',
          verified_at: new Date().toISOString(),
          expires_at: expiresAt,
        }));
        return;
      }
    }

    // Try to get server truth for authenticated users
    const fetchStatus = async () => {
      try {
        const status = await solo.getMonitoringStatus(tripId);
        if (status && (status.state === 'active' || status.state === 'pending_verification')) {
          if (status.state === 'active') {
            setPostBookingState('monitoring_active');
          } else {
            setPostBookingState('email_pending_verification');
          }
          return;
        }
      } catch {
        // Not authenticated or no subscription — fall through to localStorage
      }

      // Restore from localStorage (unauthenticated / fallback)
      try {
        // Check monitoring-specific localStorage (with staleness)
        const monitoringRaw = localStorage.getItem(`tripy_monitoring_${tripId}`);
        if (monitoringRaw) {
          const parsed = JSON.parse(monitoringRaw);
          if (parsed.state === 'active' && parsed.expires_at) {
            const expiresAt = new Date(parsed.expires_at);
            if (expiresAt > new Date()) {
              setPostBookingState('monitoring_active');
              return;
            }
            // Stale — remove it
            localStorage.removeItem(`tripy_monitoring_${tripId}`);
          }
        }

        // Check general post-booking state
        const stored = localStorage.getItem(`tripy_post_booking_${tripId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (['booked', 'monitoring_active', 'dismissed', 'email_input', 'email_pending_verification'].includes(parsed.state)) {
            setPostBookingState(parsed.state);
            if (parsed.email) setMonitoringEmail(parsed.email);
          }
        }
      } catch { /* ignore parse errors */ }
    };

    fetchStatus();
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    if (['booked', 'monitoring_active', 'dismissed', 'email_input', 'email_pending_verification'].includes(postBookingState)) {
      localStorage.setItem(`tripy_post_booking_${tripId}`, JSON.stringify({
        state: postBookingState,
        email: monitoringEmail,
      }));
    }
  }, [tripId, postBookingState, monitoringEmail]);

  // Check if this trip was previously booked locally (anon users)
  useEffect(() => {
    if (tripId && typeof window !== 'undefined') {
      const bookedTrips = JSON.parse(localStorage.getItem('tripy_booked_trips') || '[]');
      if (bookedTrips.includes(tripId)) {
        setIsBooked(true);
      }
    }
  }, [tripId]);

  // "I Booked It" handler
  const handleIBookedIt = async () => {
    trackEvent(EVENTS.I_BOOKED_IT, { tripId, isAuthenticated: isAuthenticated() });
    
    if (isAuthenticated() && tripId) {
      try {
        await solo.updateStatus(tripId, 'booked');
      } catch (err) {
        console.error('Error marking trip as booked:', err);
      }
    } else {
      if (typeof window !== 'undefined' && tripId) {
        const bookedTrips = JSON.parse(localStorage.getItem('tripy_booked_trips') || '[]');
        if (!bookedTrips.includes(tripId)) {
          bookedTrips.push(tripId);
          localStorage.setItem('tripy_booked_trips', JSON.stringify(bookedTrips));
        }
      }
    }
    
    setIsBooked(true);
  };

  // Handle Lock Plan
  const handleLockPlan = async () => {
    trackEvent(EVENTS.LOCK_PLAN_CLICKED, { tripId, isAuthenticated: isAuthenticated() });
    
    if (!isAuthenticated()) {
      trackEvent(EVENTS.SIGN_IN_PROMPTED, { trigger: 'lock', tripId });
      setShowSignInPrompt('lock');
      return;
    }
    
    try {
      if (selection?.itineraryId && tripId) {
        await solo.selectItinerary(tripId, {
          itineraryId: selection.itineraryId,
          itinerarySnapshot: selection.itinerarySnapshot || {},
          cashPriceAtSelection: selection.cashPriceAtSelection || 0,
          outOfPocketAtSelection: selection.outOfPocketAtSelection || 0,
        });
      }
      setIsLocked(true);
    } catch (err) {
      console.error('Error locking plan:', err);
    }
  };

  // Post-booking workflow handlers
  const handleBookingConfirm = async () => {
    setPostBookingState('booked');
    if (tripId) {
      try {
        await solo.updateStatus(tripId, 'booked');
      } catch (err) {
        console.log('Could not update trip status:', err);
      }
    }
  };

  const handleNotYet = () => {
    setPostBookingState('not_booked');
  };

  const handleStartMonitoring = () => {
    // Show email input — free email tier only (paid hidden behind feature flag)
    setPostBookingState('email_input');
    setMonitoringError(null);
  };

  const handleMonitoringDecline = () => {
    // Clean dismiss — no email prompt, no nag
    setPostBookingState('dismissed');
  };

  const handleEmailSubmit = async () => {
    if (!monitoringEmail.trim()) return;
    if (!tripId) return;
    setEmailSubmitting(true);
    setMonitoringError(null);
    try {
      // Build baseline payload from current selection (if available)
      const baselinePayload = selection?.itinerarySnapshot
        ? {
            schema_version: 1,
            selected_itinerary: selection.itinerarySnapshot,
            alternatives: [],
            query_inputs: {},
          }
        : undefined;

      const result = await solo.startMonitoring(tripId, monitoringEmail, baselinePayload);

      if (result.state === 'active') {
        // Authenticated user — immediately active
        setPostBookingState('monitoring_active');
        const expiresAt = result.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        localStorage.setItem(`tripy_monitoring_${tripId}`, JSON.stringify({
          state: 'active',
          verified_at: new Date().toISOString(),
          expires_at: expiresAt,
        }));
      } else if (result.state === 'pending_verification') {
        // Check if the verification email was actually sent
        if (result.emailSent === false) {
          setMonitoringError(result.message || 'Could not send verification email. Please try again.');
        } else {
          // Unauthenticated — awaiting email verification
          setPostBookingState('email_pending_verification');
        }
      } else {
        // Unexpected state — treat as active
        setPostBookingState('monitoring_active');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start monitoring. Please try again.';
      setMonitoringError(message);
      // Stay in email_input state so user can retry
    } finally {
      setEmailSubmitting(false);
    }
  };

  // handlePayment removed — paywall disabled

  if (loading) {
    return (
      <div data-testid="solo-booking-loading" data-slot="loading-spinner-wrapper" className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading booking details...</p>
        </div>
      </div>
    );
  }

  const pathItem = items.find((i: Record<string, unknown>) => i.type === 'path') as Record<string, unknown> | undefined;
  const itineraryItem = items.find((i: Record<string, unknown>) => {
    if (i.type !== 'itinerary') return false;
    const r = i.route || i.cities || (i as { path?: unknown }).path;
    return Array.isArray(r) && r.length > 0;
  }) as Record<string, unknown> | undefined;
  const paymentsItem = items.find((i: Record<string, unknown>) => i.type === 'payments') as { payments?: PaymentRec[] } | undefined;
  const totalsItem = items.find((i: Record<string, unknown>) => i.type === 'totals') as { totals?: { cash?: number; airline_points?: number } } | undefined;

  const citiesFromItinerary = itineraryItem?.cities as Array<{ name?: string }> | undefined;
  const rawRoute = (pathItem?.path || pathItem?.route || itineraryItem?.route || itineraryItem?.path) as string[] | Array<{ name?: string }> | undefined;
  const routeLabels: string[] = Array.isArray(citiesFromItinerary) && citiesFromItinerary.length > 0
    ? citiesFromItinerary.map((c) => c?.name).filter(Boolean) as string[]
    : Array.isArray(rawRoute)
      ? rawRoute.map((n: string | { name?: string }) => {
          if (typeof n === 'object' && n?.name) return n.name;
          if (typeof n === 'string' && /^[0-9a-f-]{36}$/i.test(n)) return destinationMap.get(n) || n;
          return String(n || '');
        }).filter(Boolean) as string[]
      : [];

  const duration = trip?.startDate && trip?.endDate ? (tripDurationDays(trip.startDate, trip.endDate) ?? 5) : 5;
  const destCount = Math.max(1, (trip?.destinations && trip.destinations.length) || destinationMap.size || 1);
  const estimatedCash = duration * 200 + destCount * 300;

  // Use actual out-of-pocket cost from selected itinerary when available (solo API selection)
  const selectionOOP = selection?.outOfPocketAtSelection;
  const cashPrice = selectionOOP != null && selectionOOP >= 0
    ? selectionOOP
    : (Number(pathItem?.totalCost ?? itineraryItem?.totalCost ?? totalsItem?.totals?.cash ?? estimatedCash) || estimatedCash);
  const pointsCost = Number(pathItem?.pointsCost ?? itineraryItem?.pointsCost ?? totalsItem?.totals?.airline_points ?? Math.round(estimatedCash * 25)) || 60000;
  const paymentRecs: PaymentRec[] = Array.isArray(paymentsItem?.payments) ? paymentsItem.payments : [];
  const taxesFromPayments = paymentRecs.reduce((s, p) => s + (Number(p.surcharge) || 0), 0);
  const taxes = taxesFromPayments > 0 ? Math.round(taxesFromPayments) : 50;
  
  // Only calculate savings if points are actually being used in payments
  const hasPointsPayments = paymentRecs.some(p => p.type === 'points');
  const actualPointsUsed = hasPointsPayments 
    ? paymentRecs.filter(p => p.type === 'points').reduce((sum, p) => sum + (Number(p.miles) || 0), 0)
    : 0;
  // Only show savings when points are actually used (2 cents per point valuation)
  const savings = hasPointsPayments && actualPointsUsed > 0
    ? cashPrice - (actualPointsUsed / 1000 * 2 + taxes)
    : 0;
  const serviceFee = calculateServiceFee(cashPrice);

  const startDate = trip?.startDate || '';
  const endDate = trip?.endDate || '';
  const primaryDestLabel = routeLabels[1] || routeLabels[0] || (trip?.destinations && trip.destinations[0]) || 'your destination';
  const startLabel = startDate ? formatDate(startDate) : 'your travel dates';
  const endLabel = endDate ? formatDate(endDate) : '';

  // Build condensed transfer summary: group by source card
  type TransferSummary = {
    source: string;
    sourceCode: string;
    partner: string;
    partnerCode: string;
    totalPoints: number;
    totalSurcharge: number;
  };
  
  type FlightSegment = {
    mode: 'flight' | 'bus' | 'car';
    orig: string;
    dest: string;
    flightNumber?: string;
    marketingAirline?: string;      // Loyalty program name (e.g., "Virgin Atlantic Flying Club")
    marketingAirlineName?: string;  // Airline name (e.g., "Virgin Atlantic")
    marketingCode?: string;         // Airline code (e.g., "VS")
    operatingAirline?: string;      // Operating loyalty program
    operatingAirlineName?: string;  // Operating airline name
    operatingCode?: string;         // Operating airline code
    isCodeshare: boolean;
    fare?: number;
    surcharge?: number;
    miles?: number;             // Points required
    departureDate?: string;     // Date string (e.g., "Jun 15, 2024")
    departureTime?: string;
    arrivalTime?: string;
    isRedEye: boolean;      // Departs late night (10pm-5am)
    isOvernight: boolean;   // Arrives next day
    paymentType?: 'points' | 'cash';
    sourceProgram?: string;     // e.g., "Chase Ultimate Rewards"
  };
  
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };
  
  // Airline booking URLs
  const AIRLINE_BOOKING_URLS: Record<string, string> = {
    VS: 'virginatlantic.com',
    AF: 'airfrance.com',
    BA: 'britishairways.com',
    UA: 'united.com',
    AA: 'aa.com',
    DL: 'delta.com',
    B6: 'jetblue.com',
    WN: 'southwest.com',
    KL: 'klm.com',
    NH: 'ana.co.jp',
    SQ: 'singaporeair.com',
  };
  
  // Helper to parse date from datetime string
  const parseDateFromDateTime = (timeStr?: string): string | null => {
    if (!timeStr) return null;
    
    // Try ISO format first (e.g., "2024-06-15T23:45:00")
    if (timeStr.includes('T')) {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
      }
    }
    
    // Try date-only format (e.g., "2024-06-15")
    const dateMatch = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      const date = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric',
          year: 'numeric'
        });
      }
    }
    
    return null;
  };
  
  // Helper to parse time and detect red-eye/overnight
  const parseFlightTime = (timeStr?: string): { hour: number; minute: number; nextDay: boolean } | null => {
    if (!timeStr) return null;
    // Handle formats like "23:45", "2024-06-15T23:45:00", "11:30 PM", "06:40+1"
    const nextDay = timeStr.includes('+1');
    const cleaned = timeStr.replace('+1', '').trim();
    
    // Try ISO format first
    if (cleaned.includes('T')) {
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return { hour: date.getHours(), minute: date.getMinutes(), nextDay };
      }
    }
    
    // Try HH:MM format
    const match24 = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      return { hour: parseInt(match24[1]), minute: parseInt(match24[2]), nextDay };
    }
    
    // Try 12-hour format (e.g., "11:30 PM")
    const match12 = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
      let hour = parseInt(match12[1]);
      const isPM = match12[3].toUpperCase() === 'PM';
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return { hour, minute: parseInt(match12[2]), nextDay };
    }
    
    return null;
  };
  
  const formatTime = (timeStr?: string): string => {
    if (!timeStr) return '';
    const parsed = parseFlightTime(timeStr);
    if (!parsed) return timeStr;
    const { hour, minute, nextDay } = parsed;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    const minStr = minute.toString().padStart(2, '0');
    return `${hour12}:${minStr} ${ampm}${nextDay ? ' +1' : ''}`;
  };
  
  const isRedEyeHour = (hour: number): boolean => hour >= 22 || hour < 5;

  const transferSummaries: TransferSummary[] = [];
  const flightSegments: FlightSegment[] = [];

  // Process payment records to build condensed summaries
  if (paymentRecs.length > 0) {
    const transferMap = new Map<string, TransferSummary>();
    
    paymentRecs.forEach((p) => {
      // Process flight/segment
      if (p.type === 'points' && (p.via?.source || p.via?.airline || p.via?.native) && (p.miles ?? 0) > 0) {
        const sourceCode = (p.via?.source || '').toLowerCase();
        const partnerCode = (p.via?.airline || p.via?.native || '').toUpperCase();
        const key = `${sourceCode}→${partnerCode}→flight`;
        
        const existing = transferMap.get(key);
        if (existing) {
          existing.totalPoints += Math.round(Number(p.miles) || 0);
          existing.totalSurcharge += Number(p.surcharge) || 0;
        } else {
          transferMap.set(key, {
            source: humanizeProgram(sourceCode),
            sourceCode,
            partner: humanizeAirline(partnerCode),
            partnerCode,
            totalPoints: Math.round(Number(p.miles) || 0),
            totalSurcharge: Number(p.surcharge) || 0,
          });
        }
      }
      
      // Add flight segment
      const edge = Array.isArray(p.edge) ? p.edge : [];
      const orig = String(edge[0] || '').toUpperCase();
      const dest = String(edge[1] || '').toUpperCase();
      const flightNumber = edge[2] ? String(edge[2]).toUpperCase() : undefined;
      const mode = (p.mode || 'flight') as 'flight' | 'bus' | 'car';
      
      if (orig && dest) {
        // Detect codeshare: marketing airline (via.airline) differs from operating airline (via.native)
        // Also check operating_airline field from backend
        const marketingCode = (p.via?.airline || '').toUpperCase();
        const nativeCode = (p.via?.native || '').toUpperCase();
        const operatingFromBackend = (p.operating_airline || '').toUpperCase();
        const operatingCode = operatingFromBackend || nativeCode;
        const isCodeshare = !!(marketingCode && operatingCode && marketingCode !== operatingCode);
        
        // For airline display, use marketingCode if available, otherwise use nativeCode
        const displayAirlineCode = marketingCode || nativeCode;
        
        // Parse departure/arrival times for red-eye and overnight detection
        const depParsed = parseFlightTime(p.departure_time);
        const arrParsed = parseFlightTime(p.arrival_time);
        const isRedEye = depParsed ? isRedEyeHour(depParsed.hour) : false;
        const isOvernight = arrParsed?.nextDay || false;
        
        // Parse date from departure time (or use trip start date as fallback)
        const departureDate = parseDateFromDateTime(p.departure_time) || startLabel;
        
        flightSegments.push({
          mode,
          orig,
          dest,
          flightNumber: flightNumber !== 'BUS' && flightNumber !== 'CAR' ? flightNumber : undefined,
          marketingAirline: displayAirlineCode ? humanizeAirline(displayAirlineCode) : undefined,
          marketingAirlineName: displayAirlineCode ? getAirlineName(displayAirlineCode) : undefined,
          marketingCode: displayAirlineCode || undefined,
          operatingAirline: isCodeshare ? humanizeAirline(operatingCode) : undefined,
          operatingAirlineName: isCodeshare ? getAirlineName(operatingCode) : undefined,
          operatingCode: isCodeshare ? operatingCode : undefined,
          isCodeshare,
          fare: p.type === 'cash' ? Number(p.fare) : undefined,
          surcharge: p.type === 'points' ? Number(p.surcharge) : undefined,
          miles: p.type === 'points' ? Number(p.miles) : undefined,
          departureDate,
          departureTime: p.departure_time,
          arrivalTime: p.arrival_time,
          isRedEye,
          isOvernight,
          paymentType: p.type as 'points' | 'cash' | undefined,
          sourceProgram: p.type === 'points' && p.via?.source ? humanizeProgram(p.via.source) : undefined,
        });
      }
    });
    
    transferSummaries.push(...transferMap.values());
  }

  // Fallback when no payment data
  const hasData = transferSummaries.length > 0 || flightSegments.length > 0;
  
  // Check if we have data from the new solo API
  const hasSoloData = usingSoloApi && selection && transferStrategy;
  // Also check if we have a selection with snapshot segments (even without transfer strategy)
  const hasSnapshotSegments = usingSoloApi && selection && !transferStrategy && Array.isArray((selection.itinerarySnapshot as Record<string, unknown>)?.segments) && ((selection.itinerarySnapshot as Record<string, unknown>).segments as unknown[]).length > 0;
  const soloSnapshot = selection?.itinerarySnapshot as {
    oopMetrics?: { totalCashPrice?: number; totalOutOfPocket?: number; cashSaved?: number; savingsPercentage?: number; totalPointsUsed?: number };
    segments?: Array<Record<string, unknown>>;
    risk?: ItineraryRisk;
  } | undefined;

  const SegmentIcon = ({ mode }: { mode: 'flight' | 'bus' | 'car' }) => (
    mode === 'flight' 
      ? <Plane className="w-5 h-5 text-blue-600" /> 
      : mode === 'bus' 
        ? <Bus className="w-5 h-5 text-green-600" /> 
        : <Car className="w-5 h-5 text-orange-600" />
  );

  return (
    <div data-testid="solo-booking-page" data-slot="SoloBooking" className="min-h-screen bg-slate-50 pb-20">
      {/* Sign-in prompt modal (for lock/save actions) */}
      {showSignInPrompt && (
        <SignInPrompt
          trigger={showSignInPrompt}
          onDismiss={() => setShowSignInPrompt(null)}
          onContinueWithout={() => setShowSignInPrompt(null)}
        />
      )}

      {/* Email Plan Modal */}
      {showEmailModal && tripId && (
        <EmailPlanModal
          tripId={tripId}
          onClose={() => setShowEmailModal(false)}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Your Booking Plan</h1>
          <p className="text-slate-500 mt-2 mb-4">Follow the step-by-step transfer instructions below to book your trip.</p>
          <TransferInfoBanner />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        
        {/* Trip Details & Savings */}
        <div className="space-y-8">
          
          {/* Savings Highlight - show from solo API or legacy */}
          {(hasSoloData || hasSnapshotSegments) && soloSnapshot?.oopMetrics?.cashSaved && soloSnapshot.oopMetrics.cashSaved > 0 ? (
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-900/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-blue-100 mb-1">
                  <Sparkles className="w-5 h-5" />
                  <span className="font-medium">Total Savings</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl font-bold">${Math.round(soloSnapshot.oopMetrics.cashSaved).toLocaleString()}</span>
                  <span className="text-blue-200">saved vs cash price</span>
                </div>
                <div className="grid grid-cols-2 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                  <div>
                    <div className="text-blue-200 text-sm">Cash Price</div>
                    <div className="text-xl font-semibold line-through opacity-70">${Math.round(soloSnapshot.oopMetrics.totalCashPrice || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-blue-200 text-sm">Your Cost</div>
                    <div className="text-xl font-semibold text-green-300">${Math.round(soloSnapshot.oopMetrics.totalOutOfPocket || 0).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : hasPointsPayments && savings > 0 ? (
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl shadow-blue-900/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-blue-100 mb-1">
                  <Sparkles className="w-5 h-5" />
                  <span className="font-medium">Total Savings</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl font-bold">${Math.max(0, Math.round(savings)).toLocaleString()}</span>
                  <span className="text-blue-200">saved vs cash price</span>
                </div>
                <div className="grid grid-cols-2 gap-4 bg-white/10 rounded-xl p-4 border border-white/10">
                  <div>
                    <div className="text-blue-200 text-sm">Cash Price</div>
                    <div className="text-xl font-semibold line-through opacity-70">${cashPrice.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-blue-200 text-sm">Your Cost</div>
                    <div className="text-xl font-semibold text-green-300">{(actualPointsUsed / 1000).toFixed(0)}k pts + ${taxes}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Transfer Instructions (Blurred until paid) */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-blue-600" />
                Instructions
              </h2>
              <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Ready
                </span>
            </div>

            <div className="relative">
              <div className="p-6 space-y-6">
                {/* New Solo API Transfer Strategy */}
                {hasSoloData && transferStrategy ? (
                  <>
                    {/* Step 1: Transfer Points */}
                    {transferStrategy.transfers.length > 0 && (() => {
                      // Compute total taxes/fees from all points-based bookings
                      const totalTaxes = transferStrategy.bookings
                        .filter(b => b.paymentMethod === 'points')
                        .reduce((sum, b) => sum + Math.max(0, b.surcharge || 0), 0);
                      // Compute total cash out-of-pocket from cash bookings
                      const totalCashOOP = transferStrategy.bookings
                        .filter(b => b.paymentMethod === 'cash')
                        .reduce((sum, b) => sum + Math.max(0, b.cashPrice || 0), 0);
                      return (
                      <div className="space-y-4">
                        {/* Party size indicator */}
                        {trip && ((trip.adults ?? 1) > 1 || (trip.children ?? 0) > 0) && (
                          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
                            <span className="text-indigo-600 font-medium">👥 Booking for:</span>
                            <span className="text-slate-700">
                              {trip.adults ?? 1} {(trip.adults ?? 1) === 1 ? 'adult' : 'adults'}
                              {(trip.children ?? 0) > 0 && (
                                <>, {trip.children} {trip.children === 1 ? 'child' : 'children'}</>
                              )}
                            </span>
                            <span className="text-slate-500">• Point totals below are for entire party</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">Transfer Points</h3>
                            <p className="text-sm text-slate-500">
                              Move <span className="font-semibold text-blue-600">{Math.max(0, transferStrategy.totalPointsToTransfer).toLocaleString()}</span> points
                              {totalTaxes > 0 && <> + <span className="font-semibold text-slate-700">${Math.round(totalTaxes).toLocaleString()}</span> in taxes/fees</>}
                              {totalCashOOP > 0 && <> + <span className="font-semibold text-slate-700">${Math.round(totalCashOOP).toLocaleString()}</span> cash</>}
                              {' '}• Est. {transferStrategy.estimatedTotalTime}
                            </p>
                          </div>
                        </div>
                        
                        <div className="ml-[52px] space-y-3">
                          {transferStrategy.transfers.map((transfer, idx) => {
                            const pointsToTransfer = Math.max(0, transfer.pointsToTransfer || 0);
                            return (
                              <div key={idx} className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
                                <div className="p-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                      <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                                        <CreditCard className="w-6 h-6 text-blue-600" />
                                      </div>
                                      <div>
                                        <div className="text-sm text-slate-500">From</div>
                                        <div className="font-bold text-slate-900">{humanizeProgram(transfer.sourceProgram)}</div>
                                      </div>
                                      <div className="flex items-center gap-2 px-3">
                                        <div className="w-8 h-px bg-slate-300"></div>
                                        <ArrowRight className="w-5 h-5 text-blue-500" />
                                        <div className="w-8 h-px bg-slate-300"></div>
                                      </div>
                                      <div>
                                        <div className="text-sm text-slate-500">To</div>
                                        <div className="font-bold text-slate-900">{humanizeProgram(transfer.targetProgram)}</div>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-2xl font-bold text-blue-600">{pointsToTransfer.toLocaleString()}</div>
                                      <div className="text-xs text-slate-500">points</div>
                                    </div>
                                  </div>
                                  
                                  {/* Transfer details */}
                                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-blue-100">
                                    <div className="flex items-center gap-4 text-sm text-slate-600">
                                      <span>⏱ {transfer.expectedTransferTime}</span>
                                      {transfer.transferRatio && transfer.transferRatio !== 1 && (
                                        <span>📊 {transfer.transferRatio}:1 ratio</span>
                                      )}
                                    </div>
                                    {transfer.portalUrl && (
                                      <a 
                                        href={transfer.portalUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                                      >
                                        Transfer <ExternalLink className="w-4 h-4" />
                                      </a>
                                    )}
                                  </div>
                                  
                                  {transfer.warning && (
                                    <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                                      ⚠️ {transfer.warning}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })()}

                    {/* Step 2: Book Flights/Hotels */}
                    {transferStrategy.bookings.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">
                            {transferStrategy.transfers.length > 0 ? '2' : '1'}
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">Book Your Trip</h3>
                            <p className="text-sm text-slate-500">
                              {transferStrategy.bookings.length} segment{transferStrategy.bookings.length > 1 ? 's' : ''} to book
                            </p>
                          </div>
                        </div>
                        
                        <div className="ml-[52px] space-y-4">
                          {transferStrategy.bookings.map((booking, idx) => {
                            // Ensure no negative values are displayed
                            const pointsUsed = Math.max(0, booking.pointsUsed || 0);
                            const cashPrice = Math.max(0, booking.cashPrice || 0);
                            const surcharge = Math.max(0, booking.surcharge || 0);
                            const durationMins = Math.max(0, booking.durationMinutes || 0);
                            const nights = Math.max(0, booking.nights || 0);
                            
                            return (
                              <div key={idx} className="bg-gradient-to-r from-slate-50 to-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                {/* Header with type badge */}
                                <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Plane className="w-4 h-4 text-blue-600" />
                                      <span className="text-sm font-medium text-blue-700">
                                        Flight
                                      </span>
                                      {booking.segmentReference && (
                                        <span className="text-xs text-blue-500 ml-2">{booking.segmentReference}</span>
                                      )}
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                      booking.paymentMethod === 'points' 
                                        ? 'bg-blue-100 text-blue-700' 
                                        : 'bg-slate-200 text-slate-600'
                                    }`}>
                                      {booking.paymentMethod === 'points' ? '✓ Award Booking' : 'Cash'}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="p-4">
                                  {/* Flight Card */}
                                  {booking.type === 'flight' && (
                                    <div className="space-y-4">
                                      {/* Route with airports - show all stops if connecting flight */}
                                      <div className="flex items-center gap-4">
                                        <div className="flex-1">
                                          {booking.stops && booking.stops > 0 && booking.legs && booking.legs.length > 0 ? (
                                            // Multi-leg connecting flight - show full route
                                            <div className="space-y-1">
                                              <div className="flex items-center gap-2 text-2xl font-bold text-slate-900">
                                                <span>{booking.origin || '---'}</span>
                                                {booking.layovers?.map((layover, layIdx) => (
                                                  <span key={layIdx} className="flex items-center gap-2">
                                                    <ArrowRight className="w-5 h-5 text-slate-400" />
                                                    <span className="text-amber-600">{layover.airport}</span>
                                                  </span>
                                                ))}
                                                <ArrowRight className="w-5 h-5 text-slate-400" />
                                                <span>{booking.destination || '---'}</span>
                                              </div>
                                              <div className="text-sm text-slate-500">
                                                {booking.stops} stop{booking.stops > 1 ? 's' : ''}
                                                {booking.departureTime && (
                                                  <span className="ml-2">
                                                    • Departs {new Date(booking.departureTime).toLocaleString('en-US', { 
                                                      weekday: 'short', month: 'short', day: 'numeric',
                                                      hour: 'numeric', minute: '2-digit'
                                                    })}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          ) : (
                                            // Direct flight - simple display
                                            <div className="flex items-center gap-3">
                                              <div>
                                                <div className="text-2xl font-bold text-slate-900">{booking.origin || '---'}</div>
                                                {booking.departureTime && (
                                                  <div className="text-sm text-slate-500">
                                                    {new Date(booking.departureTime).toLocaleString('en-US', { 
                                                      weekday: 'short', month: 'short', day: 'numeric',
                                                      hour: 'numeric', minute: '2-digit'
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                              <div className="flex-1 flex items-center px-2">
                                                <div className="flex-1 h-1 bg-gradient-to-r from-blue-200 to-blue-400 rounded-full"></div>
                                                <Plane className="w-5 h-5 text-blue-600 mx-2 rotate-90" />
                                                <div className="flex-1 h-1 bg-gradient-to-r from-blue-400 to-blue-200 rounded-full"></div>
                                              </div>
                                              <div className="text-right">
                                                <div className="text-2xl font-bold text-slate-900">{booking.destination || '---'}</div>
                                                {booking.arrivalTime && (
                                                  <div className="text-sm text-slate-500">
                                                    {new Date(booking.arrivalTime).toLocaleString('en-US', { 
                                                      hour: 'numeric', minute: '2-digit'
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          )}
                                          {durationMins > 0 && (
                                            <div className="text-center text-xs text-slate-400 mt-1">
                                              {Math.floor(durationMins / 60)}h {durationMins % 60}m total travel time
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Layover Details for connecting flights */}
                                      {booking.layovers && booking.layovers.length > 0 && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                          <div className="flex items-center gap-2 text-amber-800 font-medium text-sm mb-2">
                                            <Clock className="w-4 h-4" />
                                            Layover{booking.layovers.length > 1 ? 's' : ''}
                                          </div>
                                          <div className="space-y-2">
                                            {booking.layovers.map((layover, layIdx) => {
                                              const layoverMins = layover.durationMinutes || 0;
                                              const hours = Math.floor(layoverMins / 60);
                                              const mins = layoverMins % 60;
                                              const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                                              const isShort = layoverMins < 60;
                                              const isLong = layoverMins > 240;
                                              
                                              return (
                                                <div key={layIdx} className="flex items-center justify-between text-sm">
                                                  <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-amber-900">{layover.airport}</span>
                                                    {layover.airportName && (
                                                      <span className="text-amber-700">({layover.airportName})</span>
                                                    )}
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <span className={`font-bold ${isShort ? 'text-red-600' : isLong ? 'text-amber-600' : 'text-amber-900'}`}>
                                                      {durationStr}
                                                    </span>
                                                    {isShort && (
                                                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                                        Short!
                                                      </span>
                                                    )}
                                                    {isLong && (
                                                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                                        Long layover
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                      
                                      {/* Flight Details */}
                                      <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                          <span className="font-semibold text-slate-900">{booking.airline || 'Airline'}</span>
                                          {booking.flightNumber && (
                                            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs font-mono">
                                              {booking.flightNumber}
                                            </span>
                                          )}
                                          {booking.cabinClass && (
                                            <span className="text-slate-600">• {booking.cabinClass}</span>
                                          )}
                                          {booking.stops && booking.stops > 0 && (
                                            <span className="text-slate-600">• {booking.stops} stop{booking.stops > 1 ? 's' : ''}</span>
                                          )}
                                        </div>
                                        
                                        {/* Per-leg flight numbers for connecting flights */}
                                        {booking.legs && booking.legs.length > 1 && (() => {
                                          // Detect codeshare: legs have different carriers but unified under one booking airline
                                          const legCarriers = booking.legs!.map(l => (l.marketingCarrier || '').toUpperCase().slice(0, 2)).filter(Boolean);
                                          const uniqueLegCarriers = [...new Set(legCarriers)];
                                          const topAirline = (booking.airline || '').toUpperCase().slice(0, 2);
                                          const hasCodeshareLegs = booking.legs!.some(l => l.isCodeshare);
                                          const isDifferentOperators = uniqueLegCarriers.length > 1 || (topAirline && !uniqueLegCarriers.includes(topAirline));
                                          const isCodeshareUnified = (hasCodeshareLegs || isDifferentOperators) && !!topAirline;
                                          
                                          return (
                                            <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-200">
                                              <p className="font-medium">Flight segments:</p>
                                              {booking.legs!.map((leg, legIdx) => (
                                                <div key={legIdx} className="flex items-center gap-2">
                                                  <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">
                                                    {leg.flightNumber}
                                                  </span>
                                                  <span>{leg.origin} → {leg.destination}</span>
                                                  {leg.operatingCarrier && leg.operatingCarrier !== leg.marketingCarrier && (
                                                    <span className="text-purple-600 text-xs">
                                                      (Operated by {leg.operatingCarrier})
                                                    </span>
                                                  )}
                                                </div>
                                              ))}
                                              {/* Codeshare note: clarify that different operators = one reservation */}
                                              {isCodeshareUnified && (
                                                <p className="text-green-700 bg-green-50 px-2 py-1 rounded mt-1">
                                                  One reservation &mdash; booked as a single {booking.airline} ticket
                                                </p>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        
                                        {/* Codeshare info */}
                                        {booking.operatingAirline && (
                                          <div className="text-xs text-slate-500 italic">
                                            Operated by {booking.operatingAirline}
                                          </div>
                                        )}
                                        
                                        {/* Booking Instructions */}
                                        <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-200">
                                          {booking.paymentMethod === 'points' && booking.program ? (
                                            <>
                                              <p><strong>Book with:</strong> {humanizeProgram(booking.program)} miles</p>
                                              <p className="text-slate-500">
                                                Search for {booking.origin} → {booking.destination} on {humanizeProgram(booking.program)}&apos;s award booking page.
                                              </p>
                                            </>
                                          ) : (
                                            <p><strong>Cash booking:</strong> Purchase on {booking.airline || 'the airline'}&apos;s website or a travel booking site.</p>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Payment Summary */}
                                      <div className="flex items-center justify-between pt-2">
                                        <div>
                                          {booking.paymentMethod === 'points' && pointsUsed > 0 ? (
                                            <div>
                                              <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-blue-600">{pointsUsed.toLocaleString()}</span>
                                                <span className="text-blue-600 font-medium">pts</span>
                                              </div>
                                              {(surcharge > 0 || cashPrice > 0) && (
                                                <div className="text-sm text-slate-600">
                                                  + ${Math.max(surcharge, 0).toFixed(0)} taxes/fees
                                                </div>
                                              )}
                                              {booking.program && (
                                                <div className="text-xs text-slate-500 mt-1">
                                                  Book with {humanizeProgram(booking.program)}
                                                </div>
                                              )}
                                              {booking.paymentReason && (
                                                <div className="text-xs text-green-600 mt-1 italic">
                                                  💡 {booking.paymentReason}
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <div>
                                              <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-slate-900">
                                                  ${cashPrice > 0 ? cashPrice.toLocaleString() : '—'}
                                                </span>
                                              </div>
                                              <div className="text-xs text-slate-500">Cash out of pocket</div>
                                              {booking.paymentReason && (
                                                <div className="text-xs text-amber-600 mt-1 italic">
                                                  💡 {booking.paymentReason}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        {booking.bookingUrl && (
                                          <a
                                            href={booking.bookingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                                          >
                                            Book Flight <ExternalLink className="w-4 h-4" />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Hotel Card */}
                                  {booking.type === 'hotel' && (
                                    <div className="space-y-4">
                                      {/* Hotel Info */}
                                      <div>
                                        <div className="text-xl font-bold text-slate-900">{booking.hotelChain || 'Hotel'}</div>
                                        {booking.city && <div className="text-sm text-slate-500">{booking.city}</div>}
                                      </div>
                                      
                                      {/* Stay Details */}
                                      <div className="bg-slate-50 rounded-lg p-3">
                                        <div className="flex items-center gap-4 text-sm">
                                          <div>
                                            <div className="text-xs text-slate-500">Check-in</div>
                                            <div className="font-semibold">
                                              {booking.checkIn 
                                                ? new Date(booking.checkIn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
                                                : 'TBD'}
                                            </div>
                                          </div>
                                          <ArrowRight className="w-4 h-4 text-slate-400" />
                                          <div>
                                            <div className="text-xs text-slate-500">Check-out</div>
                                            <div className="font-semibold">
                                              {booking.checkOut 
                                                ? new Date(booking.checkOut).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
                                                : 'TBD'}
                                            </div>
                                          </div>
                                          {nights > 0 && (
                                            <div className="ml-auto bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium">
                                              {nights} night{nights > 1 ? 's' : ''}
                                            </div>
                                          )}
                                        </div>
                                        
                                        {/* Booking Instructions */}
                                        <div className="text-xs text-slate-600 pt-2 mt-2 border-t border-slate-200">
                                          {booking.paymentMethod === 'points' && booking.program ? (
                                            <>
                                              <p><strong>Book with:</strong> {humanizeProgram(booking.program)} points</p>
                                              <p className="text-slate-500">
                                                Log into your {humanizeProgram(booking.program)} account and search for award nights at this property.
                                              </p>
                                            </>
                                          ) : (
                                            <p><strong>Cash booking:</strong> Book on {booking.hotelChain || 'the hotel'}&apos;s website or a travel booking site.</p>
                                          )}
                                        </div>
                                      </div>
                                      
                                      {/* Payment Summary */}
                                      <div className="flex items-center justify-between pt-2">
                                        <div>
                                          {booking.paymentMethod === 'points' && pointsUsed > 0 ? (
                                            <div>
                                              <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-blue-600">{pointsUsed.toLocaleString()}</span>
                                                <span className="text-blue-600 font-medium">pts</span>
                                              </div>
                                              {surcharge > 0 && (
                                                <div className="text-sm text-slate-600">+ ${surcharge.toFixed(0)} resort fees</div>
                                              )}
                                              {booking.program && (
                                                <div className="text-xs text-slate-500 mt-1">
                                                  Book with {humanizeProgram(booking.program)}
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <div>
                                              <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-slate-900">
                                                  ${cashPrice > 0 ? cashPrice.toLocaleString() : '—'}
                                                </span>
                                              </div>
                                              <div className="text-xs text-slate-500">Cash out of pocket</div>
                                            </div>
                                          )}
                                        </div>
                                        {booking.bookingUrl && (
                                          <a
                                            href={booking.bookingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                                          >
                                            Book Hotel <ExternalLink className="w-4 h-4" />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Warnings */}
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="flex items-center gap-2 text-amber-800 font-medium text-sm mb-2">
                        <Info className="w-4 h-4" />
                        Important Notes
                      </div>
                      <ul className="text-sm text-amber-700 space-y-1">
                        <li>• Verify flight availability on the airline&apos;s website before transferring points</li>
                        {transferStrategy.warnings.map((warning, idx) => (
                          <li key={idx}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : hasSnapshotSegments ? (
                  /* ── Snapshot-based flight details (no transfer strategy loaded) ── */
                  (() => {
                    const snapSegs = (soloSnapshot?.segments || []) as Array<Record<string, unknown>>;
                    const flightSegs = snapSegs.filter(s => {
                      const t = (s.type as string) || '';
                      return t === 'flight' || (!t && t !== 'hotel');
                    });
                    const segs = flightSegs.length > 0 ? flightSegs : snapSegs.filter(s => (s.type as string) !== 'hotel');
                    
                    const g = (seg: Record<string, unknown>, ...keys: string[]): string => {
                      for (const k of keys) { if (seg[k] != null && seg[k] !== '') return String(seg[k]); }
                      return '';
                    };
                    const gn = (seg: Record<string, unknown>, ...keys: string[]): number => {
                      for (const k of keys) { if (seg[k] != null) { const n = Number(seg[k]); if (!isNaN(n)) return n; } }
                      return 0;
                    };
                    const fmtDur = (mins: number) => {
                      if (!mins) return '';
                      const h = Math.floor(mins / 60);
                      const m = mins % 60;
                      return h > 0 ? `${h}h ${m}m` : `${m}m`;
                    };
                    const fmtSnapTime = (isoStr: string) => {
                      if (!isoStr) return '';
                      try {
                        return new Date(isoStr).toLocaleString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit'
                        });
                      } catch { return isoStr; }
                    };
                    
                    const hasPointsSegs = segs.some(s => g(s, 'paymentMethod', 'payment_method') === 'points');
                    
                    return (
                      <>
                        {/* Cash-only notice */}
                        {!hasPointsSegs && (
                          <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl">
                            <div className="flex items-start gap-3">
                              <DollarSign className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <h3 className="font-semibold text-emerald-900 mb-1">Cash Booking</h3>
                                <p className="text-emerald-800 text-sm">
                                  This itinerary is best booked with cash. No points transfers are needed.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Flight segments from snapshot */}
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                            <div>
                              <h3 className="text-lg font-bold text-slate-900">Book Your Flights</h3>
                              <p className="text-sm text-slate-500">{segs.length} flight{segs.length > 1 ? 's' : ''} to book</p>
                            </div>
                          </div>
                          
                          <div className="ml-[52px] space-y-4">
                            {segs.map((seg, idx) => {
                              const origin = g(seg, 'origin', 'originAirport', 'origin_airport');
                              const destination = g(seg, 'destination', 'destinationAirport', 'destination_airport');
                              const airline = g(seg, 'airline', 'airlineName', 'airline_name');
                              const flightNum = g(seg, 'flightNumber', 'flight_number');
                              const departure = g(seg, 'departureTime', 'departure_time');
                              const arrival = g(seg, 'arrivalTime', 'arrival_time');
                              const cabin = g(seg, 'cabinClass', 'cabin_class', 'cabin');
                              const price = gn(seg, 'cashPrice', 'cash_price');
                              const duration = gn(seg, 'durationMinutes', 'duration_minutes');
                              const stops = gn(seg, 'stops', 'numStops', 'num_stops');
                              const rawLegs = (seg.legs || []) as Array<Record<string, unknown>>;
                              const rawLayovers = (seg.layovers || []) as Array<Record<string, unknown>>;
                              const bookingUrl = g(seg, 'bookingUrl', 'booking_url');
                              const operatingAirline = g(seg, 'operatingAirline', 'operating_airline');
                              const paymentMethod = g(seg, 'paymentMethod', 'payment_method');
                              const pointsUsed = gn(seg, 'pointsUsed', 'points_used');
                              const surcharge = gn(seg, 'surcharge');
                              const program = g(seg, 'program');
                              const segLabel = g(seg, 'segment', 'displayName', 'display_name');
                              
                              // Resolve airline code
                              const airlineCode = (
                                (flightNum.match(/^([A-Z]{2})\s?\d/) || [])[1]
                                || g(seg, 'marketingCarrier', 'marketing_carrier', 'airlineCode', 'airline_code')
                                || (airline.length === 2 ? airline.toUpperCase() : '')
                              );
                              const directUrl = airlineCode ? AIRLINE_BOOKING_URLS[airlineCode] : '';
                              const airlineName = airlineCode ? getAirlineName(airlineCode) : airline;
                              
                              return (
                                <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                  {/* Header with flight number, stops, cabin, price */}
                                  <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Plane className="w-4 h-4 text-blue-600" />
                                        <span className="font-semibold text-blue-800">
                                          {flightNum || `Flight ${idx + 1}`}
                                        </span>
                                        {airlineName && (
                                          <span className="text-sm text-slate-600">{airlineName}</span>
                                        )}
                                        {stops > 0 ? (
                                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{stops} stop{stops > 1 ? 's' : ''}</span>
                                        ) : (
                                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Nonstop</span>
                                        )}
                                        {cabin && (
                                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{cabin}</span>
                                        )}
                                      </div>
                                      {paymentMethod === 'points' && pointsUsed > 0 ? (
                                        <span className="text-lg font-bold text-purple-700">{pointsUsed.toLocaleString()} pts</span>
                                      ) : price > 0 ? (
                                        <span className="text-lg font-bold text-slate-900">${price.toLocaleString()}</span>
                                      ) : null}
                                    </div>
                                  </div>
                                  
                                  {/* Route visual + times */}
                                  <div className="p-4 space-y-4">
                                    {origin && destination ? (
                                      <div className="flex items-center justify-between">
                                        <div className="text-center">
                                          <div className="text-2xl font-bold text-slate-900">{origin}</div>
                                          {departure && <div className="text-sm text-slate-500">{fmtSnapTime(departure)}</div>}
                                        </div>
                                        <div className="flex-1 flex items-center px-4">
                                          <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-300 to-blue-500 rounded-full"></div>
                                          <div className="px-3 text-center">
                                            <Plane className="w-5 h-5 text-blue-600 mx-auto rotate-90" />
                                            {duration > 0 && <div className="text-xs text-slate-500 mt-1">{fmtDur(duration)}</div>}
                                          </div>
                                          <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-500 to-blue-300 rounded-full"></div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-2xl font-bold text-slate-900">{destination}</div>
                                          {arrival && <div className="text-sm text-slate-500">{fmtSnapTime(arrival)}</div>}
                                        </div>
                                      </div>
                                    ) : segLabel ? (
                                      <div className="text-lg font-semibold text-slate-900 text-center">{segLabel}</div>
                                    ) : null}
                                    
                                    {/* Info grid */}
                                    {(airlineName || flightNum || duration > 0) && (
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                                        {airlineName && (
                                          <div className="p-3 bg-slate-50 rounded-lg">
                                            <div className="text-xs text-slate-500 mb-1">Airline</div>
                                            <div className="font-semibold text-slate-900">{airlineName}</div>
                                          </div>
                                        )}
                                        {flightNum && (
                                          <div className="p-3 bg-slate-50 rounded-lg">
                                            <div className="text-xs text-slate-500 mb-1">Flight #</div>
                                            <div className="font-semibold text-slate-900">{flightNum}</div>
                                          </div>
                                        )}
                                        {operatingAirline && operatingAirline !== airline && (
                                          <div className="p-3 bg-purple-50 rounded-lg">
                                            <div className="text-xs text-purple-600 mb-1">Operated by</div>
                                            <div className="font-semibold text-purple-800">{operatingAirline}</div>
                                          </div>
                                        )}
                                        <div className="p-3 bg-slate-50 rounded-lg">
                                          <div className="text-xs text-slate-500 mb-1">Stops</div>
                                          <div className="font-semibold text-slate-900">{stops > 0 ? `${stops} stop${stops > 1 ? 's' : ''}` : 'Nonstop'}</div>
                                        </div>
                                        {duration > 0 && (
                                          <div className="p-3 bg-slate-50 rounded-lg">
                                            <div className="text-xs text-slate-500 mb-1">Duration</div>
                                            <div className="font-semibold text-slate-900">{fmtDur(duration)}</div>
                                          </div>
                                        )}
                                        {cabin && (
                                          <div className="p-3 bg-slate-50 rounded-lg">
                                            <div className="text-xs text-slate-500 mb-1">Cabin</div>
                                            <div className="font-semibold text-slate-900">{cabin}</div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    
                                    {/* Per-leg breakdown */}
                                    {rawLegs.length > 1 && (
                                      <div className="pt-3 border-t border-slate-100 space-y-2">
                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Flight Legs</div>
                                        {rawLegs.map((leg, legIdx) => {
                                          const lFN = g(leg, 'flightNumber', 'flight_number');
                                          const lOrig = g(leg, 'origin');
                                          const lDest = g(leg, 'destination');
                                          const lDep = g(leg, 'departureTime', 'departure_time');
                                          const lArr = g(leg, 'arrivalTime', 'arrival_time');
                                          const lMkt = g(leg, 'marketingCarrier', 'marketing_carrier');
                                          const lOp = g(leg, 'operatingCarrier', 'operating_carrier');
                                          return (
                                            <div key={legIdx} className="p-2 bg-slate-50 rounded-lg">
                                              <div className="flex items-center gap-2 text-sm">
                                                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{legIdx + 1}</span>
                                                {lFN && <span className="font-medium text-slate-900">{lFN}</span>}
                                                <span className="text-slate-600">{lOrig} → {lDest}</span>
                                                {lDep && lArr && (
                                                  <span className="text-xs text-slate-500 ml-auto">{fmtSnapTime(lDep)} – {fmtSnapTime(lArr)}</span>
                                                )}
                                              </div>
                                              {lOp && lMkt && lOp !== lMkt && (
                                                <div className="ml-7 text-xs text-slate-400 mt-0.5">Operated by {lOp}</div>
                                              )}
                                              {/* Layover */}
                                              {rawLayovers[legIdx] && (
                                                <div className="ml-7 mt-1 text-xs text-slate-500">
                                                  {fmtDur(gn(rawLayovers[legIdx], 'durationMinutes', 'duration_minutes'))} layover at {g(rawLayovers[legIdx], 'airportName', 'airport_name', 'airport')}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    
                                    {/* Payment details */}
                                    {paymentMethod === 'points' && pointsUsed > 0 ? (
                                      <div className="pt-3 border-t border-slate-100">
                                        <div className="flex items-center gap-2 text-sm">
                                          <Wallet className="w-4 h-4 text-purple-500" />
                                          <span className="text-slate-700">
                                            {pointsUsed.toLocaleString()} points{program && <> via {humanizeProgram(program)}</>}
                                            {surcharge > 0 && <> + ${surcharge.toFixed(0)} taxes/fees</>}
                                          </span>
                                        </div>
                                      </div>
                                    ) : price > 0 ? (
                                      <div className="pt-3 border-t border-slate-100">
                                        <div className="flex items-center gap-2 text-sm">
                                          <DollarSign className="w-4 h-4 text-emerald-500" />
                                          <span className="text-slate-700">
                                            ${price.toLocaleString()} cash out of pocket
                                          </span>
                                        </div>
                                      </div>
                                    ) : null}
                                    
                                    {/* Booking links */}
                                    <div className="pt-3 flex flex-wrap gap-2">
                                      {bookingUrl ? (
                                        <a href={bookingUrl.startsWith('http') ? bookingUrl : `https://${bookingUrl}`} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
                                          <Plane className="w-4 h-4" /> Book Flight <ExternalLink className="w-4 h-4" />
                                        </a>
                                      ) : directUrl ? (
                                        <a href={`https://${directUrl}`} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
                                          <Plane className="w-4 h-4" /> Book on {getAirlineName(airlineCode) || directUrl} <ExternalLink className="w-4 h-4" />
                                        </a>
                                      ) : origin && destination ? (
                                        <a href={`https://www.google.com/travel/flights?q=flights%20from%20${encodeURIComponent(origin)}%20to%20${encodeURIComponent(destination)}${startDate ? `%20on%20${encodeURIComponent(startDate)}` : ''}`} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors">
                                          <Plane className="w-4 h-4" /> Search on Google Flights <ExternalLink className="w-4 h-4" />
                                        </a>
                                      ) : null}
                                      
                                      {directUrl && bookingUrl && !bookingUrl.includes(directUrl) && (
                                        <a href={`https://${directUrl}`} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors">
                                          {getAirlineName(airlineCode)} website <ExternalLink className="w-3 h-3" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          
                          {/* Total Cost */}
                          {soloSnapshot?.oopMetrics && (
                            <div className="ml-[52px] p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-emerald-900">
                                  {hasPointsSegs ? 'Total Out-of-Pocket' : 'Total Estimated Cost'}
                                </span>
                                <span className="text-xl font-bold text-emerald-700">
                                  ${Math.round(soloSnapshot.oopMetrics.totalOutOfPocket || soloSnapshot.oopMetrics.totalCashPrice || cashPrice || 0).toLocaleString()}
                                </span>
                              </div>
                              <p className="text-xs text-emerald-700 mt-1">Book directly with airlines or through travel sites</p>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : hasData ? (
                  <>
                    {/* Legacy Step 1: Transfer Summary - Condensed view of all transfers by card */}
                    {transferSummaries.length > 0 && (
                      <div className="space-y-4">
                        {/* Party size indicator (legacy) */}
                        {trip && ((trip.adults ?? 1) > 1 || (trip.children ?? 0) > 0) && (
                          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
                            <span className="text-indigo-600 font-medium">👥 Booking for:</span>
                            <span className="text-slate-700">
                              {trip.adults ?? 1} {(trip.adults ?? 1) === 1 ? 'adult' : 'adults'}
                              {(trip.children ?? 0) > 0 && (
                                <>, {trip.children} {trip.children === 1 ? 'child' : 'children'}</>
                              )}
                            </span>
                            <span className="text-slate-500">• Point totals below are for entire party</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md">1</div>
                          <div>
                            <h3 className="font-semibold text-slate-900">Transfer Points</h3>
                            <p className="text-xs text-slate-500">Move points from your credit cards to airline programs</p>
                          </div>
                        </div>
                        
                        <div className="ml-11 space-y-3">
                          {transferSummaries.map((transfer, idx) => (
                            <div key={`flight-${idx}`} className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100 shadow-sm">
                              <div className="flex items-center gap-4">
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                  <CreditCard className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-900">{transfer.source}</div>
                                  <div className="flex items-center gap-2 text-sm text-slate-600 mt-0.5">
                                    <ArrowRight className="w-3 h-3" />
                                    <span>{transfer.partner}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-bold text-blue-700">{transfer.totalPoints.toLocaleString()}</div>
                                <div className="text-xs text-slate-500">points to transfer</div>
                                {transfer.totalSurcharge > 0 && (
                                  <div className="text-xs text-slate-500 mt-1">+${Math.round(transfer.totalSurcharge)} fees</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step 2: Flights to Book - Condensed list */}
                    {flightSegments.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
                            {transferSummaries.length > 0 ? '2' : '1'}
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-900">Book Your Flights</h3>
                            <p className="text-xs text-slate-500">Use your transferred points to book these flights</p>
                          </div>
                        </div>
                        
                        <div className="ml-11 space-y-3">
                          {flightSegments.map((segment, idx) => {
                            const isExpanded = expandedFlightIdx === idx;
                            const bookingUrl = segment.marketingCode ? AIRLINE_BOOKING_URLS[segment.marketingCode] : undefined;
                            const dateStr = segment.departureDate || '';
                            const timeStr = segment.departureTime ? formatTime(segment.departureTime) : '';
                            const airlineName = segment.marketingAirlineName || segment.marketingAirline || 'airline';
                            const bookingSummary = segment.flightNumber 
                              ? `Book ${segment.flightNumber} (${segment.orig}→${segment.dest}) on ${dateStr}${timeStr ? ` at ${timeStr}` : ''} via ${airlineName}`
                              : `Book ${segment.orig}→${segment.dest} on ${dateStr}${timeStr ? ` at ${timeStr}` : ''}`;
                            
                            return (
                              <div key={idx} className={`rounded-xl border overflow-hidden shadow-sm transition-all ${isExpanded ? 'bg-white border-blue-200 shadow-md' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                                {/* Clickable header */}
                                <button
                                  onClick={() => setExpandedFlightIdx(isExpanded ? null : idx)}
                                  className="w-full flex items-start gap-4 p-4 text-left hover:bg-slate-50/50 transition-colors"
                                >
                                  <div className={`p-2 rounded-lg ${segment.mode === 'flight' ? 'bg-blue-50' : 'bg-slate-100'}`}>
                                    <SegmentIcon mode={segment.mode} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-lg font-semibold text-slate-900">
                                        {segment.orig} <ArrowRight className="w-4 h-4 inline mx-1 text-slate-400" /> {segment.dest}
                                      </span>
                                      {segment.flightNumber && (
                                        <span className="px-2.5 py-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs font-bold rounded-md shadow-sm">
                                          {segment.flightNumber}
                                        </span>
                                      )}
                                    </div>
                                    {/* Airline name */}
                                    {segment.marketingAirlineName && (
                                      <div className="text-sm text-slate-600 mt-1 font-medium">
                                        {segment.marketingAirlineName}
                                        {segment.isCodeshare && segment.operatingAirlineName && (
                                          <span className="text-purple-600 font-normal"> • Operated by {segment.operatingAirlineName}</span>
                                        )}
                                      </div>
                                    )}
                                    {/* Date and Flight times */}
                                    <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                                      {segment.departureDate && (
                                        <span className="flex items-center gap-1.5 text-slate-700">
                                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                          <span className="font-medium">{segment.departureDate}</span>
                                        </span>
                                      )}
                                      {segment.departureTime && (
                                        <span className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-md text-slate-700">
                                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                                          <span className="font-medium">{formatTime(segment.departureTime)}</span>
                                          {segment.arrivalTime && (
                                            <>
                                              <ArrowRight className="w-3 h-3 text-slate-400" />
                                              <span className="font-medium">{formatTime(segment.arrivalTime)}</span>
                                            </>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                    {/* Tags */}
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                      {segment.isCodeshare && (
                                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                          Codeshare
                                        </span>
                                      )}
                                      {segment.isRedEye && (
                                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full flex items-center gap-1">
                                          <Moon className="w-3 h-3" /> Red-eye
                                        </span>
                                      )}
                                      {segment.isOvernight && (
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                                          Arrives +1 day
                                        </span>
                                      )}
                                      {segment.surcharge !== undefined && segment.surcharge > 0 && (
                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                                          ${Math.round(segment.surcharge)} fees
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className={`p-1 rounded-full transition-colors ${isExpanded ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                    {isExpanded ? (
                                      <ChevronUp className={`w-5 h-5 ${isExpanded ? 'text-blue-600' : 'text-slate-400'}`} />
                                    ) : (
                                      <ChevronDown className="w-5 h-5 text-slate-400" />
                                    )}
                                  </div>
                                </button>
                                
                                {/* Expanded details */}
                                {isExpanded && (
                                  <div className="border-t border-blue-100 bg-gradient-to-b from-blue-50/50 to-white">
                                    {/* Copy-paste booking summary */}
                                    <div className="p-4 border-b border-slate-100">
                                      <button
                                        onClick={() => copyToClipboard(bookingSummary)}
                                        className="w-full p-4 bg-white rounded-xl border-2 border-dashed border-slate-200 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-all group"
                                      >
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Booking Summary</span>
                                          <span className={`flex items-center gap-1.5 text-xs font-medium ${copiedText === bookingSummary ? 'text-green-600' : 'text-blue-600'}`}>
                                            {copiedText === bookingSummary ? (
                                              <><Check className="w-3.5 h-3.5" /> Copied!</>
                                            ) : (
                                              <><Copy className="w-3.5 h-3.5" /> Click to copy</>
                                            )}
                                          </span>
                                        </div>
                                        <p className="text-slate-800 font-medium leading-relaxed">{bookingSummary}</p>
                                      </button>
                                    </div>
                                    
                                    {/* Flight details grid */}
                                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                                      <div className="p-3 bg-white rounded-lg border border-slate-100">
                                        <div className="text-xs text-slate-500 mb-1 font-medium">Route</div>
                                        <div className="font-semibold text-slate-900">{segment.orig} → {segment.dest}</div>
                                      </div>
                                      {segment.flightNumber && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Flight</div>
                                          <div className="font-semibold text-slate-900">{segment.flightNumber}</div>
                                        </div>
                                      )}
                                      {segment.departureDate && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Date</div>
                                          <div className="font-semibold text-slate-900">{segment.departureDate}</div>
                                        </div>
                                      )}
                                      {segment.departureTime && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Departs</div>
                                          <div className="font-semibold text-slate-900">{formatTime(segment.departureTime)}</div>
                                        </div>
                                      )}
                                      {segment.arrivalTime && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Arrives</div>
                                          <div className="font-semibold text-slate-900">
                                            {formatTime(segment.arrivalTime)}
                                            {segment.isOvernight && <span className="text-amber-600 text-xs ml-1">(+1)</span>}
                                          </div>
                                        </div>
                                      )}
                                      {segment.marketingAirlineName && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Airline</div>
                                          <div className="font-semibold text-slate-900">{segment.marketingAirlineName}</div>
                                        </div>
                                      )}
                                      {segment.isCodeshare && segment.operatingAirlineName && (
                                        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                                          <div className="text-xs text-purple-600 mb-1 font-medium">Operated By</div>
                                          <div className="font-semibold text-purple-800">{segment.operatingAirlineName}</div>
                                        </div>
                                      )}
                                      {segment.paymentType === 'points' && segment.miles && (
                                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                          <div className="text-xs text-blue-600 mb-1 font-medium">Points Required</div>
                                          <div className="font-semibold text-blue-800">{segment.miles.toLocaleString()} pts</div>
                                        </div>
                                      )}
                                      {segment.surcharge !== undefined && segment.surcharge > 0 && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Taxes & Fees</div>
                                          <div className="font-semibold text-slate-900">${Math.round(segment.surcharge)}</div>
                                        </div>
                                      )}
                                      {segment.fare && (
                                        <div className="p-3 bg-white rounded-lg border border-slate-100">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Cash Fare</div>
                                          <div className="font-semibold text-slate-900">${Math.round(segment.fare)}</div>
                                        </div>
                                      )}
                                      {segment.marketingAirline && (
                                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 col-span-2 md:col-span-3">
                                          <div className="text-xs text-slate-500 mb-1 font-medium">Loyalty Program</div>
                                          <div className="font-semibold text-slate-700">{segment.marketingAirline}</div>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Special notes */}
                                    {(segment.isRedEye || segment.isOvernight || segment.isCodeshare) && (
                                      <div className="px-4 pb-4">
                                        <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                                          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
                                            <Info className="w-4 h-4" />
                                            Important Notes
                                          </div>
                                          <ul className="text-sm text-amber-700 space-y-1.5">
                                            {segment.isRedEye && (
                                              <li className="flex items-start gap-2">
                                                <Moon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                <span><strong>Red-eye flight</strong> – Departs late night, plan for less sleep</span>
                                              </li>
                                            )}
                                            {segment.isOvernight && (
                                              <li className="flex items-start gap-2">
                                                <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                <span><strong>Overnight flight</strong> – Arrives the next calendar day</span>
                                              </li>
                                            )}
                                            {segment.isCodeshare && (
                                              <li className="flex items-start gap-2">
                                                <Plane className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                <span><strong>Codeshare</strong> – Booked via {segment.marketingAirlineName} but operated by {segment.operatingAirlineName}</span>
                                              </li>
                                            )}
                                          </ul>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Booking link */}
                                    {bookingUrl && (
                                      <div className="p-4 pt-0">
                                        <a
                                          href={`https://${bookingUrl}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-3 w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
                                        >
                                          <Plane className="w-5 h-5" />
                                          Book on {segment.marketingAirlineName || bookingUrl}
                                          <ExternalLink className="w-4 h-4" />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Total Out-of-Pocket Summary */}
                    {taxes > 0 && (
                      <div className="mt-4 p-4 bg-slate-100 rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700">Total Out-of-Pocket</span>
                          <span className="text-lg font-bold text-slate-900">${taxes}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Taxes and fees payable when booking</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    {/* Cash-only booking instructions when no points are being used */}
                    {!hasPointsPayments && cashPrice > 0 ? (
                      <>
                        <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl">
                          <div className="flex items-start gap-3">
                            <DollarSign className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <h3 className="font-semibold text-emerald-900 mb-2">Cash Booking</h3>
                              <p className="text-emerald-800 text-sm">
                                This itinerary is best booked with cash. No points transfers are needed.
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        {/* Flight Details - First check outer flightSegments from payment records */}
                        {flightSegments.length > 0 ? (
                          <div className="space-y-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                              <div>
                                <h3 className="text-lg font-bold text-slate-900">Book Your Flights</h3>
                                <p className="text-sm text-slate-500">{flightSegments.length} flight{flightSegments.length > 1 ? 's' : ''} to book</p>
                              </div>
                            </div>
                            
                            <div className="ml-[52px] space-y-4">
                              {flightSegments.map((seg, idx) => {
                                const origin = seg.orig;
                                const destination = seg.dest;
                                const airline = seg.marketingAirlineName || '';
                                const airlineCode = seg.marketingCode || '';
                                const flightNum = seg.flightNumber || '';
                                const departure = seg.departureTime;
                                const arrival = seg.arrivalTime;
                                const price = seg.fare || 0;
                                const isCodeshare = seg.isCodeshare;
                                const operatingAirline = seg.operatingAirlineName || '';
                                
                                return (
                                  <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                    {/* Header */}
                                    <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <Plane className="w-4 h-4 text-blue-600" />
                                          <span className="font-semibold text-blue-800">Flight {idx + 1}</span>
                                          {isCodeshare && operatingAirline && (
                                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                              Codeshare
                                            </span>
                                          )}
                                        </div>
                                        {price > 0 && <span className="text-lg font-bold text-slate-900">${price.toLocaleString()}</span>}
                                      </div>
                                    </div>
                                    
                                    {/* Flight Details */}
                                    <div className="p-4 space-y-4">
                                      {/* Route Display */}
                                      <div className="flex items-center justify-between">
                                        <div className="text-center">
                                          <div className="text-2xl font-bold text-slate-900">{origin}</div>
                                          {departure && <div className="text-sm text-slate-500">{formatTime(departure)}</div>}
                                        </div>
                                        <div className="flex-1 flex items-center px-4">
                                          <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-300 to-blue-500 rounded-full"></div>
                                          <div className="px-3 text-center">
                                            <Plane className="w-5 h-5 text-blue-600 mx-auto rotate-90" />
                                          </div>
                                          <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-500 to-blue-300 rounded-full"></div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-2xl font-bold text-slate-900">{destination}</div>
                                          {arrival && <div className="text-sm text-slate-500">{formatTime(arrival)}</div>}
                                        </div>
                                      </div>
                                      
                                      {/* Flight Info Grid */}
                                      {(airline || flightNum) && (
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                                          {airline && (
                                            <div className="p-3 bg-slate-50 rounded-lg">
                                              <div className="text-xs text-slate-500 mb-1">Airline</div>
                                              <div className="font-semibold text-slate-900">{airline}</div>
                                            </div>
                                          )}
                                          {flightNum && (
                                            <div className="p-3 bg-slate-50 rounded-lg">
                                              <div className="text-xs text-slate-500 mb-1">Flight</div>
                                              <div className="font-semibold text-slate-900">{airlineCode} {flightNum}</div>
                                            </div>
                                          )}
                                          {isCodeshare && operatingAirline && (
                                            <div className="p-3 bg-amber-50 rounded-lg">
                                              <div className="text-xs text-amber-600 mb-1">Operated by</div>
                                              <div className="font-semibold text-amber-900">{operatingAirline}</div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      
                                      {/* Booking Link */}
                                      <div className="pt-3">
                                        <a
                                          href={`https://www.google.com/travel/flights?q=flights%20from%20${encodeURIComponent(origin)}%20to%20${encodeURIComponent(destination)}${startDate ? `%20on%20${encodeURIComponent(startDate)}` : ''}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                                        >
                                          <Plane className="w-4 h-4" />
                                          Book this flight on Google Flights
                                          <ExternalLink className="w-4 h-4" />
                                        </a>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {/* Total Cost */}
                            <div className="ml-[52px] p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-emerald-900">Total Estimated Cost</span>
                                <span className="text-xl font-bold text-emerald-700">${cashPrice.toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-emerald-700 mt-1">Book directly with airlines or through travel sites</p>
                            </div>
                          </div>
                        ) : (
                        /* Fall back to Flight Details from Snapshot */
                        (() => {
                          // Extract flight segments from snapshot — try multiple paths for robustness
                          const rawSnapshot = selection?.itinerarySnapshot || {};
                          const snapshotSegments = (
                            soloSnapshot?.segments
                            || (rawSnapshot as Record<string, unknown>).segments
                            || []
                          ) as Array<Record<string, unknown>>;
                          
                          // Filter for flight segments (type === 'flight', or untyped non-hotel)
                          const flightSegsTyped = snapshotSegments.filter(s => {
                            const t = (s.type as string) || '';
                            return t === 'flight' || (!t && t !== 'hotel');
                          });
                          // If no flight-typed segments, try all non-hotel segments
                          const flightSegments = flightSegsTyped.length > 0 ? flightSegsTyped : snapshotSegments.filter(s => (s.type as string) !== 'hotel');
                          
                          // Robust accessor helpers for camelCase / snake_case
                          const getField = (seg: Record<string, unknown>, ...keys: string[]): string => {
                            for (const k of keys) { if (seg[k] != null && seg[k] !== '') return String(seg[k]); }
                            return '';
                          };
                          const getNumField = (seg: Record<string, unknown>, ...keys: string[]): number => {
                            for (const k of keys) { if (seg[k] != null) { const n = Number(seg[k]); if (!isNaN(n)) return n; } }
                            return 0;
                          };
                          
                          // Helper to parse origin/destination from segment string like "JFK → LAX"
                          const parseSegmentRoute = (seg: Record<string, unknown>) => {
                            const orig = getField(seg, 'origin', 'originAirport', 'origin_airport');
                            const dest = getField(seg, 'destination', 'destinationAirport', 'destination_airport');
                            if (orig && dest) return { origin: orig, destination: dest };
                            const segStr = getField(seg, 'segment', 'route', 'display_name', 'displayName');
                            const parts = segStr.split(/\s*→\s*/).map(s => s.trim()).filter(Boolean);
                            if (parts.length >= 2) return { origin: parts[0], destination: parts[parts.length - 1] };
                            return { origin: '', destination: '' };
                          };
                          
                          // Local time/duration formatters
                          const fmtTime = (isoStr: string) => {
                            if (!isoStr) return '';
                            try {
                              return new Date(isoStr).toLocaleString('en-US', {
                                weekday: 'short', month: 'short', day: 'numeric',
                                hour: 'numeric', minute: '2-digit'
                              });
                            } catch { return isoStr; }
                          };
                          const fmtDuration = (mins: number) => {
                            if (!mins) return '';
                            const h = Math.floor(mins / 60);
                            const m = mins % 60;
                            return h > 0 ? `${h}h ${m}m` : `${m}m`;
                          };
                          
                          if (flightSegments.length === 0) {
                            // No segments — fall back to route labels
                            const routeForDisplay = routeLabels.length > 0 ? routeLabels : [];
                            const hasRoute = routeForDisplay.length >= 2;
                            const routeSegments: { from: string; to: string }[] = [];
                            for (let i = 0; i < routeForDisplay.length - 1; i++) {
                              routeSegments.push({ from: routeForDisplay[i], to: routeForDisplay[i + 1] });
                            }
                            
                            if (hasRoute) {
                              return (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                                    <div>
                                      <h3 className="text-lg font-bold text-slate-900">Book Your Flights</h3>
                                      <p className="text-sm text-slate-500">{routeSegments.length} flight{routeSegments.length > 1 ? 's' : ''} to book</p>
                                    </div>
                                  </div>
                                  <div className="ml-[52px] space-y-4">
                                    {routeSegments.map((seg, idx) => (
                                      <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                                          <div className="flex items-center gap-2">
                                            <Plane className="w-4 h-4 text-blue-600" />
                                            <span className="font-semibold text-blue-800">Flight {idx + 1}: {seg.from} → {seg.to}</span>
                                          </div>
                                        </div>
                                        <div className="p-4 space-y-4">
                                          <div className="flex items-center justify-between">
                                            <div className="text-center">
                                              <div className="text-2xl font-bold text-slate-900">{seg.from}</div>
                                              {startDate && idx === 0 && <div className="text-sm text-slate-500">{startLabel}</div>}
                                            </div>
                                            <div className="flex-1 flex items-center px-4">
                                              <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-300 to-blue-500 rounded-full"></div>
                                              <div className="px-3"><Plane className="w-5 h-5 text-blue-600 rotate-90" /></div>
                                              <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-500 to-blue-300 rounded-full"></div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-2xl font-bold text-slate-900">{seg.to}</div>
                                              {endDate && idx === routeSegments.length - 1 && <div className="text-sm text-slate-500">{endLabel}</div>}
                                            </div>
                                          </div>
                                          <div className="pt-3">
                                            <a
                                              href={`https://www.google.com/travel/flights?q=flights%20from%20${encodeURIComponent(seg.from)}%20to%20${encodeURIComponent(seg.to)}${startDate && idx === 0 ? `%20on%20${encodeURIComponent(startDate)}` : ''}${endDate && idx === routeSegments.length - 1 ? `%20on%20${encodeURIComponent(endDate)}` : ''}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                                            >
                                              <Plane className="w-4 h-4" />
                                              Search {seg.from} → {seg.to} on Google Flights
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="ml-[52px] p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-emerald-900">Total Estimated Cost</span>
                                      <span className="text-xl font-bold text-emerald-700">${cashPrice.toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-emerald-700 mt-1">Book directly with airlines or through travel sites</p>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Absolute last resort — no segments AND no route labels
                            return (
                              <div className="space-y-4">
                                <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl">
                                  <div className="flex items-start gap-3">
                                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <p className="text-sm text-blue-900 font-medium mb-2">
                                        Detailed flight info not available
                                      </p>
                                      <p className="text-sm text-blue-800 mb-3">
                                        Return to the Results page and re-select your itinerary to see full flight details, or search for flights below.
                                      </p>
                                      {cashPrice > 0 && (
                                        <p className="text-sm font-semibold text-blue-900 mb-3">
                                          Estimated total: ${cashPrice.toLocaleString()}
                                        </p>
                                      )}
                                      <a
                                        href="https://www.google.com/travel/flights"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                                      >
                                        <Plane className="w-4 h-4" />
                                        Search Google Flights
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          
                          // We have snapshot segments — render rich flight cards
                          return (
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                                <div>
                                  <h3 className="text-lg font-bold text-slate-900">Book Your Flights</h3>
                                  <p className="text-sm text-slate-500">{flightSegments.length} flight{flightSegments.length > 1 ? 's' : ''} to book with cash</p>
                                </div>
                              </div>
                              
                              <div className="ml-[52px] space-y-4">
                                {flightSegments.map((seg, idx) => {
                                  const { origin, destination } = parseSegmentRoute(seg);
                                  const airline = getField(seg, 'airline', 'airlineName', 'airline_name', 'operatingAirline', 'operating_airline');
                                  const flightNum = getField(seg, 'flightNumber', 'flight_number');
                                  const departure = getField(seg, 'departureTime', 'departure_time');
                                  const arrival = getField(seg, 'arrivalTime', 'arrival_time');
                                  const cabin = getField(seg, 'cabinClass', 'cabin_class', 'cabin');
                                  const price = getNumField(seg, 'cashPrice', 'cash_price', 'cash_cost');
                                  const duration = getNumField(seg, 'durationMinutes', 'duration_minutes', 'totalDurationMinutes', 'total_duration_minutes');
                                  const stops = getNumField(seg, 'stops', 'numStops', 'num_stops');
                                  const rawLegs = (seg.legs || []) as Array<Record<string, unknown>>;
                                  const bookingUrl = getField(seg, 'bookingUrl', 'booking_url');
                                  const operatingAirline = getField(seg, 'operatingAirline', 'operating_airline');
                                  const segmentLabel = getField(seg, 'segment', 'display_name', 'displayName');
                                  
                                  // Resolve airline code for booking link
                                  const airlineCode = (
                                    (flightNum.match(/^([A-Z]{2})\s?\d/) || [])[1]
                                    || getField(seg, 'marketingCarrier', 'marketing_carrier', 'airlineCode', 'airline_code')
                                    || (airline.length === 2 ? airline.toUpperCase() : '')
                                  );
                                  const directUrl = airlineCode ? AIRLINE_BOOKING_URLS[airlineCode] : '';
                                  const airlineName = airlineCode ? getAirlineName(airlineCode) : airline;
                                  
                                  return (
                                    <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                      {/* Header */}
                                      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <Plane className="w-4 h-4 text-blue-600" />
                                            <span className="font-semibold text-blue-800">
                                              {flightNum ? flightNum : `Flight ${idx + 1}`}
                                            </span>
                                            {airlineName && !flightNum && (
                                              <span className="text-sm text-slate-600">{airlineName}</span>
                                            )}
                                            {stops > 0 ? (
                                              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                                {stops} stop{stops > 1 ? 's' : ''}
                                              </span>
                                            ) : (
                                              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                                Nonstop
                                              </span>
                                            )}
                                            {cabin && (
                                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{cabin}</span>
                                            )}
                                          </div>
                                          {price > 0 && <span className="text-lg font-bold text-slate-900">${price.toLocaleString()}</span>}
                                        </div>
                                      </div>
                                      
                                      {/* Flight Details */}
                                      <div className="p-4 space-y-4">
                                        {/* Route Display */}
                                        {origin && destination ? (
                                          <div className="flex items-center justify-between">
                                            <div className="text-center">
                                              <div className="text-2xl font-bold text-slate-900">{origin}</div>
                                              {departure && <div className="text-sm text-slate-500">{fmtTime(departure)}</div>}
                                            </div>
                                            <div className="flex-1 flex items-center px-4">
                                              <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-300 to-blue-500 rounded-full"></div>
                                              <div className="px-3 text-center">
                                                <Plane className="w-5 h-5 text-blue-600 mx-auto rotate-90" />
                                                {duration > 0 && <div className="text-xs text-slate-500 mt-1">{fmtDuration(duration)}</div>}
                                              </div>
                                              <div className="flex-1 h-1.5 bg-gradient-to-r from-blue-500 to-blue-300 rounded-full"></div>
                                            </div>
                                            <div className="text-center">
                                              <div className="text-2xl font-bold text-slate-900">{destination}</div>
                                              {arrival && <div className="text-sm text-slate-500">{fmtTime(arrival)}</div>}
                                            </div>
                                          </div>
                                        ) : segmentLabel ? (
                                          <div className="text-lg font-semibold text-slate-900 text-center">{segmentLabel}</div>
                                        ) : null}
                                        
                                        {/* Flight Info Grid */}
                                        {(airlineName || flightNum || duration > 0) && (
                                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                                            {airlineName && (
                                              <div className="p-3 bg-slate-50 rounded-lg">
                                                <div className="text-xs text-slate-500 mb-1">Airline</div>
                                                <div className="font-semibold text-slate-900">{airlineName}</div>
                                              </div>
                                            )}
                                            {flightNum && (
                                              <div className="p-3 bg-slate-50 rounded-lg">
                                                <div className="text-xs text-slate-500 mb-1">Flight #</div>
                                                <div className="font-semibold text-slate-900">{flightNum}</div>
                                              </div>
                                            )}
                                            {operatingAirline && operatingAirline !== airline && (
                                              <div className="p-3 bg-purple-50 rounded-lg">
                                                <div className="text-xs text-purple-600 mb-1">Operated by</div>
                                                <div className="font-semibold text-purple-800">{operatingAirline}</div>
                                              </div>
                                            )}
                                            <div className="p-3 bg-slate-50 rounded-lg">
                                              <div className="text-xs text-slate-500 mb-1">Stops</div>
                                              <div className="font-semibold text-slate-900">{stops > 0 ? `${stops} stop${stops > 1 ? 's' : ''}` : 'Nonstop'}</div>
                                            </div>
                                            {duration > 0 && (
                                              <div className="p-3 bg-slate-50 rounded-lg">
                                                <div className="text-xs text-slate-500 mb-1">Duration</div>
                                                <div className="font-semibold text-slate-900">{fmtDuration(duration)}</div>
                                              </div>
                                            )}
                                            {cabin && (
                                              <div className="p-3 bg-slate-50 rounded-lg">
                                                <div className="text-xs text-slate-500 mb-1">Cabin</div>
                                                <div className="font-semibold text-slate-900">{cabin}</div>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                        
                                        {/* Per-leg breakdown for connecting flights */}
                                        {rawLegs.length > 1 && (
                                          <div className="pt-3 border-t border-slate-100 space-y-2">
                                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Flight Legs</div>
                                            {rawLegs.map((leg, legIdx) => {
                                              const legFN = getField(leg, 'flightNumber', 'flight_number');
                                              const legOrig = getField(leg, 'origin');
                                              const legDest = getField(leg, 'destination');
                                              const legDep = getField(leg, 'departureTime', 'departure_time');
                                              const legArr = getField(leg, 'arrivalTime', 'arrival_time');
                                              const legMarketing = getField(leg, 'marketingCarrier', 'marketing_carrier');
                                              const legOperating = getField(leg, 'operatingCarrier', 'operating_carrier');
                                              return (
                                                <div key={legIdx} className="p-2 bg-slate-50 rounded-lg">
                                                  <div className="flex items-center gap-2 text-sm">
                                                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{legIdx + 1}</span>
                                                    {legFN && <span className="font-medium text-slate-900">{legFN}</span>}
                                                    <span className="text-slate-600">{legOrig} → {legDest}</span>
                                                    {legDep && legArr && (
                                                      <span className="text-xs text-slate-500 ml-auto">{fmtTime(legDep)} – {fmtTime(legArr)}</span>
                                                    )}
                                                  </div>
                                                  {legOperating && legMarketing && legOperating !== legMarketing && (
                                                    <div className="ml-7 text-xs text-slate-400 mt-0.5">Operated by {legOperating}</div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        
                                        {/* Booking Links */}
                                        <div className="pt-3 flex flex-wrap gap-2">
                                          {bookingUrl ? (
                                            <a
                                              href={bookingUrl.startsWith('http') ? bookingUrl : `https://${bookingUrl}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                                            >
                                              <Plane className="w-4 h-4" />
                                              Book Flight
                                              <ExternalLink className="w-4 h-4" />
                                            </a>
                                          ) : directUrl ? (
                                            <a
                                              href={`https://${directUrl}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                                            >
                                              <Plane className="w-4 h-4" />
                                              Book on {getAirlineName(airlineCode) || directUrl}
                                              <ExternalLink className="w-4 h-4" />
                                            </a>
                                          ) : origin && destination ? (
                                            <a
                                              href={`https://www.google.com/travel/flights?q=flights%20from%20${encodeURIComponent(origin)}%20to%20${encodeURIComponent(destination)}${startDate ? `%20on%20${encodeURIComponent(startDate)}` : ''}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center justify-center gap-2 flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-colors"
                                            >
                                              <Plane className="w-4 h-4" />
                                              Search on Google Flights
                                              <ExternalLink className="w-4 h-4" />
                                            </a>
                                          ) : null}
                                          
                                          {/* Airline website link (separate from booking) */}
                                          {directUrl && bookingUrl && !bookingUrl.includes(directUrl) && (
                                            <a
                                              href={`https://${directUrl}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors"
                                            >
                                              {getAirlineName(airlineCode)} website
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Total Cost */}
                              <div className="ml-[52px] p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-emerald-900">Total Estimated Cost</span>
                                  <span className="text-xl font-bold text-emerald-700">${cashPrice.toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-emerald-700 mt-1">Book directly with airlines or through travel sites</p>
                              </div>
                            </div>
                          );
                        })())}
                      </>
                    ) : (
                      <>
                        <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl">
                          <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <h3 className="font-semibold text-amber-900 mb-2">Booking Information Unavailable</h3>
                              <p className="text-amber-800 text-sm">
                                We couldn&apos;t load the detailed booking steps. Please return to the Results page and re-select your itinerary.
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <h3 className="font-semibold text-slate-900 mb-2">General guidance</h3>
                          <ul className="text-slate-600 text-sm space-y-1 list-disc list-inside">
                            <li>Search for flights on Google Flights or airline websites</li>
                            <li>If using points, transfer from your credit card programs to airlines</li>
                            <li>Book quickly as prices and availability change frequently</li>
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ================================================ */}
        {/* Next Steps                                       */}
        {/* ================================================ */}
        <div className="mt-8 space-y-6">
          {/* What Happens Next */}
          <NextSteps 
            hasTransfers={
              (transferStrategy?.transfers?.length ?? 0) > 0 ||
              transferSummaries.length > 0
            }
          />

          {/* Risk Assessment */}
          {soloSnapshot?.risk && (
            <RiskBadge risk={soloSnapshot.risk} variant="card" />
          )}

          {/* Email Me This Plan */}
          <button
            onClick={() => setShowEmailModal(true)}
            className="w-full py-3 px-4 border border-slate-200 bg-white hover:bg-slate-50 rounded-2xl text-sm font-medium text-slate-700 transition-colors flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Email me this plan
          </button>

        </div>

        {/* ================================================ */}
        {/* Post-Booking Workflow (Steps 4–9)                */}
        {/* ================================================ */}
        <div className="mt-12">

          {/* STEP 4 — "Did you book this flight?" checkpoint */}
          {postBookingState === 'asking' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Plane className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">Did you book this flight?</h3>
                    <p className="text-sm text-slate-500">Let us know so we can help you next.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleBookingConfirm}
                    className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Yes, I booked it
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5–6 — Reassurance + STEP 7 — Monitoring offer */}
          {postBookingState === 'booked' && (
            <div className="space-y-6">
              {/* Reassurance (Step 6) — always shown before any upsell */}
              <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-green-900 text-lg">Nice work — this was a clean booking.</h3>
                    <p className="text-green-700 mt-1">
                      {flightSegments.length <= 2 ? 'Direct flight, ' : `${flightSegments.length} segments, `}
                      single ticket, low risk.
                    </p>
                  </div>
                </div>
              </div>

              {/* Monitoring offer (Step 7) — free email tier only */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-6">
                  <div className="flex items-start gap-3 mb-5">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Eye className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-lg">Want us to keep watching this trip?</h3>
                      <p className="text-slate-500 mt-1">
                        We&apos;ll monitor prices and schedule changes for this route every 6 hours for up to 14 days, and email you if something meaningful changes.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl">
                      <TrendingDown className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <span className="text-sm text-slate-700">Price drops</span>
                    </div>
                    <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl">
                      <Calendar className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span className="text-sm text-slate-700">Schedule changes</span>
                    </div>
                  </div>

                  <p className="text-slate-600 mb-5 text-sm">
                    Free &middot; We check every 6 hours &middot; Monitoring runs until 24h before departure or 14 days
                  </p>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleStartMonitoring}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
                    >
                      Watch this trip
                    </button>
                    <button
                      onClick={handleMonitoringDecline}
                      className="px-6 py-3 text-slate-500 hover:text-slate-700 font-medium transition-colors"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 8 — Email input (user clicked "Watch this trip") */}
          {postBookingState === 'email_input' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Where should we send alerts?</h3>
                  <p className="text-sm text-slate-500 mt-1">We&apos;ll send a confirmation email to verify it&apos;s you.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="email"
                  value={monitoringEmail}
                  onChange={(e) => { setMonitoringEmail(e.target.value); setMonitoringError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSubmit(); }}
                  placeholder="you@example.com"
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={handleEmailSubmit}
                  disabled={emailSubmitting || !monitoringEmail.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
                >
                  {emailSubmitting ? 'Verifying...' : 'Start watching'}
                </button>
              </div>
              {monitoringError && (
                <p className="mt-2 text-sm text-red-600">{monitoringError}</p>
              )}
            </div>
          )}

          {/* STEP 8b — Email pending verification */}
          {postBookingState === 'email_pending_verification' && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-900">Check your inbox to confirm</h3>
                  <p className="text-amber-700 mt-1">
                    We sent a verification link to <strong>{monitoringEmail}</strong>. Click it to activate monitoring.
                  </p>
                  {monitoringError && (
                    <p className="mt-2 text-sm text-red-600">{monitoringError}</p>
                  )}
                  <button
                    onClick={handleEmailSubmit}
                    disabled={emailSubmitting}
                    className="mt-3 text-sm text-amber-700 hover:text-amber-900 underline underline-offset-2"
                  >
                    {emailSubmitting ? 'Resending...' : 'Resend verification email'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 9 — Monitoring active confirmation */}
          {postBookingState === 'monitoring_active' && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900 text-lg">We&apos;re watching this trip for you.</h3>
                  <p className="text-blue-700 mt-1">
                    We&apos;ll check every 6 hours for price drops and schedule changes, and email you if something meaningful happens.
                  </p>
                  <p className="text-blue-600 text-sm mt-2">Monitoring active until 24h before departure (up to 14 days).</p>
                </div>
              </div>
            </div>
          )}

          {/* postBookingState === 'not_booked' or 'dismissed' renders nothing — banner dismissed */}
        </div>

      </div>
    </div>
  );
}

export default function SoloBooking() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
      <SoloBookingContent />
    </Suspense>
  );
}
