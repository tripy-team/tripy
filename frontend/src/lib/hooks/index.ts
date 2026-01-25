/**
 * Custom hooks for data fetching and state management.
 */

export { useTrip, type UseTripResult } from './useTrip';
export { 
  useItinerary, 
  type UseItineraryResult,
  type ItineraryResponse,
  type ItinerarySolution,
  type PathCity,
  type TransportSegment,
  type CostBreakdown,
  type SavingsBreakdown,
  type PointsUsageBreakdown,
  type TransferInstruction,
  type Warning,
  type Suggestion,
  type OutOfPocketData,
  type OutOfPocketHotelsData,
} from './useItinerary';
export { 
  usePoints, 
  type UsePointsResult,
  type PointsSummaryResponse,
  type EnrichedPointsItem,
  type TransferRecommendation,
} from './usePoints';
export {
  useTransferStrategy,
  type UseTransferStrategyResult,
  type TransferStrategySolution,
  type TransferPlanItem,
  type PaymentPlanItem,
  type Expense,
  type PointsOption,
  type TransferPartner,
  type TransferPartnersResponse,
  type OptimizeParams,
} from './useTransferStrategy';
export { useOOPOptimization } from './useOOPOptimization';
export { 
  useGroupAllocation,
  useMemberUpfrontCost,
  useMemberPointsUsed,
  useMemberSettlements,
} from './useGroupAllocation';
export { useDynamicRoute } from './useDynamicRoute';

// Re-export dynamic route types from the main types file for convenience
export type {
  DynamicRouteRequest,
  DynamicRouteResult,
  DynamicRouteOption,
  DynamicRouteSegment,
  DynamicRouteTransferStep,
  DynamicRouteComparisonMetric,
} from '@/types/optimization';
