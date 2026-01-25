/**
 * Custom hook for fetching and managing points data.
 * Provides loading states, valuations, and upsert capabilities.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { points as pointsAPI, PointsSummary, PointsSummaryItem } from '@/lib/api';

// Extended points summary with new display fields
export interface PointsSummaryResponse extends PointsSummary {
  displayTotalPoints?: string;
  displayTotalValue?: string;
  byCategory?: {
    bank: EnrichedPointsItem[];
    airline: EnrichedPointsItem[];
    hotel: EnrichedPointsItem[];
  };
  recommendations?: TransferRecommendation[];
}

export interface EnrichedPointsItem extends PointsSummaryItem {
  displayBalance?: string;
  displayValue?: string;
  displayCPP?: string;
  programDisplayName?: string;
  category?: 'bank' | 'airline' | 'hotel' | 'unknown';
  transferPartners?: string[];
}

export interface TransferRecommendation {
  fromProgram: string;
  fromProgramCode: string;
  toProgram: string;
  toProgramCode: string;
  reason: string;
  potentialSavings: number;
  displaySavings: string;
}

export interface UsePointsResult {
  summary: PointsSummaryResponse | null;
  valuations: Record<string, number>;
  loading: boolean;
  error: string | null;
  upsert: (program: string, balance: number) => Promise<void>;
  refetch: () => Promise<void>;
  
  // Computed values for convenience
  totalPoints: number;
  totalValue: number;
  displayTotalPoints: string;
  displayTotalValue: string;
  bankPoints: EnrichedPointsItem[];
  airlinePoints: EnrichedPointsItem[];
  hotelPoints: EnrichedPointsItem[];
  recommendations: TransferRecommendation[];
}

export function usePoints(tripId: string | null): UsePointsResult {
  const [summary, setSummary] = useState<PointsSummaryResponse | null>(null);
  const [valuations, setValuations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch valuations once on mount
  useEffect(() => {
    const fetchValuations = async () => {
      try {
        const vals = await pointsAPI.valuations();
        setValuations(vals);
      } catch (e) {
        console.warn('Failed to fetch point valuations:', e);
      }
    };
    fetchValuations();
  }, []);

  // Fetch points summary when tripId changes
  const fetchSummary = useCallback(async () => {
    if (!tripId) {
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await pointsAPI.summary(tripId);
      setSummary(result as PointsSummaryResponse);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch points';
      setError(message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Upsert points and refresh summary
  const upsert = useCallback(async (program: string, balance: number) => {
    if (!tripId) return;

    try {
      await pointsAPI.upsert({ trip_id: tripId, program, balance });
      // Refresh summary after upsert
      await fetchSummary();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update points';
      setError(message);
      throw e;
    }
  }, [tripId, fetchSummary]);

  // Computed values
  const totalPoints = summary?.totalPoints ?? 0;
  const totalValue = summary?.totalValue ?? 0;
  const displayTotalPoints = summary?.displayTotalPoints ?? formatPoints(totalPoints);
  const displayTotalValue = summary?.displayTotalValue ?? formatCurrency(totalValue);
  
  const bankPoints = summary?.byCategory?.bank ?? 
    (summary?.items?.filter(i => categorizeProgram(i.program) === 'bank') as EnrichedPointsItem[] ?? []);
  const airlinePoints = summary?.byCategory?.airline ?? 
    (summary?.items?.filter(i => categorizeProgram(i.program) === 'airline') as EnrichedPointsItem[] ?? []);
  const hotelPoints = summary?.byCategory?.hotel ?? 
    (summary?.items?.filter(i => categorizeProgram(i.program) === 'hotel') as EnrichedPointsItem[] ?? []);
  
  const recommendations = summary?.recommendations ?? [];

  return {
    summary,
    valuations,
    loading,
    error,
    upsert,
    refetch: fetchSummary,
    totalPoints,
    totalValue,
    displayTotalPoints,
    displayTotalValue,
    bankPoints,
    airlinePoints,
    hotelPoints,
    recommendations,
  };
}

// Helper functions
function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) {
      return `${points / 1000}k`;
    }
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

function formatCurrency(amount: number): string {
  if (amount === 0) return '$0';
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function categorizeProgram(program?: string): 'bank' | 'airline' | 'hotel' | 'unknown' {
  if (!program) return 'unknown';
  
  const bankPrograms = ['chase', 'amex', 'citi', 'capitalone', 'bilt'];
  const hotelPrograms = ['marriott', 'hilton', 'hyatt', 'ihg', 'mar', 'hh'];
  
  const lower = program.toLowerCase();
  if (bankPrograms.some(p => lower.includes(p))) return 'bank';
  if (hotelPrograms.some(p => lower.includes(p))) return 'hotel';
  
  // 2-letter codes are likely airlines
  if (program.length === 2 && program === program.toUpperCase()) return 'airline';
  
  return 'airline'; // Default to airline for unknown
}

export default usePoints;
