'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  optimization,
  type OptimizeSoloRequest,
  type OptimizeGroupRequest,
} from '@/lib/api';
import type {
  OptimizeSoloResponse,
  OptimizeGroupResponse,
  RankedItinerary,
  CostBreakdown,
} from '@/types/optimization';

interface UseOOPOptimizationOptions {
  tripId: string;
  tripType: 'solo' | 'group';
  points: Record<string, number>;
  budget: number;
  memberPoints?: Record<string, Record<string, number>>;
  memberBudgets?: Record<string, number>;
  cabinClasses?: string[];
  hotelStars?: number[];
  includeHotels?: boolean;
  autoFetch?: boolean;
}

interface UseOOPOptimizationReturn {
  // State
  loading: boolean;
  error: string | null;
  results: OptimizeSoloResponse | OptimizeGroupResponse | null;
  
  // Selected itinerary
  selectedItinerary: RankedItinerary | null;
  setSelectedId: (id: string | null) => void;
  
  // Cost breakdown (lazy loaded)
  costBreakdown: CostBreakdown | null;
  loadingBreakdown: boolean;
  fetchCostBreakdown: (itineraryId: string) => Promise<void>;
  
  // Actions
  refetch: () => Promise<void>;
  
  // Computed
  bestOption: {
    outOfPocket: number;
    savingsPercentage: number;
    pointsUsed: number;
  } | null;
}

export function useOOPOptimization(options: UseOOPOptimizationOptions): UseOOPOptimizationReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OptimizeSoloResponse | OptimizeGroupResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  const fetchResults = useCallback(async () => {
    if (!options.tripId) return;

    setLoading(true);
    setError(null);

    try {
      let response: OptimizeSoloResponse | OptimizeGroupResponse;

      if (options.tripType === 'solo') {
        response = await optimization.solo({
          tripId: options.tripId,
          points: options.points,
          budget: options.budget,
          cabinClasses: options.cabinClasses,
          hotelStars: options.hotelStars,
          includeHotels: options.includeHotels,
        });
      } else {
        response = await optimization.group({
          tripId: options.tripId,
          points: options.points,
          budget: options.budget,
          memberPoints: options.memberPoints || {},
          memberBudgets: options.memberBudgets || {},
          cabinClasses: options.cabinClasses,
          hotelStars: options.hotelStars,
          includeHotels: options.includeHotels,
        });
      }

      setResults(response);

      // Auto-select best (first) itinerary
      if (response.itineraries.length > 0) {
        setSelectedId(response.itineraries[0].id);
      }
    } catch (err) {
      console.error('OOP optimization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to optimize');
    } finally {
      setLoading(false);
    }
  }, [
    options.tripId,
    options.tripType,
    options.points,
    options.budget,
    options.cabinClasses,
    options.hotelStars,
    options.includeHotels,
    options.memberPoints,
    options.memberBudgets,
  ]);

  const fetchCostBreakdown = useCallback(async (itineraryId: string) => {
    setLoadingBreakdown(true);
    try {
      const breakdown = await optimization.getCostBreakdown(itineraryId);
      setCostBreakdown(breakdown);
    } catch (err) {
      console.error('Cost breakdown error:', err);
    } finally {
      setLoadingBreakdown(false);
    }
  }, []);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (options.autoFetch !== false && options.tripId) {
      fetchResults();
    }
  }, [options.tripId, options.autoFetch, fetchResults]);

  // Find selected itinerary
  const selectedItinerary = results?.itineraries.find(i => i.id === selectedId) || null;

  // Compute best option
  const bestOption = results?.itineraries[0] 
    ? {
        outOfPocket: results.itineraries[0].oopMetrics.totalOutOfPocket,
        savingsPercentage: results.itineraries[0].oopMetrics.savingsPercentage,
        pointsUsed: results.itineraries[0].oopMetrics.totalPointsUsed,
      }
    : null;

  return {
    loading,
    error,
    results,
    selectedItinerary,
    setSelectedId,
    costBreakdown,
    loadingBreakdown,
    fetchCostBreakdown,
    refetch: fetchResults,
    bestOption,
  };
}

export default useOOPOptimization;
