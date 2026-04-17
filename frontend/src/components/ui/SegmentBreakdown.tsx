'use client';

import { useState } from 'react';
import { 
  Plane, ChevronDown, ChevronUp, 
  DollarSign, Zap, ArrowRight, ExternalLink,
  Clock, AlertCircle, Circle, AlertTriangle
} from 'lucide-react';
import { TripSegment, TransferInstruction, FlightSegment, FlightLeg, FlightLayover } from '@/types/optimization';

interface SegmentBreakdownProps {
  segments: TripSegment[];
  transfers: TransferInstruction[];
}

/**
 * Build display route from legs (e.g., "SEA → AMS → CDG")
 */
function buildRouteDisplay(segment: FlightSegment): string {
  if (segment.legs && segment.legs.length > 0) {
    const airports = [segment.legs[0].origin, ...segment.legs.map(l => l.destination)];
    return airports.join(' → ');
  }
  return `${segment.origin} → ${segment.destination}`;
}

/**
 * Format duration for display
 */
function formatDuration(minutes?: number): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Get connection status badge color
 */
function getConnectionStatusColor(segment: FlightSegment): string {
  if (segment.hasShortConnection) return 'bg-red-100 text-red-700';
  if (segment.hasCarrierChange) return 'bg-amber-100 text-amber-700';
  return 'bg-green-100 text-green-700';
}

export function SegmentBreakdown({ segments, transfers }: SegmentBreakdownProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Cost Breakdown by Segment
      </h3>

      {segments.map((segment) => {
        const isExpanded = expandedId === segment.id;
        const isPoints = segment.payment.method === 'points';
        const flightSegment = segment as FlightSegment;
        const hasConnections = (flightSegment.stops ?? 0) > 0;
        const routeDisplay = buildRouteDisplay(flightSegment);

        return (
          <div 
            key={segment.id}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            {/* Summary Row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : segment.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Plane className="w-5 h-5 text-blue-600" />
                </div>

                <div className="text-left">
                  <div className="font-medium text-slate-900">
                    {routeDisplay}
                  </div>
                  <div className="text-sm text-slate-500 flex items-center gap-2 flex-wrap">
                    <span>{flightSegment.cabinClass} · {flightSegment.airline}</span>
                    {flightSegment.flightNumber && (
                      <span className="text-xs text-slate-600 font-medium">
                        {flightSegment.flightNumber}
                      </span>
                    )}
                    {flightSegment.durationMinutes && flightSegment.durationMinutes > 0 && (
                      <span className="text-xs text-slate-500">
                        {formatDuration(flightSegment.durationMinutes)}
                      </span>
                    )}
                    {hasConnections && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${getConnectionStatusColor(flightSegment)}`}>
                        {flightSegment.stops} stop{flightSegment.stops !== 1 ? 's' : ''}
                      </span>
                    )}
                    {flightSegment.operatingAirline && flightSegment.operatingAirline !== flightSegment.airline && (
                      <span className="text-xs text-purple-600">
                        (Operated by {flightSegment.operatingAirline})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Payment Badge */}
                {isPoints ? (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-blue-600 font-semibold">
                      <Zap className="w-4 h-4" />
                      {((segment.payment as any).pointsUsed / 1000).toFixed(0)}k pts
                    </div>
                    {(segment.payment as any).program && (
                      <div className="text-xs text-blue-500">
                        {(segment.payment as any).program}
                      </div>
                    )}
                    <div className="text-sm text-slate-500">
                      +${(segment.payment as any).surcharge} surcharge
                    </div>
                  </div>
                ) : (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-slate-900 font-semibold">
                      <DollarSign className="w-4 h-4" />
                      ${(segment.payment as any).amount?.toLocaleString()}
                    </div>
                    <div className="text-sm text-slate-500">cash</div>
                  </div>
                )}

                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </div>
            </button>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50">
                
                {/* Connection Details (for multi-leg flights) */}
                {hasConnections && flightSegment.legs && flightSegment.legs.length > 0 && (
                  <div className="mb-4 p-3 bg-white rounded-lg border border-slate-200">
                    <div className="text-sm font-medium text-slate-700 mb-3">
                      Flight Details
                    </div>
                    <div className="space-y-3">
                      {flightSegment.legs.map((leg, idx) => (
                        <div key={idx}>
                          {/* Leg details */}
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <Circle className="w-3 h-3 text-blue-500 fill-blue-500" />
                              {idx < flightSegment.legs.length - 1 && (
                                <div className="w-0.5 h-12 bg-slate-300 my-1" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="font-medium text-slate-900">{leg.origin}</span>
                                  <span className="text-slate-400 mx-2">→</span>
                                  <span className="font-medium text-slate-900">{leg.destination}</span>
                                </div>
                                <span className="text-sm text-slate-600">{leg.flightNumber}</span>
                              </div>
                              <div className="text-sm text-slate-500 mt-0.5">
                                {leg.departureTime && (
                                  <span>{new Date(leg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                )}
                                {leg.durationMinutes && (
                                  <span className="ml-2">({formatDuration(leg.durationMinutes)})</span>
                                )}
                                {leg.isCodeshare && leg.codeshareInfo && (
                                  <span className="ml-2 text-purple-600">{leg.codeshareInfo}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          {/* Layover info (after each leg except the last) */}
                          {idx < flightSegment.legs.length - 1 && flightSegment.layovers?.[idx] && (
                            <div className="ml-6 mt-2 mb-1 p-2 bg-slate-50 rounded text-sm">
                              <div className="flex items-center gap-2">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span className="text-slate-600">
                                  Layover in {flightSegment.layovers[idx].airport}:
                                </span>
                                <span className={`font-medium ${
                                  flightSegment.layovers[idx].isShort 
                                    ? 'text-red-600' 
                                    : flightSegment.layovers[idx].isLong 
                                      ? 'text-amber-600'
                                      : 'text-slate-700'
                                }`}>
                                  {flightSegment.layovers[idx].durationDisplay || formatDuration(flightSegment.layovers[idx].durationMinutes)}
                                </span>
                                {flightSegment.layovers[idx].isShort && (
                                  <span className="text-xs text-red-600 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Short connection
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    
                    {/* Connection warnings */}
                    {(flightSegment.hasShortConnection || flightSegment.hasCarrierChange) && (
                      <div className="mt-3 space-y-2">
                        {flightSegment.hasShortConnection && (
                          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                            <AlertTriangle className="w-4 h-4" />
                            <span>This itinerary has a short connection. Consider a longer layover if possible.</span>
                          </div>
                        )}
                        {flightSegment.hasCarrierChange && (
                          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-2 rounded">
                            <AlertCircle className="w-4 h-4" />
                            <span>Operating carriers differ between flights. Verify bag check-through policy.</span>
                          </div>
                        )}
                        {!flightSegment.ticketingConfirmed && (
                          <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 p-2 rounded">
                            <AlertCircle className="w-4 h-4" />
                            <span>Ticketing not confirmed. Verify this is a single booking, not separate tickets.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Cash vs Points Comparison */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className={`p-3 rounded-lg ${!isPoints ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-white border border-slate-200'}`}>
                    <div className="text-xs text-slate-500 mb-1">Cash Price</div>
                    <div className="text-lg font-semibold text-slate-900">
                      ${flightSegment.cashPrice.toLocaleString()}
                    </div>
                    {!isPoints && (
                      <div className="text-xs text-emerald-600 mt-1">✓ Selected</div>
                    )}
                  </div>

                  {isPoints && (
                    <div className="p-3 rounded-lg bg-blue-50 border-2 border-blue-200">
                      <div className="text-xs text-slate-500 mb-1">Points + Surcharge</div>
                      <div className="text-lg font-semibold text-slate-900">
                        {((segment.payment as any).pointsUsed / 1000).toFixed(0)}k + ${(segment.payment as any).surcharge}
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        ✓ Selected · {(segment.payment as any).cppAchieved?.toFixed(1)}¢/pt
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Explanation */}
                {segment.payment.reason && (
                  <div className="p-3 bg-amber-50 rounded-lg mb-4">
                    <div className="text-sm text-amber-800">
                      <strong>Why this option:</strong> {segment.payment.reason}
                    </div>
                  </div>
                )}

                {/* Transfer Instructions (if points) */}
                {isPoints && (segment.payment as any).transfer && (
                  <TransferCard transfer={(segment.payment as any).transfer} />
                )}
                
                {/* Verification info */}
                {flightSegment.verificationNote && (
                  <div className="p-2 bg-slate-100 rounded text-xs text-slate-600 mb-3">
                    {flightSegment.verificationNote}
                  </div>
                )}

                {/* Booking Links */}
                <div className="flex gap-2">
                  {segment.bookingUrl && (
                    <a
                      href={segment.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      Book This Flight
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  {flightSegment.googleFlightsUrl && (
                    <a
                      href={flightSegment.googleFlightsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 p-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                    >
                      Verify on Google
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransferCard({ transfer }: { transfer: TransferInstruction }) {
  return (
    <div className="p-4 bg-white border border-slate-200 rounded-lg mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-blue-600" />
        <span className="font-medium text-slate-900">Transfer Required</span>
      </div>

      {/* Transfer Flow */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
        <span className="font-medium text-blue-800">{transfer.fromProgram}</span>
        <ArrowRight className="w-4 h-4 text-blue-400" />
        <span className="font-medium text-blue-800">{transfer.toProgram}</span>
        <span className="text-sm text-blue-600 ml-auto">
          {transfer.pointsToTransfer.toLocaleString()} pts ({transfer.ratio}:1)
        </span>
      </div>

      {/* Transfer Time */}
      <div className="flex items-center gap-2 mb-3 text-sm text-slate-600">
        <Clock className="w-4 h-4" />
        Transfer time: {transfer.transferTime}
      </div>

      {/* Steps */}
      {transfer.steps && transfer.steps.length > 0 && (
        <div className="space-y-2 mb-4">
          {transfer.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-slate-700">{step}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warning */}
      {transfer.warning && (
        <div className="flex items-start gap-2 p-2 bg-amber-50 rounded text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {transfer.warning}
        </div>
      )}

      {/* Portal Link */}
      <a
        href={transfer.portalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full p-2 mt-3 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
      >
        Open Transfer Portal
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

export default SegmentBreakdown;
