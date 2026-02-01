'use client';

/**
 * useSoloOptimization Hook
 * 
 * Connects to the points arbitrage engine for solo trip optimization.
 * Backend is source of truth for preferences (P0-5).
 */

import { useState, useCallback } from 'react';
import { toSnakeCase, toCamelCase } from '@/lib/serializers';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

// Types aligned with backend schemas
export interface TransferInsight {
  type: 'transfer_bonus' | 'sweet_spot' | 'multi_hop' | 'cross_program';
  description: string;
  evidence?: string;
  asOf?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TransferInstruction {
  stepNumber: number;
  sourceProgram: string;
  targetProgram: string;
  pointsToTransfer: number;
  transferRatio: number;
  expectedTransferTime: string;
  portalUrl: string;
  warning?: string;
}

export interface SegmentBreakdown {
  segment: string;
  type: 'flight' | 'hotel';
  paymentMethod: 'cash' | 'points';
  cashPrice: number;
  pointsUsed?: number;
  surcharge?: number;
  cppAchieved?: number;
  transferFrom?: string;
  transferTo?: string;
  transferRatio?: number;
}

export interface OOPMetrics {
  totalCashPrice: number;
  totalOutOfPocket: number;
  cashSaved: number;
  savingsPercentage: number;
  totalPointsUsed: number;
  averageCpp: number;
}

export interface RankedItinerary {
  id: string;
  rank: number;
  route: string[];
  displayName: string;
  segments: SegmentBreakdown[];
  oopMetrics: OOPMetrics;
  transfers: TransferInstruction[];
  insights: TransferInsight[];
}

export interface OptimizeSoloResponse {
  itineraries: RankedItinerary[];
  bestOption?: string;
  warnings: string[];
  globalInsights: TransferInsight[];
  cached: boolean;
  computedAt: string;
  expiresAt: string;
}

export interface UseSoloOptimizationResult {
  itineraries: RankedItinerary[];
  isLoading: boolean;
  error: string | null;
  optimize: (tripId: string, modeOverride?: 'oop' | 'cpp' | 'balanced') => Promise<void>;
  bestOption: string | null;
  warnings: string[];
  globalInsights: TransferInsight[];
  cached: boolean;
  computedAt: string | null;
  expiresAt: string | null;
  // Issue #8 FIX: Expose pointsMap so results page can use it
  pointsMap: Record<string, number>;
}

/**
 * Get access token from storage
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
}

/**
 * Fetch points summary for a trip
 */
async function fetchPointsSummary(tripId: string): Promise<{ items: Array<{ program: string; balance: number }> }> {
  const token = getAccessToken();
  
  const response = await fetch(`${BACKEND_URL}/solo/trips/${tripId}/points`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch points: ${response.status}`);
  }
  
  const data = await response.json();
  return toCamelCase(data);
}

/**
 * Call the solo optimization endpoint
 */
async function callOptimize(
  tripId: string, 
  points: Record<string, number>,
  modeOverride?: 'oop' | 'cpp' | 'balanced'
): Promise<OptimizeSoloResponse> {
  const token = getAccessToken();
  
  const requestBody = toSnakeCase({
    tripId,
    points,
    optimizationModeOverride: modeOverride,
  });
  
  const response = await fetch(`${BACKEND_URL}/solo/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Optimization failed: ${response.status} ${errorText}`);
  }
  
  const data = await response.json();
  return toCamelCase(data);
}

/**
 * Hook for solo trip optimization
 */
export function useSoloOptimization(): UseSoloOptimizationResult {
  const [itineraries, setItineraries] = useState<RankedItinerary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bestOption, setBestOption] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [globalInsights, setGlobalInsights] = useState<TransferInsight[]>([]);
  const [cached, setCached] = useState(false);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // Issue #8 FIX: Store and expose the pointsMap
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});

  const optimize = useCallback(async (
    tripId: string, 
    modeOverride?: 'oop' | 'cpp' | 'balanced'
  ) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 1. Get points summary using canonical endpoint
      const pointsSummary = await fetchPointsSummary(tripId);
      
      // 2. Build points map with canonical program IDs
      // FIXUP 5: Use != null to preserve zero balances (0 is falsy but valid)
      const builtPointsMap: Record<string, number> = {};
      pointsSummary.items.forEach(item => {
        if (item.program && item.balance != null) {
          builtPointsMap[item.program] = item.balance;
        }
      });
      
      // Issue #8 FIX: Store pointsMap so results page can use it
      setPointsMap(builtPointsMap);
      
      // 3. Call arbitrage engine
      // BACKEND IS SOURCE OF TRUTH for preferences (P0-5)
      // Only pass mode override for strategy comparison
      const response = await callOptimize(tripId, builtPointsMap, modeOverride);
      
      // 4. Update state with response
      setItineraries(response.itineraries || []);
      setBestOption(response.bestOption || null);
      setWarnings(response.warnings || []);
      setGlobalInsights(response.globalInsights || []);
      setCached(response.cached || false);
      setComputedAt(response.computedAt || null);
      setExpiresAt(response.expiresAt || null);
      
    } catch (err) {
      console.error('Solo optimization error:', err);
      setError(err instanceof Error ? err.message : 'Optimization failed');
      setItineraries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    itineraries,
    isLoading,
    error,
    optimize,
    bestOption,
    warnings,
    globalInsights,
    cached,
    computedAt,
    expiresAt,
    pointsMap,  // Issue #8 FIX: Expose pointsMap to results page
  };
}

// ============================================================================
// PURE FETCH FUNCTIONS (no React state - use in components like StrategyComparisonCard)
// ============================================================================

/**
 * Pure fetch function for solo optimization.
 * Does NOT manage React state. Returns typed response directly.
 * Use this in StrategyComparisonCard to avoid state race conditions.
 */
export async function fetchOptimizeSolo(
  tripId: string,
  points: Record<string, number>,
  modeOverride?: 'oop' | 'cpp' | 'balanced'
): Promise<OptimizeSoloResponse> {
  return callOptimize(tripId, points, modeOverride);
}

export default useSoloOptimization;
