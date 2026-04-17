/**
 * OOP-optimized itinerary types from agentic backend (Flights Only)
 */

// =============================================================================
// OOP METRICS
// =============================================================================

/**
 * Payment action for a single segment (multi-currency tracking).
 */
export interface PaymentAction {
  segmentId: string;
  segmentDescription: string;  // e.g., "SEA → CDG"
  paymentMethod: 'cash' | 'points';
  
  // For cash payment
  cashAmount?: number;
  
  // For points payment
  pointsProgram?: string;       // Target program (e.g., "flying_blue")
  pointsAmount?: number;
  surcharge?: number;
  sourceCurrency?: string;      // Bank currency used (e.g., "amex", "chase")
  transferRatio?: number;
  cppAchieved?: number;
}

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
  
  /** Points used per target program: { "flying_blue": 30000, "united": 25000 } */
  pointsBreakdown: Record<string, number>;
  
  /** 
   * MULTI-CURRENCY: Points spent from each bank currency.
   * Shows which credit card programs contributed to the optimization.
   * Example: { "amex": 30000, "chase": 25000 }
   */
  bankCurrenciesUsed?: Record<string, number>;
  
  /**
   * MULTI-CURRENCY: Detailed payment actions per segment.
   * Shows exactly which currency funded each segment.
   */
  paymentActions?: PaymentAction[];
}

// =============================================================================
// PAYMENT TYPES
// =============================================================================

export interface TransferInstruction {
  /** Source program (bank points) */
  fromProgram: string;
  
  /** Target program (airline) */
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

/**
 * A single leg within a multi-segment flight.
 * CRITICAL: This enables displaying "SEA → AMS → CDG" instead of just "SEA → CDG"
 */
export interface FlightLeg {
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes?: number;
  
  flightNumber: string;
  marketingCarrier: string;       // Who sells the ticket (e.g., "DL")
  operatingCarrier?: string;      // Who flies the plane (e.g., "KL" for codeshare)
  
  cabinClass?: string;
  aircraft?: string;
  
  // Codeshare display
  isCodeshare?: boolean;
  codeshareInfo?: string;         // e.g., "Operated by KLM"
}

/**
 * Layover between flight legs.
 */
export interface FlightLayover {
  airport: string;
  airportName?: string;
  durationMinutes: number;
  durationDisplay?: string;       // e.g., "2h 15m"
  isShort?: boolean;              // Under 60 min (risky)
  isLong?: boolean;               // Over 4 hours
}

export interface FlightSegment {
  id: string;
  type: 'flight';
  
  // Overall journey info (first origin → final destination)
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes?: number;
  
  // Primary airline (marketing carrier of first leg)
  airline: string;
  flightNumber?: string;          // Summary: "DL 2055" or "DL 2055 → SK 944"
  cabinClass: 'Economy' | 'Premium Economy' | 'Business' | 'First';
  operatingAirline?: string;      // If first leg is codeshare
  
  // CRITICAL: Connection details - enables proper UI display
  stops: number;                  // Number of stops (0 = nonstop)
  legs: FlightLeg[];              // Per-leg details for connecting flights
  layovers: FlightLayover[];      // Layover info between legs
  
  // Connection safety flags
  ticketingConfirmed?: boolean;   // True if single-ticket confirmed
  hasCarrierChange?: boolean;     // True if operating carriers differ between legs
  hasShortConnection?: boolean;   // True if any layover < 60 min
  
  cashPrice: number;
  payment: SegmentPayment;
  
  bookingUrl?: string;
  
  // Verification info
  googleFlightsUrl?: string;
  verificationNote?: string;
  dataSource?: string;
  fetchedAt?: string;
  isVerified?: boolean;
  verificationStatus?: 'verified' | 'unverified' | 'stale' | 'not_found';
}

export type TripSegment = FlightSegment;

// =============================================================================
// POINTS STRATEGY (consolidated transfer + booking plan)
// =============================================================================

/** A single source contributing points to an airline program */
export interface PointsSource {
  /** Source program key (e.g., "amex" or "DL") */
  source_program: string;
  /** Human-friendly name (e.g., "Amex Membership Rewards") */
  source_program_display: string;
  /** Points to transfer/use from this source */
  points_from_source: number;
  /** Transfer ratio (1.0 = 1:1) */
  transfer_ratio: number;
  /** Points received in the airline program after ratio */
  resulting_points: number;
  /** True if transfer is needed, false if using direct balance */
  is_transfer: boolean;
  /** Transfer time estimate */
  transfer_time: string;
  /** Portal URL to initiate transfer */
  portal_url: string;
}

/** Strategy for a single airline program, showing how to assemble points */
export interface AirlineProgramStrategy {
  /** Airline program code (e.g., "DL", "UA") */
  airline_program: string;
  /** Display name (e.g., "Delta SkyMiles") */
  airline_program_display: string;
  /** Total points needed for booking(s) */
  points_needed: number;
  /** All sources contributing to this program (direct balance + transfers) */
  sources: PointsSource[];
  /** Sum of resulting_points from all sources */
  total_points_available: number;
  /** Surplus: total_points_available - points_needed */
  surplus_points: number;
  /** Flight descriptions covered by this program */
  covers_flights: string[];
  /** Booking URL for this program */
  booking_url: string;
}

/** Complete points strategy for an itinerary */
export interface PointsStrategy {
  /** Per-airline-program breakdown with additive sources */
  programs: AirlineProgramStrategy[];
  /** Number of transfer operations needed */
  total_transfers_needed: number;
  /** Total bank points being moved */
  total_points_transferred: number;
  /** Total airline points redeemed */
  total_airline_points_used: number;
  /** Total surcharges/taxes */
  total_surcharges: number;
  /** Plain-English action steps */
  action_summary: string[];
}

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

  /** Consolidated points strategy with additive balances and transfer instructions */
  pointsStrategy?: PointsStrategy | null;

  withinBudget: boolean;
  withinPoints: boolean;

  summary?: string;

  /** Warning message when itinerary exceeds user's budget */
  budgetWarning?: string;
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
  /** 
   * MULTI-CURRENCY: Points balances by program.
   * Can include multiple bank currencies (chase_ur, amex_mr) and direct airline miles (UA, DL).
   * Example: { "chase_ur": 100000, "amex_mr": 75000, "UA": 25000 }
   */
  points: Record<string, number>;
  budget: number;
  cabinClasses?: string[];
  
  // Currency control settings (optional)
  /** If set, only use these currencies in optimization */
  allowedCurrencies?: string[];
  /** Per-currency maximum points to use */
  maxPointsByCurrency?: Record<string, number>;
  /** Maximum cash out-of-pocket (overrides budget) */
  maxCashBudget?: number;
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

/**
 * Budget overrun information for group optimization.
 * Populated when solution exceeds budget (relaxed mode).
 */
export interface BudgetOverrun {
  /** Amount by which group total budget is exceeded */
  group_overrun_usd: number;
  /** Per-member budget overruns (member_id -> overrun amount) */
  member_overrun_usd: Record<string, number>;
  /** Maximum overrun among all members */
  max_member_overrun_usd: number;
  /** Sum of all positive overruns */
  total_overrun_usd: number;
}

/**
 * Solve metadata for group optimization.
 */
export interface SolveMeta {
  /** Status of the optimization */
  status: 'optimal_strict' | 'optimal_relaxed' | 'infeasible_no_options' | 'error';
  /** Whether budget constraints were relaxed */
  is_relaxed: boolean;
  /** Solver used */
  solver: string;
  /** Time limit in seconds */
  time_limit_s: number;
  /** Actual solve time in milliseconds */
  solve_time_ms: number;
  /** Final objective value */
  objective_value: number | null;
  /** Reason why strict solve was infeasible */
  strict_infeasible_reason: string | null;
  /** Summary of relaxation */
  relaxation_summary: Record<string, unknown>;
}

export interface OptimizeGroupResponse {
  tripId: string;
  itineraries: RankedItinerary[];
  groupMetrics?: GroupOOPMetrics;
  bestOption: {
    totalOutOfPocket: number;
    perPersonAverage: number;
    totalSavings: number;
    /** Whether solution is within budget */
    withinBudget?: boolean;
    /** Suggested budget if over budget */
    suggestedBudget?: number;
    /** User's original budget */
    userBudget?: number;
  };
  warnings: string[];
  
  // New contract fields for two-phase solve
  /** Solve metadata (status, timing, etc.) */
  meta?: SolveMeta;
  /** Budget overrun information */
  budget_overrun?: BudgetOverrun;
  /** Results array (new format) */
  results?: Array<{
    id: string;
    name: string;
    total_oop: number;
    total_cash_price: number;
    total_savings: number;
    savings_percentage: number;
    total_points_used: number;
    within_budget: boolean;
    overrun?: BudgetOverrun;
    allocations?: unknown[];
    transfers?: unknown[];
    settlements?: unknown[];
  }>;
}

// =============================================================================
// COST BREAKDOWN
// =============================================================================

export interface SegmentBreakdown {
  segment: string;
  type: 'flight';
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
