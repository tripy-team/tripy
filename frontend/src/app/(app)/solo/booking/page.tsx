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
  Wallet,
  Car,
  Bus,
  Info,
} from 'lucide-react';
import { itineraries as itinerariesAPI, trips as tripsAPI, destinations as destinationsAPI, generateItinerary } from '@/lib/api';
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
    VS: 'Virgin Atlantic Flying Club',
    AF: 'Air France / KLM Flying Blue',
    BA: 'British Airways',
    KLM: 'KLM Flying Blue',
    UA: 'United MileagePlus',
    AA: 'American AAdvantage',
    DL: 'Delta SkyMiles',
    B6: 'JetBlue TrueBlue',
    WN: 'Southwest Rapid Rewards',
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

  useEffect(() => {
    const fetchData = async () => {
      if (!tripId) {
        setLoading(false);
        return;
      }
      try {
        const [itineraryRes, tripData, destRes] = await Promise.all([
          itinerariesAPI.get(tripId).catch(() => ({ items: [] })),
          tripsAPI.get(tripId).catch(() => null),
          destinationsAPI.list(tripId).catch(() => ({ destinations: [] })),
        ]);
        setTrip(tripData ?? null);
        setItems(Array.isArray(itineraryRes?.items) ? itineraryRes.items : []);
        const map = new Map<string, string>();
        (destRes?.destinations || []).forEach((d: { destinationId?: string; name?: string }) => {
          if (d?.destinationId && d?.name) map.set(d.destinationId, d.name);
        });
        setDestinationMap(map);
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
    if (tripId) {
      generateItinerary(tripId).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 2000));
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
  const savings = cashPrice - (pointsCost / 1000 * 2 + taxes);
  const serviceFee = calculateServiceFee(cashPrice);

  const includeHotels = trip?.includeHotels !== false;
  const startDate = trip?.startDate || '';
  const endDate = trip?.endDate || '';
  const primaryDestLabel = routeLabels[1] || routeLabels[0] || (trip?.destinations && trip.destinations[0]) || 'your destination';
  const startLabel = startDate ? formatDate(startDate) : 'your travel dates';
  const endLabel = endDate ? formatDate(endDate) : '';

  type Step = { kind: 'transfer'; source: string; partner: string; amount: number; surcharge?: number } | { kind: 'segment'; mode: 'flight' | 'bus' | 'car'; orig: string; dest: string; via?: string[]; flightNumber?: string; airline?: string; fare?: number } | { kind: 'hotel_transfer' } | { kind: 'hotel_book'; dest: string; start: string; end: string };
  const steps: Step[] = [];

  if (paymentRecs.length > 0) {
    paymentRecs.forEach((p) => {
      // Add transfer step if this is a points booking
      if (p.type === 'points' && (p.via?.source || p.via?.airline || p.via?.native) && (p.miles ?? 0) > 0) {
        const partner = p.via?.airline ? humanizeAirline(p.via.airline) : p.via?.native ? humanizeAirline(p.via.native) : 'airline partner';
        const source = p.via?.source ? humanizeProgram(p.via.source) : 'your points program';
        steps.push({ 
          kind: 'transfer', 
          source, 
          partner, 
          amount: Math.round(Number(p.miles) || 0),
          surcharge: Number(p.surcharge) || undefined
        });
      }
      // Add segment step with detailed flight info
      const edge = Array.isArray(p.edge) ? p.edge : [];
      const orig = String(edge[0] || '').toUpperCase();
      const dest = String(edge[1] || '').toUpperCase();
      const flightNumber = edge[2] ? String(edge[2]).toUpperCase() : undefined;
      const mode = (p.mode || 'flight') as 'flight' | 'bus' | 'car';
      if (orig && dest) {
        steps.push({ 
          kind: 'segment', 
          mode, 
          orig, 
          dest,
          flightNumber: flightNumber !== 'BUS' && flightNumber !== 'CAR' ? flightNumber : undefined,
          airline: p.type === 'points' 
            ? (p.via?.airline ? humanizeAirline(p.via.airline) : p.via?.native ? humanizeAirline(p.via.native) : undefined)
            : undefined,
          fare: p.type === 'cash' ? Number(p.fare) : undefined
        });
      }
    });
  } else if (routeLabels.length >= 2) {
    // Fallback when no payment data: show generic route
    steps.push({ kind: 'segment', mode: 'flight', orig: routeLabels[0], dest: routeLabels[routeLabels.length - 1], via: routeLabels.slice(1, -1) });
  }

  if (includeHotels) {
    steps.push({ kind: 'hotel_transfer' });
    steps.push({ kind: 'hotel_book', dest: primaryDestLabel, start: startLabel, end: endLabel || startLabel });
  }

  const SegmentIcon = ({ mode }: { mode: 'flight' | 'bus' | 'car' }) => (mode === 'flight' ? <Plane className="w-5 h-5 text-slate-400" /> : mode === 'bus' ? <Bus className="w-5 h-5 text-slate-400" /> : <Car className="w-5 h-5 text-slate-400" />);

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
          
          {/* Savings Highlight */}
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
                  <div className="text-xl font-semibold text-green-300">{(pointsCost / 1000).toFixed(0)}k pts + ${taxes}</div>
                </div>
              </div>
            </div>
          </div>

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

              <div className={`p-8 space-y-8 ${!isPaid ? 'opacity-20 select-none' : ''}`}>
                {steps.length > 0 ? (
                  steps.map((step, idx) => {
                    if (step.kind === 'transfer') {
                      return (
                        <div key={idx} className="flex gap-4">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">{idx + 1}</div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-slate-900 mb-2">Transfer points to {step.partner}</h3>
                            <p className="text-slate-600 mb-4">
                              Log in to your {step.source} account and transfer <span className="font-bold text-slate-900">{step.amount.toLocaleString()} points</span> to {step.partner}. Transfers are usually instant.
                              {step.surcharge && step.surcharge > 0 && (
                                <> You'll also pay <span className="font-bold text-slate-900">${Math.round(step.surcharge)}</span> in taxes and fees when booking.</>
                              )}
                            </p>
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-xs text-slate-500 mb-1">Transfer From</div>
                                  <div className="text-sm font-semibold text-slate-900">{step.source}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-slate-500 mb-1">Transfer To</div>
                                  <div className="text-sm font-semibold text-slate-900">{step.partner}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-slate-500 mb-1">Amount</div>
                                  <div className="text-sm font-semibold text-slate-900">{step.amount.toLocaleString()} points</div>
                                </div>
                                {step.surcharge && step.surcharge > 0 && (
                                  <div>
                                    <div className="text-xs text-slate-500 mb-1">Taxes & Fees</div>
                                    <div className="text-sm font-semibold text-slate-900">${Math.round(step.surcharge)}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (step.kind === 'segment') {
                      const modeLabel = step.mode === 'flight' ? 'flight' : step.mode === 'bus' ? 'bus' : 'car';
                      const via = step.via?.length ? ` (via ${step.via.join(', ')})` : '';
                      const flightInfo = step.flightNumber ? ` ${step.flightNumber}` : '';
                      const airlineInfo = step.airline ? ` on ${step.airline}` : '';
                      const fareInfo = step.fare ? ` (~$${Math.round(step.fare)})` : '';
                      return (
                        <div key={idx} className="flex gap-4">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">{idx + 1}</div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-slate-900 mb-2">
                              Book {modeLabel}{flightInfo} {step.orig} → {step.dest}
                            </h3>
                            <p className="text-slate-600 mb-4">
                              {step.mode === 'flight' ? (
                                <>
                                  {step.airline ? (
                                    <>Book {modeLabel}{flightInfo}{airlineInfo} from {step.orig} to {step.dest}{via}. Use the points you transferred above to complete the award booking.</>
                                  ) : (
                                    <>Search for {modeLabel} rewards from {step.orig} to {step.dest}{via} on {startLabel}. Use the points you transferred to book.</>
                                  )}
                                </>
                              ) : (
                                <>Book {modeLabel} from {step.orig} to {step.dest}{fareInfo}. This connecting segment fills gaps where flights aren't available.</>
                              )}
                            </p>
                            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                              <SegmentIcon mode={step.mode} />
                              <div className="flex-1">
                                <div className="font-semibold text-slate-900">
                                  {step.orig} <ArrowRight className="w-4 h-4 inline mx-1" /> {step.dest}
                                  {step.flightNumber && <span className="ml-2 text-sm font-normal text-slate-600">Flight {step.flightNumber}</span>}
                                </div>
                                {step.airline && (
                                  <div className="text-sm text-slate-600 mt-1">{step.airline}</div>
                                )}
                                {step.fare && (
                                  <div className="text-xs text-slate-500 mt-1">Cash option: ${Math.round(step.fare)}</div>
                                )}
                                <div className="text-xs text-slate-500 mt-1">{startLabel}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (step.kind === 'hotel_transfer') {
                      return (
                        <div key={idx} className="flex gap-4">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">{idx + 1}</div>
                          <div>
                            <h3 className="font-semibold text-slate-900 mb-2">Transfer points for hotel</h3>
                            <p className="text-slate-600 mb-4">
                              Use your preferred hotel program (e.g. Marriott Bonvoy, Hilton Honors, IHG) and transfer points if needed. Transfers typically take 24–48 hours.
                            </p>
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm font-mono text-slate-600">
                              Hotel program • Amount based on your stay
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (step.kind === 'hotel_book') {
                      return (
                        <div key={idx} className="flex gap-4">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">{idx + 1}</div>
                          <div>
                            <h3 className="font-semibold text-slate-900 mb-2">Book hotel at {step.dest}</h3>
                            <p className="text-slate-600 mb-4">
                              Search for hotels in {step.dest} and book with points or cash. Check in on {step.start} and check out on {step.end}.
                            </p>
                            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                              <Building2 className="w-5 h-5 text-slate-400" />
                              <div>
                                <div className="font-semibold text-slate-900">{step.dest}</div>
                                <div className="text-xs text-slate-500">Check-in: {step.start} • Check-out: {step.end}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })
                ) : (
                  <div className="space-y-4">
                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-amber-900 mb-2">No detailed flight data available</h3>
                          <p className="text-amber-800 text-sm mb-4">
                            We couldn't find specific flight and transfer information for your trip. This usually happens when:
                          </p>
                          <ul className="text-amber-800 text-sm space-y-2 list-disc list-inside mb-4">
                            <li>Flight search returned no results (small airports or no award availability)</li>
                            <li>The trip planner used estimated costs instead of real flight data</li>
                            <li>Trip dates or destinations need to be updated</li>
                          </ul>
                          <p className="text-amber-800 text-sm font-semibold">
                            To get specific transfer instructions and flight numbers, please return to the Results page and ensure your trip has valid dates and major airports, then regenerate your itinerary.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold">1</div>
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-2">General booking guidance</h3>
                        <p className="text-slate-600">
                          Based on your itinerary ({routeLabels.length > 0 ? routeLabels.join(' → ') : 'your destinations'}), you should:
                        </p>
                        <ul className="text-slate-600 text-sm space-y-2 mt-3 list-disc list-inside">
                          <li>Search for award flights on airline websites or aggregators</li>
                          <li>Transfer points from flexible credit card programs (Chase, Amex, Citi) to airline partners with good availability</li>
                          <li>Book as soon as you find availability, as award seats can disappear quickly</li>
                          {includeHotels && <li>Book hotels separately using hotel points or cash</li>}
                        </ul>
                      </div>
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
                  <span className="line-through">${cashPrice.toLocaleString()}.00</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Points Cost</span>
                  <span className="font-medium text-slate-900">{pointsCost.toLocaleString()} pts</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Taxes & Fees (Airline)</span>
                  <span className="font-medium text-slate-900">~${taxes}.00</span>
                </div>
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
