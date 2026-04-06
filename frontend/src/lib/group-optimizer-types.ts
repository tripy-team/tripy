// ---------------------------------------------------------------------------
// Group Travel Optimizer — Shared Types
// ---------------------------------------------------------------------------

export interface GroupTraveler {
  id: string;
  clientId: string;
  name: string;
  balances: GroupTravelerBalance[];
  cashBudget?: number;
}

export interface GroupTravelerBalance {
  programId: string;
  programCode: string;
  programName: string;
  category: string; // "airline" | "hotel" | "transferable_bank"
  balance: number;
  pointValueCents: number;
}

export interface GroupSegment {
  id: string;
  travelerId: string;
  segmentType: "flight" | "hotel";
  label: string;
  bestCashPrice: number;
  awardOptions: GroupAwardOption[];
}

export interface GroupAwardOption {
  program: string;
  programName: string;
  pointsRequired: number;
  taxes: number;
  seatsRemaining?: number;
}

export interface TransferRule {
  fromProgramId: string;
  fromProgramCode: string;
  toProgramId: string;
  toProgramCode: string;
  ratio: number; // numerator/denominator — points received per point sent
  isIrreversible: boolean;
  estimatedTransferTimeHours?: number;
}

export interface ActiveBonus {
  fromProgramId: string;
  toProgramId: string;
  bonusPercent: number;
}

export interface PoolingRule {
  programId: string;
  programCode: string;
  scope: "none" | "household_only" | "authorized_user_like" | "book_for_others" | "unrestricted";
}

export interface GroupOptimizerInput {
  travelers: GroupTraveler[];
  segments: GroupSegment[];
  transferRules: TransferRule[];
  activeBonuses: ActiveBonus[];
  poolingRules: PoolingRule[];
  pointValuations: Record<string, number>; // programCode → cents per point
  householdClientIds: string[];
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface SegmentAssignment {
  segmentId: string;
  segmentLabel: string;
  travelerId: string;
  travelerName: string;
  paymentType: "cash" | "points" | "mixed";
  cashAmount: number;
  pointsUsed: number;
  pointsProgram: string | null;
  pointsProgramName: string | null;
  pointsOwnerId: string;
  pointsOwnerName: string;
  transferFrom?: string;
  transferFromName?: string;
  transferPointsNeeded?: number;
  transferRatio?: number;
  cppAchieved: number;
}

export interface GroupAllocation {
  assignments: SegmentAssignment[];
  totalCashCost: number;
  totalCashBaseline: number;
  totalPointsValueCents: number;
  cashSavedVsAllCash: number;
  savingsPercent: number;
}

// ---------------------------------------------------------------------------
// Settlement Types
// ---------------------------------------------------------------------------

export type SplitMethod = "equal" | "proportional_to_cost" | "custom";

export interface SettlementInput {
  assignments: SegmentAssignment[];
  travelers: GroupTraveler[];
  splitMethod: SplitMethod;
  customSplits?: Record<string, number>;
  pointValuations: Record<string, number>;
  waivedTravelerIds?: string[];
}

export interface TravelerContribution {
  travelerId: string;
  travelerName: string;
  cashPaid: number;
  pointsContributed: PointContributionItem[];
  totalContributionCents: number;
}

export interface PointContributionItem {
  program: string;
  programName: string;
  points: number;
  valueCents: number;
  usedForTravelerId: string;
  usedForTravelerName: string;
  usedForSegmentId: string;
  usedForSegmentLabel: string;
}

export interface TravelerFairShare {
  travelerId: string;
  travelerName: string;
  fairShareCents: number;
  segmentBreakdown: { segmentId: string; segmentLabel: string; cashEquivalent: number }[];
}

export interface SettlementTransfer {
  fromTravelerId: string;
  fromName: string;
  toTravelerId: string;
  toName: string;
  amountCents: number;
  reason: string;
  breakdown: string[];
}

export interface SettlementResult {
  contributions: TravelerContribution[];
  fairShares: TravelerFairShare[];
  transfers: SettlementTransfer[];
  memo: string;
}
