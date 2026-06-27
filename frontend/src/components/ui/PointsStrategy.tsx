/**
 * PointsStrategy - Shows which loyalty points to use, which flights to book,
 * and how to transfer points (including additive balances).
 *
 * Example: "Transfer 1,000 Amex MR → Delta SkyMiles.
 *           Combined with your existing 40,000 Delta SkyMiles = 41,000 total.
 *           Book JFK → LAX (DL 1234) using 41,000 Delta SkyMiles."
 */
'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  PlaneTakeoff,
  Plus,
  Wallet,
  Zap,
} from 'lucide-react';
import type { PointsStrategy, AirlineProgramStrategy, PointsSource } from '@/types/optimization';

interface PointsStrategyProps {
  strategy: PointsStrategy;
  className?: string;
}

export function PointsStrategyCard({ strategy, className = '' }: PointsStrategyProps) {
  const [expanded, setExpanded] = useState(true);

  if (!strategy || !strategy.programs || strategy.programs.length === 0) {
    return null;
  }

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-900">Points Strategy</h3>
            <p className="text-sm text-slate-500">
              {strategy.total_transfers_needed > 0
                ? `${strategy.total_transfers_needed} transfer${strategy.total_transfers_needed > 1 ? 's' : ''} needed`
                : 'Using your existing miles'}
              {' · '}
              {formatPoints(strategy.total_airline_points_used)} pts total
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-200">
          {/* Per-program strategies */}
          {strategy.programs.map((program, idx) => (
            <ProgramStrategySection key={program.airline_program} program={program} index={idx} />
          ))}

          {/* Action Summary */}
          {strategy.action_summary && strategy.action_summary.length > 0 && (
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Step-by-step plan
              </div>
              <ol className="space-y-2">
                {strategy.action_summary.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="w-5 h-5 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Surcharges note */}
          {strategy.total_surcharges > 0 && (
            <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-sm text-amber-800">
              Plus ${strategy.total_surcharges.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} in taxes & surcharges paid in cash.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramStrategySection({
  program,
  index,
}: {
  program: AirlineProgramStrategy;
  index: number;
}) {
  const hasMultipleSources = program.sources.length > 1;
  const hasTransfers = program.sources.some((s) => s.is_transfer);

  return (
    <div className={`p-4 ${index > 0 ? 'border-t border-slate-200' : ''}`}>
      {/* Airline program header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-slate-900">
            {program.airline_program_display}
          </span>
        </div>
        <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg">
          {formatPoints(program.points_needed)} pts needed
        </span>
      </div>

      {/* Flights covered */}
      <div className="mb-3">
        <div className="text-xs text-slate-500 mb-1">Covers:</div>
        <div className="flex flex-wrap gap-1.5">
          {program.covers_flights.map((flight, i) => (
            <span
              key={i}
              className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-lg text-sm text-slate-700"
            >
              <PlaneTakeoff className="w-3 h-3" />
              {flight}
            </span>
          ))}
        </div>
      </div>

      {/* Sources breakdown (additive) */}
      {program.sources.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-3 space-y-2">
          {program.sources.map((source, i) => (
            <SourceRow key={i} source={source} isLast={i === program.sources.length - 1} />
          ))}

          {/* Total line (when multiple sources) */}
          {hasMultipleSources && (
            <div className="border-t border-indigo-200 pt-2 mt-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-indigo-900">
                Total {program.airline_program_display}
              </span>
              <span className="text-sm font-bold text-indigo-900">
                {formatPoints(program.total_points_available)} pts
              </span>
            </div>
          )}

          {/* Surplus indicator */}
          {program.surplus_points > 0 && (
            <div className="text-xs text-emerald-700 mt-1">
              {formatPoints(program.surplus_points)} pts remaining after booking
            </div>
          )}
        </div>
      )}

      {/* Booking link */}
      {program.booking_url && (
        <a
          href={program.booking_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full p-2 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
        >
          Book on {program.airline_program_display}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

/** Live transfer-bonus badge (e.g. "🔥 +30% through 2026-06-30") */
function BonusBadge({ source }: { source: PointsSource }) {
  const leg = source.legs?.find((l) => l.bonus_pct);
  if (!leg?.bonus_pct) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">
      <Flame className="w-2.5 h-2.5" />
      +{leg.bonus_pct}% bonus
      {leg.bonus_expiry && ` · thru ${leg.bonus_expiry}`}
      {leg.bonus_source && ` · ${leg.bonus_source}`}
    </span>
  );
}

function SourceRow({ source, isLast }: { source: PointsSource; isLast: boolean }) {
  if (source.is_transfer) {
    // Chained bank -> hotel -> airline transfer: render the two-hop flow.
    if (source.is_chained && source.via_program_display) {
      return (
        <div className="flex items-start gap-2 text-sm">
          <ArrowRightLeft className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-purple-800">
                {source.source_program_display}
              </span>
              <ArrowRight className="w-3 h-3 text-purple-400" />
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <Building2 className="w-3 h-3" />
                {source.via_program_display}
              </span>
              <ArrowRight className="w-3 h-3 text-purple-400" />
              <span className="font-medium text-purple-800">
                {formatPoints(source.resulting_points)} pts
              </span>
            </div>
            <div className="text-xs text-purple-600 mt-0.5">
              Chained transfer of {formatPoints(source.points_from_source)} pts
              {source.transfer_time && ` · ${source.transfer_time}`}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <BonusBadge source={source} />
              {source.top_up_reason && (
                <span className="text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                  {source.top_up_reason}
                </span>
              )}
            </div>
          </div>
          {!isLast && <Plus className="w-3 h-3 text-slate-400 flex-shrink-0 mt-1" />}
        </div>
      );
    }

    const isHotel = source.source_type === 'hotel';
    const Icon = isHotel ? Building2 : ArrowRightLeft;
    return (
      <div className="flex items-start gap-2 text-sm">
        <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isHotel ? 'text-amber-600' : 'text-purple-600'}`} />
        <div className="flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-purple-800">
              {source.source_program_display}
            </span>
            <ArrowRight className="w-3 h-3 text-purple-400" />
            <span className="font-medium text-purple-800">
              {formatPoints(source.resulting_points)} pts
            </span>
          </div>
          <div className="text-xs text-purple-600 mt-0.5">
            Transfer {formatPoints(source.points_from_source)} pts
            {source.transfer_ratio !== 1.0 && ` (${source.transfer_ratio}:1 ratio)`}
            {source.transfer_time && ` · ${source.transfer_time}`}
          </div>
          {(source.legs?.some((l) => l.bonus_pct) || source.top_up_reason) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <BonusBadge source={source} />
              {source.top_up_reason && (
                <span className="text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                  {source.top_up_reason}
                </span>
              )}
            </div>
          )}
        </div>
        {!isLast && <Plus className="w-3 h-3 text-slate-400 flex-shrink-0 mt-1" />}
      </div>
    );
  }

  // Direct balance
  return (
    <div className="flex items-center gap-2 text-sm">
      <Wallet className="w-4 h-4 text-indigo-600 flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-indigo-800">
            {source.source_program_display}
          </span>
          <span className="text-indigo-700">
            {formatPoints(source.resulting_points)} pts
          </span>
        </div>
        <div className="text-xs text-indigo-600 mt-0.5">
          Your existing balance
        </div>
      </div>
      {!isLast && <Plus className="w-3 h-3 text-slate-400 flex-shrink-0" />}
    </div>
  );
}

/** Compact version for summary cards */
export function PointsStrategySummary({
  strategy,
  className = '',
}: {
  strategy: PointsStrategy;
  className?: string;
}) {
  if (!strategy || !strategy.programs || strategy.programs.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {strategy.programs.map((program) => (
        <div key={program.airline_program} className="flex items-center gap-2 text-sm">
          <Zap className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-slate-700">
            {formatPoints(program.points_needed)} {program.airline_program_display}
          </span>
          {program.sources.some((s) => s.is_transfer) && (
            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
              transfer needed
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

export default PointsStrategyCard;
