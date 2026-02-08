'use client';

/**
 * BookingGuide Component
 * 
 * Step-by-step booking instructions for the selected itinerary.
 * Includes transfer steps and booking steps with actionable URLs.
 * Shows detailed flight info: flight number, departure/arrival times,
 * number of stops, per-leg details, and airline website links.
 */

import { useState } from 'react';
import { 
  Check, 
  Circle, 
  ExternalLink, 
  AlertTriangle, 
  Clock, 
  ArrowRight,
  Plane,
  Building2,
  RefreshCw,
  MapPin,
  Timer,
  CreditCard,
  Wallet
} from 'lucide-react';
import { getProgramLabel } from '@/lib/programLabels';
import type { BookingGuideStep } from '@/lib/hooks/useSoloTransferStrategy';

// Airline website URLs for "Book on airline" links
const AIRLINE_WEBSITES: Record<string, { name: string; url: string }> = {
  UA: { name: 'United Airlines', url: 'https://www.united.com' },
  AA: { name: 'American Airlines', url: 'https://www.aa.com' },
  DL: { name: 'Delta Air Lines', url: 'https://www.delta.com' },
  AS: { name: 'Alaska Airlines', url: 'https://www.alaskaair.com' },
  B6: { name: 'JetBlue', url: 'https://www.jetblue.com' },
  WN: { name: 'Southwest Airlines', url: 'https://www.southwest.com' },
  AF: { name: 'Air France', url: 'https://www.airfrance.com' },
  KL: { name: 'KLM', url: 'https://www.klm.com' },
  BA: { name: 'British Airways', url: 'https://www.britishairways.com' },
  VS: { name: 'Virgin Atlantic', url: 'https://www.virginatlantic.com' },
  NH: { name: 'ANA', url: 'https://www.ana.co.jp/en/us/' },
  JL: { name: 'Japan Airlines', url: 'https://www.jal.co.jp/en/' },
  SQ: { name: 'Singapore Airlines', url: 'https://www.singaporeair.com' },
  CX: { name: 'Cathay Pacific', url: 'https://www.cathaypacific.com' },
  EK: { name: 'Emirates', url: 'https://www.emirates.com' },
  QR: { name: 'Qatar Airways', url: 'https://www.qatarairways.com' },
  TK: { name: 'Turkish Airlines', url: 'https://www.turkishairlines.com' },
  LH: { name: 'Lufthansa', url: 'https://www.lufthansa.com' },
  AC: { name: 'Air Canada', url: 'https://www.aircanada.com' },
  LX: { name: 'Swiss', url: 'https://www.swiss.com' },
  AY: { name: 'Finnair', url: 'https://www.finnair.com' },
  SK: { name: 'SAS', url: 'https://www.flysas.com' },
  IB: { name: 'Iberia', url: 'https://www.iberia.com' },
  QF: { name: 'Qantas', url: 'https://www.qantas.com' },
};

/**
 * Try to resolve an airline code from a flight number or airline name.
 * Returns the 2-letter IATA code or empty string.
 */
function resolveAirlineCode(flightNumber?: string, airline?: string): string {
  // Extract from flight number (e.g. "UA123" → "UA", "DL 2055" → "DL")
  if (flightNumber) {
    const match = flightNumber.match(/^([A-Z]{2})\s?\d/);
    if (match && AIRLINE_WEBSITES[match[1]]) return match[1];
  }
  // Try direct match on airline name as a code
  if (airline) {
    const upper = airline.toUpperCase().trim();
    if (AIRLINE_WEBSITES[upper]) return upper;
    // Try matching by name
    const lower = airline.toLowerCase();
    for (const [code, info] of Object.entries(AIRLINE_WEBSITES)) {
      if (info.name.toLowerCase().includes(lower) || lower.includes(info.name.toLowerCase())) {
        return code;
      }
    }
  }
  return '';
}

/** Format minutes to "Xh Ym" */
function formatDuration(minutes?: number): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

interface BookingGuideProps {
  steps: BookingGuideStep[];
  isPaid: boolean;
  onRefresh?: () => void;
  expiresAt?: string;
}

export function BookingGuide({ steps, isPaid, onRefresh, expiresAt }: BookingGuideProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (stepNumber: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  };

  // Check if results are stale
  const isStale = expiresAt ? new Date(expiresAt) < new Date() : false;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Booking Instructions</h2>
            <p className="text-sm text-slate-500 mt-1">
              Complete these steps in order to book your trip
            </p>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          )}
        </div>
        
        {/* Staleness warning */}
        {isStale && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800">
              <strong>Availability may have changed.</strong> Refresh for the latest prices and availability.
            </div>
          </div>
        )}
        
        {/* Expiry info */}
        {expiresAt && !isStale && (
          <div className="mt-4 text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Valid until {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="divide-y divide-slate-100">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.has(step.stepNumber);
          const isLocked = !isPaid && idx > 0;  // Only show first step if not paid

          return (
            <div 
              key={step.stepNumber}
              className={`p-6 ${isLocked ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start gap-4">
                {/* Step indicator */}
                <button
                  onClick={() => !isLocked && toggleStep(step.stepNumber)}
                  disabled={isLocked}
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    isCompleted 
                      ? 'bg-emerald-500 text-white' 
                      : 'border-2 border-slate-300 text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-sm font-medium">{step.stepNumber}</span>
                  )}
                </button>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {step.action === 'transfer' && (
                      <ArrowRight className="w-4 h-4 text-blue-500" />
                    )}
                    {step.action === 'book_flight' && (
                      <Plane className="w-4 h-4 text-blue-500" />
                    )}
                    {step.action === 'book_hotel' && (
                      <Building2 className="w-4 h-4 text-amber-500" />
                    )}
                    <h3 className={`font-semibold ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {step.title}
                    </h3>
                  </div>
                  
                  <p className="text-sm text-slate-600 mt-1">{step.description}</p>

                  {/* Transfer-specific details */}
                  {step.action === 'transfer' && step.details && !isLocked && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span>{step.details.points?.toLocaleString()} points</span>
                        <ArrowRight className="w-3 h-3" />
                        <span>{step.details.to && getProgramLabel(step.details.to)}</span>
                      </div>
                      {step.details.transferTime && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-blue-600">
                          <Clock className="w-3 h-3" />
                          {step.details.transferTime}
                        </div>
                      )}
                      {step.details.warning && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          {step.details.warning}
                        </div>
                      )}
                      {step.details.portalUrl && (
                        <a
                          href={step.details.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                        >
                          Open Transfer Portal
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Flight booking details — rich card */}
                  {step.action === 'book_flight' && step.details && !isLocked && (
                    <div className="mt-3 space-y-3">
                      {/* Flight info card */}
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        {/* Flight number + route header */}
                        <div className="flex items-center gap-2 mb-3">
                          <Plane className="w-4 h-4 text-blue-600" />
                          <span className="font-bold text-slate-900 text-sm">
                            {step.details.flightNumber || step.details.airline || 'Flight'}
                          </span>
                          {step.details.origin && step.details.destination && (
                            <span className="text-sm text-slate-600">
                              {step.details.origin} → {step.details.destination}
                            </span>
                          )}
                          {step.details.cabinClass && (
                            <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {step.details.cabinClass}
                            </span>
                          )}
                        </div>

                        {/* Departure / Arrival / Duration / Stops */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          {step.details.departureTime && (
                            <div>
                              <div className="text-xs text-blue-600 font-medium">Departure</div>
                              <div className="font-semibold text-slate-900">{step.details.departureTime}</div>
                              {step.details.origin && (
                                <div className="text-xs text-slate-500">{step.details.origin}</div>
                              )}
                            </div>
                          )}
                          {step.details.arrivalTime && (
                            <div>
                              <div className="text-xs text-blue-600 font-medium">Arrival</div>
                              <div className="font-semibold text-slate-900">{step.details.arrivalTime}</div>
                              {step.details.destination && (
                                <div className="text-xs text-slate-500">{step.details.destination}</div>
                              )}
                            </div>
                          )}
                          {step.details.durationMinutes != null && step.details.durationMinutes > 0 && (
                            <div>
                              <div className="text-xs text-blue-600 font-medium">Duration</div>
                              <div className="font-semibold text-slate-900 flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                {formatDuration(step.details.durationMinutes)}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="text-xs text-blue-600 font-medium">Stops</div>
                            <div className="font-semibold text-slate-900">
                              {step.details.stops != null && step.details.stops > 0
                                ? `${step.details.stops} stop${step.details.stops > 1 ? 's' : ''}`
                                : 'Nonstop'}
                            </div>
                          </div>
                        </div>

                        {/* Operating airline (codeshare) */}
                        {step.details.operatingAirline && (
                          <div className="mt-2 text-xs text-slate-500">
                            Operated by {step.details.operatingAirline}
                          </div>
                        )}

                        {/* Per-leg breakdown for connecting flights */}
                        {step.details.legs && step.details.legs.length > 1 && (
                          <div className="mt-3 pt-3 border-t border-blue-200 space-y-2">
                            <div className="text-xs font-bold text-blue-600 uppercase tracking-wider">
                              Flight Legs
                            </div>
                            {step.details.legs.map((leg, legIdx) => (
                              <div key={legIdx}>
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                    {legIdx + 1}
                                  </span>
                                  <span className="font-medium text-slate-900">
                                    {leg.flightNumber}
                                  </span>
                                  <span className="text-slate-600">
                                    {leg.origin} → {leg.destination}
                                  </span>
                                  {leg.departureTime && leg.arrivalTime && (
                                    <span className="text-xs text-slate-500 ml-auto">
                                      {leg.departureTime} – {leg.arrivalTime}
                                    </span>
                                  )}
                                </div>
                                {leg.operatingCarrier && leg.operatingCarrier !== leg.marketingCarrier && (
                                  <div className="ml-7 text-xs text-slate-400">
                                    Operated by {leg.operatingCarrier}
                                  </div>
                                )}
                                {/* Layover after this leg (if not the last leg) */}
                                {step.details.layovers && legIdx < step.details.layovers.length && (
                                  <div className="ml-7 mt-1 flex items-center gap-1 text-xs">
                                    <MapPin className="w-3 h-3 text-amber-500" />
                                    <span className={`${
                                      step.details.layovers[legIdx].isShort
                                        ? 'text-red-600 font-medium'
                                        : step.details.layovers[legIdx].isLong
                                          ? 'text-amber-600'
                                          : 'text-slate-500'
                                    }`}>
                                      {formatDuration(step.details.layovers[legIdx].durationMinutes)} layover at{' '}
                                      {step.details.layovers[legIdx].airportName || step.details.layovers[legIdx].airport}
                                      {step.details.layovers[legIdx].isShort && ' ⚠️ Tight connection'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Payment details */}
                        {step.details.paymentMethod && (
                          <div className="mt-3 pt-3 border-t border-blue-200">
                            {step.details.paymentMethod === 'points' ? (
                              <div className="flex items-center gap-2 text-sm">
                                <Wallet className="w-4 h-4 text-purple-500" />
                                <span className="text-slate-700">
                                  {step.details.pointsUsed?.toLocaleString()} points
                                  {step.details.program && (
                                    <> via {getProgramLabel(step.details.program)}</>
                                  )}
                                  {step.details.surcharge != null && step.details.surcharge > 0 && (
                                    <> + ${step.details.surcharge.toFixed(0)} taxes/fees</>
                                  )}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm">
                                <CreditCard className="w-4 h-4 text-slate-500" />
                                <span className="text-slate-700">
                                  {step.details.cashPrice != null && step.details.cashPrice > 0
                                    ? `$${step.details.cashPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} cash`
                                    : 'Cash booking'}
                                </span>
                              </div>
                            )}
                            {step.details.paymentReason && (
                              <div className="text-xs text-slate-500 mt-1 ml-6">
                                {step.details.paymentReason}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Airline website link + Book button */}
                      <div className="flex flex-wrap gap-2">
                        {step.details.bookingUrl && (
                          <a
                            href={step.details.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                          >
                            <Plane className="w-4 h-4" />
                            Book Flight
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {(() => {
                          const code = resolveAirlineCode(step.details.flightNumber, step.details.airline);
                          const airlineInfo = code ? AIRLINE_WEBSITES[code] : null;
                          if (!airlineInfo) return null;
                          // Don't show duplicate link if bookingUrl is already the airline site
                          if (step.details.bookingUrl?.includes(airlineInfo.url.replace('https://www.', ''))) return null;
                          return (
                            <a
                              href={airlineInfo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
                            >
                              {airlineInfo.name} website
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          );
                        })()}
                      </div>

                      {/* Award availability warning */}
                      {step.details.paymentMethod === 'points' && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                          <AlertTriangle className="w-3 h-3 inline mr-1" />
                          Award availability changes quickly. If this exact flight isn&apos;t available,
                          search for similar times—the points cost should be similar.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hotel booking details */}
                  {step.action === 'book_hotel' && step.details && !isLocked && (
                    <div className="mt-3">
                      {step.details.bookingUrl && (
                        <a
                          href={step.details.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700"
                        >
                          Book Hotel
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Locked state */}
                  {isLocked && (
                    <div className="mt-3 p-3 bg-slate-100 rounded-lg text-sm text-slate-500">
                      🔒 Unlock full instructions to see this step
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {steps.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          <Circle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>No booking instructions available yet.</p>
          <p className="text-sm mt-1">Select an itinerary to see booking steps.</p>
        </div>
      )}
    </div>
  );
}

export default BookingGuide;
