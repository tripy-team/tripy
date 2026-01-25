/**
 * UI components index file.
 * Export all reusable UI components from here.
 */

// Transport components
export { 
  TransportSegmentCard, 
  TransportSegmentCompact,
  default as TransportSegment,
} from './TransportSegment';

export { 
  TransportPreferenceSelector,
  default as TransportPreference,
} from './TransportPreferenceSelector';

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

// Loading states
export {
  ItineraryLoadingState,
  ItineraryCardSkeleton,
  ItineraryListSkeleton,
} from './ItineraryLoadingState';
