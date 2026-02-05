'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, DollarSign, Info, X } from 'lucide-react';
import type { BudgetOverrun, SolveMeta } from '@/types/optimization';

interface BudgetOverrunBannerProps {
  /** Budget overrun information */
  overrun: BudgetOverrun;
  /** Solve metadata (for additional context) */
  solveMeta?: SolveMeta | null;
  /** Member name lookup */
  memberNames?: Record<string, string>;
  /** Whether to show as dismissible */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
}

export function BudgetOverrunBanner({
  overrun,
  solveMeta,
  memberNames = {},
  dismissible = false,
  onDismiss,
}: BudgetOverrunBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || overrun.total_overrun_usd <= 0) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const memberOverruns = Object.entries(overrun.member_overrun_usd)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 overflow-hidden">
      {/* Main Banner */}
      <div className="p-4 flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-amber-900">
              Closest Option (Over Budget)
            </h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-200 text-amber-800">
              +${overrun.total_overrun_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          
          <p className="text-sm text-amber-800">
            No itinerary could be found within budget. This is the closest option,
            exceeding the total budget by{' '}
            <strong>${overrun.total_overrun_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>.
          </p>

          {/* Quick stats */}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {overrun.group_overrun_usd > 0 && (
              <div className="flex items-center gap-1.5 text-amber-700">
                <DollarSign className="w-4 h-4" />
                <span>Group overrun: <strong>${overrun.group_overrun_usd.toFixed(0)}</strong></span>
              </div>
            )}
            {overrun.max_member_overrun_usd > 0 && (
              <div className="flex items-center gap-1.5 text-amber-700">
                <Info className="w-4 h-4" />
                <span>Max individual: <strong>${overrun.max_member_overrun_usd.toFixed(0)}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        {dismissible && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-amber-100 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-amber-600" />
          </button>
        )}
      </div>

      {/* Expandable member breakdown */}
      {memberOverruns.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-amber-700 bg-amber-100/50 hover:bg-amber-100 transition-colors border-t border-amber-200"
          >
            <span>Per-member breakdown</span>
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {expanded && (
            <div className="px-4 py-3 bg-white/50 border-t border-amber-100">
              <div className="space-y-2">
                {memberOverruns.map(([memberId, amount]) => (
                  <div
                    key={memberId}
                    className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/70"
                  >
                    <span className="text-sm text-slate-700">
                      {memberNames[memberId] || memberId}
                    </span>
                    <span className="text-sm font-medium text-amber-700">
                      +${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
              
              {/* Additional context from solve meta */}
              {solveMeta?.strict_infeasible_reason && (
                <div className="mt-3 pt-3 border-t border-amber-100">
                  <p className="text-xs text-amber-600">
                    <strong>Why:</strong> {solveMeta.strict_infeasible_reason}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Tag component to show on itinerary cards when they exceed budget.
 */
interface OverrunTagProps {
  /** Overrun amount in USD */
  amount: number;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function OverrunTag({ amount, size = 'sm' }: OverrunTagProps) {
  if (amount <= 0) return null;

  const sizeClasses = size === 'sm' 
    ? 'px-2 py-0.5 text-xs'
    : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center rounded-full font-medium bg-amber-100 text-amber-800 ${sizeClasses}`}>
      +${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} over budget
    </span>
  );
}

/**
 * Empty state component when optimization is completely infeasible.
 */
interface InfeasibleEmptyStateProps {
  /** Reason from solver (if available) */
  reason?: string | null;
  /** Suggestions to show user */
  suggestions?: string[];
  /** Callback to try again */
  onRetry?: () => void;
}

export function InfeasibleEmptyState({
  reason,
  suggestions = [],
  onRetry,
}: InfeasibleEmptyStateProps) {
  const defaultSuggestions = [
    'Increase your total budget to at least cover minimum flight costs',
    'Enable additional cabin classes (Economy, Premium Economy, Business)',
    'Add more points programs or connect additional credit cards',
    'Consider adjusting travel dates for more availability',
    'Try different destination airports if available',
  ];

  const displaySuggestions = suggestions.length > 0 ? suggestions : defaultSuggestions;

  return (
    <div className="text-center py-12 px-6">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <AlertTriangle className="w-8 h-8 text-slate-400" />
      </div>
      
      <h2 className="text-2xl font-semibold text-slate-900 mb-3">
        No Booking Options Found
      </h2>
      
      <p className="text-slate-600 max-w-md mx-auto mb-6">
        {reason || 'No booking combination could be constructed with the current constraints.'}
      </p>

      <div className="max-w-lg mx-auto text-left bg-slate-50 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Try these suggestions:
        </h3>
        <ul className="space-y-2">
          {displaySuggestions.map((suggestion, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-medium">
                {index + 1}
              </span>
              <span>{suggestion}</span>
            </li>
          ))}
        </ul>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

export default BudgetOverrunBanner;
