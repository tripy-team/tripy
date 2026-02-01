'use client';

/**
 * ValueInsightCard Component
 * 
 * Shows users exactly how much they're saving and WHY - builds trust and demonstrates value.
 * P0-4 Fix: Insights show descriptions (percentages, CPP values), NOT invented dollar amounts.
 */

import { Sparkles, TrendingUp, ArrowRight, Gift, Route } from 'lucide-react';
import type { TransferInsight, OOPMetrics } from '@/lib/hooks/useSoloOptimization';

interface ValueInsightCardProps {
  insights: TransferInsight[];
  oopMetrics: OOPMetrics;
}

const insightIcons = {
  transfer_bonus: Gift,
  sweet_spot: Sparkles,
  multi_hop: Route,
  cross_program: ArrowRight,
};

const insightLabels = {
  transfer_bonus: 'Transfer Bonus',
  sweet_spot: 'Sweet Spot Found',
  multi_hop: 'Smart Routing',
  cross_program: 'Cross-Program Value',
};

export function ValueInsightCard({ insights, oopMetrics }: ValueInsightCardProps) {
  const { totalCashPrice, totalOutOfPocket, cashSaved, savingsPercentage } = oopMetrics;

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl overflow-hidden">
      {/* Savings Header - Uses REAL cash comparison (P0-4) */}
      <div className="p-6 border-b border-emerald-200 bg-white/50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-emerald-700 font-medium">Your Savings</div>
            <div className="text-3xl font-bold text-emerald-800">
              ${cashSaved.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">vs. paying cash</div>
            <div className="text-lg text-slate-400 line-through">
              ${totalCashPrice.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
            {savingsPercentage.toFixed(0)}% off
          </div>
          <div className="text-sm text-slate-600">
            You pay <strong className="text-emerald-700">${totalOutOfPocket.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {/* Insights Section - Descriptions only, no fake $ (P0-4) */}
      {insights.length > 0 && (
        <div className="p-6 space-y-4">
          <div className="text-sm font-semibold text-slate-700">How we found this value:</div>
          
          {insights.map((insight, idx) => {
            const Icon = insightIcons[insight.type] || Sparkles;
            const label = insightLabels[insight.type] || 'Value Found';
            
            return (
              <div key={idx} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800">{label}</div>
                  <div className="text-sm text-slate-600">{insight.description}</div>
                  {insight.evidence && (
                    <div className="text-xs text-slate-500 mt-1">
                      Source: {insight.evidence}
                    </div>
                  )}
                </div>
                {insight.confidence && (
                  <div className={`text-xs px-2 py-0.5 rounded ${
                    insight.confidence === 'high' 
                      ? 'bg-green-100 text-green-700' 
                      : insight.confidence === 'medium'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {insight.confidence}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ValueInsightCard;
