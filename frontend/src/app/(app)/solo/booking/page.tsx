'use client';

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Shield,
  CheckCircle,
  Lock,
  CreditCard,
  ArrowRight,
  Plane,
  Building2,
  Sparkles,
  ChevronRight,
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
} from 'lucide-react';
import { solo, trips as tripsAPI, destinations as destinationsAPI, type SoloTransferStrategyResponse, type SoloTransferInstruction, type SoloBookingStep } from '@/lib/api';
import { calculateServiceFee, SERVICE_FEE_PERCENT, formatDate, tripDurationDays } from '@/lib/utils';

function humanizeProgram(code: string): string {
  const m: Record<string, string> = {
    chase: 'Chase Ultimate Rewards',
    amex: 'Amex Membership Rewards',
    citi: 'Citi ThankYou Rewards',
    capital_one: 'Capital One Miles',
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
  via?: { source?: string; airline?: string; native?: string; hotel?: string };
  miles?: number;
  surcharge?: number;
  mode?: string;
  fare?: number;
  // Flight time fields
  departure_time?: string;
  arrival_time?: string;
  operating_airline?: string;
  // Hotel-specific fields
  segmentType?: 'flight' | 'hotel';
  hotelName?: string;
  hotelCity?: string;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  program?: string;
}

// Hotel program display names
function humanizeHotelProgram(code: string): string {
  const m: Record<string, string> = {
    hyatt: 'World of Hyatt',
    marriott: 'Marriott Bonvoy',
    hilton: 'Hilton Honors',
    ihg: 'IHG One Rewards',
    wyndham: 'Wyndham Rewards',
    choice: 'Choice Privileges',
    accor: 'Accor Live Limitless',
  };
  return m[String(code || '').toLowerCase()] || String(code || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function SoloBookingContent() {
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  const [isPaid, setIsPaid] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [trip, setTrip] = useState<{ startDate?: string; endDate?: string; includeHotels?: boolean; destinations?: string[] } | null>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [destinationMap, setDestinationMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedFlightIdx, setExpandedFlightIdx] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  // New solo booking state
  const [selection, setSelection] = useState<{
    itineraryId?: string;
    itinerarySnapshot?: Record<string, unknown>;
    cashPriceAtSelection?: number;
    outOfPocketAtSelection?: number;
  } | null>(null);
  const [transferStrategy, setTransferStrategy] = useState<SoloTransferStrategyResponse | null>(null);
  const [usingSoloApi, setUsingSoloApi] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!tripId) {
        setLoading(false);
        return;
      }
      try {
        // Try to get selection from new solo API first
        let usedSoloApi = false;
        try {
          const [selectionRes, tripData] = await Promise.all([
            solo.getSelection(tripId).catch(() => null),
            solo.getTrip(tripId).catch(() => null),
          ]);
          
          if (selectionRes?.itineraryId && selectionRes?.itinerarySnapshot) {
            setSelection(selectionRes);
            setTrip(tripData);
            setUsingSoloApi(true);
            usedSoloApi = true;
            
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
                  setSelection(newSelectionRes);
                  setTrip(tripData);
                  setUsingSoloApi(true);
                  usedSoloApi = true;
                  
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

  const handlePayment = async () => {
    setIsProcessing(true);
    
    // Simulate payment processing (actual payment integration will be added later)
    if (tripId) {
      // Try to update backend status, then refresh transfer strategy (best-effort)
      try {
        await solo.updateStatus(tripId, 'instructions_unlocked', {
          paidAt: new Date().toISOString(),
          amount: serviceFee,
          method: 'demo',
        });
      } catch (err) {
        console.warn('Status update failed:', err);
      }

      // Refresh transfer strategy now that backend enforces unlock
      try {
        const itineraryId = selection?.itineraryId || (await solo.getSelection(tripId).catch(() => null))?.itineraryId;
        if (itineraryId) {
          const strategy = await solo.getTransferStrategy(tripId, itineraryId);
          setTransferStrategy(strategy);
        }
      } catch (err) {
        console.warn('Transfer strategy refresh failed:', err);
      }
    }
    
    // Simulate processing delay
    await new Promise((r) => setTimeout(r, 1500));
    setIsProcessing(false);
    setIsPaid(true);
  };

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

  const cashPrice = Number(pathItem?.totalCost ?? itineraryItem?.totalCost ?? totalsItem?.totals?.cash ?? estimatedCash) || estimatedCash;
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

  const includeHotels = trip?.includeHotels !== false;
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
    isHotel: boolean;
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

  type HotelBooking = {
    hotelName?: string;
    hotelCity: string;
    checkIn: string;
    checkOut: string;
    nights?: number;
    pointsUsed?: number;
    program?: string;
  };

  const transferSummaries: TransferSummary[] = [];
  const flightSegments: FlightSegment[] = [];
  const hotelBookings: HotelBooking[] = [];

  // Process payment records to build condensed summaries
  if (paymentRecs.length > 0) {
    const transferMap = new Map<string, TransferSummary>();
    
    paymentRecs.forEach((p) => {
      const isHotel = p.segmentType === 'hotel' || p.hotelName || p.via?.hotel;
      
      if (isHotel) {
        // Process hotel
        if (p.type === 'points' && (p.miles ?? 0) > 0) {
          const sourceCode = (p.via?.source || '').toLowerCase();
          const hotelProgram = (p.via?.hotel || p.program || '').toLowerCase();
          const key = `${sourceCode}→${hotelProgram}→hotel`;
          
          const existing = transferMap.get(key);
          if (existing) {
            existing.totalPoints += Math.round(Number(p.miles) || 0);
            existing.totalSurcharge += Number(p.surcharge) || 0;
          } else {
            transferMap.set(key, {
              source: humanizeProgram(sourceCode),
              sourceCode,
              partner: humanizeHotelProgram(hotelProgram),
              partnerCode: hotelProgram,
              totalPoints: Math.round(Number(p.miles) || 0),
              totalSurcharge: Number(p.surcharge) || 0,
              isHotel: true,
            });
          }
        }
        // Add hotel booking
        hotelBookings.push({
          hotelName: p.hotelName,
          hotelCity: p.hotelCity || primaryDestLabel,
          checkIn: p.checkIn || startLabel,
          checkOut: p.checkOut || (endLabel || startLabel),
          nights: p.nights,
          pointsUsed: p.type === 'points' ? Math.round(Number(p.miles) || 0) : undefined,
          program: p.type === 'points' ? humanizeHotelProgram(p.via?.hotel || p.program || '') : undefined,
        });
      } else {
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
              isHotel: false,
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
      }
    });
    
    transferSummaries.push(...transferMap.values());
  }
  
  // Add fallback hotel booking when includeHotels is true but no hotel payments exist
  if (includeHotels && hotelBookings.length === 0 && (transferSummaries.length > 0 || flightSegments.length > 0)) {
    hotelBookings.push({
      hotelName: undefined,
      hotelCity: primaryDestLabel,
      checkIn: startLabel,
      checkOut: endLabel || startLabel,
      nights: duration > 0 ? duration : undefined,
      pointsUsed: undefined,
      program: undefined,
    });
  }

  // Fallback when no payment data
  const hasData = transferSummaries.length > 0 || flightSegments.length > 0 || hotelBookings.length > 0;
  
  // Check if we have data from the new solo API
  const hasSoloData = usingSoloApi && selection && transferStrategy;
  const soloSnapshot = selection?.itinerarySnapshot as {
    oopMetrics?: { totalCashPrice?: number; totalOutOfPocket?: number; cashSaved?: number; savingsPercentage?: number; totalPointsUsed?: number };
    segments?: Array<{ segment?: string; type?: string; paymentMethod?: string; pointsUsed?: number; surcharge?: number; cashPrice?: number }>;
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
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Secure Your Booking</h1>
          <p className="text-slate-500 mt-2">Complete your payment to unlock step-by-step transfer instructions.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Trip Details & Savings */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Savings Highlight - show from solo API or legacy */}
          {hasSoloData && soloSnapshot?.oopMetrics?.cashSaved && soloSnapshot.oopMetrics.cashSaved > 0 ? (
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
          ) : (
            <div className="bg-gradient-to-br from-slate-600 to-slate-700 rounded-2xl p-8 text-white shadow-xl shadow-slate-900/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-slate-300 mb-1">
                  <CreditCard className="w-5 h-5" />
                  <span className="font-medium">Cash Booking</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl font-bold">${cashPrice.toLocaleString()}</span>
                  <span className="text-slate-300">total cost</span>
                </div>
                <div className="bg-white/10 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-300 text-sm mb-1">No points redemption available for this itinerary</div>
                  <div className="text-sm text-slate-400">This trip will be booked using cash. Points may be unavailable for these routes or you may not have sufficient points balance.</div>
                </div>
              </div>
            </div>
          )}

          {/* Transfer Instructions (Blurred until paid) */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-blue-600" />
                Transfer Instructions
              </h2>
              {isPaid ? (
                <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Unlocked
                </span>
              ) : (
                <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wide rounded-full flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
            </div>

            <div className="relative">
              {!isPaid && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-8">
                  <div className="bg-white p-4 rounded-full shadow-lg mb-4">
                    <Lock className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Pending Payment</h3>
                  <p className="text-slate-600 max-w-sm mb-6">
                    Pay the service fee to reveal the exact transfer partners, flight numbers, and step-by-step booking guide.
                  </p>
                  <button 
                    onClick={() => document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-blue-600 font-semibold hover:text-blue-700 flex items-center gap-1"
                  >
                    Go to Payment <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className={`p-6 space-y-6 ${!isPaid ? 'opacity-20 select-none' : ''}`}>
                {/* New Solo API Transfer Strategy */}
                {hasSoloData && transferStrategy ? (
                  <>
                    {/* Step 1: Transfer Points */}
                    {transferStrategy.transfers.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg">1</div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-900">Transfer Points</h3>
                            <p className="text-sm text-slate-500">
                              Move <span className="font-semibold text-blue-600">{Math.max(0, transferStrategy.totalPointsToTransfer).toLocaleString()}</span> points • Est. {transferStrategy.estimatedTotalTime}
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
                    )}

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
                                      {booking.type === 'flight' ? (
                                        <Plane className="w-4 h-4 text-blue-600" />
                                      ) : (
                                        <Building2 className="w-4 h-4 text-blue-600" />
                                      )}
                                      <span className="text-sm font-medium text-blue-700">
                                        {booking.type === 'flight' ? 'Flight' : 'Hotel'}
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
                                      {/* Route with airports */}
                                      <div className="flex items-center gap-4">
                                        <div className="flex-1">
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
                                              <div className="flex-1 h-px bg-slate-300"></div>
                                              <Plane className="w-5 h-5 text-blue-500 mx-2 rotate-90" />
                                              <div className="flex-1 h-px bg-slate-300"></div>
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
                                          {durationMins > 0 && (
                                            <div className="text-center text-xs text-slate-400 mt-1">
                                              {Math.floor(durationMins / 60)}h {durationMins % 60}m flight
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      
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
                                        </div>
                                        
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
                                            </div>
                                          ) : (
                                            <div>
                                              <div className="flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-slate-900">
                                                  ${cashPrice > 0 ? cashPrice.toLocaleString() : 'TBD'}
                                                </span>
                                              </div>
                                              <div className="text-xs text-slate-500">Cash booking</div>
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
                                                  ${cashPrice > 0 ? cashPrice.toLocaleString() : 'TBD'}
                                                </span>
                                              </div>
                                              <div className="text-xs text-slate-500">Cash booking</div>
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
                    {transferStrategy.warnings.length > 0 && (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                        <div className="flex items-center gap-2 text-amber-800 font-medium text-sm mb-2">
                          <Info className="w-4 h-4" />
                          Important Notes
                        </div>
                        <ul className="text-sm text-amber-700 space-y-1">
                          {transferStrategy.warnings.map((warning, idx) => (
                            <li key={idx}>• {warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : hasData ? (
                  <>
                    {/* Legacy Step 1: Transfer Summary - Condensed view of all transfers by card */}
                    {transferSummaries.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md">1</div>
                          <div>
                            <h3 className="font-semibold text-slate-900">Transfer Points</h3>
                            <p className="text-xs text-slate-500">Move points from your credit cards to airline/hotel programs</p>
                          </div>
                        </div>
                        
                        <div className="ml-11 space-y-3">
                          {transferSummaries.filter(t => !t.isHotel).map((transfer, idx) => (
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
                          
                          {transferSummaries.filter(t => t.isHotel).map((transfer, idx) => (
                            <div key={`hotel-${idx}`} className="flex items-center justify-between p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100 shadow-sm">
                              <div className="flex items-center gap-4">
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                  <Building2 className="w-5 h-5 text-amber-600" />
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
                                <div className="text-xl font-bold text-amber-700">{transfer.totalPoints.toLocaleString()}</div>
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

                    {/* Step 3: Hotels to Book - Condensed list */}
                    {hotelBookings.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center font-bold text-sm shadow-md">
                            {(transferSummaries.length > 0 ? 1 : 0) + (flightSegments.length > 0 ? 1 : 0) + 1}
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-900">Book Your Hotels</h3>
                            <p className="text-xs text-slate-500">Reserve your accommodation at these destinations</p>
                          </div>
                        </div>
                        
                        <div className="ml-11 space-y-3">
                          {hotelBookings.map((hotel, idx) => (
                            <div key={idx} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                              <div className="p-4">
                                <div className="flex items-start gap-4">
                                  <div className="p-2.5 bg-gradient-to-br from-amber-100 to-orange-100 rounded-lg">
                                    <Building2 className="w-5 h-5 text-amber-600" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-lg font-semibold text-slate-900">
                                      {hotel.hotelName || `Hotel in ${hotel.hotelCity}`}
                                    </div>
                                    {hotel.hotelName && hotel.hotelCity && (
                                      <div className="text-sm text-slate-500 mt-0.5">{hotel.hotelCity}</div>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Stay details */}
                                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                                  <div className="p-3 bg-slate-50 rounded-lg">
                                    <div className="text-xs text-slate-500 font-medium mb-1">Check-in</div>
                                    <div className="font-semibold text-slate-900 text-sm">{hotel.checkIn}</div>
                                  </div>
                                  <div className="p-3 bg-slate-50 rounded-lg">
                                    <div className="text-xs text-slate-500 font-medium mb-1">Check-out</div>
                                    <div className="font-semibold text-slate-900 text-sm">{hotel.checkOut}</div>
                                  </div>
                                  {hotel.nights && (
                                    <div className="p-3 bg-slate-50 rounded-lg">
                                      <div className="text-xs text-slate-500 font-medium mb-1">Duration</div>
                                      <div className="font-semibold text-slate-900 text-sm">{hotel.nights} nights</div>
                                    </div>
                                  )}
                                  {hotel.pointsUsed && hotel.program && (
                                    <div className="p-3 bg-amber-50 rounded-lg">
                                      <div className="text-xs text-amber-600 font-medium mb-1">Points</div>
                                      <div className="font-semibold text-amber-800 text-sm">{hotel.pointsUsed.toLocaleString()}</div>
                                    </div>
                                  )}
                                </div>
                                
                                {hotel.program && (
                                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                    Book via <span className="font-medium text-amber-700">{hotel.program}</span>
                                  </div>
                                )}
                              </div>
                              {!hotel.hotelName && (
                                <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-t border-amber-100">
                                  <p className="text-sm text-amber-800">
                                    Search for hotels in <strong>{hotel.hotelCity}</strong> using your preferred hotel program (Marriott Bonvoy, Hilton Honors, World of Hyatt, etc.)
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
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
                    <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-amber-900 mb-2">No detailed flight data available</h3>
                          <p className="text-amber-800 text-sm">
                            We couldn't find specific flight and transfer information. Please return to the Results page to regenerate your itinerary with valid dates and major airports.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl">
                      <h3 className="font-semibold text-slate-900 mb-2">General guidance</h3>
                      <ul className="text-slate-600 text-sm space-y-1 list-disc list-inside">
                        <li>Search for award flights on airline websites</li>
                        <li>Transfer points from Chase, Amex, or Citi to airline partners</li>
                        <li>Book quickly as award seats disappear fast</li>
                        {includeHotels && <li>Book hotels separately using hotel points or cash</li>}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Payment */}
        <div className="lg:col-span-1" id="payment-section">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-lg sticky top-8">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Order Summary</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-slate-600">
                  <span>Itinerary Value</span>
                  <span className={hasPointsPayments && savings > 0 ? "line-through" : ""}>${cashPrice.toLocaleString()}.00</span>
                </div>
                {hasPointsPayments && actualPointsUsed > 0 ? (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Points Cost</span>
                      <span className="font-medium text-slate-900">{actualPointsUsed.toLocaleString()} pts</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Taxes & Fees (Airline)</span>
                      <span className="font-medium text-slate-900">~${taxes}.00</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-slate-600">
                    <span>Payment Method</span>
                    <span className="font-medium text-slate-900">Cash</span>
                  </div>
                )}
                <div className="border-t border-slate-100 my-4 pt-4 flex justify-between items-center">
                  <span className="font-semibold text-slate-900">Tripy Service Fee ({SERVICE_FEE_PERCENT}% of trip value)</span>
                  <span className="text-xl font-bold text-slate-900">${serviceFee.toFixed(2)}</span>
                </div>
              </div>

              {!isPaid ? (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-blue-800 font-semibold text-sm">
                      <Shield className="w-4 h-4" /> Secure Payment
                    </div>
                    <p className="text-xs text-blue-600">
                      We use bank-level encryption to handle your transaction securely.
                    </p>
                  </div>
                  
                  <button
                    onClick={handlePayment}
                    disabled={isProcessing}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <>Processing...</>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" /> Pay & Reveal
                      </>
                    )}
                  </button>
                  <p className="text-xs text-center text-slate-400">
                    By clicking Pay, you agree to our Terms of Service.
                  </p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Payment Successful!</h3>
                  <p className="text-sm text-slate-600">
                    Instructions unlocked. Check your email for a receipt.
                  </p>
                  <button 
                    className="mt-6 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-colors"
                  >
                    Download Receipt
                  </button>
                </div>
              )}
            </div>
          </div>
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
