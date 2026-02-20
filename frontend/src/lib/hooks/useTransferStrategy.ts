/**
 * useTransferStrategy - Hook for optimizing point transfer strategy.
 * Calls the backend to minimize out-of-pocket costs across flights and hotels.
 */
'use client';

import { useState, useCallback } from 'react';

// Keep NEXT_PUBLIC_API_URL as a legacy fallback, but standardize on NEXT_PUBLIC_BACKEND_URL.
const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000';

// Types
export interface PointsOption {
  program_code: string;
  program_type?: 'airline' | 'hotel';
  points_required: number;
  surcharge: number;
}

export interface Expense {
  type: 'flight' | 'hotel';
  description: string;
  cash_cost: number;
  points_options: PointsOption[];
}

export interface TransferPlanItem {
  from_program: string;
  from_program_name: string;
  to_program: string;
  to_program_name: string;
  points_to_transfer: number;
  transfer_ratio: string;
  resulting_points: number;
  transfer_time: string;
  portal_url: string;
  booking_url: string;
  for_items: string[];
  steps: string[];
}

export interface PaymentPlanItem {
  item_id: string;
  item_type: 'flight' | 'hotel';
  description: string;
  payment_type: 'cash' | 'points';
  cash_paid: number;
  points_used?: number;
  program_used?: string;
  program_name?: string;
}

export interface TransferStrategySolution {
  status: string;
  total_out_of_pocket: number;
  total_points_used: number;
  all_cash_cost: number;
  savings: number;
  savings_percentage: number;
  points_breakdown: Record<string, number>;
  points_remaining: Record<string, number>;
  payment_plan: PaymentPlanItem[];
  transfer_plan: TransferPlanItem[];
  summary?: {
    total_out_of_pocket: string;
    all_cash_would_cost: string;
    you_save: string;
    savings_percentage: string;
    total_points_used: string;
  };
  booking_order?: Array<{
    step: number;
    type: 'transfer' | 'booking';
    action: string;
    url?: string;
    item_type?: string;
  }>;
}

export interface TransferPartner {
  code: string;
  name: string;
  type: 'airline' | 'hotel';
  ratio: number;
}

export interface TransferPartnersResponse {
  bank?: string;
  bank_name?: string;
  partners?: TransferPartner[];
  transfer_graph?: Record<string, {
    bank_name: string;
    portal_url: string;
    partners: TransferPartner[];
  }>;
}

export interface UseTransferStrategyResult {
  // State
  solution: TransferStrategySolution | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  optimizeStrategy: (params: OptimizeParams) => Promise<TransferStrategySolution | null>;
  simulateStrategy: (expenses: Expense[], availablePoints: Record<string, number>) => Promise<TransferStrategySolution | null>;
  getTransferPartners: (bank?: string, programType?: 'airline' | 'hotel') => Promise<TransferPartnersResponse | null>;
  clearError: () => void;
  reset: () => void;
}

export interface OptimizeParams {
  tripId?: string;
  flights?: Array<{
    origin?: string;
    destination?: string;
    cash_cost: number;
    points_options?: PointsOption[];
    [key: string]: unknown;
  }>;
  availablePoints: Record<string, number>;
  maxCashBudget?: number;
  minPointsUsagePct?: number;
}

export function useTransferStrategy(): UseTransferStrategyResult {
  const [solution, setSolution] = useState<TransferStrategySolution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthToken = useCallback(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('accessToken');
    }
    return null;
  }, []);

  const optimizeStrategy = useCallback(async (params: OptimizeParams): Promise<TransferStrategySolution | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(`${API_BASE}/api/transfer-strategy/optimize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          trip_id: params.tripId,
          flights: params.flights,
          available_points: params.availablePoints,
          max_cash_budget: params.maxCashBudget,
          min_points_usage_pct: params.minPointsUsagePct ?? 0,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setSolution(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to optimize strategy';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [getAuthToken]);

  const simulateStrategy = useCallback(async (
    expenses: Expense[],
    availablePoints: Record<string, number>
  ): Promise<TransferStrategySolution | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/api/transfer-strategy/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          available_points: availablePoints,
          expenses,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setSolution(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to simulate strategy';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getTransferPartners = useCallback(async (
    bank?: string,
    programType?: 'airline' | 'hotel'
  ): Promise<TransferPartnersResponse | null> => {
    try {
      const params = new URLSearchParams();
      if (bank) params.set('program', bank);
      if (programType) params.set('program_type', programType);
      
      const url = `${API_BASE}/api/transfer-partners${params.toString() ? `?${params.toString()}` : ''}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get transfer partners';
      setError(message);
      return null;
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setSolution(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    solution,
    isLoading,
    error,
    optimizeStrategy,
    simulateStrategy,
    getTransferPartners,
    clearError,
    reset,
  };
}

export default useTransferStrategy;
