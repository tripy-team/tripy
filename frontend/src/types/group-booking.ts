/**
 * Group Booking Allocation Types
 * 
 * CRITICAL: Points are per-member, NOT pooled!
 * Each member uses their OWN points for segments they book.
 */

// =============================================================================
// MEMBER TYPES
// =============================================================================

export type SettlementSplitMethod = 
  | 'equal'
  | 'proportional_travelers'
  | 'proportional_points'
  | 'custom';

export interface MemberBookingCapability {
  /** Unique member identifier */
  memberId: string;
  
  /** Display name */
  memberName: string;
  
  /** THIS member's points balances (not pooled with others!) */
  points: Record<string, number>;
  
  /** Optional maximum cash budget for this member */
  maxCashBudget?: number;
  
  /** Credit cards this member has */
  creditCards?: string[];
  
  /** How many travelers this member is booking for (for proportional split) */
  travelerCount?: number;
  
  /** Custom split percentage (for custom settlement method) */
  customSplitPercentage?: number;
}

// =============================================================================
// ALLOCATION STRATEGY
// =============================================================================

export type AllocationStrategyType = 
  | 'optimize'        // System finds best assignment based on points
  | 'by_segment_type' // One person books flights, another hotels
  | 'by_direction'    // One books outbound, another return
  | 'manual';         // User specifies each assignment

export interface BookingAllocationStrategy {
  strategyType: AllocationStrategyType;
  
  /** For by_segment_type: who books flights */
  flightBooker?: string;
  
  /** For by_segment_type: who books hotels */
  hotelBooker?: string;
  
  /** For by_direction: who books outbound */
  outboundBooker?: string;
  
  /** For by_direction: who books return */
  returnBooker?: string;
  
  /** For manual: segment_id -> member_id */
  manualAssignments?: Record<string, string>;
}

// =============================================================================
// BOOKING ASSIGNMENT
// =============================================================================

export interface BookingAssignment {
  /** Segment being assigned */
  segmentId: string;
  segmentType: 'flight' | 'hotel';
  
  /** Who books this segment */
  assignedTo: string;
  assignedToName: string;
  
  /** Why this assignment was made */
  reason: string;
  
  /** Payment details (from THIS member's resources) */
  usesPoints: boolean;
  pointsProgram?: string;
  pointsProgramName?: string;
  pointsUsed?: number;
  cashAmount: number;
  
  /** Display info */
  segmentSummary?: string;
  
  /** === NEW: Transfer details (if points come from bank transfer) === */
  requiresTransfer?: boolean;
  transferFrom?: string;           // Source bank: "Chase UR"
  transferFromName?: string;       // "Chase Ultimate Rewards"
  transferPointsFromSource?: number; // Bank points to transfer
  transferRatio?: number;          // 1.0 or 2.0
  transferRatioDisplay?: string;   // "1:1" or "1:2"
  transferTime?: string;           // "Instant", "1-2 days"
  transferPortalUrl?: string;      // URL to make transfer
  bookingUrl?: string;             // URL to book after transfer
}

// =============================================================================
// TRANSFER INFO (consolidated transfer instruction)
// =============================================================================

export interface TransferInfo {
  /** Member who needs to make this transfer */
  memberId: string;
  memberName: string;
  
  /** Source bank */
  fromProgram: string;           // "Chase UR"
  fromProgramName: string;       // "Chase Ultimate Rewards"
  
  /** Target program */
  toProgram: string;             // "UA"
  toProgramName: string;         // "United MileagePlus"
  toProgramType: 'airline' | 'hotel';
  
  /** Transfer details */
  totalSourcePoints: number;     // Total bank points to transfer
  totalTargetPoints: number;     // Total points received
  ratio: number;
  ratioDisplay: string;          // "1:1"
  transferTime: string;          // "Instant"
  
  /** URLs for action */
  portalUrl: string;
  bookingUrl: string;
  
  /** Step-by-step instructions */
  steps: string[];
  
  /** Which segments this transfer covers */
  coversSegments: string[];
}

// =============================================================================
// SETTLEMENT
// =============================================================================

export interface GroupSettlement {
  /** Who owes money */
  fromMember: string;
  fromName: string;
  
  /** Who is owed money */
  toMember: string;
  toName: string;
  
  /** Amount to transfer */
  amount: number;
  
  /** Reason for settlement */
  reason: string;
}

// =============================================================================
// MEMBER SUMMARY
// =============================================================================

export interface MemberBookingSummary {
  memberId: string;
  memberName: string;
  
  /** Segments this member books */
  segmentsToBook: string[];
  segmentCount: number;
  
  /** What they pay upfront (before settlement) */
  totalCashUpfront: number;
  totalPointsUsed: number;
  programsUsed: string[];
  
  /** After settlement */
  fairShare: number;
  settlementAmount: number; // Positive = they owe, Negative = they're owed
  finalCost: number;
}

// =============================================================================
// GROUP BOOKING PLAN
// =============================================================================

export interface GroupBookingPlan {
  tripId: string;
  strategyUsed: string;
  splitMethodUsed: string;
  
  /** All segment assignments */
  assignments: BookingAssignment[];
  
  /** === NEW: Consolidated transfer instructions === */
  transfersNeeded: TransferInfo[];
  
  /** Per-member summaries */
  memberSummaries: MemberBookingSummary[];
  
  /** Money transfers needed (settlements between members) */
  settlements: GroupSettlement[];
  
  /** Overall metrics */
  metrics: {
    totalGroupOOP: number;
    totalPointsUsed: number;
    perPersonEffectiveCost: number;
    totalTransfersNeeded?: number;       // NEW
    totalSourcePointsTransferred?: number; // NEW
  };
  
  /** Validation status */
  validation: {
    allSegmentsAssigned: boolean;
    allMembersWithinBudget: boolean;
    allMembersWithinPoints: boolean;
  };
  
  /** Warnings from validation */
  warnings: string[];
}

// =============================================================================
// API REQUEST/RESPONSE
// =============================================================================

export interface GroupAllocationRequest {
  tripId: string;
  members: MemberBookingCapability[];
  strategy: BookingAllocationStrategy;
  splitMethod?: SettlementSplitMethod;
  cabinClasses?: string[];
  hotelStars?: number[];
  includeHotels?: boolean;
}

export type GroupAllocationResponse = GroupBookingPlan;

// =============================================================================
// HELPER TYPE GUARDS
// =============================================================================

export function isPointsPayment(assignment: BookingAssignment): boolean {
  return assignment.usesPoints && !!assignment.pointsProgram;
}

export function getMemberById(
  members: MemberBookingCapability[],
  memberId: string
): MemberBookingCapability | undefined {
  return members.find(m => m.memberId === memberId);
}

export function getMemberSummaryById(
  summaries: MemberBookingSummary[],
  memberId: string
): MemberBookingSummary | undefined {
  return summaries.find(s => s.memberId === memberId);
}
