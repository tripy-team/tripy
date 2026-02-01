'use client';

/**
 * CostBreakdownCard Component
 * 
 * Shows detailed cost breakdown for each itinerary.
 * FIXUP 1 APPLIED: Takes segments + oopMetrics as PROPS. Does NOT call any API.
 */

import { useState } from 'react';
import { Plane, Building2, ArrowRight, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { SegmentBreakdown, OOPMetrics } from '@/lib/hooks/useSoloOptimization';
// Issue #7 FIX: Import getProgramLabel for displaying program IDs
import { getProgramLabel } from '@/lib/programLabels';

interface CostBreakdownCardProps {
  segments: SegmentBreakdown[];  // From itinerary.segments
  oopMetrics: OOPMetrics;        // From itinerary.oopMetrics
}

export function CostBreakdownCard({ segments, oopMetrics }: CostBreakdownCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Summary (always visible) */}
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-slate-500">Cash Price</div>
            <div className="font-semibold text-slate-400 line-through">
              ${oopMetrics.totalCashPrice.toLocaleString()}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-emerald-500" />
          <div>
            <div className="text-xs text-emerald-600">Your Cost</div>
            <div className="font-bold text-emerald-700">
              ${oopMetrics.totalOutOfPocket.toLocaleString()}
            </div>
          </div>
          <div className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
            Save ${oopMetrics.cashSaved.toLocaleString()}
          </div>
        </div>
        {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {/* Detailed Breakdown (expandable) */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Segment Details</div>
          <div className="space-y-2">
            {segments.map((seg, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  {seg.type === 'flight' ? (
                    <Plane className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Building2 className="w-4 h-4 text-amber-600" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">{seg.segment}</div>
                    {seg.transferFrom && seg.transferTo && (
                      <div className="text-xs text-blue-600">
                        {/* Use getProgramLabel() - never display raw IDs */}
                        via {getProgramLabel(seg.transferFrom)} → {getProgramLabel(seg.transferTo)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {seg.paymentMethod === 'points' ? (
                    <div>
                      <div className="font-semibold text-blue-700">{seg.pointsUsed?.toLocaleString()} pts</div>
                      {seg.surcharge && seg.surcharge > 0 && (
                        <div className="text-xs text-slate-500">+${seg.surcharge} fees</div>
                      )}
                      {seg.cppAchieved && (
                        <div className="text-xs text-emerald-600">{seg.cppAchieved.toFixed(2)}¢/pt</div>
                      )}
                    </div>
                  ) : (
                    <div className="font-semibold text-slate-900">${seg.cashPrice.toLocaleString()}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Value Analysis - uses oopMetrics from props */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
              <Info className="w-4 h-4" />
              Value Analysis
            </div>
            <div className="text-sm text-blue-700">
              Average redemption: <strong>{oopMetrics.averageCpp.toFixed(2)}¢ per point</strong>
            </div>
            {/* Find best segment CPP from segments array */}
            {segments.filter(s => s.cppAchieved).length > 0 && (
              <div className="text-xs text-blue-600 mt-1">
                Best value: {
                  segments
                    .filter(s => s.cppAchieved)
                    .reduce((best, s) => s.cppAchieved! > (best?.cppAchieved || 0) ? s : best, segments[0])
                    .segment
                } at {
                  Math.max(...segments.filter(s => s.cppAchieved).map(s => s.cppAchieved!)).toFixed(2)
                }¢/pt
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CostBreakdownCard;
