'use client';

/**
 * DynamicRouteResults - Displays multi-city route optimization results.
 * 
 * Shows:
 * - Recommended route with optimal city ordering
 * - Segment-by-segment flight details
 * - Transfer instructions for points
 * - Comparison with alternative routes
 * - Total savings and metrics
 */

import { useState } from 'react';
import {
  Plane,
  MapPin,
  DollarSign,
  Zap,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  Clock,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import type {
  DynamicRouteResult,
  DynamicRouteOption,
  DynamicRouteSegment,
  DynamicRouteTransferStep,
  DynamicRouteComparisonMetric,
} from '@/types/optimization';

interface DynamicRouteResultsProps {
  result: DynamicRouteResult;
  onSelectRoute?: (route: DynamicRouteOption) => void;
}

// Format large numbers with k/M suffix
function formatPoints(points: number): string {
  if (points >= 1_000_000) {
    return `${(points / 1_000_000).toFixed(1)}M`;
  }
  if (points >= 1_000) {
    return `${(points / 1_000).toFixed(0)}k`;
  }
  return points.toLocaleString();
}

// Format currency
function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Format duration
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Segment card component
function SegmentCard({ segment, index }: { segment: DynamicRouteSegment; index: number }) {
  const isPaid = !segment.awardAvailable || segment.pointsCost === 0;
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 transition-colors">
      <div className="flex items-start gap-4">
        {/* Flight number badge */}
        <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
          <Plane className="w-6 h-6 text-blue-600" />
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Route header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold text-slate-900">{segment.origin}</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <span className="font-semibold text-slate-900">{segment.destination}</span>
            {segment.airline && (
              <span className="text-sm text-slate-500 ml-2">
                {segment.airline} {segment.flightNumber || ''}
              </span>
            )}
          </div>
          
          {/* Flight details */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 mb-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(segment.durationMinutes)}
            </span>
            {segment.isDirect ? (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                Direct
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                {segment.numStops} stop{segment.numStops > 1 ? 's' : ''}
              </span>
            )}
          </div>
          
          {/* Pricing */}
          <div className="flex flex-wrap items-center gap-4">
            {isPaid ? (
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-slate-500" />
                <span className="font-semibold text-slate-900">
                  {formatCurrency(segment.cashPrice)}
                </span>
                <span className="text-xs text-slate-500">cash</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-blue-600">
                    {formatPoints(segment.pointsCost)} pts
                  </span>
                  {segment.pointsProgramName && (
                    <span className="text-xs text-slate-500">
                      via {segment.pointsProgramName}
                    </span>
                  )}
                </div>
                {segment.surcharge > 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-slate-500">+</span>
                    <span className="text-slate-700">{formatCurrency(segment.surcharge)}</span>
                    <span className="text-xs text-slate-500">surcharge</span>
                  </div>
                )}
                {segment.cashSaved > 0 && (
                  <div className="flex items-center gap-1 text-sm text-green-600">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Save {formatCurrency(segment.cashSaved)}</span>
                  </div>
                )}
                {segment.cpp > 0 && (
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {segment.cpp.toFixed(2)}¢/pt
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Booking link */}
        {segment.bookingLink && (
          <a
            href={segment.bookingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 p-2 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <ExternalLink className="w-5 h-5 text-blue-600" />
          </a>
        )}
      </div>
    </div>
  );
}

// Transfer step component
function TransferStepCard({ step, onCopyInstructions }: { step: DynamicRouteTransferStep; onCopyInstructions: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-amber-700 font-semibold text-sm">{step.stepNumber}</span>
          </div>
          
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-slate-900">{step.sourceProgramName}</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-slate-900">{step.targetProgramName}</span>
            </div>
            
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 mb-2">
              <span className="font-semibold text-amber-700">
                {formatPoints(step.pointsToTransfer)} pts
              </span>
              <span className="text-slate-400">•</span>
              <span>{step.transferRatio}</span>
              <span className="text-slate-400">•</span>
              <span>{step.transferTime}</span>
            </div>
            
            {step.cppValue > 0 && (
              <div className="text-sm text-green-600">
                Saves {formatCurrency(step.cashSaved)} ({step.cppValue.toFixed(2)}¢/pt value)
              </div>
            )}
          </div>
        </div>
        
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2 hover:bg-amber-100 rounded-lg transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-600" />
          )}
        </button>
      </div>
      
      {expanded && (
        <div className="mt-4 pt-4 border-t border-amber-200">
          <div className="space-y-3">
            {step.instructions.map((instruction, idx) => (
              <div key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>{instruction}</span>
              </div>
            ))}
          </div>
          
          <div className="flex gap-3 mt-4">
            {step.portalUrl && (
              <a
                href={step.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Transfer Portal
              </a>
            )}
            {step.bookingUrl && (
              <a
                href={step.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Book Flight
              </a>
            )}
            <button
              onClick={() => onCopyInstructions(step.instructions.join('\n'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              <Copy className="w-4 h-4" />
              Copy Steps
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Route option card (for comparison)
function RouteOptionCard({ 
  route, 
  isRecommended,
  onSelect,
}: { 
  route: DynamicRouteOption; 
  isRecommended: boolean;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(isRecommended);
  
  return (
    <div
      className={`bg-white border-2 rounded-2xl overflow-hidden transition-all ${
        isRecommended 
          ? 'border-blue-500 shadow-lg shadow-blue-500/10' 
          : 'border-slate-200 hover:border-blue-300'
      }`}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-slate-900">{route.routeName}</h3>
              {isRecommended && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Recommended
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <MapPin className="w-3.5 h-3.5" />
              <span>{route.pathDisplay}</span>
            </div>
          </div>
          
          {!route.feasible && (
            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {route.status === 'exceeds_points' ? 'Exceeds points' : 
               route.status === 'no_availability' ? 'Limited availability' : 'Over budget'}
            </span>
          )}
        </div>
        
        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-3 p-4 bg-slate-50 rounded-xl mb-4">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Out-of-pocket</div>
            <div className="text-lg font-bold text-slate-900">
              {formatCurrency(route.totalSurcharges)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Points</div>
            <div className="text-lg font-bold text-blue-600">
              {formatPoints(route.totalPoints)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Saved</div>
            <div className="text-lg font-bold text-green-600">
              {formatCurrency(route.totalCashSaved)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Value</div>
            <div className="text-lg font-bold text-slate-900">
              {route.averageCpp.toFixed(2)}¢/pt
            </div>
          </div>
        </div>
        
        {/* Expandable segments */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-3 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <span className="text-sm font-medium text-slate-700">
            {route.segments.length} segment{route.segments.length > 1 ? 's' : ''} • {formatDuration(route.totalDurationMinutes)} total
          </span>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-500" />
          )}
        </button>
        
        {expanded && (
          <div className="mt-4 space-y-3">
            {route.segments.map((segment, idx) => (
              <SegmentCard key={segment.segmentId} segment={segment} index={idx} />
            ))}
          </div>
        )}
        
        {/* Select button */}
        {onSelect && (
          <button
            onClick={onSelect}
            className={`w-full mt-4 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              isRecommended
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
            }`}
          >
            {isRecommended ? 'Book This Route' : 'Select This Route'}
          </button>
        )}
      </div>
    </div>
  );
}

// Comparison table
function ComparisonTable({ metrics }: { metrics: DynamicRouteComparisonMetric[] }) {
  if (!metrics || metrics.length === 0) return null;
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">Route Comparison</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {metrics.map((metric, idx) => (
          <div key={idx} className="grid grid-cols-4 gap-4 p-4 text-sm">
            <div className="font-medium text-slate-700">{metric.metricName}</div>
            <div className={metric.winner === 'route_a' ? 'text-green-600 font-semibold' : 'text-slate-600'}>
              {metric.routeAValue}
            </div>
            <div className={metric.winner === 'route_b' ? 'text-green-600 font-semibold' : 'text-slate-600'}>
              {metric.routeBValue}
            </div>
            <div className="text-slate-500">
              {metric.winnerDisplay}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Main component
export function DynamicRouteResults({ result, onSelectRoute }: DynamicRouteResultsProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  const handleCopyInstructions = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  if (!result.success || !result.recommendedRoute) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-900 mb-2">No Optimal Route Found</h3>
        <p className="text-slate-600">
          We couldn&apos;t find a valid route with the given parameters. 
          Try adjusting your cities or dates.
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-8">
      {/* Summary header */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Optimized Route</h2>
            <p className="text-slate-600">
              {result.startCity} → {result.intermediateCities.join(' → ')} → {result.endCity}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-500">Computed in</div>
            <div className="text-lg font-semibold text-slate-900">
              {(result.computationTimeMs / 1000).toFixed(2)}s
            </div>
          </div>
        </div>
        
        {/* Key metrics */}
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white/70 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-600 mb-1">
              <Zap className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Points Used</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {formatPoints(result.totalPointsUsed)}
            </div>
          </div>
          
          <div className="bg-white/70 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-600 mb-1">
              <Zap className="w-4 h-4 opacity-50" />
              <span className="text-xs font-medium uppercase tracking-wider">Remaining</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {formatPoints(result.remainingPoints)}
            </div>
          </div>
          
          <div className="bg-white/70 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-600 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Out-of-pocket</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(result.totalSurcharges)}
            </div>
          </div>
          
          <div className="bg-white/70 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Cash Saved</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(result.totalCashSaved)}
            </div>
          </div>
          
          <div className="bg-white/70 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Avg Value</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {result.averageCpp.toFixed(2)}¢/pt
            </div>
          </div>
        </div>
      </div>
      
      {/* Strategy summary */}
      {result.strategySummary && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Strategy Summary
          </h3>
          <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap">
            {result.strategySummary}
          </div>
        </div>
      )}
      
      {/* Recommendation reasons */}
      {result.recommendationReasons && result.recommendationReasons.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
            <Check className="w-5 h-5" />
            Why This Route?
          </h3>
          <ul className="space-y-2">
            {result.recommendationReasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2 text-green-800">
                <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Transfer instructions */}
      {result.transferSteps && result.transferSteps.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Transfer Instructions ({result.transferSteps.length} step{result.transferSteps.length > 1 ? 's' : ''})
          </h3>
          <div className="space-y-3">
            {result.transferSteps.map((step) => (
              <TransferStepCard 
                key={step.stepNumber} 
                step={step} 
                onCopyInstructions={handleCopyInstructions}
              />
            ))}
          </div>
          {copiedText && (
            <div className="fixed bottom-4 right-4 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
              <Check className="w-4 h-4" />
              Copied to clipboard
            </div>
          )}
        </div>
      )}
      
      {/* Route options */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4">
          Route Options ({result.routeOptions.length})
        </h3>
        <div className="space-y-4">
          {result.routeOptions.map((route) => (
            <RouteOptionCard
              key={route.routeId}
              route={route}
              isRecommended={route.routeId === result.recommendedRoute?.routeId}
              onSelect={onSelectRoute ? () => onSelectRoute(route) : undefined}
            />
          ))}
        </div>
      </div>
      
      {/* Comparison matrix */}
      {result.comparisonMatrix && result.comparisonMatrix.length > 0 && (
        <ComparisonTable metrics={result.comparisonMatrix} />
      )}
    </div>
  );
}

export default DynamicRouteResults;
