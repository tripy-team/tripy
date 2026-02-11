"""
V3 Optimization Solver

CRITICAL FIXES implemented:
1. Award option ID in decision variables (prevents cross-program mixing)
2. Hotel points cost tied to room count (fixes group undercounting)
3. Date feasibility constraints in MILP (REAL enforcement, not just filter)
4. Single-ticket enforcement (HARD filter for connections)
5. No pooling - payer uses only their own balances
6. Tight Big-M bounds
7. Hotel payment fully constrained (u_points + room type exclusivity)
8. Proper linearization build order
9. Transfer "used" binary to prevent pointless t_b > 0
10. Safe pass-2 objective handling (fresh model rebuild)
11. Variable name sanitization (slug function)
12. CBC availability check at startup

Key design decisions:
- Stay segments are INPUTS (from TripPlanSpec)
- Payer assignment is a DECISION
- Hotel cost comes from room vars * nights (not constant)
- Two-pass solve with robust slack
- Integer-safe transfers
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from collections import defaultdict
from enum import Enum
import logging
import time
import re
import copy

from pulp import (
    LpProblem, LpMinimize, LpVariable, LpBinary, LpInteger,
    lpSum, value, LpStatusOptimal, LpStatus
)

from .trip_spec import TripPlanSpec, StaySegment, OrderedLeg
from .models_v3 import (
    FlightItineraryEdge, TransferPath, AwardOption,
    FundingSource, SlackConfig, SolverConfig, BalancedModeConfig, PruningConfig,
    ComfortConfig, OptimizationStatus, Solution, PaymentChoice, OptimizationResult,
)
from .validators import (
    filter_single_ticket_only, 
    validate_date_feasibility, 
    pre_check_feasibility,
    validate_connection_warnings,
)
from .pruning import prune_flights, prune_award_options
from .precompute import precompute_soft_values, compute_flight_K
from .metrics import OptimizationMetrics, create_metrics
from .flags import V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED, V3_CLOSEST_PLAN_ENABLED

logger = logging.getLogger(__name__)


def compute_stage2_delta(budget: float, oop_star: float) -> float:
    """
    Slack for Stage 2 quality optimization.
    
    Small enough that OOP doesn't degrade meaningfully.
    Large enough that the solver has room to improve quality.
    
    Formula: delta = max($25, 2% of budget, 1% of OOP*)
    """
    return max(25.0, 0.02 * max(1.0, budget or 0), 0.01 * oop_star)


# =============================================================================
# CBC AVAILABILITY CHECK
# =============================================================================

_CBC_AVAILABLE: Optional[bool] = None
_CBC_ERROR: Optional[str] = None


def check_cbc_available() -> Tuple[bool, Optional[str]]:
    """
    Check if CBC solver is available at runtime.
    
    Call this at application startup to fail fast if solver is missing.
    Returns (is_available, error_message).
    """
    global _CBC_AVAILABLE, _CBC_ERROR
    
    if _CBC_AVAILABLE is not None:
        return _CBC_AVAILABLE, _CBC_ERROR
    
    try:
        from pulp import PULP_CBC_CMD
        
        # Try a trivial solve
        prob = LpProblem("test", LpMinimize)
        x = LpVariable("x", lowBound=0)
        prob += x
        prob += x >= 1
        
        solver = PULP_CBC_CMD(msg=False, timeLimit=5)
        status = prob.solve(solver)
        
        if status == LpStatusOptimal:
            _CBC_AVAILABLE = True
            _CBC_ERROR = None
            logger.info("CBC solver available and working")
        else:
            _CBC_AVAILABLE = False
            _CBC_ERROR = f"CBC solver returned non-optimal status: {LpStatus[status]}"
            logger.error(_CBC_ERROR)
    
    except Exception as e:
        _CBC_AVAILABLE = False
        _CBC_ERROR = f"CBC solver not available: {e}"
        logger.error(_CBC_ERROR)
    
    return _CBC_AVAILABLE, _CBC_ERROR


def require_cbc():
    """Raise an error if CBC is not available."""
    available, error = check_cbc_available()
    if not available:
        raise RuntimeError(
            f"CBC solver required but not available: {error}. "
            "Install CBC via: apt-get install coinor-cbc (Linux) or brew install cbc (macOS)"
        )


# =============================================================================
# VARIABLE NAME SANITIZATION
# =============================================================================

def slug(s: str) -> str:
    """
    Sanitize string for use in PuLP variable names.
    
    PuLP/CBC dislike: -, /, spaces, colons, etc.
    Replace with underscores and truncate.
    """
    if not s:
        return "empty"
    return re.sub(r"[^A-Za-z0-9_]", "_", str(s))[:80]


# =============================================================================
# SOLVER
# =============================================================================

class Mode(Enum):
    """Optimization mode."""
    OOP = "oop"      # Out-of-pocket: minimize cash
    CPP = "cpp"      # Cents-per-point: maximize redemption value
    BALANCED = "balanced"  # Balance value, time, convenience


class SolverV3:
    """
    V3 Optimization Solver (Flights Only).
    
    Variable naming convention (all IDs passed through slug()):
    - x_f_{leg}_{edge}                              : flight selection
    - z_cf_{leg}_{edge}_{payer}                     : flight cash payment
    - y_pf_{leg}_{edge}_{opt}_{payer}_{src}         : flight points payment
    - t_b_{payer}_{bank}_{prog}                     : transfer blocks
    - u_tr_{payer}_{bank}_{prog}                    : transfer used (binary)
    """
    
    def __init__(
        self,
        mode: Mode,
        solver_config: Optional[SolverConfig] = None,
        slack_config: Optional[SlackConfig] = None,
        balanced_config: Optional[BalancedModeConfig] = None,
        pruning_config: Optional[PruningConfig] = None,
        comfort_config: Optional[ComfortConfig] = None,
        determinism_mode: bool = False,
        is_international: bool = False,  # Route type affects penalties
        cash_budget: Optional[float] = None,  # User's cash budget (if set, FORCES points usage when over)
    ):
        self.mode = mode
        self.solver_config = solver_config or SolverConfig()
        self.slack_config = slack_config or SlackConfig()
        self.balanced_config = balanced_config or BalancedModeConfig()
        self.pruning_config = pruning_config or PruningConfig()
        self.comfort_config = comfort_config or ComfortConfig()
        self.determinism_mode = determinism_mode
        self.is_international = is_international
        self.cash_budget = cash_budget  # None means no budget constraint
        
        self.model: Optional[LpProblem] = None
        self.metrics = create_metrics()
        
        # Data
        self.spec: Optional[TripPlanSpec] = None
        self.flights: List[FlightItineraryEdge] = []
        self.transfers: List[TransferPath] = []
        
        # Indices
        self.flights_by_leg: Dict[int, List[FlightItineraryEdge]] = {}
        
        # Funding sources per payer (NO POOLING)
        self.funding_sources: Dict[str, List[FundingSource]] = {}
        
        # Variables
        self.vars: Dict[str, Dict] = {}
        
        # Date feasibility (REAL constraint data)
        self.date_feasible: Dict[Tuple[int, str], int] = {}  # (leg, edge) -> 0/1
        
        # Precomputed key indices for faster lookup
        self.y_pf_keys_by_flight: Dict[Tuple[int, str], List] = {}
        
        # Big-M constants (centralized)
        self.M_blocks: Dict[Tuple[str, str, str], int] = {}
        
        # Normalization constants
        self.K_flight: float = 100.0
        
        # Budget tier override (used during guardrail escalation)
        self._override_budget_tier: Optional[str] = None
    
    def solve(
        self,
        spec: TripPlanSpec,
        flights: List[FlightItineraryEdge],
        transfers: List[TransferPath],
    ) -> OptimizationResult:
        """Main solve method (flights only)."""
        
        start_time = time.time()
        all_warnings = []
        
        self.spec = spec
        self.transfers = transfers
        
        # Record input counts
        self.metrics.flights_input = len(flights)
        self.metrics.transfers_input = len(transfers)
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 1: Validate TripPlanSpec
        # ═══════════════════════════════════════════════════════════════════
        
        spec_errors = spec.validate()
        if spec_errors:
            return OptimizationResult(
                status=OptimizationStatus.INFEASIBLE_DATA,
                solution=None,
                warnings=spec_errors,
                suggestions=["Fix trip specification errors"],
                infeasibility_reason="Invalid trip specification",
            )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 2: Single-ticket filter (HARD — skipped in money-saver mode)
        # ═══════════════════════════════════════════════════════════════════
        
        if self.comfort_config.require_single_ticket:
            flights, ticket_warnings = filter_single_ticket_only(flights)
            all_warnings.extend(ticket_warnings)
        else:
            ticket_warnings = []
            logger.info("[V3] Single-ticket filter SKIPPED (money-saver mode)")
        
        self.metrics.flights_after_ticket_filter = len(flights)
        self.metrics.flights_dropped_separate_tickets = sum(
            1 for w in ticket_warnings if "separate tickets" in w
        )
        self.metrics.flights_dropped_unknown_tickets = sum(
            1 for w in ticket_warnings if "unknown ticketing" in w and "Dropped" in w
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 3: Date feasibility - compute but DON'T filter yet
        # Keep all flights, mark infeasible ones with date_feasible=0
        # ═══════════════════════════════════════════════════════════════════
        
        feasible_flights, date_warnings = validate_date_feasibility(
            flights, spec.stay_segments, spec.legs
        )
        all_warnings.extend(date_warnings)
        
        # Build date_feasible dict: 1 for feasible, 0 for infeasible
        feasible_set = {f.edge_id for f in feasible_flights}
        for f in flights:
            self.date_feasible[(f.leg_id, f.edge_id)] = 1 if f.edge_id in feasible_set else 0
        
        # Keep only feasible for now (but MILP constraint will also enforce)
        flights = feasible_flights
        
        self.metrics.flights_after_date_filter = len(flights)
        self.metrics.flights_dropped_date_infeasible = (
            self.metrics.flights_after_ticket_filter - len(flights)
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 4: Connection warnings (informational)
        # ═══════════════════════════════════════════════════════════════════
        
        conn_warnings = validate_connection_warnings(flights)
        all_warnings.extend(conn_warnings)
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 5: Build indices and pre-check feasibility
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_indices(flights)
        
        # Validate ID uniqueness (fail early)
        self._validate_id_uniqueness(flights)
        
        is_feasible, feasibility_issues = pre_check_feasibility(
            spec, self.flights_by_leg, {}  # No hotels
        )
        
        if not is_feasible:
            self.metrics.solve_time_seconds = time.time() - start_time
            return OptimizationResult(
                status=OptimizationStatus.INFEASIBLE_DATA,
                solution=None,
                warnings=all_warnings,
                suggestions=feasibility_issues,
                infeasibility_reason="Missing required data",
                missing_data=feasibility_issues,
            )
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 6: Prune candidates
        # ═══════════════════════════════════════════════════════════════════
        
        flights = prune_flights(flights, self.pruning_config)
        prune_award_options(flights, [], self.pruning_config)
        
        self.flights = flights
        
        # Rebuild indices after pruning
        self._build_indices(flights)
        
        self.metrics.flights_after_prune = len(flights)
        
        for leg_id, leg_flights in self.flights_by_leg.items():
            self.metrics.flights_per_leg[leg_id] = len(leg_flights)
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 7: Precompute soft values
        # ═══════════════════════════════════════════════════════════════════
        
        precompute_soft_values(flights, [], self.balanced_config)
        
        # Count award options and availability
        for f in flights:
            self.metrics.award_options_total += len(f.award_options)
            for opt in f.award_options:
                if opt.availability_score < self.balanced_config.min_availability_threshold:
                    self.metrics.award_options_low_availability += 1
                if opt.is_waitlisted:
                    self.metrics.award_options_waitlisted += 1
        
        # Compute normalization constants
        self.K_flight = compute_flight_K(flights, self.balanced_config)
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 8: Build funding sources (NO POOLING)
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_funding_sources()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 9: Build MILP
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_model()
        
        self.metrics.milp_variables = len(self.model.variables())
        self.metrics.milp_constraints = len(self.model.constraints)
        
        # Count variable types
        for v in self.model.variables():
            if v.cat == "Binary":
                self.metrics.milp_binary_vars += 1
            elif v.cat == "Integer":
                self.metrics.milp_integer_vars += 1
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 10: Solve (two-pass with model rebuild for pass 2)
        # ═══════════════════════════════════════════════════════════════════
        
        result = self._solve_two_pass()
        
        self.metrics.solve_time_seconds = time.time() - start_time
        self.metrics.warnings = all_warnings
        
        result.warnings.extend(all_warnings)
        result.solve_time_seconds = self.metrics.solve_time_seconds
        result.num_variables = self.metrics.milp_variables
        result.num_constraints = self.metrics.milp_constraints
        
        # Log metrics
        self.metrics.log_summary(logger)
        
        return result
    
    def _validate_id_uniqueness(self, flights: List[FlightItineraryEdge]):
        """Validate that IDs are unique where required. Fail early if not."""
        
        # Edge IDs should be unique
        edge_ids = [f.edge_id for f in flights]
        if len(edge_ids) != len(set(edge_ids)):
            raise ValueError("Duplicate flight edge_ids detected")
        
        # Option IDs should be unique within each flight
        for f in flights:
            opt_ids = [o.option_id for o in f.award_options]
            if len(opt_ids) != len(set(opt_ids)):
                raise ValueError(f"Duplicate option_ids in flight {f.edge_id}")
    
    def _build_indices(self, flights: List[FlightItineraryEdge]):
        """Build lookup indices."""
        
        self.flights_by_leg = defaultdict(list)
        for f in flights:
            self.flights_by_leg[f.leg_id].append(f)
    
    def _build_funding_sources(self):
        """
        Build funding sources per payer.
        
        NO POOLING: Each payer can only use their own balances.
        
        MULTI-CURRENCY TELEMETRY: Logs all available currencies and funding paths.
        """
        
        self.funding_sources = {}
        
        for traveler in self.spec.travelers:
            payer = traveler.traveler_id
            sources = []
            
            # ══════════════════════════════════════════════════════════════
            # MULTI-CURRENCY TELEMETRY: Log available currencies
            # ══════════════════════════════════════════════════════════════
            logger.info(f"[V3 Solver] Building funding sources for payer '{payer}'")
            logger.info(f"[V3 Solver] ├── Bank balances: {traveler.bank_balances}")
            logger.info(f"[V3 Solver] └── Airline balances: {traveler.points_balances}")
            
            # Native program balances
            for prog, bal in traveler.points_balances.items():
                if bal > 0:
                    sources.append(FundingSource.make_native(payer, prog))
                    logger.debug(f"[V3 Solver]     + Native source: {prog} ({bal:,} pts)")
            
            # Transfer paths from this payer's banks
            transfer_count_by_bank = {}
            for tp in self.transfers:
                if tp.from_bank in traveler.bank_balances:
                    if traveler.bank_balances[tp.from_bank] > 0:
                        sources.append(FundingSource.make_transfer(
                            payer, tp.from_bank, tp.to_program, tp.path_id
                        ))
                        transfer_count_by_bank[tp.from_bank] = transfer_count_by_bank.get(tp.from_bank, 0) + 1
            
            # Log transfer path summary
            if transfer_count_by_bank:
                for bank, count in transfer_count_by_bank.items():
                    bal = traveler.bank_balances.get(bank, 0)
                    logger.info(f"[V3 Solver]     + {bank}: {bal:,} pts → {count} transfer partners")
            
            self.funding_sources[payer] = sources
            logger.info(f"[V3 Solver] Total funding sources for '{payer}': {len(sources)}")
    
    def _get_sources_for_program(self, payer: str, program: str) -> List[FundingSource]:
        """Get funding sources a payer can use for a specific program."""
        return [
            s for s in self.funding_sources.get(payer, [])
            if s.target_program == program
        ]
    
    def _build_model(self):
        """
        Build MILP with correct variable indexing (flights only).
        """
        
        self.model = LpProblem("TripOptV3", LpMinimize)
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 1: Build all decision variables
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_flight_vars()
        self._build_transfer_vars()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 2: Add selection and payment structure constraints
        # ═══════════════════════════════════════════════════════════════════
        
        self._add_selection_constraints()
        self._add_payment_constraints()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 3: Add transfer and balance constraints
        # ═══════════════════════════════════════════════════════════════════
        
        self._add_transfer_constraints()
        self._add_balance_constraints()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 4: Add date feasibility constraints (REAL enforcement)
        # ═══════════════════════════════════════════════════════════════════
        
        self._add_date_feasibility_constraints()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 5: Add airport continuity constraints for multi-airport cities
        # ═══════════════════════════════════════════════════════════════════
        
        self._add_airport_continuity_constraints()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 6: Add budget constraint (if set) - FORCES points usage when over budget
        # ═══════════════════════════════════════════════════════════════════
        
        self._add_budget_constraint()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 7: Build key indices for fast lookup
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_key_indices()
        
        # ═══════════════════════════════════════════════════════════════════
        # STEP 8: Log detailed flight options (for debugging)
        # ═══════════════════════════════════════════════════════════════════
        
        self._log_flight_options_detail()
    
    def _build_key_indices(self):
        """Build indices for faster constraint/objective construction."""
        
        self.y_pf_keys_by_flight = defaultdict(list)
        for key in self.vars.get("y_pf", {}).keys():
            leg, edge = key[0], key[1]
            self.y_pf_keys_by_flight[(leg, edge)].append(key)
    
    def _compute_best_cash_price(self) -> float:
        """
        Compute the best (lowest) cash price across all flight options.
        
        Used for budget tier calculation. Returns the sum of cheapest
        cash option per leg.
        """
        best_per_leg = {}
        
        for f in self.flights:
            if f.leg_id not in best_per_leg:
                best_per_leg[f.leg_id] = float('inf')
            if f.cash_cost > 0:
                best_per_leg[f.leg_id] = min(best_per_leg[f.leg_id], f.cash_cost)
        
        # Sum across legs (need one flight per leg)
        total = sum(
            price for price in best_per_leg.values() 
            if price < float('inf')
        )
        
        return total if total > 0 else 1000.0  # Default if no cash prices
    
    def _compute_lowest_surcharge(self) -> float:
        """
        Compute the lowest total surcharge available if paying all points.
        
        Used for budget feasibility messaging.
        """
        best_surcharge_per_leg = {}
        
        for f in self.flights:
            for opt in f.award_options:
                if f.leg_id not in best_surcharge_per_leg:
                    best_surcharge_per_leg[f.leg_id] = float('inf')
                best_surcharge_per_leg[f.leg_id] = min(
                    best_surcharge_per_leg[f.leg_id], 
                    opt.surcharge
                )
        
        if not best_surcharge_per_leg:
            return float('inf')  # No award options
        
        return sum(
            s for s in best_surcharge_per_leg.values()
            if s < float('inf')
        )
    
    def _build_flight_vars(self):
        """Build flight decision variables with ADAPTIVE budget-based guardrails."""
        
        self.vars["x_f"] = {}     # Flight selection
        self.vars["z_cf"] = {}    # Cash payment
        self.vars["y_pf"] = {}    # Points payment (with option_id!)
        
        cfg = self.comfort_config
        
        # ═══════════════════════════════════════════════════════════════════════
        # ADAPTIVE BUDGET-BASED GUARDRAILS (Budget > CPP)
        # ═══════════════════════════════════════════════════════════════════════
        # 
        # PRINCIPLE: Meeting the user's budget is MORE important than CPP quality.
        # When budget requires points, we proactively relax CPP guards.
        # Tier is determined by: r = budget / best_cash_price
        #
        # Normal (r ≥ 1.0): cpp_floor=1.1, miles/$=140 (budget covers cash)
        # Tight (0.60 ≤ r < 1.0): cpp_floor=0.95, miles/$=180 (must use some points)
        # Very tight (0.30 ≤ r < 0.60): cpp_floor=0.80, miles/$=250 (heavy points)
        # CRITICAL (r < 0.30): cpp_floor=0 (NO restriction), miles/$=∞
        
        best_cash_price = self._compute_best_cash_price()
        
        # Use override tier if set (during guardrail escalation), otherwise compute
        if self._override_budget_tier is not None:
            self.budget_tier = self._override_budget_tier
            logger.info(f"[Budget Tier] Using OVERRIDE tier: {self.budget_tier.upper()} (escalated to prioritize points)")
        else:
            self.budget_tier = cfg.get_budget_tier(self.cash_budget, best_cash_price)
        
        # Get adaptive thresholds based on tier
        cpp_floor = cfg.get_adaptive_cpp_floor(self.budget_tier) if cfg.enable_cpp_floor else 0.0
        max_miles_per_dollar = cfg.get_adaptive_miles_per_dollar(self.budget_tier) if cfg.enable_miles_per_dollar_guard else float('inf')
        
        # Log budget tier and thresholds
        if self.cash_budget and self.cash_budget > 0:
            ratio = self.cash_budget / best_cash_price if best_cash_price > 0 else 1.0
            logger.info(
                f"[Budget Tier] budget=${self.cash_budget:.0f}, best_cash=${best_cash_price:.0f}, "
                f"ratio={ratio:.2f} → tier={self.budget_tier.upper()}"
            )
            logger.info(
                f"[Budget Tier] Using ADAPTIVE guardrails: cpp_floor={cpp_floor}¢, "
                f"max_miles/$={max_miles_per_dollar}"
            )
            
            # Check if budget is feasible at all
            lowest_surcharge = self._compute_lowest_surcharge()
            if lowest_surcharge > self.cash_budget:
                logger.warning(
                    f"[Budget Warning] ⚠️ Budget ${self.cash_budget:.0f} may be infeasible! "
                    f"Lowest available surcharge is ${lowest_surcharge:.0f}. "
                    f"Even all-points solution exceeds budget."
                )
        else:
            logger.info(f"[Budget Tier] No budget constraint → tier=NORMAL (default guardrails)")
        
        rejected_count = 0
        accepted_count = 0
        flights_with_awards = 0
        flights_without_awards = 0
        
        for f in self.flights:
            leg = f.leg_id
            edge = slug(f.edge_id)
            
            # Track flights with/without awards
            if f.award_options:
                flights_with_awards += 1
            else:
                flights_without_awards += 1
            
            # Selection
            self.vars["x_f"][(f.leg_id, f.edge_id)] = LpVariable(
                f"x_f_{leg}_{edge}", cat=LpBinary
            )
            
            # Cash payment by each payer
            for payer in self.spec.all_traveler_ids:
                p = slug(payer)
                self.vars["z_cf"][(f.leg_id, f.edge_id, payer)] = LpVariable(
                    f"z_cf_{leg}_{edge}_{p}", cat=LpBinary
                )
            
            # Points payment: for each award option, each payer, each source
            # CRITICAL: includes opt.option_id
            for opt in f.award_options:
                # ═══════════════════════════════════════════════════════════════
                # REDEMPTION QUALITY GUARDS
                # ═══════════════════════════════════════════════════════════════
                # 
                # Two complementary guardrails prevent "burn points stupidly":
                #
                # 1. CPP FLOOR: Reject if CPP < floor (e.g., < 1.0¢/pt)
                #    CPP = (cash_saved * 100) / miles_required
                #
                # 2. MILES PER DOLLAR: Reject if miles_per_$ > max (e.g., > 150)
                #    miles_per_dollar = miles / max(1, cash_saved)
                #
                # Guard 2 is most intuitive: "Don't spend more than 150 miles to save $1"
                # It directly kills: "60k pts to save $120" = 500 miles/$ ❌
                
                cash_saved = max(1.0, f.cash_cost - opt.surcharge)  # Avoid divide-by-zero
                actual_cpp = (cash_saved * 100) / opt.miles_required if opt.miles_required > 0 else 0
                miles_per_dollar = opt.miles_required / cash_saved if cash_saved > 0 else float('inf')
                
                # Store CPP quality metadata for Stage 2 objective
                opt._cpp_quality = actual_cpp
                
                if V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED:
                    # Lexicographic mode: no hard CPP gates — all options create variables.
                    # Quality is handled in Stage 2 objective instead.
                    pass
                else:
                    # Legacy mode: hard CPP/miles-per-dollar guards
                    # Guard 1: CPP Floor
                    if cpp_floor > 0 and opt.miles_required > 0:
                        if actual_cpp < cpp_floor:
                            rejected_count += 1
                            logger.debug(
                                f"[CPP Floor] Rejected {f.edge_id} award option: "
                                f"CPP={actual_cpp:.3f}¢ < floor={cpp_floor}¢ "
                                f"(cash=${f.cash_cost}, surcharge=${opt.surcharge}, miles={opt.miles_required})"
                            )
                            continue
                    
                    # Guard 2: Miles Per Dollar Saved (uses adaptive threshold from budget tier)
                    if miles_per_dollar > max_miles_per_dollar and opt.miles_required > 0:
                        rejected_count += 1
                        logger.debug(
                            f"[Miles/$] Rejected {f.edge_id} award option: "
                            f"{miles_per_dollar:.1f} miles/$ > max {max_miles_per_dollar} "
                            f"(saves ${cash_saved:.0f} for {opt.miles_required:,} miles)"
                        )
                        continue
                
                # Award option passed guards - create variables
                accepted_count += 1
                opt_s = slug(opt.option_id)
                for payer in self.spec.all_traveler_ids:
                    p = slug(payer)
                    for src in self._get_sources_for_program(payer, opt.program):
                        src_s = slug(src.source_id)
                        key = (f.leg_id, f.edge_id, opt.option_id, payer, src.source_id)
                        self.vars["y_pf"][key] = LpVariable(
                            f"y_pf_{leg}_{edge}_{opt_s}_{p}_{src_s}",
                            cat=LpBinary
                        )
        
        # Diagnostic logging
        logger.info(
            f"[Flight Vars] {len(self.flights)} flights: "
            f"{flights_with_awards} have awards, {flights_without_awards} cash-only"
        )
        
        if flights_without_awards > 0 and flights_with_awards == 0:
            logger.warning(
                f"[Flight Vars] ⚠️ NO flights have award options! "
                f"Solver can ONLY pick cash options. Check AwardTool availability."
            )
        
        if rejected_count > 0 or accepted_count > 0:
            logger.info(
                f"[Quality Guards] Award options: {accepted_count} accepted, {rejected_count} rejected "
                f"(tier={self.budget_tier}, CPP floor={cpp_floor}¢, max miles/$={max_miles_per_dollar})"
            )
        
        if accepted_count == 0 and flights_with_awards > 0:
            logger.warning(
                f"[Quality Guards] ⚠️ ALL {rejected_count} award options were rejected by guards! "
                f"Budget tier is '{self.budget_tier}'. If budget is tight, guards may need further relaxation."
            )
            # If critical tier and still rejecting, there's a bug
            if self.budget_tier == "critical" and rejected_count > 0:
                logger.error(
                    f"[Quality Guards] BUG: Critical tier should have NO guards but still rejected {rejected_count} awards!"
                )
        
        if flights_with_awards == 0:
            logger.warning(
                f"[Quality Guards] ⚠️ NO AWARD OPTIONS found in flight data! "
                f"Total flights: {len(self.flights)}. Awards must be fetched from AwardTool."
            )
    
    def _build_transfer_vars(self):
        """Build transfer block variables with tight bounds and 'used' binary."""
        
        self.vars["t_b"] = {}  # Transfer blocks
        self.vars["u_tr"] = {}  # Transfer used (binary) - NEW
        
        for payer in self.spec.all_traveler_ids:
            traveler = self.spec.get_traveler(payer)
            p = slug(payer)
            
            for tp in self.transfers:
                if tp.from_bank not in traveler.bank_balances:
                    continue
                
                balance = traveler.bank_balances[tp.from_bank]
                if balance <= 0:
                    continue
                
                # Tight Big-M: max blocks = balance / increment
                max_blocks = balance // tp.min_increment
                self.M_blocks[(payer, tp.from_bank, tp.to_program)] = max_blocks
                
                bank_s = slug(tp.from_bank)
                prog_s = slug(tp.to_program)
                key = (payer, tp.from_bank, tp.to_program)
                
                # Transfer blocks (integer)
                self.vars["t_b"][key] = LpVariable(
                    f"t_b_{p}_{bank_s}_{prog_s}",
                    lowBound=0,
                    upBound=max_blocks,
                    cat=LpInteger
                )
                
                # Transfer used binary - prevents pointless t_b > 0
                self.vars["u_tr"][key] = LpVariable(
                    f"u_tr_{p}_{bank_s}_{prog_s}",
                    cat=LpBinary
                )
    
    def _add_selection_constraints(self):
        """One flight per leg."""
        
        for leg in self.spec.legs:
            leg_flights = self.flights_by_leg.get(leg.leg_id, [])
            if leg_flights:
                self.model += lpSum(
                    self.vars["x_f"][(leg.leg_id, f.edge_id)]
                    for f in leg_flights
                ) == 1, f"one_flight_{leg.leg_id}"
    
    def _add_payment_constraints(self):
        """Payment constraints for flights."""
        
        for f in self.flights:
            leg, edge = f.leg_id, f.edge_id
            x = self.vars["x_f"][(leg, edge)]
            
            # All cash payment vars
            cash_vars = [
                self.vars["z_cf"][(leg, edge, p)]
                for p in self.spec.all_traveler_ids
            ]
            
            # All points payment vars
            points_vars = [
                self.vars["y_pf"][k]
                for k in self.vars["y_pf"]
                if k[0] == leg and k[1] == edge
            ]
            
            # If selected, exactly one payment
            self.model += (
                lpSum(cash_vars) + lpSum(points_vars) == x
            ), f"one_pay_f_{leg}_{slug(edge)}"
    
    def _add_transfer_constraints(self):
        """Transfer constraints with integer delivery and 'used' binary."""
        
        for payer in self.spec.all_traveler_ids:
            for tp in self.transfers:
                key = (payer, tp.from_bank, tp.to_program)
                
                if key not in self.vars["t_b"]:
                    continue
                
                t = self.vars["t_b"][key]
                u_tr = self.vars["u_tr"][key]
                prog = tp.to_program
                max_blocks = self.M_blocks.get(key, 0)
                
                # ═══════════════════════════════════════════════════════════════
                # Link t_b to u_tr: t_b > 0 only if u_tr = 1
                # ═══════════════════════════════════════════════════════════════
                
                self.model += t <= max_blocks * u_tr, f"tr_used_ub_{slug(payer)}_{slug(tp.from_bank)}_{slug(prog)}"
                
                # ═══════════════════════════════════════════════════════════════
                # u_tr = 1 only if some award uses this transfer source
                # ═══════════════════════════════════════════════════════════════
                
                src_id = f"transfer_{payer}_{tp.from_bank}_{prog}"
                
                # Count flight awards that use this source
                uses_this_source = []
                
                for f in self.flights:
                    for opt in f.award_options:
                        if opt.program == prog:
                            y_key = (f.leg_id, f.edge_id, opt.option_id, payer, src_id)
                            if y_key in self.vars["y_pf"]:
                                uses_this_source.append(self.vars["y_pf"][y_key])
                
                if uses_this_source:
                    # u_tr can only be 1 if at least one award uses this source
                    self.model += u_tr <= lpSum(uses_this_source), f"tr_needed_{slug(payer)}_{slug(tp.from_bank)}_{slug(prog)}"
                else:
                    # No awards use this transfer path - force u_tr = 0
                    self.model += u_tr == 0, f"tr_unused_{slug(payer)}_{slug(tp.from_bank)}_{slug(prog)}"
                
                # ═══════════════════════════════════════════════════════════════
                # Miles used via this source <= blocks * delivered_per_block
                # ═══════════════════════════════════════════════════════════════
                
                miles_used = self._compute_miles_used_via_transfer(payer, tp)
                
                self.model += (
                    miles_used <= t * tp.effective_delivered_per_block
                ), f"transfer_{slug(payer)}_{slug(tp.from_bank)}_{slug(prog)}"
    
    def _compute_miles_used_via_transfer(self, payer: str, tp: TransferPath):
        """Compute miles used by payer via this transfer path."""
        
        prog = tp.to_program
        src_id = f"transfer_{payer}_{tp.from_bank}_{prog}"
        
        # Flight miles only
        flight_miles = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, payer, src_id)] * opt.miles_required
            for f in self.flights
            for opt in f.award_options
            if opt.program == prog
            if (f.leg_id, f.edge_id, opt.option_id, payer, src_id) in self.vars["y_pf"]
        )
        
        return flight_miles
    
    def _add_balance_constraints(self):
        """Balance constraints."""
        
        for traveler in self.spec.travelers:
            payer = traveler.traveler_id
            
            # Native balances
            for prog, balance in traveler.points_balances.items():
                if balance <= 0:
                    continue
                
                src_id = f"native_{payer}_{prog}"
                
                # Flight miles from native
                native_flight = lpSum(
                    self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, payer, src_id)] * opt.miles_required
                    for f in self.flights
                    for opt in f.award_options
                    if opt.program == prog
                    if (f.leg_id, f.edge_id, opt.option_id, payer, src_id) in self.vars["y_pf"]
                )
                
                self.model += native_flight <= balance, f"native_bal_{slug(payer)}_{slug(prog)}"
            
            # Bank balances (sum of blocks * increment)
            for bank, balance in traveler.bank_balances.items():
                if balance <= 0:
                    continue
                
                bank_used = lpSum(
                    self.vars["t_b"][(payer, bank, tp.to_program)] * tp.min_increment
                    for tp in self.transfers
                    if tp.from_bank == bank
                    if (payer, bank, tp.to_program) in self.vars["t_b"]
                )
                
                self.model += bank_used <= balance, f"bank_bal_{slug(payer)}_{slug(bank)}"
    
    def _add_date_feasibility_constraints(self):
        """
        Add REAL date feasibility constraints.
        
        x_f[(leg, edge)] <= date_feasible[(leg, edge)]
        
        This actually binds and prevents selection of infeasible flights.
        """
        
        for f in self.flights:
            leg, edge = f.leg_id, f.edge_id
            feasible = self.date_feasible.get((leg, edge), 1)
            
            self.model += (
                self.vars["x_f"][(leg, edge)] <= feasible
            ), f"date_feas_{leg}_{slug(edge)}"
    
    def _add_airport_continuity_constraints(self):
        """
        Add airport continuity constraints for multi-airport cities.
        
        When consecutive legs share a city (e.g., SEA→Paris, Paris→SEA),
        the arrival airport of leg N must match the departure airport of leg N+1.
        
        This prevents routes like: SEA→ORY, CDG→SEA (different Paris airports!)
        
        Implementation:
        1. Group airports by city using METRO_AIRPORTS mapping
        2. For each consecutive leg pair through the same city:
           - Create binary variables for each airport option
           - Link flight selection to airport selection
           - Ensure the same airport is selected for arrival and departure
        """
        from collections import defaultdict
        
        # Build reverse mapping: airport -> city
        # Import the METRO_AIRPORTS mapping
        try:
            from src.agents.orchestrator import METRO_AIRPORTS
        except ImportError:
            logger.warning("[Solver] Could not import METRO_AIRPORTS, skipping airport continuity constraints")
            return
        
        airport_to_city = {}
        for city, airports in METRO_AIRPORTS.items():
            for apt in airports:
                airport_to_city[apt.upper()] = city
        
        # Sort legs by leg_id to process in order
        sorted_leg_ids = sorted(set(f.leg_id for f in self.flights))
        
        if len(sorted_leg_ids) < 2:
            return  # No consecutive legs to link
        
        # Group flights by leg
        flights_by_leg = defaultdict(list)
        for f in self.flights:
            flights_by_leg[f.leg_id].append(f)
        
        # Check each consecutive leg pair
        continuity_constraints_added = 0
        
        for i in range(len(sorted_leg_ids) - 1):
            leg_n = sorted_leg_ids[i]
            leg_n1 = sorted_leg_ids[i + 1]
            
            # Get destination airports of leg N
            leg_n_flights = flights_by_leg.get(leg_n, [])
            leg_n1_flights = flights_by_leg.get(leg_n1, [])
            
            if not leg_n_flights or not leg_n1_flights:
                continue
            
            # Find which city leg N ends at
            # Use the last segment's destination of each flight
            dest_cities = set()
            for f in leg_n_flights:
                if f.segments:
                    dest_apt = f.segments[-1].destination.upper()
                    city = airport_to_city.get(dest_apt)
                    if city:
                        dest_cities.add(city)
            
            # Find which city leg N+1 starts from
            origin_cities = set()
            for f in leg_n1_flights:
                if f.segments:
                    origin_apt = f.segments[0].origin.upper()
                    city = airport_to_city.get(origin_apt)
                    if city:
                        origin_cities.add(city)
            
            # Find shared cities (where continuity constraint needed)
            shared_cities = dest_cities & origin_cities
            
            for city in shared_cities:
                city_airports = set(METRO_AIRPORTS.get(city, []))
                
                if len(city_airports) <= 1:
                    continue  # Single airport city - no constraint needed
                
                logger.info(f"[Solver] Adding airport continuity constraint for {city} between leg {leg_n} and {leg_n1}")
                
                # For each airport in the city, create a linking constraint:
                # If ANY flight landing at this airport is selected on leg N,
                # then ONLY flights departing from this airport can be selected on leg N+1
                
                for airport in city_airports:
                    airport = airport.upper()
                    
                    # Flights landing at this airport on leg N
                    arriving_at_airport = [
                        f for f in leg_n_flights
                        if f.segments and f.segments[-1].destination.upper() == airport
                    ]
                    
                    # Flights departing from this airport on leg N+1
                    departing_from_airport = [
                        f for f in leg_n1_flights
                        if f.segments and f.segments[0].origin.upper() == airport
                    ]
                    
                    # Flights departing from OTHER airports in the same city on leg N+1
                    departing_from_other = [
                        f for f in leg_n1_flights
                        if f.segments and f.segments[0].origin.upper() in city_airports
                        and f.segments[0].origin.upper() != airport
                    ]
                    
                    if not arriving_at_airport or not departing_from_other:
                        continue
                    
                    # Constraint: If arriving at this airport, cannot depart from other airports
                    # Sum(arriving) <= 1 - Sum(departing_other) + M*(1 - any_arriving)
                    # Simplified: Sum(arriving) + Sum(departing_other) <= 1
                    # This ensures: if any arriving=1, then departing_other must all be 0
                    
                    arriving_vars = [
                        self.vars["x_f"][(f.leg_id, f.edge_id)]
                        for f in arriving_at_airport
                        if (f.leg_id, f.edge_id) in self.vars["x_f"]
                    ]
                    
                    departing_other_vars = [
                        self.vars["x_f"][(f.leg_id, f.edge_id)]
                        for f in departing_from_other
                        if (f.leg_id, f.edge_id) in self.vars["x_f"]
                    ]
                    
                    if arriving_vars and departing_other_vars:
                        # If landing at this airport, cannot depart from other airports
                        for arr_var in arriving_vars:
                            for dep_var in departing_other_vars:
                                self.model += (
                                    arr_var + dep_var <= 1
                                ), f"apt_cont_{leg_n}_{leg_n1}_{airport}_{continuity_constraints_added}"
                                continuity_constraints_added += 1
        
        if continuity_constraints_added > 0:
            logger.info(f"[Solver] Added {continuity_constraints_added} airport continuity constraints")
    
    def _add_budget_constraint(self):
        """
        Add cash budget constraint (HARD LIMIT).
        
        CRITICAL: This is a hard constraint, not a preference.
        The solver MUST find a solution within budget or return INFEASIBLE.
        
        Constraint:
            total_out_of_pocket <= cash_budget
        
        Where total_out_of_pocket =
            - For cash bookings: full ticket price
            - For award bookings: surcharge (taxes/fees) only
        
        This FORCES points usage when budget is tight:
            - Budget: $500, All-cash: $2,000 → Must use points
            - Points: 50k + $80 surcharge → OOP = $80 ✓ (within budget)
        """
        if self.cash_budget is None or self.cash_budget <= 0:
            logger.info("[Budget] No budget constraint set - optimizing without cash limit")
            return
        
        logger.info("=" * 80)
        logger.info(f"[Budget] ADDING HARD BUDGET CONSTRAINT: OOP <= ${self.cash_budget:,.2f}")
        logger.info("=" * 80)
        
        # Count variables for logging
        cash_var_count = len(self.vars.get("z_cf", {}))
        points_var_count = len(self.vars.get("y_pf", {}))
        
        logger.info(f"[Budget] Cash payment vars: {cash_var_count}, Points payment vars: {points_var_count}")
        
        # Sum of cash payments (full ticket price when paying cash)
        flight_cash = lpSum(
            self.vars["z_cf"][(f.leg_id, f.edge_id, p)] * f.cash_cost
            for f in self.flights
            for p in self.spec.all_traveler_ids
            if (f.leg_id, f.edge_id, p) in self.vars["z_cf"]
        )
        
        # Sum of surcharges (taxes/fees when paying with points)
        flight_surcharge = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] * opt.surcharge
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        # Log what we're constraining
        best_cash = self._compute_best_cash_price()
        lowest_surcharge = self._compute_lowest_surcharge()
        
        logger.info(f"[Budget] Best all-cash price: ${best_cash:,.2f}")
        logger.info(f"[Budget] Lowest all-points surcharge: ${lowest_surcharge:,.2f}")
        
        if self.cash_budget < lowest_surcharge:
            logger.warning(
                f"[Budget] ⚠️ INFEASIBLE: Budget ${self.cash_budget:,.2f} < "
                f"minimum surcharge ${lowest_surcharge:,.2f}. No solution possible!"
            )
        elif self.cash_budget < best_cash:
            logger.info(
                f"[Budget] ✓ Budget ${self.cash_budget:,.2f} < all-cash ${best_cash:,.2f} → "
                f"Solver MUST use points to meet budget"
            )
        else:
            logger.info(
                f"[Budget] Budget ${self.cash_budget:,.2f} >= all-cash ${best_cash:,.2f} → "
                f"Cash option is feasible, but points may still be preferred"
            )
        
        # Add the constraint
        self.model += (
            flight_cash + flight_surcharge <= self.cash_budget
        ), "cash_budget_hard_limit"
        
        logger.info(f"[Budget] Constraint added: flight_cash + flight_surcharge <= {self.cash_budget}")
        logger.info("=" * 80)
    
    def _solve_two_pass(self) -> OptimizationResult:
        """
        Two-pass solve with robust slack.
        
        SAFE APPROACH: Build a fresh model for pass 2 to avoid
        PuLP objective state issues.
        
        FALLBACK BEHAVIOR: If budget constraint makes model infeasible,
        automatically relax it and return the closest feasible solution
        with an appropriate warning.
        """
        
        try:
            from pulp import PULP_CBC_CMD
        except ImportError:
            return OptimizationResult(
                status=OptimizationStatus.ERROR,
                solution=None,
                warnings=["PuLP not available"],
                suggestions=["Install pulp: pip install pulp"],
                infeasibility_reason="Solver not available",
            )
        
        threads = (
            self.solver_config.threads_determinism if self.determinism_mode
            else self.solver_config.threads_production
        )
        
        solver = PULP_CBC_CMD(
            msg=False,
            timeLimit=self.solver_config.time_limit_seconds,
            gapRel=self.solver_config.mip_gap,
            threads=threads,
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # STAGE 1: Minimize OOP (primary objective)
        # ═══════════════════════════════════════════════════════════════════
        
        primary = self._build_primary_objective()
        
        # Set objective directly (not via +=)
        self.model.objective = primary
        self.model.sense = LpMinimize
        
        status = self.model.solve(solver)
        
        self.metrics.pass1_status = LpStatus[status]
        
        if status != LpStatusOptimal:
            if V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED:
                # ═══════════════════════════════════════════════════════
                # LEXICOGRAPHIC MODE: No tier escalation.
                # All award options already have variables (no CPP gates).
                # If infeasible, go directly to closest-plan.
                # ═══════════════════════════════════════════════════════
                if self.cash_budget and self.cash_budget > 0:
                    logger.warning(
                        f"[Solver] Stage 1 infeasible with budget ${self.cash_budget:.0f}. "
                        f"Budget cannot be met. Finding closest plan..."
                    )
                    
                    if V3_CLOSEST_PLAN_ENABLED:
                        fallback_result = self._solve_closest_plan(solver)
                        if fallback_result:
                            return fallback_result
                
                return OptimizationResult(
                    status=OptimizationStatus.INFEASIBLE_MODEL,
                    solution=None,
                    warnings=[],
                    suggestions=["No feasible solution within budget. Check constraints and available points."],
                    infeasibility_reason="No feasible solution found",
                )
            else:
                # ═══════════════════════════════════════════════════════
                # LEGACY MODE: Tier escalation + budget constraint removal
                # ═══════════════════════════════════════════════════════
                if self.cash_budget and self.cash_budget > 0:
                    current_tier = getattr(self, 'budget_tier', 'normal')
                    logger.warning(
                        f"[Solver] Model infeasible with budget ${self.cash_budget:.0f} "
                        f"(tier={current_tier}). Escalating guardrails to prioritize points..."
                    )
                    
                    escalated_result = self._solve_with_escalated_guardrails(solver, current_tier)
                    if escalated_result:
                        return escalated_result
                    
                    logger.warning(
                        f"[Solver] All guardrail tiers exhausted. "
                        f"Removing budget constraint to find closest feasible solution..."
                    )
                    fallback_result = self._solve_without_budget_constraint(solver, primary)
                    if fallback_result:
                        return fallback_result
                
                return OptimizationResult(
                    status=OptimizationStatus.INFEASIBLE_MODEL,
                    solution=None,
                    warnings=[],
                    suggestions=["Model infeasible. Check constraints."],
                    infeasibility_reason="No feasible solution found",
                )
        
        oop_star = value(primary)
        self.metrics.pass1_objective = oop_star
        
        logger.info(f"[V3] stage1 oop_star={oop_star:.2f}")
        
        if V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED:
            # ═══════════════════════════════════════════════════════════════
            # STAGE 2 (Lexicographic): Maximize quality within OOP envelope
            # ═══════════════════════════════════════════════════════════════
            # Use delta override from comfort config if set (e.g., money-saver mode uses 0)
            if self.comfort_config.stage2_delta_override is not None:
                delta = self.comfort_config.stage2_delta_override
                logger.info(f"[V3] stage2 delta={delta:.2f} (OVERRIDE from comfort config)")
            else:
                delta = compute_stage2_delta(self.cash_budget or 0, oop_star)
            self.metrics.pass1_slack = delta
            
            logger.info(
                f"[V3] stage2 delta={delta:.2f} "
                f"(budget={self.cash_budget}, oop_star={oop_star:.2f})"
            )
            
            # Add OOP envelope constraint
            self.model += primary <= oop_star + delta, "oop_envelope"
            
            # Build quality-maximization objective
            secondary = self._build_lexicographic_quality_objective()
            self.model.objective = secondary
            # Maximize quality (LpMinimize of negative = maximize)
            self.model.sense = LpMinimize
            
            status = self.model.solve(solver)
            
            self.metrics.pass2_status = LpStatus[status]
            self.metrics.pass2_objective = value(secondary) if status == LpStatusOptimal else 0
            
            logger.info(f"[V3] stage2 quality={self.metrics.pass2_objective:.4f}")
            
        else:
            # ═══════════════════════════════════════════════════════════════
            # LEGACY PASS 2: Tie-break within slack
            # ═══════════════════════════════════════════════════════════════
            abs_eps = self.slack_config.get_abs_eps(self.is_international)
            slack = max(abs_eps, self.slack_config.rel_eps * abs(oop_star))
            self.metrics.pass1_slack = slack
            
            logger.debug(
                f"[Two-Pass] Pass 1 objective: ${oop_star:.2f}, "
                f"Comfort budget (slack): ${slack:.2f} "
                f"(abs_eps=${abs_eps}, rel_eps={self.slack_config.rel_eps*100:.0f}%, "
                f"is_intl={self.is_international})"
            )
            
            self.model += primary <= oop_star + slack, "pass1_bound"
            
            secondary = self._build_secondary_objective(slack)
            self.model.objective = secondary
            
            status = self.model.solve(solver)
            
            self.metrics.pass2_status = LpStatus[status]
            self.metrics.pass2_objective = value(secondary) if status == LpStatusOptimal else 0
        
        # Log budget status
        budget_status = "no_budget_set"
        if self.cash_budget and self.cash_budget > 0:
            budget_status = "within_budget"
        logger.info(
            f"[V3] budget_status={budget_status} "
            f"user_budget={self.cash_budget} actual_oop={oop_star:.2f} shortfall=0"
        )
        
        # Extract solution
        solution = self._extract_solution()
        
        return OptimizationResult(
            status=OptimizationStatus.OPTIMAL if status == LpStatusOptimal else OptimizationStatus.FEASIBLE_SUBOPTIMAL,
            solution=solution,
            pass1_objective=oop_star,
            pass1_slack=self.metrics.pass1_slack,
            pass2_objective=self.metrics.pass2_objective,
            warnings=[],
            suggestions=[],
        )
    
    # ═══════════════════════════════════════════════════════════════════════
    # GUARDRAIL ESCALATION: Prioritize points when budget is tight
    # ═══════════════════════════════════════════════════════════════════════
    
    # Tier escalation order: each tier relaxes quality guards further
    TIER_ESCALATION_ORDER = ["normal", "tight", "very_tight", "critical"]
    
    def _solve_with_escalated_guardrails(
        self, solver, current_tier: str
    ) -> Optional[OptimizationResult]:
        """
        Progressively relax guardrails to find a within-budget solution using points.
        
        When the model is infeasible at the current budget tier, this method
        escalates through higher tiers (tight → very_tight → critical),
        rebuilding the model each time with relaxed quality guards. This allows
        more award options to be considered, potentially finding a points-heavy
        solution that stays within the user's budget.
        
        Returns an OptimizationResult if a feasible solution is found at any
        escalated tier, or None if even "critical" (no restrictions) is infeasible.
        """
        
        # Determine which tiers to try (only those above the current tier)
        try:
            current_idx = self.TIER_ESCALATION_ORDER.index(current_tier)
        except ValueError:
            current_idx = 0  # Default to trying all tiers
        
        tiers_to_try = self.TIER_ESCALATION_ORDER[current_idx + 1:]
        
        if not tiers_to_try:
            logger.info(
                f"[Guardrail Escalation] Already at highest tier ({current_tier}). "
                f"No further escalation possible."
            )
            return None
        
        logger.info("=" * 80)
        logger.info(
            f"[Guardrail Escalation] Current tier: {current_tier.upper()}. "
            f"Will try: {' → '.join(t.upper() for t in tiers_to_try)}"
        )
        logger.info("=" * 80)
        
        for tier in tiers_to_try:
            logger.info(
                f"[Guardrail Escalation] Trying tier={tier.upper()} "
                f"(relaxing quality guards to accept more award options)..."
            )
            
            # Override the budget tier and rebuild the model
            self._override_budget_tier = tier
            
            try:
                self._build_model()
                
                # Build and set objective
                primary = self._build_primary_objective()
                self.model.objective = primary
                self.model.sense = LpMinimize
                
                # Solve
                status = self.model.solve(solver)
                
                if status == LpStatusOptimal:
                    opt1 = value(primary)
                    logger.info(
                        f"[Guardrail Escalation] ✅ FEASIBLE at tier={tier.upper()}! "
                        f"OOP=${opt1:.2f} (within budget ${self.cash_budget:.0f})"
                    )
                    
                    # Run pass 2 for tie-breaking
                    abs_eps = self.slack_config.get_abs_eps(self.is_international)
                    slack = max(abs_eps, self.slack_config.rel_eps * abs(opt1))
                    
                    self.model += primary <= opt1 + slack, "pass1_bound"
                    
                    secondary = self._build_secondary_objective(slack)
                    self.model.objective = secondary
                    
                    status = self.model.solve(solver)
                    
                    self.metrics.pass2_status = LpStatus[status]
                    self.metrics.pass2_objective = value(secondary) if status == LpStatusOptimal else 0
                    
                    solution = self._extract_solution()
                    
                    # Add a note about escalated guardrails
                    escalation_note = (
                        f"Used relaxed redemption criteria (tier={tier}) to stay within budget. "
                        f"Some point redemptions may have lower-than-ideal value."
                    )
                    
                    return OptimizationResult(
                        status=OptimizationStatus.OPTIMAL,
                        solution=solution,
                        pass1_objective=opt1,
                        pass1_slack=slack,
                        pass2_objective=self.metrics.pass2_objective,
                        warnings=[escalation_note],
                        suggestions=[],
                    )
                else:
                    logger.info(
                        f"[Guardrail Escalation] ❌ Still infeasible at tier={tier.upper()}. "
                        f"Trying next tier..."
                    )
            finally:
                # Always clear the override after each attempt
                self._override_budget_tier = None
        
        logger.warning(
            f"[Guardrail Escalation] All tiers exhausted (up to CRITICAL). "
            f"Budget ${self.cash_budget:.0f} cannot be met even with unrestricted points usage."
        )
        return None
    
    def _solve_without_budget_constraint(self, solver, primary) -> Optional[OptimizationResult]:
        """
        Solve without the budget constraint to find the closest feasible solution.
        
        This is called when the original model is infeasible due to budget AND
        guardrail escalation has already been attempted.
        Returns an OptimizationResult with the closest solution and a warning
        about how much it exceeds the budget.
        """
        logger.info("[Solver] Rebuilding model without budget constraint for fallback solve...")
        
        # Store original budget and disable it
        original_budget = self.cash_budget
        self.cash_budget = None
        
        try:
            # Rebuild the model without budget constraint
            self._build_model()
            
            # Build and set objective
            primary = self._build_primary_objective()
            self.model.objective = primary
            self.model.sense = LpMinimize
            
            # Solve
            status = self.model.solve(solver)
            
            if status != LpStatusOptimal:
                logger.warning("[Solver] Even without budget constraint, model is infeasible")
                return None
            
            opt1 = value(primary)
            logger.info(f"[Solver] Fallback solve found solution with OOP: ${opt1:.2f}")
            
            # Calculate how much over budget
            budget_excess = opt1 - original_budget if original_budget else 0
            
            # Build warning message
            warning_msg = (
                f"No itinerary available within your ${original_budget:.0f} budget. "
                f"The closest option costs ${opt1:.0f} (${budget_excess:.0f} over budget)."
            )
            
            suggestion_msg = (
                f"Consider increasing your budget to ${opt1:.0f} or adding more points balances."
            )
            
            # Run pass 2 for tie-breaking
            abs_eps = self.slack_config.get_abs_eps(self.is_international)
            slack = max(abs_eps, self.slack_config.rel_eps * abs(opt1))
            
            # Add pass1 bound constraint
            self.model += primary <= opt1 + slack, "pass1_bound"
            
            # Build and set secondary objective
            secondary = self._build_secondary_objective(slack)
            self.model.objective = secondary
            
            status = self.model.solve(solver)
            
            # Extract solution
            solution = self._extract_solution()
            
            # Mark that this solution exceeds budget
            if solution:
                solution.budget_exceeded = True
                solution.budget_excess_amount = budget_excess
                solution.original_budget = original_budget
            
            return OptimizationResult(
                status=OptimizationStatus.FEASIBLE_SUBOPTIMAL,
                solution=solution,
                pass1_objective=opt1,
                pass1_slack=slack,
                pass2_objective=value(secondary) if status == LpStatusOptimal else 0,
                warnings=[warning_msg],
                suggestions=[suggestion_msg],
                infeasibility_reason=None,
                budget_exceeded=True,
                budget_excess_amount=budget_excess,
            )
            
        finally:
            # Restore original budget setting
            self.cash_budget = original_budget
    
    def _build_primary_objective(self):
        """
        Build primary objective: MINIMIZE CASH OUT-OF-POCKET.
        
        SIMPLIFIED: Single optimization mode. Budget is the constraint.
        
        Objective:
            Minimize: cash_paid + surcharges + convenience_penalties
        
        When paying with points, cash_paid = 0, only surcharges apply.
        This naturally prefers points when they save cash.
        
        The budget constraint (if set) FORCES points usage when cash exceeds budget.
        """
        return self._build_oop_objective()
    
    def _build_oop_objective(self):
        """
        OOP: Minimize OUT-OF-POCKET cash (cash + surcharges + convenience costs).
        
        DESIGN PRINCIPLE: OOP mode should ENCOURAGE using points to save cash.
        
        The objective is:
            total_cost = cash + surcharge + convenience_penalties + tiny_points_tiebreaker
        
        The points tiebreaker is TINY (0.2¢/point by default) - it only matters when
        two options have the same cash cost, preferring fewer points in that case.
        
        This makes Tripy behave like: "Use points to reduce cash now."
        
        Terrible redemptions are blocked by the CPP floor constraint (separate).
        """
        cfg = self.comfort_config
        
        # ═══════════════════════════════════════════════════════════════════════
        # MONETARY COST: Cash + Surcharges (this is what we minimize!)
        # ═══════════════════════════════════════════════════════════════════════
        
        # Flight cash payments
        flight_cash = lpSum(
            self.vars["z_cf"][(f.leg_id, f.edge_id, p)] * f.cash_cost
            for f in self.flights
            for p in self.spec.all_traveler_ids
        )
        
        # Flight surcharges (taxes/fees for award bookings)
        flight_surcharge = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] * opt.surcharge
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        # ═══════════════════════════════════════════════════════════════════════
        # CONVENIENCE COSTS (Generalized Cost Model)
        # ═══════════════════════════════════════════════════════════════════════
        
        stop_cost = cfg.get_stop_cost(self.is_international)
        baseline_hours = cfg.get_baseline_hours(self.is_international)
        
        # Stop penalty: Real cost per stop ($100 domestic, $175 international)
        stops_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * stop_cost
            for f in self.flights
        )
        
        # Time penalty: $20 per hour over baseline
        # (e.g., a 10-hour flight when baseline is 4 hours = 6 * $20 = $120 penalty)
        time_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] 
            * max(0, (f.total_time_minutes / 60.0) - baseline_hours) 
            * cfg.time_cost_per_hour
            for f in self.flights
        )
        
        # Layover penalty: $25 per hour after 90 minutes
        # Sum all layover times that exceed baseline
        layover_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] 
            * self._compute_excess_layover_hours(f) 
            * cfg.layover_cost_per_hour
            for f in self.flights
        )
        
        # Quality penalties (redeye, carrier change, short connection)
        quality_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * (
                (cfg.redeye_cost if f.is_redeye else 0) +
                (cfg.carrier_change_cost if f.has_carrier_change else 0) +
                (cfg.short_connection_cost if f.has_short_connection else 0)
            )
            for f in self.flights
        )
        
        # ═══════════════════════════════════════════════════════════════════════
        # POINTS OPPORTUNITY COST (OFF BY DEFAULT IN OOP MODE)
        # ═══════════════════════════════════════════════════════════════════════
        #
        # FLIGHTS-ONLY DESIGN: OOP minimizes *cash leaving the bank*.
        # Points opportunity cost is OFF (0.0) so points naturally win when
        # they save cash.
        #
        # Pass 2 handles "don't waste points" by minimizing miles within
        # the comfort budget.
        #
        # CPP floor + miles-per-$ guards block terrible redemptions.
        #
        # Example with opportunity cost OFF:
        #   Cash: $500, Points: 50k + $80 surcharge
        #   OOP cost (cash): $500 + convenience
        #   OOP cost (points): $80 + convenience  ← Points wins by $420!
        #
        # The CPP floor (1.1¢) and miles-per-$ cap (140) prevent garbage.
        
        points_tiebreaker = 0
        opp_cost_rate = cfg.points_opportunity_cost_oop  # 0 in OOP mode (points preferred!)
        
        if opp_cost_rate > 0:
            # Only used if configured (e.g., for Balanced mode or custom configs)
            points_tiebreaker = lpSum(
                self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] 
                * opt.miles_required 
                * opp_cost_rate / 100.0  # Convert ¢ to $
                for f in self.flights
                for opt in f.award_options
                for p in self.spec.all_traveler_ids
                for src in self._get_sources_for_program(p, opt.program)
                if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
            )
        
        # ═══════════════════════════════════════════════════════════════════════
        # TOTAL GENERALIZED COST
        # ═══════════════════════════════════════════════════════════════════════
        
        total_cost = (
            flight_cash + 
            flight_surcharge + 
            stops_penalty + 
            time_penalty + 
            layover_penalty + 
            quality_penalty +
            points_tiebreaker
        )
        
        if opp_cost_rate == 0:
            logger.info(
                f"[OOP Objective] Minimize CASH leaving bank (points preferred!): "
                f"OOP = cash + surcharge + convenience | "
                f"stop=${stop_cost}/stop, time=${cfg.time_cost_per_hour}/hr | "
                f"points_opp_cost=OFF, is_intl={self.is_international}"
            )
        else:
            logger.info(
                f"[OOP Objective] Minimize cash + tiny points cost: "
                f"stop=${stop_cost}/stop, time=${cfg.time_cost_per_hour}/hr, "
                f"points_opp_cost={opp_cost_rate}¢/pt, is_intl={self.is_international}"
            )
        
        return total_cost
    
    def _compute_excess_layover_hours(self, flight: FlightItineraryEdge) -> float:
        """
        Compute total excess layover time in hours.
        
        Excess = sum of (layover - baseline) for each connection, where baseline is 90 min.
        Only counts time OVER the baseline (reasonable connections aren't penalized).
        """
        cfg = self.comfort_config
        baseline_minutes = cfg.baseline_layover_minutes
        
        if len(flight.segments) <= 1:
            return 0.0
        
        total_excess_minutes = 0.0
        for i in range(len(flight.segments) - 1):
            s1 = flight.segments[i]
            s2 = flight.segments[i + 1]
            
            if s1.arrival and s2.departure:
                layover_minutes = (s2.departure - s1.arrival).total_seconds() / 60.0
                if layover_minutes > baseline_minutes:
                    total_excess_minutes += (layover_minutes - baseline_minutes)
        
        return total_excess_minutes / 60.0  # Convert to hours
    
    def _build_cpp_objective(self):
        """
        CPP: Maximize value (negated for minimize) with real convenience costs.
        
        Uses the same generalized cost model as OOP, but prioritizes value.
        """
        cfg = self.comfort_config
        stop_cost = cfg.get_stop_cost(self.is_international)
        
        # Flight value (soft_value_cpp precomputed in precompute.py)
        flight_value = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] * opt.soft_value_cpp
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        # Stops penalty: Use real convenience cost (same as OOP)
        stops_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * stop_cost
            for f in self.flights
        )
        
        # Quality penalties (redeye, carrier change)
        quality_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * (
                (cfg.redeye_cost if f.is_redeye else 0) +
                (cfg.carrier_change_cost if f.has_carrier_change else 0) +
                (cfg.short_connection_cost if f.has_short_connection else 0)
            )
            for f in self.flights
        )
        
        # Negate for minimize: minimize(-value + convenience_costs)
        return -flight_value + stops_penalty + quality_penalty
    
    def _build_balanced_objective(self):
        """Balanced: Value utility - cash penalty."""
        
        cfg = self.balanced_config
        
        # Flight utility (normalized)
        flight_utility = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)]
            * (opt.soft_value_balanced / self.K_flight)
            * cfg.flight_importance
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        # Cash cost (reuse OOP objective)
        cash_cost = self._build_oop_objective()
        
        # Total: minimize (cash_penalty - utility) = minimize cash - maximize utility
        return cfg.cash_penalty_weight * cash_cost - flight_utility
    
    def _build_secondary_objective(self, slack: float):
        """
        Secondary objective: tie-break within OOP slack.
        
        ADAPTIVE BEHAVIOR based on budget tier:
        
        NORMAL/TIGHT budget (budget >= $100):
            Priority: minimize miles → time → stops
            Reason: "Don't waste points" - user has flexibility
        
        VERY TIGHT budget (budget < $100):
            Priority: minimize time → stops → miles
            Reason: "I can go + don't kill me" - user already knows they're spending points
        
        This ensures:
            - Normal users don't waste points on similarly priced options
            - Budget-constrained users get the best experience within their limit
        """
        
        n = len(self.flights)
        if n > 1:
            safe_eps = (1e-6 * abs(slack)) / (n * (n - 1) / 2) if slack != 0 else 1e-10
        else:
            safe_eps = 1e-10
        
        safe_eps = max(1e-15, min(1e-6, safe_eps))
        
        # ═══════════════════════════════════════════════════════════════════════
        # COMPUTE COST COMPONENTS
        # ═══════════════════════════════════════════════════════════════════════
        
        miles_cost = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] 
            * opt.miles_required 
            * 0.001  # 0.1¢ per mile = $0.001
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        time_cost = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.total_time_minutes * 0.0001
            for f in self.flights
        )
        
        stops_cost = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * 0.001
            for f in self.flights
        )
        
        # Deterministic tie-breaker
        all_keys = sorted(self.vars["x_f"].keys())
        tie = lpSum(
            self.vars["x_f"][k] * (i * safe_eps)
            for i, k in enumerate(all_keys)
        )
        
        # ═══════════════════════════════════════════════════════════════════════
        # ADAPTIVE PRIORITY BASED ON BUDGET TIER
        # ═══════════════════════════════════════════════════════════════════════
        
        budget_tier = getattr(self, 'budget_tier', 'normal')
        
        if budget_tier in ("very_tight", "critical"):
            # VERY TIGHT / CRITICAL: Budget is the priority, user is committed to spending points.
            # Priority: time → stops → miles (best experience within budget)
            logger.info(
                f"[Pass 2] Budget tier={budget_tier.upper()}: prioritizing convenience (time → stops → miles)"
            )
            # Scale: time dominates, then stops, then miles
            return (time_cost * 100) + (stops_cost * 10) + miles_cost + tie
        else:
            # NORMAL/TIGHT: User has some flexibility, balance points efficiency
            # Priority: miles → time → stops
            logger.info(
                f"[Pass 2] Budget tier={budget_tier.upper()}: prioritizing efficiency (miles → time → stops)"
            )
            # Scale: miles dominate, then time, then stops
            return miles_cost + time_cost + stops_cost + tie
    
    def _build_lexicographic_quality_objective(self):
        """
        Stage 2 quality objective for lexicographic mode.
        
        MAXIMIZE quality (we negate and minimize):
        - CPP quality (primary — reward good redemption value): +1000 per cpp cent
        - Transfer count penalty: -200 per transfer
        - Program diversity penalty: -100 per distinct program used
        - Stops penalty: -150 per stop
        - Travel time penalty: -50 per hour over baseline
        - Deterministic tie-breaker: tiny bonus for lower edge index
        """
        cfg = self.comfort_config
        baseline_hours = cfg.get_baseline_hours(self.is_international)
        
        # Term 1: CPP quality (reward good redemption value)
        cpp_quality = lpSum(
            self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)]
            * getattr(opt, '_cpp_quality', 0) * 10  # Scale: 10 per cpp cent
            for f in self.flights
            for opt in f.award_options
            for p in self.spec.all_traveler_ids
            for src in self._get_sources_for_program(p, opt.program)
            if (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
        )
        
        # Term 2: Transfer count penalty
        transfer_penalty = lpSum(
            self.vars["u_tr"][k] * 200
            for k in self.vars.get("u_tr", {})
        )
        
        # Term 3: Stops penalty (150 per stop)
        stops_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * 150
            for f in self.flights
        )
        
        # Term 4: Travel time penalty (50 per hour over baseline)
        time_penalty = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)]
            * max(0, (f.total_time_minutes / 60.0) - baseline_hours)
            * 50
            for f in self.flights
        )
        
        # Term 5: Deterministic tie-breaker (tiny bonus for lower edge index)
        all_keys = sorted(self.vars["x_f"].keys())
        tie = lpSum(
            self.vars["x_f"][k] * (i * 0.001)
            for i, k in enumerate(all_keys)
        )
        
        # Minimize negative quality = maximize quality
        # quality = cpp_quality - transfer_penalty - stops_penalty - time_penalty
        # minimize: -quality + tie = -cpp_quality + transfer_penalty + stops_penalty + time_penalty + tie
        return -cpp_quality + transfer_penalty + stops_penalty + time_penalty + tie
    
    def _solve_closest_plan(self, solver) -> Optional[OptimizationResult]:
        """
        Find the closest feasible plan when budget is infeasible.
        
        Invariant: "Closest plan" = minimum OOP under the SAME constraints
        as the original request, EXCEPT `OOP <= budget` is removed.
        
        Preserves: allowed_currencies, max_points_by_currency, payer separation,
        transfer increments, cabin/stops/airline filters, same search result snapshot.
        Only removes: the budget hard constraint.
        """
        logger.info("[Solver] Finding closest plan (same constraints, no budget)...")
        
        original_budget = self.cash_budget
        self.cash_budget = None
        
        try:
            # Rebuild model without budget constraint (same flights, same constraints)
            self._build_model()
            
            primary = self._build_primary_objective()
            self.model.objective = primary
            self.model.sense = LpMinimize
            
            status = self.model.solve(solver)
            
            if status != LpStatusOptimal:
                logger.warning("[Solver] Even without budget, model is infeasible")
                return None
            
            min_feasible_oop = value(primary)
            shortfall = min_feasible_oop - original_budget if original_budget else 0
            
            logger.info(
                f"[V3] budget_status=closest_over_budget "
                f"user_budget={original_budget} actual_oop={min_feasible_oop:.2f} "
                f"shortfall={shortfall:.2f}"
            )
            
            # Run Stage 2 for quality within closest plan
            if V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED:
                delta = compute_stage2_delta(original_budget or 0, min_feasible_oop)
                self.model += primary <= min_feasible_oop + delta, "oop_envelope"
                secondary = self._build_lexicographic_quality_objective()
            else:
                abs_eps = self.slack_config.get_abs_eps(self.is_international)
                slack = max(abs_eps, self.slack_config.rel_eps * abs(min_feasible_oop))
                self.model += primary <= min_feasible_oop + slack, "pass1_bound"
                secondary = self._build_secondary_objective(slack)
            
            self.model.objective = secondary
            self.model.sense = LpMinimize
            status = self.model.solve(solver)
            
            solution = self._extract_solution()
            
            if solution:
                solution.budget_exceeded = True
                solution.budget_excess_amount = shortfall
                solution.original_budget = original_budget
            
            warning_msg = (
                f"No itinerary available within your ${original_budget:.0f} budget. "
                f"The closest option costs ${min_feasible_oop:.0f} "
                f"(${shortfall:.0f} over budget)."
            )
            suggestion_msg = (
                f"Consider increasing your budget to ${min_feasible_oop * 1.10:.0f} "
                f"or adding more points balances."
            )
            
            return OptimizationResult(
                status=OptimizationStatus.FEASIBLE_SUBOPTIMAL,
                solution=solution,
                pass1_objective=min_feasible_oop,
                pass1_slack=0,
                pass2_objective=value(secondary) if status == LpStatusOptimal else 0,
                warnings=[warning_msg],
                suggestions=[suggestion_msg],
                budget_exceeded=True,
                budget_excess_amount=shortfall,
            )
        finally:
            self.cash_budget = original_budget
    
    def _log_flight_options_detail(self):
        """
        Log detailed cost breakdown for each flight option.
        
        This helps diagnose why the solver picks certain flights.
        """
        cfg = self.comfort_config
        stop_cost = cfg.get_stop_cost(self.is_international)
        baseline_hours = cfg.get_baseline_hours(self.is_international)
        opp_cost_rate = cfg.points_opportunity_cost_oop
        
        logger.info("=" * 80)
        logger.info("[FLIGHT OPTIONS DETAIL] Cost breakdown for each option (OOP mode)")
        logger.info("=" * 80)
        
        # Group by leg
        for leg_id in sorted(set(f.leg_id for f in self.flights)):
            leg_flights = [f for f in self.flights if f.leg_id == leg_id]
            logger.info(f"\n--- LEG {leg_id}: {len(leg_flights)} flight options ---")
            
            options_with_costs = []
            
            for f in leg_flights:
                # Calculate convenience penalties
                excess_hours = max(0, (f.total_time_minutes / 60.0) - baseline_hours)
                time_penalty = excess_hours * cfg.time_cost_per_hour
                stops_penalty = f.num_stops * stop_cost
                layover_penalty = self._compute_excess_layover_hours(f) * cfg.layover_cost_per_hour
                quality_penalty = (
                    (cfg.redeye_cost if f.is_redeye else 0) +
                    (cfg.carrier_change_cost if f.has_carrier_change else 0) +
                    (cfg.short_connection_cost if f.has_short_connection else 0)
                )
                convenience_total = time_penalty + stops_penalty + layover_penalty + quality_penalty
                
                # Cash option cost
                cash_total = f.cash_cost + convenience_total
                options_with_costs.append({
                    'flight': f,
                    'method': 'CASH',
                    'out_of_pocket': f.cash_cost,
                    'convenience': convenience_total,
                    'tiebreaker': 0,
                    'total': cash_total,
                    'points': 0,
                    'cpp': 0,
                })
                
                # Award options
                for opt in f.award_options:
                    # Check if this option passed guards (has variable)
                    has_var = any(
                        (f.leg_id, f.edge_id, opt.option_id, p, src.source_id) in self.vars["y_pf"]
                        for p in self.spec.all_traveler_ids
                        for src in self._get_sources_for_program(p, opt.program)
                    )
                    
                    if not has_var:
                        # Rejected by guards
                        cash_saved = max(1.0, f.cash_cost - opt.surcharge)
                        actual_cpp = (cash_saved * 100) / opt.miles_required if opt.miles_required > 0 else 0
                        miles_per_dollar = opt.miles_required / cash_saved if cash_saved > 0 else float('inf')
                        logger.debug(
                            f"  [REJECTED] {opt.program} {opt.miles_required:,}pts + ${opt.surcharge} "
                            f"(CPP={actual_cpp:.2f}¢, miles/$={miles_per_dollar:.0f}) - failed guards"
                        )
                        continue
                    
                    # Calculate award cost
                    points_tiebreaker = opt.miles_required * opp_cost_rate / 100.0
                    award_total = opt.surcharge + convenience_total + points_tiebreaker
                    cash_saved = f.cash_cost - opt.surcharge
                    actual_cpp = (cash_saved * 100) / opt.miles_required if opt.miles_required > 0 else 0
                    
                    options_with_costs.append({
                        'flight': f,
                        'method': f'POINTS ({opt.program})',
                        'out_of_pocket': opt.surcharge,
                        'convenience': convenience_total,
                        'tiebreaker': points_tiebreaker,
                        'total': award_total,
                        'points': opt.miles_required,
                        'cpp': actual_cpp,
                        'option': opt,
                    })
            
            # Sort by total cost and log
            options_with_costs.sort(key=lambda x: x['total'])
            
            for i, opt in enumerate(options_with_costs[:10]):  # Top 10
                f = opt['flight']
                route = f"{f.origin}→{f.destination}"
                duration = f.total_time_minutes
                stops = f.num_stops
                
                if opt['method'] == 'CASH':
                    logger.info(
                        f"  #{i+1} [{opt['method']}] {route} {stops}stop {duration}min | "
                        f"OOP=${opt['out_of_pocket']:.0f} + conv=${opt['convenience']:.0f} = "
                        f"TOTAL=${opt['total']:.0f}"
                    )
                else:
                    logger.info(
                        f"  #{i+1} [{opt['method']}] {route} {stops}stop {duration}min | "
                        f"OOP=${opt['out_of_pocket']:.0f} + conv=${opt['convenience']:.0f} + tie=${opt['tiebreaker']:.1f} = "
                        f"TOTAL=${opt['total']:.0f} | {opt['points']:,}pts ({opt['cpp']:.2f}¢/pt)"
                    )
            
            if len(options_with_costs) > 10:
                logger.info(f"  ... and {len(options_with_costs) - 10} more options")
        
        logger.info("=" * 80)
    
    def _extract_solution(self) -> Solution:
        """Extract solution from solved model."""
        
        solution = Solution()
        
        logger.info("\n" + "=" * 80)
        logger.info("[SOLUTION] Extracting selected flights and payments")
        logger.info("=" * 80)
        
        # Extract selected flights
        for f in self.flights:
            key = (f.leg_id, f.edge_id)
            var = self.vars["x_f"].get(key)
            if var is None:
                continue
            
            val = value(var)
            if val is None or val < 0.5:
                continue
            
            solution.selected_flights[f.leg_id] = f.edge_id
            
            # Extract payment
            payment_found = False
            for p in self.spec.all_traveler_ids:
                z_var = self.vars["z_cf"].get((f.leg_id, f.edge_id, p))
                if z_var and value(z_var) is not None and value(z_var) > 0.5:
                    solution.flight_payments[f.edge_id] = PaymentChoice(
                        payer_id=p,
                        method="cash",
                        cash_amount=f.cash_cost,
                    )
                    solution.total_cash += f.cash_cost
                    payment_found = True
                    
                    # Log the selection
                    logger.info(
                        f"  [LEG {f.leg_id}] SELECTED: {f.origin}→{f.destination} "
                        f"({f.num_stops} stops, {f.total_time_minutes}min) | "
                        f"💵 CASH ${f.cash_cost:.0f}"
                    )
                    
                    # Log why points wasn't chosen (if awards existed)
                    if f.award_options:
                        best_award = min(f.award_options, key=lambda o: o.surcharge)
                        logger.info(
                            f"      ⚠️ Had {len(f.award_options)} award option(s), "
                            f"best: {best_award.miles_required:,}pts + ${best_award.surcharge} surcharge"
                        )
                        # Check if any passed guards
                        passed_guards = sum(
                            1 for opt in f.award_options
                            if any(
                                (f.leg_id, f.edge_id, opt.option_id, px, src.source_id) in self.vars["y_pf"]
                                for px in self.spec.all_traveler_ids
                                for src in self._get_sources_for_program(px, opt.program)
                            )
                        )
                        if passed_guards == 0:
                            logger.warning(
                                f"      ❌ ALL award options rejected by CPP floor / miles-per-$ guards!"
                            )
                        else:
                            logger.info(
                                f"      ℹ️ {passed_guards} award option(s) passed guards but cash was cheaper overall"
                            )
                    else:
                        logger.info(f"      ℹ️ No award options available for this flight")
                    
                    break
                
                if payment_found:
                    break
                
                for opt in f.award_options:
                    for src in self._get_sources_for_program(p, opt.program):
                        ykey = (f.leg_id, f.edge_id, opt.option_id, p, src.source_id)
                        y_var = self.vars["y_pf"].get(ykey)
                        if y_var and value(y_var) is not None and value(y_var) > 0.5:
                            solution.flight_payments[f.edge_id] = PaymentChoice(
                                payer_id=p,
                                method="points",
                                award_option_id=opt.option_id,
                                funding_source_id=src.source_id,
                                cash_amount=opt.surcharge,
                                points_amount=opt.miles_required,
                            )
                            solution.total_cash += opt.surcharge
                            solution.total_points_by_program[opt.program] = (
                                solution.total_points_by_program.get(opt.program, 0) + opt.miles_required
                            )
                            solution.total_value += opt.raw_value
                            payment_found = True
                            
                            # Log the selection
                            cash_saved = f.cash_cost - opt.surcharge
                            cpp = (cash_saved * 100) / opt.miles_required if opt.miles_required > 0 else 0
                            logger.info(
                                f"  [LEG {f.leg_id}] SELECTED: {f.origin}→{f.destination} "
                                f"({f.num_stops} stops, {f.total_time_minutes}min) | "
                                f"✈️ POINTS {opt.miles_required:,} {opt.program} + ${opt.surcharge} surcharge "
                                f"({cpp:.2f}¢/pt, saves ${cash_saved:.0f} vs cash)"
                            )
                            
                            break
                    if payment_found:
                        break
                if payment_found:
                    break
        
        # Log summary with budget verification
        logger.info("-" * 80)
        logger.info(
            f"[SOLUTION SUMMARY] Total out-of-pocket: ${solution.total_cash:.0f}, "
            f"Points used: {solution.total_points_by_program}"
        )
        
        # ══════════════════════════════════════════════════════════════════
        # MULTI-CURRENCY TELEMETRY: Log which bank currencies were used
        # ══════════════════════════════════════════════════════════════════
        if solution.transfers_used or solution.total_points_by_program:
            logger.info("-" * 80)
            logger.info("[MULTI-CURRENCY SUMMARY]")
            
            # Count currencies actually used
            bank_currencies_used = {}
            for (payer, bank, program), blocks in solution.transfers_used.items():
                if blocks > 0:
                    # Find increment from transfer paths
                    tp = next((t for t in self.transfers if t.from_bank == bank and t.to_program == program), None)
                    points_used = blocks * (tp.min_increment if tp else 1000)
                    bank_currencies_used[bank] = bank_currencies_used.get(bank, 0) + points_used
            
            if bank_currencies_used:
                logger.info("  Bank currencies used (transferred):")
                for bank, points in bank_currencies_used.items():
                    traveler = next((t for t in self.spec.travelers), None)
                    available = traveler.bank_balances.get(bank, 0) if traveler else 0
                    pct = (points / available * 100) if available > 0 else 0
                    logger.info(f"    • {bank}: {points:,} pts used (of {available:,} available, {pct:.1f}%)")
            
            if solution.total_points_by_program:
                logger.info("  Target programs funded:")
                for prog, pts in solution.total_points_by_program.items():
                    logger.info(f"    • {prog}: {pts:,} pts")
            
            # Count currencies available but NOT used
            unused_banks = []
            for traveler in self.spec.travelers:
                for bank, balance in traveler.bank_balances.items():
                    if balance > 0 and bank not in bank_currencies_used:
                        unused_banks.append((bank, balance))
            
            if unused_banks:
                logger.info("  Currencies available but NOT used:")
                for bank, balance in unused_banks:
                    logger.info(f"    • {bank}: {balance:,} pts (not optimal for this route)")
        
        # Verify budget constraint
        if self.cash_budget and self.cash_budget > 0:
            if solution.total_cash <= self.cash_budget:
                logger.info(
                    f"[BUDGET CHECK] ✅ PASSED: ${solution.total_cash:.0f} <= "
                    f"budget ${self.cash_budget:.0f}"
                )
            else:
                logger.error(
                    f"[BUDGET CHECK] ❌ FAILED: ${solution.total_cash:.0f} > "
                    f"budget ${self.cash_budget:.0f} - THIS IS A BUG!"
                )
        logger.info("=" * 80 + "\n")
        
        # Extract transfers
        for key, var in self.vars.get("t_b", {}).items():
            val = value(var)
            if val is not None:
                blocks = int(round(val))
                if blocks > 0:
                    solution.transfers_used[key] = blocks
                    logger.info(f"  [TRANSFER] {key}: {blocks} blocks")
        
        return solution


# =============================================================================
# PUBLIC API
# =============================================================================

def optimize_trip(
    spec: TripPlanSpec,
    flights: List[FlightItineraryEdge],
    transfers: List[TransferPath],
    mode: str = "oop",  # Kept for API compatibility, but ignored
    determinism_mode: bool = False,
    is_international: bool = False,
    comfort_config: Optional[ComfortConfig] = None,
    pruning_config: Optional[PruningConfig] = None,
    cash_budget: Optional[float] = None,
) -> OptimizationResult:
    """
    Main entry point for V3 optimization (flights only).
    
    SIMPLIFIED: Single optimization mode. Budget is the constraint.
    
    Objective: Minimize cash out-of-pocket (cash + surcharges + convenience).
    
    Args:
        spec: Trip specification
        flights: Available flight itineraries
        transfers: Available transfer paths
        mode: IGNORED (kept for API compatibility) - always minimizes cash
        determinism_mode: Use single thread for reproducibility
        is_international: Whether this is an international route (affects penalties)
        comfort_config: Optional custom comfort configuration
        pruning_config: Optional custom pruning configuration
        cash_budget: Cash budget constraint (HARD LIMIT). When set:
                    - Solver MUST find solution within budget
                    - Forces points usage when cash exceeds budget
                    - Returns INFEASIBLE if even all-points exceeds budget
    
    Returns:
        OptimizationResult with solution, status, and metrics
    
    How it works:
        1. Minimize: cash_paid + surcharges + convenience_penalties
        2. If budget set: Add constraint (total_oop <= budget)
        3. Points naturally win when they save cash
        4. Budget forces points when cash exceeds limit
    
    Route type affects convenience penalties:
        - Domestic: $100/stop, 4hr baseline
        - International: $175/stop, 12hr baseline
    """
    
    # Always use OOP mode (minimize cash)
    solver = SolverV3(
        mode=Mode.OOP,
        determinism_mode=determinism_mode,
        is_international=is_international,
        comfort_config=comfort_config,
        pruning_config=pruning_config,
        cash_budget=cash_budget,
    )
    
    return solver.solve(spec, flights, transfers)
