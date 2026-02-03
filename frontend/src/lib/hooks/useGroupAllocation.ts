/**
 * Hook for group booking allocation
 * 
 * CRITICAL: Points are per-member, NOT pooled!
 * Each member uses their OWN points for segments they book.
 */

import { useState, useCallback, useRef } from 'react';
import type {
  MemberBookingCapability,
  BookingAllocationStrategy,
  GroupBookingPlan,
  GroupAllocationRequest,
  SettlementSplitMethod,
} from '@/types/group-booking';

interface UseGroupAllocationOptions {
  tripId: string;
  onSuccess?: (plan: GroupBookingPlan) => void;
  onError?: (error: string) => void;
}

interface UseGroupAllocationReturn {
  /** Current booking plan */
  plan: GroupBookingPlan | null;
  
  /** Loading state */
  loading: boolean;
  
  /** Error message */
  error: string | null;
  
  /** Run allocation */
  allocate: (
    members: MemberBookingCapability[],
    strategy: BookingAllocationStrategy,
    options?: {
      cabinClasses?: string[];
      splitMethod?: SettlementSplitMethod;
    }
  ) => Promise<GroupBookingPlan | null>;
  
  /** Reset state */
  reset: () => void;
  
  /** Retry count */
  retryCount: number;
  
  /** Can retry */
  canRetry: boolean;
  
  /** Retry the last allocation */
  retry: () => Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export function useGroupAllocation(
  options: UseGroupAllocationOptions
): UseGroupAllocationReturn {
  const { tripId, onSuccess, onError } = options;
  
  const [plan, setPlan] = useState<GroupBookingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Store last request for retry
  const lastRequestRef = useRef<{
    members: MemberBookingCapability[];
    strategy: BookingAllocationStrategy;
    options?: {
      cabinClasses?: string[];
      splitMethod?: SettlementSplitMethod;
    };
  } | null>(null);
  
  const allocate = useCallback(async (
    members: MemberBookingCapability[],
    strategy: BookingAllocationStrategy,
    requestOptions?: {
      cabinClasses?: string[];
      splitMethod?: SettlementSplitMethod;
    }
  ): Promise<GroupBookingPlan | null> => {
    // Store for retry
    lastRequestRef.current = { members, strategy, options: requestOptions };
    
    setLoading(true);
    setError(null);
    
    try {
      const request: GroupAllocationRequest = {
        tripId,
        members,
        strategy,
        splitMethod: requestOptions?.splitMethod,
        cabinClasses: requestOptions?.cabinClasses,
      };
      
      const response = await fetch('/api/optimize/group/allocate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Allocation failed: ${response.status}`);
      }
      
      const data: GroupBookingPlan = await response.json();
      
      setPlan(data);
      setRetryCount(0);
      onSuccess?.(data);
      
      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
      onError?.(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [tripId, onSuccess, onError]);
  
  const retry = useCallback(async () => {
    if (retryCount >= MAX_RETRIES || !lastRequestRef.current) {
      return;
    }
    
    setRetryCount(prev => prev + 1);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    
    const { members, strategy, options: reqOpts } = lastRequestRef.current;
    await allocate(members, strategy, reqOpts);
  }, [allocate, retryCount]);
  
  const reset = useCallback(() => {
    setPlan(null);
    setLoading(false);
    setError(null);
    setRetryCount(0);
    lastRequestRef.current = null;
  }, []);
  
  return {
    plan,
    loading,
    error,
    allocate,
    reset,
    retryCount,
    canRetry: retryCount < MAX_RETRIES && !!lastRequestRef.current,
    retry,
  };
}

// =============================================================================
// HELPER HOOKS
// =============================================================================

/**
 * Get total cash a member will pay upfront
 */
export function useMemberUpfrontCost(
  plan: GroupBookingPlan | null,
  memberId: string
): number {
  if (!plan) return 0;
  
  return plan.assignments
    .filter(a => a.assignedTo === memberId)
    .reduce((sum, a) => sum + a.cashAmount, 0);
}

/**
 * Get total points a member will use
 */
export function useMemberPointsUsed(
  plan: GroupBookingPlan | null,
  memberId: string
): Record<string, number> {
  if (!plan) return {};
  
  const pointsByProgram: Record<string, number> = {};
  
  for (const assignment of plan.assignments) {
    if (assignment.assignedTo === memberId && assignment.usesPoints && assignment.pointsProgram) {
      pointsByProgram[assignment.pointsProgram] = 
        (pointsByProgram[assignment.pointsProgram] || 0) + (assignment.pointsUsed || 0);
    }
  }
  
  return pointsByProgram;
}

/**
 * Get settlements involving a specific member
 */
export function useMemberSettlements(
  plan: GroupBookingPlan | null,
  memberId: string
): {
  owes: Array<{ toName: string; amount: number }>;
  owed: Array<{ fromName: string; amount: number }>;
} {
  if (!plan) return { owes: [], owed: [] };
  
  const owes = plan.settlements
    .filter(s => s.fromMember === memberId)
    .map(s => ({ toName: s.toName, amount: s.amount }));
  
  const owed = plan.settlements
    .filter(s => s.toMember === memberId)
    .map(s => ({ fromName: s.fromName, amount: s.amount }));
  
  return { owes, owed };
}
