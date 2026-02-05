/**
 * Group Optimization Contracts
 *
 * TypeScript interfaces mirroring backend Pydantic models for group optimization.
 * These types define the canonical response schema for group optimization endpoints.
 */

/**
 * Status of the optimization solve.
 */
export enum OptimizationStatus {
  OPTIMAL_STRICT = "optimal_strict",
  OPTIMAL_RELAXED = "optimal_relaxed",
  INFEASIBLE_NO_OPTIONS = "infeasible_no_options",
  ERROR = "error",
}

/**
 * Budget overrun information for group optimization.
 */
export interface BudgetOverrun {
  /** Amount by which group total budget is exceeded */
  group_overrun_usd: number;
  /** Per-member budget overruns (member_id -> overrun amount) */
  member_overrun_usd: Record<string, number>;
  /** Maximum overrun among all members */
  max_member_overrun_usd: number;
  /** Sum of all positive overruns (group + members) */
  total_overrun_usd: number;
}

/**
 * Metadata about the optimization solve.
 */
export interface SolveMeta {
  /** Status of the optimization */
  status: OptimizationStatus;
  /** Whether budget constraints were relaxed */
  is_relaxed: boolean;
  /** Solver used (e.g., 'CBC', 'GLPK') */
  solver: string;
  /** Solver time limit in seconds */
  time_limit_s: number;
  /** Actual solve time in milliseconds */
  solve_time_ms: number;
  /** Final objective value if solved */
  objective_value: number | null;
  /** Reason why strict solve was infeasible */
  strict_infeasible_reason: string | null;
  /** Summary of relaxation (weights used, slack values, etc.) */
  relaxation_summary: Record<string, unknown>;
}

/**
 * Result for a single itinerary in the optimization.
 * This preserves the existing shape from the legacy response.
 */
export interface ItineraryResult {
  id?: string;
  rank?: number;
  name?: string;
  route?: string[];
  segments?: unknown[];
  oopMetrics?: {
    totalCashPrice?: number;
    totalOutOfPocket?: number;
    totalPointsUsed?: number;
    cashSaved?: number;
    savingsPercentage?: number;
    averageCPP?: number;
    pointsBreakdown?: Record<string, number>;
  };
  transfers?: unknown[];
  withinBudget?: boolean;
  withinPoints?: boolean;
  summary?: string;
  // Legacy fields that may also exist
  [key: string]: unknown;
}

/**
 * Canonical response for group optimization endpoints.
 *
 * This wraps the existing results format with additional metadata
 * for status, budget overruns, and solve information.
 */
export interface GroupOptimizationResult {
  /** Metadata about the solve (status, timing, etc.) */
  meta: SolveMeta;
  /** Budget overrun information */
  budget_overrun: BudgetOverrun;
  /** List of optimization results/itineraries */
  results: ItineraryResult[];
  /** Warning messages for the user */
  warnings: string[];
  /** Legacy status field (maps from meta.status) */
  status?: string;
  /** Legacy message field */
  message?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the result represents a solution within budget.
 */
export function isWithinBudget(result: GroupOptimizationResult): boolean {
  return result.meta.status === OptimizationStatus.OPTIMAL_STRICT;
}

/**
 * Check if the result represents a solution that exceeds budget.
 */
export function isOverBudget(result: GroupOptimizationResult): boolean {
  return result.meta.status === OptimizationStatus.OPTIMAL_RELAXED;
}

/**
 * Check if any results were found.
 */
export function hasResults(result: GroupOptimizationResult): boolean {
  return result.results.length > 0;
}

/**
 * Check if the optimization found no feasible solution.
 */
export function isInfeasible(result: GroupOptimizationResult): boolean {
  return result.meta.status === OptimizationStatus.INFEASIBLE_NO_OPTIONS;
}

/**
 * Check if there was an error during optimization.
 */
export function isError(result: GroupOptimizationResult): boolean {
  return result.meta.status === OptimizationStatus.ERROR;
}

/**
 * Get a user-friendly status message.
 */
export function getStatusMessage(result: GroupOptimizationResult): string {
  switch (result.meta.status) {
    case OptimizationStatus.OPTIMAL_STRICT:
      return "Found optimal solution within budget";
    case OptimizationStatus.OPTIMAL_RELAXED:
      const overrun = result.budget_overrun.total_overrun_usd;
      return `Found closest solution (exceeds budget by $${overrun.toFixed(2)})`;
    case OptimizationStatus.INFEASIBLE_NO_OPTIONS:
      return (
        result.meta.strict_infeasible_reason || "No feasible solution found"
      );
    case OptimizationStatus.ERROR:
      return result.meta.strict_infeasible_reason || "Error during optimization";
    default:
      return "Unknown status";
  }
}

/**
 * Create an empty/default BudgetOverrun.
 */
export function createZeroBudgetOverrun(): BudgetOverrun {
  return {
    group_overrun_usd: 0,
    member_overrun_usd: {},
    max_member_overrun_usd: 0,
    total_overrun_usd: 0,
  };
}

/**
 * Create default SolveMeta for error state.
 */
export function createErrorMeta(reason: string): SolveMeta {
  return {
    status: OptimizationStatus.ERROR,
    is_relaxed: false,
    solver: "CBC",
    time_limit_s: 60,
    solve_time_ms: 0,
    objective_value: null,
    strict_infeasible_reason: reason,
    relaxation_summary: {},
  };
}

/**
 * Create a default GroupOptimizationResult for error state.
 */
export function createErrorResult(reason: string): GroupOptimizationResult {
  return {
    meta: createErrorMeta(reason),
    budget_overrun: createZeroBudgetOverrun(),
    results: [],
    warnings: [reason],
    status: OptimizationStatus.ERROR,
    message: reason,
  };
}

/**
 * Format overrun amount for display.
 */
export function formatOverrun(amount: number): string {
  if (amount <= 0) return "";
  return `+$${amount.toFixed(0)}`;
}

/**
 * Get member overruns as a formatted list.
 */
export function getMemberOverrunsList(
  overrun: BudgetOverrun
): Array<{ memberId: string; amount: number; formatted: string }> {
  return Object.entries(overrun.member_overrun_usd)
    .filter(([, amount]) => amount > 0)
    .map(([memberId, amount]) => ({
      memberId,
      amount,
      formatted: formatOverrun(amount),
    }))
    .sort((a, b) => b.amount - a.amount);
}
