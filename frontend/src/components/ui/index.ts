/**
 * UI components index file.
 * Export all reusable UI components from here.
 */

// Savings and points components
export { 
  SavingsBreakdown, 
  SavingsCompact,
} from './SavingsBreakdown';

export { 
  PointsUsageChart, 
  PointsUsageCompact,
} from './PointsUsageChart';

export { 
  TransferInstructions, 
  TransferSummaryCompact,
} from './TransferInstructions';

export {
  TransferStrategy,
  TransferStrategySummary,
  type TransferStrategySolution,
  type TransferPlanItem,
  type PaymentPlanItem,
} from './TransferStrategy';

export {
  TransferStrategyCard,
  type TransferItem,
} from './TransferStrategyCard';

// Loading states
export {
  ItineraryLoadingState,
  ItineraryCardSkeleton,
  ItineraryListSkeleton,
} from './ItineraryLoadingState';

export { TripGenerationLoader } from './TripGenerationLoader';

// OOP Optimization components
export { OOPSummaryCard } from './OOPSummaryCard';
export { SegmentBreakdown } from './SegmentBreakdown';
export { PointsStrategyCard, PointsStrategySummary } from './PointsStrategy';

// Solo Booking components
export { ValueInsightCard } from './ValueInsightCard';
export { PointsValueExplainer } from './PointsValueExplainer';
export { CostBreakdownCard } from './CostBreakdownCard';
export { BookingGuide } from './BookingGuide';
export { ServiceFeePayment } from './ServiceFeePayment';
export { StrategyComparisonCard } from './StrategyComparisonCard';
export { ErrorState } from './ErrorState';

// Date picker components
export { default as SingleDatePicker } from './SingleDatePicker';
