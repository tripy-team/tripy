/**
 * Group Booking Allocation Types
 * 
 * CRITICAL: Points are per-member, NOT pooled!
 * Each member uses their OWN points for segments they book.
 */

// =============================================================================
// MEMBER TYPES
// =============================================================================

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
  pointsUsed?: number;
  cashAmount: number;
  
  /** Display info */
  segmentSummary?: string;
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
  
  /** All segment assignments */
  assignments: BookingAssignment[];
  
  /** Per-member summaries */
  memberSummaries: MemberBookingSummary[];
  
  /** Money transfers needed */
  settlements: GroupSettlement[];
  
  /** Overall metrics */
  metrics: {
    totalGroupOOP: number;
    totalPointsUsed: number;
    perPersonEffectiveCost: number;
  };
  
  /** Validation status */
  validation: {
    allSegmentsAssigned: boolean;
    allMembersWithinBudget: boolean;
    allMembersWithinPoints: boolean;
  };
}

// =============================================================================
// API REQUEST/RESPONSE
// =============================================================================

export interface GroupAllocationRequest {
  tripId: string;
  members: MemberBookingCapability[];
  strategy: BookingAllocationStrategy;
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
