'use client';

/**
 * Hook for dynamic multi-city route optimization.
 * 
 * Optimizes the order of intermediate destinations to minimize
 * out-of-pocket costs while maximizing points value.
 */

import { useState, useCallback } from 'react';
import { optimization } from '@/lib/api';
import type {
  DynamicRouteRequest,
  DynamicRouteResult,
  DynamicRouteOption,
  DynamicRouteTransferStep,
} from '@/types/optimization';

interface UseDynamicRouteOptions {
  /** Fixed starting airport (IATA code) */
  startCity: string;
  /** Fixed ending airport (IATA code) */
  endCity: string;
  /** Cities to visit (order will be optimized) */
  intermediateCities: string[];
  /** User's points balances {program: balance} */
  points: Record<string, number>;
  /** Travel start date (YYYY-MM-DD) */
  travelDate: string;
  /** Cabin class for flights */
  cabinClass?: string;
}

interface UseDynamicRouteReturn {
  /** Loading state */
  loading: boolean;
  
  /** Error message if failed */
  error: string | null;
  
  /** Full optimization result */
  result: DynamicRouteResult | null;
  
  /** The recommended route */
  recommendedRoute: DynamicRouteOption | null;
  
  /** All route options evaluated */
  routeOptions: DynamicRouteOption[];
  
  /** Transfer instructions for recommended route */
  transferSteps: DynamicRouteTransferStep[];
  
  /** Human-readable strategy summary */
  strategySummary: string;
  
  /** Trigger optimization */
  optimize: () => Promise<DynamicRouteResult | null>;
  
  /** Clear results and error */
  reset: () => void;
  
  /** Computed metrics */
  metrics: {
    totalPointsUsed: number;
    remainingPoints: number;
    totalCashSaved: number;
    averageCpp: number;
    totalSurcharges: number;
    pointsBudget: number;
  } | null;
}

export function useDynamicRoute(options: UseDynamicRouteOptions): UseDynamicRouteReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DynamicRouteResult | null>(null);

  const optimize = useCallback(async (): Promise<DynamicRouteResult | null> => {
    // Validate inputs
    if (!options.startCity || !options.endCity) {
      setError('Start and end cities are required');
      return null;
    }
    
    if (!options.intermediateCities || options.intermediateCities.length === 0) {
      setError('At least one intermediate city is required');
      return null;
    }
    
    if (!options.travelDate) {
      setError('Travel date is required');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const request: DynamicRouteRequest = {
        startCity: options.startCity.toUpperCase(),
        endCity: options.endCity.toUpperCase(),
        intermediateCities: options.intermediateCities.map(c => c.toUpperCase()),
        points: options.points,
        travelDate: options.travelDate,
        cabinClass: options.cabinClass || 'economy',
      };

      const response = await optimization.dynamicRoute(request);
      setResult(response);
      
      if (!response.success) {
        setError('Optimization failed - no valid routes found');
      }
      
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to optimize route';
      setError(message);
      console.error('Dynamic route optimization error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [options]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  // Computed values
  const recommendedRoute = result?.recommendedRoute || null;
  const routeOptions = result?.routeOptions || [];
  const transferSteps = result?.transferSteps || [];
  const strategySummary = result?.strategySummary || '';
  
  const metrics = result ? {
    totalPointsUsed: result.totalPointsUsed,
    remainingPoints: result.remainingPoints,
    totalCashSaved: result.totalCashSaved,
    averageCpp: result.averageCpp,
    totalSurcharges: result.totalSurcharges,
    pointsBudget: result.pointsBudget,
  } : null;

  return {
    loading,
    error,
    result,
    recommendedRoute,
    routeOptions,
    transferSteps,
    strategySummary,
    optimize,
    reset,
    metrics,
  };
}

export default useDynamicRoute;
