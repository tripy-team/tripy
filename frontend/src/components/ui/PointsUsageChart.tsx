/**
 * PointsUsageChart - Visual breakdown of points used by program.
 * Shows usage bars and remaining balance for each program.
 */
'use client';

import { CreditCard, Plane, Building2 } from 'lucide-react';
import type { PointsUsageBreakdown, ProgramUsage } from '@/lib/hooks/useItinerary';

interface PointsUsageChartProps {
  usage: PointsUsageBreakdown;
  className?: string;
}

// Category icons and colors
const CATEGORY_CONFIG = {
  bank: {
    icon: CreditCard,
    color: 'bg-purple-500',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
  },
  airline: {
    icon: Plane,
    color: 'bg-blue-500',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
  },
  hotel: {
    icon: Building2,
    color: 'bg-amber-500',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
  },
} as const;

export function PointsUsageChart({ usage, className = '' }: PointsUsageChartProps) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-6 ${className}`}>
      <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-purple-600" />
        Points Used
      </h3>
      
      <div className="space-y-4">
        {usage.byProgram.map((program) => (
          <ProgramUsageBar key={program.programCode} program={program} />
        ))}
      </div>
      
      {/* Summary */}
      <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-slate-500">Bank Points Used</div>
          <div className="font-semibold text-purple-700">
            {formatPoints(usage.totalBankPointsUsed)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Airline Miles Used</div>
          <div className="font-semibold text-blue-700">
            {formatPoints(usage.totalAirlineMilesUsed)}
          </div>
        </div>
      </div>
      
      {/* Remaining points */}
      {usage.remainingPoints && usage.remainingPoints.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="text-sm text-slate-500 mb-2">Remaining Balance</div>
          <div className="flex flex-wrap gap-2">
            {usage.remainingPoints.map((prog) => (
              <span 
                key={prog.programCode}
                className="px-2 py-1 bg-slate-100 rounded-lg text-xs font-medium text-slate-700"
              >
                {prog.program}: {prog.displayBalance || formatPoints(prog.balance)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgramUsageBar({ program }: { program: ProgramUsage }) {
  const total = program.used + program.remaining;
  const usedPercent = total > 0 ? (program.used / total) * 100 : 0;
  const config = CATEGORY_CONFIG[program.category] || CATEGORY_CONFIG.airline;
  const Icon = config.icon;
  
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded ${config.bgColor} ${config.textColor}`}>
            <Icon className="w-3 h-3" />
          </div>
          <span className="font-medium text-slate-900">{program.program}</span>
        </div>
        <span className="text-slate-500">
          {program.displayUsed || formatPoints(program.used)} used
          {program.remaining > 0 && (
            <span className="text-slate-400">
              {' / '}
              {program.displayRemaining || formatPoints(program.remaining)} left
            </span>
          )}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div 
          className={`h-full ${config.color} rounded-full transition-all duration-500`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      
      {/* Transfer info */}
      {program.transferredTo && (
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <span>→</span>
          <span>Transferred to {program.transferredTo}</span>
        </div>
      )}
    </div>
  );
}

// Compact version for summary cards
export function PointsUsageCompact({
  bankUsed,
  airlineUsed,
  className = '',
}: {
  bankUsed: number;
  airlineUsed: number;
  className?: string;
}) {
  const total = bankUsed + airlineUsed;
  
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {bankUsed > 0 && (
        <div className="flex items-center gap-1.5">
          <CreditCard className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-medium text-slate-700">
            {formatPoints(bankUsed)}
          </span>
        </div>
      )}
      {airlineUsed > 0 && (
        <div className="flex items-center gap-1.5">
          <Plane className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-slate-700">
            {formatPoints(airlineUsed)}
          </span>
        </div>
      )}
      {total > 0 && (
        <span className="text-xs text-slate-500">pts used</span>
      )}
    </div>
  );
}

// Helper
function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

export default PointsUsageChart;
