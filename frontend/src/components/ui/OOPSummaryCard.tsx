'use client';

import { DollarSign, Zap, TrendingDown, Sparkles, ArrowRightLeft } from 'lucide-react';
import { OOPMetrics, PointsStrategy } from '@/types/optimization';

interface OOPSummaryCardProps {
  metrics: OOPMetrics;
  pointsStrategy?: PointsStrategy | null;
  rank?: number;
  isSelected?: boolean;
  onClick?: () => void;
}

export function OOPSummaryCard({ metrics, pointsStrategy, rank, isSelected, onClick }: OOPSummaryCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        p-6 rounded-2xl border-2 transition-all cursor-pointer
        ${isSelected 
          ? 'border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-lg shadow-emerald-500/10' 
          : 'border-slate-200 bg-white hover:border-emerald-300'
        }
      `}
    >
      {/* Rank Badge */}
      {rank === 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            Lowest Out-of-Pocket
          </span>
        </div>
      )}

      {/* Main OOP Display */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-4xl font-bold text-slate-900">
          ${metrics.totalOutOfPocket.toLocaleString()}
        </span>
        <span className="text-slate-500 text-lg">you pay</span>
      </div>

      {/* Savings Highlight */}
      <div className="flex items-center gap-2 p-3 bg-emerald-100 rounded-xl mb-4">
        <TrendingDown className="w-5 h-5 text-emerald-600" />
        <span className="text-emerald-800 font-medium">
          Save ${metrics.cashSaved.toLocaleString()} ({metrics.savingsPercentage.toFixed(0)}% off)
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <DollarSign className="w-3.5 h-3.5" />
            Cash Price
          </div>
          <div className="text-lg font-semibold text-slate-400 line-through">
            ${metrics.totalCashPrice.toLocaleString()}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <Zap className="w-3.5 h-3.5" />
            Points Used
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {(metrics.totalPointsUsed / 1000).toFixed(0)}k
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            Avg CPP
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {metrics.averageCPP.toFixed(1)}¢
          </div>
        </div>
      </div>

      {/* Points Breakdown */}
      {metrics.pointsBreakdown && typeof metrics.pointsBreakdown === 'object' && Object.keys(metrics.pointsBreakdown).length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-2">Points by program:</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.pointsBreakdown).map(([program, points]) => {
              const programStr = typeof program === 'string' ? program : String(program);
              const pointsNum = typeof points === 'number' ? points : Number(points) || 0;
              return (
                <span 
                  key={programStr}
                  className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium"
                >
                  {programStr}: {(pointsNum / 1000).toFixed(0)}k
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-Currency Breakdown */}
      {metrics.bankCurrenciesUsed && Object.keys(metrics.bankCurrenciesUsed).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-2">Points from your cards:</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.bankCurrenciesUsed).map(([bank, points]) => {
              const bankLabel = bank === 'amex' ? 'Amex MR'
                : bank === 'chase' ? 'Chase UR'
                : bank === 'citi' ? 'Citi TYP'
                : bank === 'capital_one' ? 'Capital One'
                : bank === 'bilt' ? 'Bilt'
                : bank === 'bank_of_america' ? 'BofA'
                : bank === 'wells_fargo' ? 'Wells Fargo'
                : bank === 'discover' ? 'Discover'
                : bank === 'us_bank' ? 'US Bank'
                : typeof bank === 'string' ? bank : String(bank);
              return (
                <span
                  key={bank}
                  className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium"
                >
                  {bankLabel}: {(points / 1000).toFixed(0)}k
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Transfer Summary (from points strategy) */}
      {pointsStrategy && pointsStrategy.programs && pointsStrategy.programs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
            <ArrowRightLeft className="w-3 h-3" />
            Points plan:
          </div>
          <div className="space-y-1">
            {pointsStrategy.programs.map((prog) => {
              const hasTransfers = prog.sources.some((s) => s.is_transfer);
              const transferSources = prog.sources.filter((s) => s.is_transfer);
              const directSource = prog.sources.find((s) => !s.is_transfer);
              return (
                <div key={prog.airline_program} className="text-xs text-slate-700">
                  {hasTransfers && transferSources.map((src, i) => (
                    <div key={i} className="flex items-center gap-1 text-purple-700">
                      <span>Transfer {formatCardPoints(src.points_from_source)} {src.source_program_display}</span>
                      <span className="text-slate-400">&rarr;</span>
                      <span>{prog.airline_program_display}</span>
                    </div>
                  ))}
                  {hasTransfers && directSource && (
                    <div className="text-indigo-700">
                      + {formatCardPoints(directSource.resulting_points)} existing {prog.airline_program_display}
                      <span className="font-semibold"> = {formatCardPoints(prog.total_points_available)} total</span>
                    </div>
                  )}
                  <div className="text-slate-600">
                    {prog.covers_flights.join(', ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCardPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

export default OOPSummaryCard;
