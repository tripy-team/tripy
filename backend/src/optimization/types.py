"""
Shared types for optimization pipeline.

Import from here to prevent circular dependencies.
All validation outcome types and rejection types live here.
"""

from dataclasses import dataclass, field
from typing import Any, Literal
from decimal import Decimal


# =============================================================================
# REJECTION: Core rejection type used by all validators
# =============================================================================

@dataclass
class Rejection:
    """
    A rejection of a candidate with reason code and details.
    Used by both contract validation and policy filtering.
    
    Attributes:
        reason_code: Namespaced code (e.g., FLIGHT_AIRPORT_NOT_ALLOWED)
        candidate_id: ID of the rejected candidate
        scope_id: Context where rejection occurred (e.g., "leg_0")
        details: Additional context for debugging
    """
    reason_code: str
    candidate_id: str
    scope_id: str
    details: dict[str, Any] = field(default_factory=dict)


# =============================================================================
# VALIDATION OUTCOMES: Results from different validation stages
# =============================================================================

@dataclass
class ContractValidationOutcome:
    """
    Outcome of contract validation (schema/structural only).
    
    If is_valid=False, candidate is MALFORMED and should not proceed to policy checks.
    Contract validation checks:
    - Required fields present
    - Correct data types
    - Parseable datetimes
    """
    is_valid: bool
    rejections: list[Rejection]
    candidate_id: str


@dataclass
class PolicyFilterOutcome:
    """
    Outcome of policy filtering.
    
    If is_allowed=False, candidate failed business rules but is NOT malformed.
    Policy filtering checks:
    - Airport allowlist
    - Ticketing type requirements
    - Connection rules
    """
    is_allowed: bool
    rejections: list[Rejection]
    candidate_id: str


@dataclass
class MergeGateOutcome:
    """
    Result of merge gate check between two candidates.
    
    Used to determine if candidates with the same fingerprint
    can be safely merged without data loss or incorrect aggregation.
    """
    can_merge: bool
    reason: str | None = None


# =============================================================================
# LEG VALIDATION RESULTS: Aggregated results for a single leg
# =============================================================================

@dataclass
class LegValidationResult:
    """
    Validation result for a single leg.
    
    IMPORTANT: Counts are PER-CANDIDATE, not per-rejection.
    A single candidate can have multiple rejections, but malformed_candidate_count
    counts unique candidates that are malformed.
    """
    contract_valid: list[dict]
    contract_rejections: list[Rejection]
    malformed_candidate_count: int
    warnings: list[str] = field(default_factory=list)


# =============================================================================
# PIPELINE RESULT: Complete result from candidate processing
# =============================================================================

@dataclass
class PipelineResult:
    """
    Complete result from process_candidates_pipeline().
    
    Contains all rejections, warnings, and metadata needed for:
    - Determining HTTP status (400 vs 502 vs 200)
    - Building response payload
    - Logging and debugging
    """
    solve_id: str
    normalization_notes: list[str] = field(default_factory=list)
    
    # Contract rejections (malformed candidates)
    contract_rejections: list[Rejection] = field(default_factory=list)
    
    # Policy rejections (valid candidates that failed business rules)
    policy_rejections: list[Rejection] = field(default_factory=list)
    
    # Fingerprint collisions (for logging, not for 502 logic)
    fingerprint_collisions: list[Rejection] = field(default_factory=list)
    
    # Legs that don't have enough candidates after filtering
    legs_below_minimum: list[str] = field(default_factory=list)
    
    # General warnings
    warnings: list[str] = field(default_factory=list)
    
    # For infeasible response
    failed_scope: str | None = None
    
    def to_rejections_summary(self) -> dict[str, int]:
        """
        Create rejections_summary: { reason_code -> count }.
        Used in API responses.
        """
        summary: dict[str, int] = {}
        for r in self.contract_rejections + self.policy_rejections:
            summary[r.reason_code] = summary.get(r.reason_code, 0) + 1
        return summary
    
    def to_rejections_sample(self, max_samples: int = 10) -> list[dict]:
        """
        Create rejections_sample with up to max_samples examples.
        Used in API responses for debugging.
        """
        all_rejections = self.contract_rejections + self.policy_rejections
        return [
            {
                "reason_code": r.reason_code,
                "candidate_id": r.candidate_id,
                "scope_id": r.scope_id,
            }
            for r in all_rejections[:max_samples]
        ]


# =============================================================================
# SOLUTION ACCOUNTING: Ledger for tracking payments and transfers
# =============================================================================

@dataclass
class LedgerLineItem:
    """
    A single line item in the payment ledger.
    
    Represents one charge or credit in the solution.
    """
    scope: str  # "leg_0", "segment_1", "trip"
    description: str  # "Flight SEA->JFK", "Transfer Chase->United"
    amount: Decimal
    unit: str  # "USD", "POINTS", "MILES"
    program: str | None = None  # Loyalty program if applicable
    traveler_id: str | None = None  # Who paid/received


@dataclass
class TravelerLedger:
    """
    Per-traveler breakdown of payments and transfers.
    
    Tracks bank points transferred, loyalty points received/spent, and cash paid.
    """
    traveler_id: str
    
    # Bank points transferred: (bank, program) -> points transferred from bank
    bank_points_transferred: dict[tuple[str, str], int] = field(default_factory=dict)
    
    # Loyalty points received via transfers: program -> points received
    loyalty_received: dict[str, int] = field(default_factory=dict)
    
    # Loyalty points spent on bookings: program -> points spent
    loyalty_spent: dict[str, int] = field(default_factory=dict)
    
    # Cash paid
    cash_paid_usd: Decimal = field(default_factory=lambda: Decimal("0"))
    
    def accumulate_transfer(self, bank: str, program: str, points: int, received: int):
        """
        Record a transfer from bank to program.
        
        IMPORTANT: Accumulates, does not overwrite.
        """
        key = (bank, program)
        self.bank_points_transferred[key] = self.bank_points_transferred.get(key, 0) + points
        self.loyalty_received[program] = self.loyalty_received.get(program, 0) + received
    
    def accumulate_spend(self, program: str, amount: int):
        """
        Record spending loyalty points.
        
        IMPORTANT: Accumulates, does not overwrite.
        """
        self.loyalty_spent[program] = self.loyalty_spent.get(program, 0) + amount
    
    def accumulate_cash(self, amount: Decimal):
        """Record cash payment."""
        self.cash_paid_usd += amount


@dataclass
class SolutionAccounting:
    """
    Complete payment ledger for the solution.
    
    This is the TRUTH SOURCE for all payment information.
    The adapter should render from this, not reconstruct from funding_source_id.
    
    Attributes:
        by_traveler: Per-traveler breakdown
        line_items: Detailed line-by-line breakdown
        total_cash_usd: Total cash across all travelers
        total_loyalty_spent: Total loyalty spent per program
        total_loyalty_received: Total loyalty received via transfers per program
        program_unit_type: Maps program to unit type ("MILES" or "POINTS")
    """
    by_traveler: dict[str, TravelerLedger] = field(default_factory=dict)
    line_items: list[LedgerLineItem] = field(default_factory=list)
    
    # Totals
    total_cash_usd: Decimal = field(default_factory=lambda: Decimal("0"))
    total_loyalty_spent: dict[str, int] = field(default_factory=dict)
    total_loyalty_received: dict[str, int] = field(default_factory=dict)
    
    # Program -> unit type registry
    # Airlines typically use "MILES", hotels use "POINTS"
    program_unit_type: dict[str, str] = field(default_factory=dict)
    
    def get_or_create_traveler(self, traveler_id: str) -> TravelerLedger:
        """Get or create a traveler ledger."""
        if traveler_id not in self.by_traveler:
            self.by_traveler[traveler_id] = TravelerLedger(traveler_id=traveler_id)
        return self.by_traveler[traveler_id]
    
    def add_line_item(
        self,
        scope: str,
        description: str,
        amount: Decimal,
        unit: str,
        program: str | None = None,
        traveler_id: str | None = None,
    ):
        """Add a line item to the ledger."""
        self.line_items.append(LedgerLineItem(
            scope=scope,
            description=description,
            amount=amount,
            unit=unit,
            program=program,
            traveler_id=traveler_id,
        ))
    
    def finalize_totals(self):
        """Compute totals from traveler ledgers."""
        self.total_cash_usd = Decimal("0")
        self.total_loyalty_spent = {}
        self.total_loyalty_received = {}
        
        for ledger in self.by_traveler.values():
            self.total_cash_usd += ledger.cash_paid_usd
            
            for program, amount in ledger.loyalty_spent.items():
                self.total_loyalty_spent[program] = (
                    self.total_loyalty_spent.get(program, 0) + amount
                )
            
            for program, amount in ledger.loyalty_received.items():
                self.total_loyalty_received[program] = (
                    self.total_loyalty_received.get(program, 0) + amount
                )


# =============================================================================
# OPTIMIZATION EXPLANATION: Provenance for explainability
# =============================================================================

@dataclass
class OptimizationExplanation:
    """
    Explanation payload for the optimization result.
    
    Provides objective breakdown and constraints enforced
    for debugging and user transparency.
    """
    # Objective breakdown (all values in USD for comparability)
    objective_breakdown: dict[str, Decimal] = field(default_factory=dict)
    # Expected keys: cash_usd, points_shadow_cost_usd, time_penalty_usd,
    #                stop_penalty_usd, risk_penalty_usd
    
    # Total objective value
    objective_total_usd: Decimal = field(default_factory=lambda: Decimal("0"))
    
    # Constraints that were enforced
    constraints_enforced: list[str] = field(default_factory=list)
    # Examples: "SINGLE_TICKET_ONLY", "MAX_STOPS", "ALLOWED_AIRPORTS"
    
    # Rejections summary by reason code
    rejections_summary: dict[str, int] = field(default_factory=dict)
    
    # Warnings
    warnings: list[str] = field(default_factory=list)
    
    # Weights snapshot (for reproducibility)
    weights_snapshot: dict[str, Any] = field(default_factory=dict)
