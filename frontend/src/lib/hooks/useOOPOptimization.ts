'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  retry: () => Promise<void>;
  clearError: () => void;
  
  // Retry state
  retryCount: number;
  canRetry: boolean;
  
  // Computed
  bestOption: {
    outOfPocket: number;
    savingsPercentage: number;
    pointsUsed: number;
  } | null;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export function useOOPOptimization(options: UseOOPOptimizationOptions): UseOOPOptimizationReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OptimizeSoloResponse | OptimizeGroupResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  // Use ref to track options without causing re-renders
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchResults = useCallback(async (isRetry = false) => {
    const currentOptions = optionsRef.current;
    if (!currentOptions.tripId) return;

    setLoading(true);
    if (!isRetry) {
      setError(null);
      setRetryCount(0);
    }

    try {
      let response: OptimizeSoloResponse | OptimizeGroupResponse;

      if (currentOptions.tripType === 'solo') {
        response = await optimization.solo({
          tripId: currentOptions.tripId,
          points: currentOptions.points,
          budget: currentOptions.budget,
          cabinClasses: currentOptions.cabinClasses,
        });
      } else {
        response = await optimization.group({
          tripId: currentOptions.tripId,
          points: currentOptions.points,
          budget: currentOptions.budget,
          memberPoints: currentOptions.memberPoints || {},
          memberBudgets: currentOptions.memberBudgets || {},
          cabinClasses: currentOptions.cabinClasses,
        });
      }

      setResults(response);
      setError(null);
      setRetryCount(0);

      // Auto-select best (first) itinerary
      if (response.itineraries.length > 0) {
        setSelectedId(response.itineraries[0].id);
      }
    } catch (err) {
      console.error('OOP optimization error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to optimize';
      setError(errorMessage);
      
      if (isRetry) {
        setRetryCount(prev => prev + 1);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  
  const retry = useCallback(async () => {
    if (retryCount >= MAX_RETRIES) {
      return;
    }
    
    // Add delay before retry
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    await fetchResults(true);
  }, [fetchResults, retryCount]);
  
  const clearError = useCallback(() => {
    setError(null);
    setRetryCount(0);
  }, []);

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
    retry,
    clearError,
    retryCount,
    canRetry: retryCount < MAX_RETRIES,
    bestOption,
  };
}

export default useOOPOptimization;
