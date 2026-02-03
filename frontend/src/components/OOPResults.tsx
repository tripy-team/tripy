'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  TrendingDown, Sparkles, MapPin, Loader2, 
  DollarSign, Zap, ChevronRight, AlertCircle
} from 'lucide-react';
import { useOOPOptimization } from '@/lib/hooks/useOOPOptimization';
import { OOPSummaryCard } from '@/components/ui/OOPSummaryCard';
import { SegmentBreakdown } from '@/components/ui/SegmentBreakdown';
import type { RankedItinerary } from '@/types/optimization';

interface OOPResultsProps {
  tripId: string;
  tripType?: 'solo' | 'group';
  points?: Record<string, number>;
  budget?: number;
  cabinClasses?: string[];
}

export function OOPResults({
  tripId,
  tripType = 'solo',
  points = {},
  budget = 5000,
  cabinClasses = ['Economy', 'Business'],
}: OOPResultsProps) {
  const router = useRouter();
  
  const {
    loading,
    error,
    results,
    selectedItinerary,
    setSelectedId,
    bestOption,
    retry,
    canRetry,
    retryCount,
    refetch,
  } = useOOPOptimization({
    tripId,
    tripType,
    points,
    budget,
    cabinClasses,
    autoFetch: true,
  });

  // Loading state
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-emerald-50/20 to-white">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse shadow-xl shadow-emerald-600/20">
            <TrendingDown className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl mb-2 text-slate-900 font-semibold">Minimizing your costs</h2>
          <p className="text-slate-600">Finding the lowest out-of-pocket options...</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching flights · Checking availability · Running optimization
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Optimization Failed</h2>
          <p className="text-red-600 mb-4">{error}</p>
          
          {retryCount > 0 && (
            <p className="text-sm text-slate-500 mb-4">
              Attempt {retryCount} of 3 failed
            </p>
          )}
          
          <div className="flex gap-3 justify-center">
            {canRetry && (
              <button
                onClick={retry}
                disabled={loading}
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  'Try Again'
                )}
              </button>
            )}
            
            <button
              onClick={() => refetch()}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50"
            >
              Start Fresh
            </button>
            
            <button
              onClick={() => router.push('/solo/setup')}
              className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
            >
              Back to Setup
            </button>
          </div>
          
          {!canRetry && (
            <p className="mt-4 text-sm text-slate-500">
              Maximum retries reached. Please try adjusting your trip settings.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (!results || results.itineraries.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No routes found</h2>
          <p className="text-slate-600 mb-6">
            We couldn't find any routes within your budget and available points.
            Try adjusting your settings.
          </p>
          <button
            onClick={() => router.push('/solo/setup')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
          >
            Adjust Trip Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-8 bg-gradient-to-br from-white via-emerald-50/20 to-white">
      <div className="max-w-7xl mx-auto">
        {/* Header with Best OOP */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
              <TrendingDown className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Best Options by Out-of-Pocket
              </h1>
              <p className="text-slate-600">
                Ranked by lowest cash you'll actually pay
              </p>
            </div>
          </div>

          {/* Best Option Highlight */}
          {bestOption && (
            <div className="p-6 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl text-white shadow-xl shadow-emerald-500/20">
              <div className="flex items-center gap-2 mb-2 text-emerald-100">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-medium uppercase tracking-wider">Best Deal</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold">
                  ${bestOption.outOfPocket.toLocaleString()}
                </span>
                <span className="text-emerald-100 text-lg">total out-of-pocket</span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-emerald-100">
                <span>Save {bestOption.savingsPercentage.toFixed(0)}%</span>
                <span>·</span>
                <span>Using {(bestOption.pointsUsed / 1000).toFixed(0)}k points</span>
              </div>
            </div>
          )}
        </div>

        {/* Warnings */}
        {results.warnings && results.warnings.length > 0 && (
          <div className="mb-6 space-y-2">
            {results.warnings.map((warning, i) => (
              <div key={i} className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        )}

        {/* Results Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Itinerary List */}
          <div className="lg:col-span-2 space-y-4">
            {results.itineraries.map((itinerary, index) => (
              <div key={itinerary.id}>
                <OOPSummaryCard
                  metrics={itinerary.oopMetrics}
                  rank={index + 1}
                  isSelected={selectedItinerary?.id === itinerary.id}
                  onClick={() => setSelectedId(itinerary.id)}
                />
                
                {/* Route Preview */}
                <div className="mt-2 px-4 py-2 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 flex-wrap">
                    {itinerary.route.map((stop, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <span className="font-medium">{stop}</span>
                        {i < itinerary.route.length - 1 && (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Constraint badges */}
                <div className="mt-2 flex gap-2">
                  {itinerary.withinBudget && (
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">
                      Within budget
                    </span>
                  )}
                  {itinerary.withinPoints && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                      Within points
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Selected Itinerary Details */}
          {selectedItinerary && (
            <div className="lg:col-span-1">
              <div className="sticky top-8 space-y-6">
                {/* Segment Breakdown */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6">
                  <SegmentBreakdown
                    segments={selectedItinerary.segments}
                    transfers={selectedItinerary.transfers}
                  />
                </div>

                {/* AI Summary */}
                {selectedItinerary.summary && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-blue-800">
                      <Sparkles className="w-4 h-4" />
                      <span className="font-medium">AI Analysis</span>
                    </div>
                    <p className="text-sm text-blue-700">{selectedItinerary.summary}</p>
                  </div>
                )}

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 bg-emerald-50 rounded-xl text-center">
                    <DollarSign className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-emerald-700">
                      ${selectedItinerary.oopMetrics.cashSaved.toLocaleString()}
                    </div>
                    <div className="text-xs text-emerald-600">saved</div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-xl text-center">
                    <Zap className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-blue-700">
                      {selectedItinerary.oopMetrics.averageCPP.toFixed(1)}¢
                    </div>
                    <div className="text-xs text-blue-600">avg CPP</div>
                  </div>
                </div>

                {/* Book Button */}
                <button
                  onClick={() => router.push(`/solo/booking?trip_id=${tripId}&itinerary_id=${selectedItinerary.id}`)}
                  className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-bold text-lg"
                >
                  Book for ${selectedItinerary.oopMetrics.totalOutOfPocket.toLocaleString()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OOPResults;
