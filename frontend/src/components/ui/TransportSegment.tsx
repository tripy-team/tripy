/**
 * TransportSegment component - Displays a transport segment (flight, train, bus, car, ferry)
 * with payment details and mode-specific styling.
 */
'use client';

import { Plane, Train, Bus, Car, Ship, DollarSign, CreditCard, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { TransportSegment as TransportSegmentType } from '@/lib/hooks/useItinerary';

// Transport mode configuration
const TRANSPORT_MODES = {
  flight: {
    icon: Plane,
    label: 'Flight',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
    iconBg: 'bg-blue-100',
  },
  train: {
    icon: Train,
    label: 'Train',
    bgColor: 'bg-green-50',
    textColor: 'text-green-700',
    borderColor: 'border-green-200',
    iconBg: 'bg-green-100',
  },
  bus: {
    icon: Bus,
    label: 'Bus',
    bgColor: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200',
    iconBg: 'bg-orange-100',
  },
  car: {
    icon: Car,
    label: 'Car',
    bgColor: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200',
    iconBg: 'bg-purple-100',
  },
  ferry: {
    icon: Ship,
    label: 'Ferry',
    bgColor: 'bg-cyan-50',
    textColor: 'text-cyan-700',
    borderColor: 'border-cyan-200',
    iconBg: 'bg-cyan-100',
  },
} as const;

interface TransportSegmentProps {
  segment: TransportSegmentType;
  showDetails?: boolean;
  compact?: boolean;
  onToggleDetails?: () => void;
}

export function TransportSegmentCard({
  segment,
  showDetails = false,
  compact = false,
  onToggleDetails,
}: TransportSegmentProps) {
  const [expanded, setExpanded] = useState(showDetails);
  
  const mode = TRANSPORT_MODES[segment.mode] || TRANSPORT_MODES.flight;
  const Icon = mode.icon;
  
  const handleToggle = () => {
    setExpanded(!expanded);
    onToggleDetails?.();
  };

  return (
    <div className={`rounded-xl border ${mode.borderColor} ${mode.bgColor} overflow-hidden transition-all`}>
      {/* Header */}
      <div className={`p-4 ${compact ? 'pb-3' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Mode icon */}
            <div className={`p-2 rounded-lg ${mode.iconBg} ${mode.textColor}`}>
              <Icon className="w-5 h-5" />
            </div>
            
            {/* Mode and operator */}
            <div>
              <span className={`font-medium ${mode.textColor}`}>{mode.label}</span>
              {segment.operator && (
                <span className="text-slate-600 ml-2">{segment.operator}</span>
              )}
              {segment.flightNumber && (
                <span className="text-slate-500 text-sm ml-1">({segment.flightNumber})</span>
              )}
            </div>
          </div>
          
          {/* Duration */}
          <div className="flex items-center gap-1 text-slate-500 text-sm">
            <Clock className="w-4 h-4" />
            <span>{segment.displayDuration || formatDuration(segment.durationMinutes)}</span>
          </div>
        </div>

        {/* Route */}
        <div className="flex items-center gap-4">
          <div className="text-center min-w-[60px]">
            <div className="text-lg font-bold text-slate-900">{segment.origin}</div>
            {segment.departureTime && (
              <div className="text-sm text-slate-500">{segment.departureTime}</div>
            )}
          </div>
          
          <div className="flex-1 flex items-center">
            <div className="flex-1 border-t-2 border-dashed border-slate-300" />
            <Icon className={`w-4 h-4 mx-2 ${mode.textColor}`} />
            <div className="flex-1 border-t-2 border-dashed border-slate-300" />
          </div>
          
          <div className="text-center min-w-[60px]">
            <div className="text-lg font-bold text-slate-900">{segment.destination}</div>
            {segment.arrivalTime && (
              <div className="text-sm text-slate-500">{segment.arrivalTime}</div>
            )}
          </div>
        </div>
      </div>

      {/* Payment Info */}
      <div className="px-4 py-3 bg-white/50 border-t border-slate-200/50">
        <div className="flex items-center justify-between">
          {segment.paymentMethod === 'points' ? (
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-purple-100 text-purple-600">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-900">
                  {segment.displayPointsUsed || formatPoints(segment.pointsUsed)} points
                </span>
                {segment.pointsProgram && (
                  <span className="text-sm text-slate-500 ml-1">({segment.pointsProgram})</span>
                )}
                {segment.surcharge && segment.surcharge > 0 && (
                  <span className="text-sm text-slate-600 ml-2">
                    + {segment.displaySurcharge || `$${segment.surcharge}`} fees
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-green-100 text-green-600">
                <DollarSign className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium text-slate-900">
                {segment.displayCashCost || `$${segment.cashCost?.toLocaleString()}`} cash
              </span>
            </div>
          )}
          
          {/* Cash equivalent comparison */}
          {segment.cashEquivalent && segment.cashEquivalent > 0 && (
            <div className="text-sm text-slate-500">
              vs {segment.displayCashEquivalent || `$${segment.cashEquivalent.toLocaleString()}`} all-cash
            </div>
          )}
          
          {/* Expand toggle */}
          {!compact && (
            <button 
              onClick={handleToggle}
              className="p-1 hover:bg-slate-100 rounded transition-colors"
            >
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && !compact && (
        <div className="px-4 py-3 bg-white border-t border-slate-200/50">
          {/* Why this mode? */}
          {segment.mode !== 'flight' && (
            <div className="mb-3 p-2 bg-slate-50 rounded-lg text-sm text-slate-600">
              💡 {getWhyMessage(segment)}
            </div>
          )}
          
          {/* Transfer from bank points */}
          {segment.transferFrom && (
            <div className="text-sm text-slate-600">
              <span className="font-medium">Transfer from:</span> {segment.transferFrom}
              {segment.transferFromCode && (
                <span className="text-slate-400 ml-1">({segment.transferFromCode})</span>
              )}
            </div>
          )}
          
          {/* Value per point */}
          {segment.valuePerPoint && segment.valuePerPoint > 0 && (
            <div className="text-sm text-green-600 mt-1">
              <span className="font-medium">Value achieved:</span> {segment.valuePerPoint.toFixed(2)}¢ per point
            </div>
          )}
          
          {/* Dates */}
          {segment.departureDate && (
            <div className="text-sm text-slate-500 mt-2">
              <span className="font-medium">Date:</span> {segment.departureDate}
              {segment.arrivalDate && segment.arrivalDate !== segment.departureDate && (
                <span> → {segment.arrivalDate}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact version for mobile or lists
export function TransportSegmentCompact({ segment }: { segment: TransportSegmentType }) {
  const mode = TRANSPORT_MODES[segment.mode] || TRANSPORT_MODES.flight;
  const Icon = mode.icon;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${mode.bgColor} border ${mode.borderColor}`}>
      <div className={`p-1.5 rounded ${mode.iconBg} ${mode.textColor}`}>
        <Icon className="w-4 h-4" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-900">{segment.origin}</span>
          <span className="text-slate-400">→</span>
          <span className="font-medium text-slate-900">{segment.destination}</span>
        </div>
        <div className="text-xs text-slate-500">
          {segment.displayDuration || formatDuration(segment.durationMinutes)}
          {segment.paymentMethod === 'points' 
            ? ` • ${segment.displayPointsUsed || formatPoints(segment.pointsUsed)} pts`
            : ` • ${segment.displayCashCost || `$${segment.cashCost}`}`
          }
        </div>
      </div>
    </div>
  );
}

// Helper functions
function formatDuration(minutes?: number): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatPoints(points?: number | null): string {
  if (!points) return '—';
  if (points >= 1000) {
    return `${(points / 1000).toFixed(0)}k`;
  }
  return points.toLocaleString();
}

function getWhyMessage(segment: TransportSegmentType): string {
  switch (segment.mode) {
    case 'train':
      return `Train selected: Often faster city-center to city-center and more comfortable than flying for this distance.`;
    case 'bus':
      return `Bus selected: Budget-friendly option. Takes longer but significantly cheaper.`;
    case 'car':
      return `Car selected: Offers flexibility and can be cost-effective when traveling with others.`;
    case 'ferry':
      return `Ferry selected: The scenic or necessary option for this water crossing.`;
    default:
      return '';
  }
}

export default TransportSegmentCard;
