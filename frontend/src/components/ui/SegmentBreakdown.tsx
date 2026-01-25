'use client';

import { useState } from 'react';
import { 
  Plane, Hotel, ChevronDown, ChevronUp, 
  DollarSign, Zap, ArrowRight, ExternalLink,
  Clock, AlertCircle
} from 'lucide-react';
import { TripSegment, TransferInstruction, FlightSegment, HotelSegment } from '@/types/optimization';

interface SegmentBreakdownProps {
  segments: TripSegment[];
  transfers: TransferInstruction[];
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
        const isFlight = segment.type === 'flight';
        const isPoints = segment.payment.method === 'points';

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
                {isFlight ? (
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Plane className="w-5 h-5 text-blue-600" />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                    <Hotel className="w-5 h-5 text-amber-600" />
                  </div>
                )}

                <div className="text-left">
                  <div className="font-medium text-slate-900">
                    {isFlight 
                      ? `${(segment as FlightSegment).origin} → ${(segment as FlightSegment).destination}`
                      : (segment as HotelSegment).name
                    }
                  </div>
                  <div className="text-sm text-slate-500">
                    {isFlight 
                      ? `${(segment as FlightSegment).cabinClass} · ${(segment as FlightSegment).airline}`
                      : `${(segment as HotelSegment).nights} nights · ${(segment as HotelSegment).starRating}★`
                    }
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
                {/* Cash vs Points Comparison */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className={`p-3 rounded-lg ${!isPoints ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-white border border-slate-200'}`}>
                    <div className="text-xs text-slate-500 mb-1">Cash Price</div>
                    <div className="text-lg font-semibold text-slate-900">
                      ${(isFlight 
                        ? (segment as FlightSegment).cashPrice 
                        : (segment as HotelSegment).cashPriceTotal
                      ).toLocaleString()}
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

                {/* Booking Link */}
                {segment.bookingUrl && (
                  <a
                    href={segment.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Book This {isFlight ? 'Flight' : 'Hotel'}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
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
