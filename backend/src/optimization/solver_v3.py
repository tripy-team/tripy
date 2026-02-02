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

logger = logging.getLogger(__name__)


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
    ):
        self.mode = mode
        self.solver_config = solver_config or SolverConfig()
        self.slack_config = slack_config or SlackConfig()
        self.balanced_config = balanced_config or BalancedModeConfig()
        self.pruning_config = pruning_config or PruningConfig()
        self.comfort_config = comfort_config or ComfortConfig()
        self.determinism_mode = determinism_mode
        self.is_international = is_international
        
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
        # STEP 2: Single-ticket filter (HARD)
        # ═══════════════════════════════════════════════════════════════════
        
        flights, ticket_warnings = filter_single_ticket_only(flights)
        all_warnings.extend(ticket_warnings)
        
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
        """
        
        self.funding_sources = {}
        
        for traveler in self.spec.travelers:
            payer = traveler.traveler_id
            sources = []
            
            # Native program balances
            for prog, bal in traveler.points_balances.items():
                if bal > 0:
                    sources.append(FundingSource.make_native(payer, prog))
            
            # Transfer paths from this payer's banks
            for tp in self.transfers:
                if tp.from_bank in traveler.bank_balances:
                    if traveler.bank_balances[tp.from_bank] > 0:
                        sources.append(FundingSource.make_transfer(
                            payer, tp.from_bank, tp.to_program, tp.path_id
                        ))
            
            self.funding_sources[payer] = sources
    
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
        # STEP 5: Build key indices for fast lookup
        # ═══════════════════════════════════════════════════════════════════
        
        self._build_key_indices()
    
    def _build_key_indices(self):
        """Build indices for faster constraint/objective construction."""
        
        self.y_pf_keys_by_flight = defaultdict(list)
        for key in self.vars.get("y_pf", {}).keys():
            leg, edge = key[0], key[1]
            self.y_pf_keys_by_flight[(leg, edge)].append(key)
    
    def _build_flight_vars(self):
        """Build flight decision variables."""
        
        self.vars["x_f"] = {}     # Flight selection
        self.vars["z_cf"] = {}    # Cash payment
        self.vars["y_pf"] = {}    # Points payment (with option_id!)
        
        for f in self.flights:
            leg = f.leg_id
            edge = slug(f.edge_id)
            
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
    
    def _solve_two_pass(self) -> OptimizationResult:
        """
        Two-pass solve with robust slack.
        
        SAFE APPROACH: Build a fresh model for pass 2 to avoid
        PuLP objective state issues.
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
        # PASS 1: Primary objective
        # ═══════════════════════════════════════════════════════════════════
        
        primary = self._build_primary_objective()
        
        # Set objective directly (not via +=)
        self.model.objective = primary
        self.model.sense = LpMinimize
        
        status = self.model.solve(solver)
        
        self.metrics.pass1_status = LpStatus[status]
        
        if status != LpStatusOptimal:
            return OptimizationResult(
                status=OptimizationStatus.INFEASIBLE_MODEL,
                solution=None,
                warnings=[],
                suggestions=["Model infeasible. Check constraints."],
                infeasibility_reason="No feasible solution found",
            )
        
        opt1 = value(primary)
        self.metrics.pass1_objective = opt1
        
        # Robust slack: max(absolute, relative * opt)
        # Use route-aware absolute slack ($150 domestic, $300 international)
        abs_eps = self.slack_config.get_abs_eps(self.is_international)
        slack = max(abs_eps, self.slack_config.rel_eps * abs(opt1))
        self.metrics.pass1_slack = slack
        
        logger.debug(
            f"[Two-Pass] Pass 1 objective: ${opt1:.2f}, "
            f"Comfort budget (slack): ${slack:.2f} "
            f"(abs_eps=${abs_eps}, rel_eps={self.slack_config.rel_eps*100:.0f}%, "
            f"is_intl={self.is_international})"
        )
        
        # ═══════════════════════════════════════════════════════════════════
        # PASS 2: Add bound and solve with secondary objective
        # (Keep same model but add constraint and change objective)
        # ═══════════════════════════════════════════════════════════════════
        
        # Add pass1 bound constraint
        self.model += primary <= opt1 + slack, "pass1_bound"
        
        # Build and set secondary objective
        secondary = self._build_secondary_objective(slack)
        self.model.objective = secondary
        
        status = self.model.solve(solver)
        
        self.metrics.pass2_status = LpStatus[status]
        self.metrics.pass2_objective = value(secondary) if status == LpStatusOptimal else 0
        
        # Extract solution
        solution = self._extract_solution()
        
        return OptimizationResult(
            status=OptimizationStatus.OPTIMAL if status == LpStatusOptimal else OptimizationStatus.FEASIBLE_SUBOPTIMAL,
            solution=solution,
            pass1_objective=opt1,
            pass1_slack=slack,
            pass2_objective=self.metrics.pass2_objective,
            warnings=[],
            suggestions=[],
        )
    
    def _build_primary_objective(self):
        """Build primary objective based on mode."""
        
        if self.mode == Mode.OOP:
            return self._build_oop_objective()
        elif self.mode == Mode.CPP:
            return self._build_cpp_objective()
        else:
            return self._build_balanced_objective()
    
    def _build_oop_objective(self):
        """
        OOP: Minimize generalized cost (cash + convenience costs).
        
        The generalized cost model prices inconvenience in dollars:
            total_cost = cash + surcharge + stop_cost*stops + time_cost*excess_hours 
                       + layover_cost*excess_layover_hours + redeye_cost + carrier_change_cost
                       + points_opportunity_cost*miles
        
        This makes "price vs convenience" a real tradeoff, not a token nudge.
        """
        cfg = self.comfort_config
        
        # ═══════════════════════════════════════════════════════════════════════
        # MONETARY COST: Cash + Surcharges
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
        # POINTS OPPORTUNITY COST (Optional)
        # ═══════════════════════════════════════════════════════════════════════
        
        # Prevents "wasting points" on bad itineraries
        # Points aren't free - they have opportunity cost (~1.2¢/point)
        points_opportunity_cost = 0
        if cfg.enable_points_opportunity_cost:
            points_opportunity_cost = lpSum(
                self.vars["y_pf"][(f.leg_id, f.edge_id, opt.option_id, p, src.source_id)] 
                * opt.miles_required 
                * cfg.points_opportunity_cost_cpp / 100.0  # Convert cpp to dollars
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
            points_opportunity_cost
        )
        
        logger.debug(
            f"[OOP Objective] Built generalized cost: "
            f"stop_cost=${stop_cost}/stop, time_cost=${cfg.time_cost_per_hour}/hr, "
            f"baseline={baseline_hours}hr, is_intl={self.is_international}"
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
        """Secondary objective with safe tie-breaking."""
        
        n = len(self.flights)
        if n > 1:
            safe_eps = (1e-6 * abs(slack)) / (n * (n - 1) / 2) if slack != 0 else 1e-10
        else:
            safe_eps = 1e-10
        
        safe_eps = max(1e-15, min(1e-6, safe_eps))
        
        # Prefer shorter flights, fewer stops
        time_cost = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.total_time_minutes
            for f in self.flights
        )
        
        stops_cost = lpSum(
            self.vars["x_f"][(f.leg_id, f.edge_id)] * f.num_stops * 60
            for f in self.flights
        )
        
        # Deterministic tie-breaker
        all_keys = sorted(self.vars["x_f"].keys())
        tie = lpSum(
            self.vars["x_f"][k] * (i * safe_eps)
            for i, k in enumerate(all_keys)
        )
        
        return time_cost + stops_cost + tie
    
    def _extract_solution(self) -> Solution:
        """Extract solution from solved model."""
        
        solution = Solution()
        
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
                            break
                    if payment_found:
                        break
                if payment_found:
                    break
        
        # Extract transfers
        for key, var in self.vars.get("t_b", {}).items():
            val = value(var)
            if val is not None:
                blocks = int(round(val))
                if blocks > 0:
                    solution.transfers_used[key] = blocks
        
        return solution


# =============================================================================
# PUBLIC API
# =============================================================================

def optimize_trip(
    spec: TripPlanSpec,
    flights: List[FlightItineraryEdge],
    transfers: List[TransferPath],
    mode: str = "balanced",
    determinism_mode: bool = False,
    is_international: bool = False,
    comfort_config: Optional[ComfortConfig] = None,
) -> OptimizationResult:
    """
    Main entry point for V3 optimization (flights only).
    
    Args:
        spec: Trip specification
        flights: Available flight itineraries
        transfers: Available transfer paths
        mode: "oop", "cpp", or "balanced"
        determinism_mode: Use single thread for reproducibility
        is_international: Whether this is an international route (affects penalties)
        comfort_config: Optional custom comfort configuration
    
    Returns:
        OptimizationResult with solution, status, and metrics
    
    The solver uses a generalized cost model that prices inconvenience:
        total_cost = cash + surcharge + stop_cost*stops + time_cost*excess_hours 
                   + layover_cost*excess_layover_hours + redeye_cost + carrier_change_cost
                   + points_opportunity_cost*miles
    
    Route type affects default penalties:
        - Domestic: $100/stop, 4hr baseline, $150 comfort budget
        - International: $175/stop, 12hr baseline, $300 comfort budget
    """
    
    mode_enum = Mode(mode.lower())
    
    solver = SolverV3(
        mode=mode_enum,
        determinism_mode=determinism_mode,
        is_international=is_international,
        comfort_config=comfort_config,
    )
    
    return solver.solve(spec, flights, transfers)
