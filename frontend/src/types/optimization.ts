/**
 * OOP-optimized itinerary types from agentic backend
 */

// =============================================================================
// OOP METRICS
// =============================================================================

export interface OOPMetrics {
  /** Total price if paid entirely in cash */
  totalCashPrice: number;
  
  /** Actual cash you'll pay (surcharges + taxes + any cash segments) */
  totalOutOfPocket: number;
  
  /** Total points being redeemed */
  totalPointsUsed: number;
  
  /** Cash saved: totalCashPrice - totalOutOfPocket */
  cashSaved: number;
  
  /** Savings as percentage: (cashSaved / totalCashPrice) * 100 */
  savingsPercentage: number;
  
  /** Weighted average CPP across all point redemptions */
  averageCPP: number;
  
  /** Points used per program: { "United MileagePlus": 45000, ... } */
  pointsBreakdown: Record<string, number>;
}

// =============================================================================
// PAYMENT TYPES
// =============================================================================

export interface TransferInstruction {
  /** Source program (bank points) */
  fromProgram: string;
  
  /** Target program (airline/hotel) */
  toProgram: string;
  
  /** Points to transfer */
  pointsToTransfer: number;
  
  /** Transfer ratio (e.g., 1.0 = 1:1) */
  ratio: number;
  
  /** Portal URL for transfer */
  portalUrl: string;
  
  /** Estimated transfer time */
  transferTime: string;
  
  /** Step-by-step instructions */
  steps: string[];
  
  /** Any warnings */
  warning?: string;
}

export interface CashPayment {
  method: 'cash';
  amount: number;
  payer?: string;
  reason?: string;
}

export interface PointsPayment {
  method: 'points';
  program: string;
  pointsUsed: number;
  surcharge: number;
  cppAchieved?: number;
  cashSaved?: number;
  transfer?: TransferInstruction;
  payer?: string;
  reason?: string;
}

export type SegmentPayment = CashPayment | PointsPayment;

// =============================================================================
// SEGMENT TYPES
// =============================================================================

export interface FlightSegment {
  id: string;
  type: 'flight';
  
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes?: number;
  
  airline: string;
  flightNumber?: string;
  cabinClass: 'Economy' | 'Premium Economy' | 'Business' | 'First';
  
  cashPrice: number;
  payment: SegmentPayment;
  
  bookingUrl?: string;
}

export interface HotelSegment {
  id: string;
  type: 'hotel';
  
  name: string;
  brand?: string;
  starRating: number;
  city: string;
  
  checkIn: string;
  checkOut: string;
  nights: number;
  
  cashPricePerNight: number;
  cashPriceTotal: number;
  payment: SegmentPayment;
  
  bookingUrl?: string;
}

export type TripSegment = FlightSegment | HotelSegment;

// =============================================================================
// RANKED ITINERARY
// =============================================================================

export interface RankedItinerary {
  id: string;
  rank: number;
  name: string;
  
  route: string[];
  segments: TripSegment[];
  
  oopMetrics: OOPMetrics;
  transfers: TransferInstruction[];
  
  withinBudget: boolean;
  withinPoints: boolean;
  
  summary?: string;
}

// =============================================================================
// GROUP-SPECIFIC
// =============================================================================

export interface GroupMemberCost {
  memberId: string;
  memberName: string;
  baseCost: number;
  pointsContribution: number;
  finalCost: number;
  pointsUsed: number;
  programsUsed: string[];
}

export interface Settlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  reason: string;
}

export interface GroupOOPMetrics extends OOPMetrics {
  memberCosts: GroupMemberCost[];
  settlements: Settlement[];
  perPersonAverage: number;
}

// =============================================================================
// API REQUEST/RESPONSE
// =============================================================================

export interface OptimizeSoloRequest {
  tripId: string;
  points: Record<string, number>;
  budget: number;
  cabinClasses?: string[];
  hotelStars?: number[];
  includeHotels?: boolean;
}

export interface OptimizeGroupRequest extends OptimizeSoloRequest {
  memberPoints: Record<string, Record<string, number>>;
  memberBudgets: Record<string, number>;
  splitMethod?: 'equal' | 'by_usage' | 'proportional';
}

export interface OptimizeSoloResponse {
  tripId: string;
  itineraries: RankedItinerary[];
  bestOption: {
    outOfPocket: number;
    savingsPercentage: number;
    pointsUsed: number;
  };
  warnings: string[];
}

export interface OptimizeGroupResponse {
  tripId: string;
  itineraries: RankedItinerary[];
  groupMetrics?: GroupOOPMetrics;
  bestOption: {
    totalOutOfPocket: number;
    perPersonAverage: number;
    totalSavings: number;
  };
  warnings: string[];
}

// =============================================================================
// COST BREAKDOWN
// =============================================================================

export interface SegmentBreakdown {
  segment: string;
  type: 'flight' | 'hotel';
  cashPrice: number;
  paymentMethod: 'cash' | 'points';
  amount?: number;
  program?: string;
  pointsUsed?: number;
  surcharge?: number;
  cppAchieved?: number;
  reason?: string;
  transfer?: TransferInstruction;
}

export interface CostBreakdown {
  tripSummary: {
    route: string;
    totalCashPrice: number;
    totalOutOfPocket: number;
    totalSavings: number;
    savingsPercentage: number;
  };
  segments: SegmentBreakdown[];
  transferSummary: {
    totalTransfers: number;
    bySource: Record<string, {
      totalTransferred: number;
      destinations: string[];
    }>;
    recommendedOrder: string[];
    timingAdvice: string;
  };
  paymentBreakdown: {
    cashPayments: Array<{ item: string; amount: number }>;
    totalCash: number;
    pointsUsed: Record<string, number>;
    totalPoints: number;
  };
  valueAnalysis: {
    averageCPP: number;
    bestRedemption?: { segment: string; cpp: number; program: string };
    worstRedemption?: { segment: string; cpp: number; program: string; note?: string };
  };
}

// =============================================================================
// DYNAMIC ROUTE OPTIMIZATION (Multi-city)
// =============================================================================

export interface DynamicRouteRequest {
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

export interface DynamicRouteSegment {
  segmentId: string;
  origin: string;
  destination: string;
  cashPrice: number;
  awardAvailable: boolean;
  pointsCost: number;
  pointsProgram?: string;
  pointsProgramName?: string;
  surcharge: number;
  cashSaved: number;
  cpp: number;
  airline?: string;
  flightNumber?: string;
  durationMinutes: number;
  departureTime?: string;
  arrivalTime?: string;
  isDirect: boolean;
  numStops: number;
  dataSource: string;
  bookingLink?: string;
}

export interface DynamicRouteTransferStep {
  stepNumber: number;
  sourceProgram: string;
  sourceProgramName: string;
  targetProgram: string;
  targetProgramName: string;
  pointsToTransfer: number;
  resultingPoints: number;
  transferRatio: string;
  transferTime: string;
  portalUrl: string;
  bookingUrl: string;
  forSegment: string;
  cppValue: number;
  cashSaved: number;
  instructions: string[];
}

export interface DynamicRouteOption {
  routeId: string;
  routeName: string;
  path: string[];
  pathDisplay: string;
  segments: DynamicRouteSegment[];
  totalCashPrice: number;
  totalPoints: number;
  totalSurcharges: number;
  totalCashSaved: number;
  averageCpp: number;
  totalDurationMinutes: number;
  totalDurationHours: number;
  status: 'feasible' | 'exceeds_points' | 'exceeds_cash' | 'no_availability';
  feasible: boolean;
  pointsWithinBudget: boolean;
  pointsBudget: number;
  pointsOverBudget: number;
}

export interface DynamicRouteComparisonMetric {
  metricName: string;
  routeAValue: string | number;
  routeBValue: string | number;
  winner: 'route_a' | 'route_b' | 'tie';
  winnerDisplay: string;
}

export interface DynamicRouteResult {
  success: boolean;
  startCity: string;
  endCity: string;
  intermediateCities: string[];
  pointsBudget: number;
  
  /** All route options evaluated */
  routeOptions: DynamicRouteOption[];
  
  /** Comparison matrix between routes */
  comparisonMatrix: DynamicRouteComparisonMetric[];
  
  /** The recommended route */
  recommendedRoute: DynamicRouteOption | null;
  
  /** Reasons for the recommendation */
  recommendationReasons: string[];
  
  /** Transfer instructions for the recommended route */
  transferSteps: DynamicRouteTransferStep[];
  
  /** Human-readable strategy summary */
  strategySummary: string;
  
  /** Metrics for the recommended route */
  totalPointsUsed: number;
  remainingPoints: number;
  totalCashSaved: number;
  averageCpp: number;
  totalSurcharges: number;
  
  /** Metadata */
  computedAt?: string;
  computationTimeMs: number;
}
