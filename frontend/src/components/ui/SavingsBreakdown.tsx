/**
 * SavingsBreakdown - Visual comparison of all-cash price vs out-of-pocket with points.
 * Shows savings amount and percentage with animated bars.
 */
'use client';

import { useEffect, useState } from 'react';
import { TrendingDown, DollarSign, Sparkles } from 'lucide-react';
import type { SavingsBreakdown as SavingsBreakdownType } from '@/lib/hooks/useItinerary';

interface SavingsBreakdownProps {
  savings: SavingsBreakdownType;
  animate?: boolean;
  className?: string;
}

export function SavingsBreakdown({
  savings,
  animate = true,
  className = '',
}: SavingsBreakdownProps) {
  const [animated, setAnimated] = useState(!animate);
  
  useEffect(() => {
    if (animate) {
      const timer = setTimeout(() => setAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [animate]);
  
  const percentage = Math.round(savings.savingsPercentage * 100);
  const outOfPocketPercent = 100 - percentage;

  return (
    <div className={`bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-200 ${className}`}>
      <h3 className="text-lg font-semibold text-emerald-900 mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5" />
        Your Savings
      </h3>
      
      {/* Visual comparison bars */}
      <div className="space-y-3 mb-6">
        {/* All Cash bar */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-sm text-slate-600">All Cash:</span>
          <div className="flex-1 h-6 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-slate-400 rounded-full transition-all duration-1000"
              style={{ width: '100%' }}
            />
          </div>
          <span className="w-20 text-right font-medium text-slate-700">
            {savings.displayAllCashCost || `$${savings.allCashCost.toLocaleString()}`}
          </span>
        </div>
        
        {/* You Pay bar */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-sm text-slate-600">You Pay:</span>
          <div className="flex-1 h-6 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
              style={{ width: animated ? `${outOfPocketPercent}%` : '0%' }}
            />
          </div>
          <span className="w-20 text-right font-bold text-emerald-700">
            {savings.displayOutOfPocket || `$${savings.outOfPocket.toLocaleString()}`}
          </span>
        </div>
      </div>
      
      {/* Savings callout */}
      <div className="bg-white rounded-xl p-4 flex items-center justify-between shadow-sm">
        <div>
          <div className="text-sm text-slate-600 flex items-center gap-1">
            <TrendingDown className="w-4 h-4 text-emerald-600" />
            You Save
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            {savings.displayCashSaved || `$${savings.cashSaved.toLocaleString()}`}
          </div>
        </div>
        <div className="text-right">
          <div 
            className={`text-4xl font-bold text-emerald-600 transition-all duration-1000 ${
              animated ? 'opacity-100 transform-none' : 'opacity-0 translate-y-2'
            }`}
          >
            {percentage}%
          </div>
          <div className="text-sm text-slate-500">savings</div>
        </div>
      </div>
      
      {/* Achievement badge for high savings */}
      {percentage >= 50 && (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-100 rounded-lg px-3 py-2">
          <Sparkles className="w-4 h-4" />
          <span className="font-medium">Great value!</span>
          <span>You&apos;re saving over half the cash price.</span>
        </div>
      )}
    </div>
  );
}

// Compact version for cards
export function SavingsCompact({
  allCashCost,
  outOfPocket,
  className = '',
}: {
  allCashCost: number;
  outOfPocket: number;
  className?: string;
}) {
  const saved = allCashCost - outOfPocket;
  const percentage = allCashCost > 0 ? Math.round((saved / allCashCost) * 100) : 0;
  
  return (
    <div className={`flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-200 ${className}`}>
      <div className="flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-emerald-600" />
        <span className="text-sm text-emerald-700">
          Save <span className="font-bold">${saved.toLocaleString()}</span>
        </span>
      </div>
      <span className="text-lg font-bold text-emerald-600">{percentage}%</span>
    </div>
  );
}

export default SavingsBreakdown;
