'use client';

/**
 * PointsValueExplainer Component
 * 
 * Explains the CPP (cents-per-point) value achieved for each segment.
 * Issue #10 FIX: Uses segments + oopMetrics from props, no fake $ calculations.
 */

import { Info, TrendingUp, Check, AlertTriangle } from 'lucide-react';
import { getProgramLabel } from '@/lib/programLabels';
import type { SegmentBreakdown, OOPMetrics } from '@/lib/hooks/useSoloOptimization';

interface PointsValueExplainerProps {
  segments: SegmentBreakdown[];
  oopMetrics: OOPMetrics;
}

/**
 * Get color class based on CPP value
 */
function getCppColor(cpp: number): string {
  if (cpp >= 2.0) return 'text-emerald-600';
  if (cpp >= 1.5) return 'text-green-600';
  if (cpp >= 1.0) return 'text-blue-600';
  if (cpp >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

/**
 * Get value rating based on CPP
 */
function getCppRating(cpp: number): { label: string; emoji: string } {
  if (cpp >= 2.0) return { label: 'Excellent', emoji: '🎉' };
  if (cpp >= 1.5) return { label: 'Great', emoji: '✨' };
  if (cpp >= 1.0) return { label: 'Good', emoji: '👍' };
  if (cpp >= 0.5) return { label: 'Fair', emoji: '🤔' };
  return { label: 'Low', emoji: '⚠️' };
}

export function PointsValueExplainer({ segments, oopMetrics }: PointsValueExplainerProps) {
  const pointsSegments = segments.filter(s => s.paymentMethod === 'points' && s.cppAchieved);
  const { averageCpp, totalPointsUsed, cashSaved } = oopMetrics;
  
  // Find best and worst redemptions
  const sortedByValue = [...pointsSegments].sort((a, b) => (b.cppAchieved || 0) - (a.cppAchieved || 0));
  const bestRedemption = sortedByValue[0];
  const worstRedemption = sortedByValue[sortedByValue.length - 1];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header with average CPP */}
      <div className="p-4 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Points Value Analysis</span>
          </div>
          <div className={`text-xl font-bold ${getCppColor(averageCpp)}`}>
            {averageCpp.toFixed(2)}¢/pt avg
          </div>
        </div>
        <div className="mt-2 text-sm text-blue-700">
          {totalPointsUsed.toLocaleString()} points used · ${cashSaved.toLocaleString()} saved
        </div>
      </div>

      {/* Segment breakdown */}
      {pointsSegments.length > 0 && (
        <div className="p-4 space-y-3">
          <div className="text-sm font-medium text-slate-700 flex items-center gap-1">
            <Info className="w-4 h-4" />
            Value by segment:
          </div>
          
          {pointsSegments.map((seg, idx) => {
            const cpp = seg.cppAchieved || 0;
            const rating = getCppRating(cpp);
            
            return (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{seg.segment}</div>
                  <div className="text-xs text-slate-500">
                    {/* Use getProgramLabel() - never display raw IDs */}
                    {seg.pointsUsed?.toLocaleString()} pts via{' '}
                    {seg.transferTo ? getProgramLabel(seg.transferTo) : 'direct'}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${getCppColor(cpp)}`}>
                    {cpp.toFixed(2)}¢/pt
                  </div>
                  <div className="text-xs text-slate-500">
                    {rating.emoji} {rating.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Best/Worst summary */}
      {bestRedemption && worstRedemption && bestRedemption !== worstRedemption && (
        <div className="p-4 border-t border-slate-100 grid grid-cols-2 gap-4">
          <div className="flex items-start gap-2">
            <Check className="w-4 h-4 text-emerald-500 mt-0.5" />
            <div>
              <div className="text-xs text-slate-500">Best value</div>
              <div className="text-sm font-medium text-emerald-700">
                {bestRedemption.segment} ({bestRedemption.cppAchieved?.toFixed(2)}¢/pt)
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
            <div>
              <div className="text-xs text-slate-500">Lowest value</div>
              <div className="text-sm font-medium text-amber-700">
                {worstRedemption.segment} ({worstRedemption.cppAchieved?.toFixed(2)}¢/pt)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PointsValueExplainer;
