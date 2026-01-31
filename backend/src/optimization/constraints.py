"""
Constraint builders for the ILP optimization model.

This module provides modular functions for building specific types of constraints,
making the main solver code cleaner and more maintainable.
"""

from typing import Dict, List, Set, Tuple, Optional, Any
import logging

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

from .models import EdgeKey, TravelerId, AirlineCode, BankCode


logger = logging.getLogger(__name__)


# Type alias for PuLP variables
LpVar = Any  # pl.LpVariable when pulp is available


class ConstraintBuilder:
    """
    Builder class for ILP constraints.
    
    Encapsulates all constraint-building logic with clear method names.
    """
    
    def __init__(
        self,
        model: "pl.LpProblem",
        travelers: List[TravelerId],
        edges: List[EdgeKey],
        cities: List[str],
        airlines: List[AirlineCode],
        x: Dict[TravelerId, Dict[EdgeKey, LpVar]],  # Edge selection
        z: Dict[Tuple, Dict[EdgeKey, LpVar]],        # Cash payment
        y: Dict[Tuple, Dict[Tuple, Dict[EdgeKey, LpVar]]],  # Transfer payment
        y_native: Dict[Tuple, Dict[AirlineCode, Dict[EdgeKey, LpVar]]],  # Native payment
        t_blocks: Dict[TravelerId, Dict[Tuple, LpVar]],  # Transfer blocks
    ):
        self.model = model
        self.travelers = travelers
        self.edges = edges
        self.cities = cities
        self.airlines = airlines
        self.x = x
        self.z = z
        self.y = y
        self.y_native = y_native
        self.t_blocks = t_blocks
        
        self._constraint_count = 0
    
    def _add_constraint(self, constraint, name: Optional[str] = None):
        """Add a constraint to the model."""
        self.model += constraint
        self._constraint_count += 1
    
    @property
    def constraint_count(self) -> int:
        """Number of constraints added."""
        return self._constraint_count
    
    # =========================================================================
    # PATH CONSTRAINTS
    # =========================================================================
    
    def add_start_constraints(self, start_city: Dict[TravelerId, str]):
        """
        Add constraints: exactly 1 edge must leave each traveler's start city.
        
        ∑{e: e.origin == start[p]} x[p][e] = 1
        """
        for p in self.travelers:
            start = start_city.get(p)
            if not start:
                continue
            
            outgoing = [e for e in self.edges if e[0] == start]
            self._add_constraint(
                pl.lpSum(self.x[p][e] for e in outgoing) == 1,
                f"start_{p}"
            )
        
        logger.debug(f"Added {len(self.travelers)} start constraints")
    
    def add_end_constraints(self, end_city: Dict[TravelerId, str]):
        """
        Add constraints: exactly 1 edge must arrive at each traveler's end city.
        
        ∑{e: e.dest == end[p]} x[p][e] = 1
        """
        for p in self.travelers:
            end = end_city.get(p)
            if not end:
                continue
            
            incoming = [e for e in self.edges if e[1] == end]
            self._add_constraint(
                pl.lpSum(self.x[p][e] for e in incoming) == 1,
                f"end_{p}"
            )
        
        logger.debug(f"Added {len(self.travelers)} end constraints")
    
    def add_flow_conservation(
        self,
        start_city: Dict[TravelerId, str],
        end_city: Dict[TravelerId, str],
    ):
        """
        Add flow conservation constraints for intermediate cities.
        
        For each city that is not start or end:
        - Round trip (start == end): outflow == inflow
        - One-way start: net outflow of 1
        - One-way end: net inflow of 1
        - Transit: outflow == inflow
        """
        for p in self.travelers:
            start = start_city.get(p)
            end = end_city.get(p)
            
            for city in self.cities:
                outgoing = pl.lpSum(self.x[p][e] for e in self.edges if e[0] == city)
                incoming = pl.lpSum(self.x[p][e] for e in self.edges if e[1] == city)
                
                if city == start and city == end:
                    # Round trip: flow conservation (1 out, 1 in already enforced)
                    self._add_constraint(
                        outgoing == incoming,
                        f"flow_roundtrip_{p}_{city}"
                    )
                elif city == start:
                    # One-way start: net outflow of 1
                    self._add_constraint(
                        outgoing - incoming == 1,
                        f"flow_start_{p}_{city}"
                    )
                elif city == end:
                    # One-way end: net inflow of 1
                    self._add_constraint(
                        outgoing - incoming == -1,
                        f"flow_end_{p}_{city}"
                    )
                else:
                    # Transit city: flow conservation
                    self._add_constraint(
                        outgoing == incoming,
                        f"flow_transit_{p}_{city}"
                    )
        
        logger.debug(f"Added flow conservation for {len(self.cities)} cities")
    
    def add_must_visit_constraints(
        self,
        must_visit_cities: List[str],
        start_city: Dict[TravelerId, str],
        end_city: Dict[TravelerId, str],
    ):
        """
        Add constraints: must-visit cities must be visited exactly once.
        
        ∑{e: e.dest == city} x[p][e] = 1
        """
        if not must_visit_cities:
            return
        
        count = 0
        for city in must_visit_cities:
            for p in self.travelers:
                # Skip if city is start or end (already handled)
                if city == start_city.get(p) or city == end_city.get(p):
                    continue
                
                incoming = [e for e in self.edges if e[1] == city]
                self._add_constraint(
                    pl.lpSum(self.x[p][e] for e in incoming) == 1,
                    f"must_visit_{p}_{city}"
                )
                count += 1
        
        logger.debug(f"Added {count} must-visit constraints")
    
    def add_transit_city_limits(
        self,
        must_visit_cities: List[str],
        start_city: Dict[TravelerId, str],
        end_city: Dict[TravelerId, str],
    ):
        """
        Add constraints: transit cities can be visited at most once.
        
        This prevents sub-tours where flow conservation allows 2-in-2-out.
        
        ∑{e: e.dest == city} x[p][e] <= 1
        """
        must_visit_set = set(must_visit_cities or [])
        count = 0
        
        for p in self.travelers:
            start = start_city.get(p)
            end = end_city.get(p)
            start_end_set = {start, end}
            
            for city in self.cities:
                # Skip start, end, and must-visit cities
                if city in start_end_set or city in must_visit_set:
                    continue
                
                incoming = [e for e in self.edges if e[1] == city]
                self._add_constraint(
                    pl.lpSum(self.x[p][e] for e in incoming) <= 1,
                    f"transit_limit_{p}_{city}"
                )
                count += 1
        
        logger.debug(f"Added {count} transit city limit constraints")
    
    def add_chronological_constraints(
        self,
        must_visit_cities: List[str],
        edge_departure_minutes: Dict[EdgeKey, float],
        edge_arrival_minutes: Dict[EdgeKey, float],
    ):
        """
        Add chronological ordering constraints at must-visit cities.
        
        At must-visit cities: if edge e1 arrives and e2 departs,
        e2's departure must be after e1's arrival.
        
        If both edges violate this, we can't select both: x[e1] + x[e2] <= 1
        """
        if not must_visit_cities or not edge_departure_minutes or not edge_arrival_minutes:
            return
        
        # Build city-to-edges maps
        edges_arriving_at = {}
        edges_departing_from = {}
        
        for e in self.edges:
            origin, dest, _ = e
            edges_departing_from.setdefault(origin, []).append(e)
            edges_arriving_at.setdefault(dest, []).append(e)
        
        count = 0
        cities_to_check = set(must_visit_cities)
        
        for p in self.travelers:
            for city in cities_to_check:
                for e1 in edges_arriving_at.get(city, []):
                    arr1 = edge_arrival_minutes.get(e1)
                    if arr1 is None:
                        continue
                    
                    for e2 in edges_departing_from.get(city, []):
                        dep2 = edge_departure_minutes.get(e2)
                        if dep2 is None:
                            continue
                        
                        # If e2 departs before e1 arrives, can't select both
                        if dep2 < arr1:
                            self._add_constraint(
                                self.x[p][e1] + self.x[p][e2] <= 1,
                                f"chrono_{p}_{city}_{count}"
                            )
                            count += 1
        
        logger.info(f"Added {count} chronological constraints at must-visit cities")
    
    # =========================================================================
    # PAYMENT CONSTRAINTS
    # =========================================================================
    
    def add_payment_method_constraints(
        self,
        can_pay_for: Dict[Tuple[TravelerId, TravelerId], int],
    ):
        """
        Add constraints: exactly one payment method per chosen edge.
        
        For each edge e and traveler p:
        ∑{q} z[q,p][e] + ∑{q,s,a} y[q,p][s,a][e] + ∑{q,a} y_native[q,p][a][e] = x[p][e]
        
        Also enforces can_pay_for restrictions.
        """
        count = 0
        
        for p in self.travelers:
            for e in self.edges:
                # Cash payments
                cash_sum = pl.lpSum(
                    self.z[(q, p)][e]
                    for q in self.travelers
                    if (q, p) in self.z
                )
                
                # Transfer payments
                transfer_sum = pl.lpSum(
                    self.y[(q, p)][(s, a)][e]
                    for q in self.travelers
                    if (q, p) in self.y
                    for (s, a) in self.y[(q, p)].keys()
                )
                
                # Native airline payments
                native_sum = pl.lpSum(
                    self.y_native[(q, p)][a][e]
                    for q in self.travelers
                    if (q, p) in self.y_native
                    for a in self.y_native[(q, p)].keys()
                )
                
                # Total payment must equal edge selection
                self._add_constraint(
                    cash_sum + transfer_sum + native_sum == self.x[p][e],
                    f"payment_{p}_{e}"
                )
                count += 1
        
        logger.debug(f"Added {count} payment method constraints")
    
    def add_can_pay_for_constraints(
        self,
        can_pay_for: Dict[Tuple[TravelerId, TravelerId], int],
    ):
        """
        Add constraints: restrict who can pay for whom.
        
        If can_pay_for[(q, p)] == 0, then z[(q,p)][e] = 0 for all edges.
        """
        count = 0
        
        for (q, p), allowed in can_pay_for.items():
            if allowed:
                continue
            
            # Cash payments not allowed
            if (q, p) in self.z:
                for e in self.edges:
                    self._add_constraint(
                        self.z[(q, p)][e] == 0,
                        f"no_pay_cash_{q}_{p}"
                    )
                    count += 1
            
            # Transfer payments not allowed
            if (q, p) in self.y:
                for (s, a) in self.y[(q, p)].keys():
                    for e in self.edges:
                        self._add_constraint(
                            self.y[(q, p)][(s, a)][e] == 0,
                            f"no_pay_transfer_{q}_{p}"
                        )
                        count += 1
        
        logger.debug(f"Added {count} can_pay_for constraints")
    
    # =========================================================================
    # TRANSFER CONSTRAINTS
    # =========================================================================
    
    def add_transfer_block_constraints(
        self,
        sources_by_trav: Dict[TravelerId, List[BankCode]],
        allowed_sa: Set[Tuple[BankCode, AirlineCode]],
        ratio: Dict[Tuple[BankCode, AirlineCode], float],
        bonus: Dict[Tuple[BankCode, AirlineCode], float],
        inc_source: Dict[Tuple[BankCode, AirlineCode], int],
        award_points: Dict[AirlineCode, Dict[EdgeKey, float]],
    ):
        """
        Add constraints: points transferred must fit in blocks.
        
        ∑{p,e} y[q,p][s,a][e] * miles[a][e] <= t_blocks[q][s,a] * block_size * ratio * bonus
        """
        count = 0
        
        for q in self.travelers:
            if q not in self.t_blocks:
                continue
            
            for s in sources_by_trav.get(q, []):
                for a in self.airlines:
                    if (s, a) not in allowed_sa:
                        continue
                    if (s, a) not in self.t_blocks[q]:
                        continue
                    
                    r = ratio.get((s, a), 1.0)
                    b = bonus.get((s, a), 1.0)
                    block = inc_source.get((s, a), 1000)
                    
                    # Miles used via this transfer path
                    miles_used = pl.lpSum(
                        self.y[(q, p)][(s, a)][e] * award_points.get(a, {}).get(e, 0)
                        for p in self.travelers
                        if (q, p) in self.y and (s, a) in self.y[(q, p)]
                        for e in self.edges
                    )
                    
                    # Must fit in transfer blocks (with ratio and bonus)
                    self._add_constraint(
                        miles_used <= self.t_blocks[q][(s, a)] * block * r * b,
                        f"transfer_block_{q}_{s}_{a}"
                    )
                    count += 1
        
        logger.debug(f"Added {count} transfer block constraints")
    
    def add_source_balance_constraints(
        self,
        source_balances: Dict[Tuple[TravelerId, BankCode], float],
        inc_source: Dict[Tuple[BankCode, AirlineCode], int],
    ):
        """
        Add constraints: can't transfer more points than balance.
        
        ∑{a} t_blocks[q][s,a] * block_size <= source_balances[q,s]
        """
        count = 0
        
        for q in self.travelers:
            if q not in self.t_blocks:
                continue
            
            # Group by source
            sources = set()
            for (s, a) in self.t_blocks[q].keys():
                sources.add(s)
            
            for s in sources:
                balance = source_balances.get((q, s), 0)
                if balance <= 0:
                    continue
                
                # Sum of all transfers from this source
                blocks_used = pl.lpSum(
                    self.t_blocks[q][(s, a)] * inc_source.get((s, a), 1000)
                    for (src, a) in self.t_blocks[q].keys()
                    if src == s
                )
                
                self._add_constraint(
                    blocks_used <= balance,
                    f"source_balance_{q}_{s}"
                )
                count += 1
        
        logger.debug(f"Added {count} source balance constraints")
    
    def add_native_miles_constraints(
        self,
        miles_balance: Dict[Tuple[TravelerId, AirlineCode], float],
        award_points: Dict[AirlineCode, Dict[EdgeKey, float]],
    ):
        """
        Add constraints: can't use more native miles than balance.
        
        ∑{p,e} y_native[q,p][a][e] * miles[a][e] <= miles_balance[q,a]
        """
        count = 0
        
        for q in self.travelers:
            if q not in self.y_native:
                continue
            
            for a in self.y_native[q].keys() if isinstance(self.y_native[q], dict) else []:
                balance = miles_balance.get((q, a), 0)
                if balance <= 0:
                    continue
                
                # Miles used natively
                miles_used = pl.lpSum(
                    self.y_native[(q, p)][a][e] * award_points.get(a, {}).get(e, 0)
                    for p in self.travelers
                    if (q, p) in self.y_native and a in self.y_native[(q, p)]
                    for e in self.edges
                )
                
                self._add_constraint(
                    miles_used <= balance,
                    f"native_balance_{q}_{a}"
                )
                count += 1
        
        logger.debug(f"Added {count} native miles constraints")
    
    # =========================================================================
    # ELIGIBILITY CONSTRAINTS
    # =========================================================================
    
    def add_link_ok_constraints(
        self,
        link_ok: Dict[Tuple[TravelerId, AirlineCode], int],
        can_price: Dict[AirlineCode, Dict[EdgeKey, int]],
    ):
        """
        Add constraints: payer must be linked to airline to use its awards.
        
        If link_ok[(q, a)] == 0, then y[q,*][*,a][*] = 0
        Also enforces can_price: if can_price[a][e] == 0, can't use airline a for edge e
        """
        count = 0
        
        for q in self.travelers:
            for a in self.airlines:
                if link_ok.get((q, a), 0) == 1:
                    continue
                
                # Not linked: block all transfers to this airline
                for p in self.travelers:
                    if (q, p) in self.y:
                        for (s, airline) in self.y[(q, p)].keys():
                            if airline == a:
                                for e in self.edges:
                                    self._add_constraint(
                                        self.y[(q, p)][(s, a)][e] == 0,
                                        f"link_ok_{q}_{a}"
                                    )
                                    count += 1
                    
                    if (q, p) in self.y_native and a in self.y_native[(q, p)]:
                        for e in self.edges:
                            self._add_constraint(
                                self.y_native[(q, p)][a][e] == 0,
                                f"link_ok_native_{q}_{a}"
                            )
                            count += 1
        
        logger.debug(f"Added {count} link_ok constraints")
    
    # =========================================================================
    # CAPACITY CONSTRAINTS
    # =========================================================================
    
    def add_cash_seat_constraints(
        self,
        total_cash_seats: Dict[EdgeKey, int],
    ):
        """
        Add constraints: can't book more cash seats than available.
        
        ∑{q,p} z[q,p][e] <= total_cash_seats[e]
        """
        count = 0
        
        for e in self.edges:
            seats = total_cash_seats.get(e, 999)
            if seats >= 999:
                continue
            
            cash_bookings = pl.lpSum(
                self.z[(q, p)][e]
                for q in self.travelers
                for p in self.travelers
                if (q, p) in self.z
            )
            
            self._add_constraint(
                cash_bookings <= seats,
                f"cash_seats_{e}"
            )
            count += 1
        
        logger.debug(f"Added {count} cash seat constraints")
    
    def add_award_seat_constraints(
        self,
        award_seats: Dict[AirlineCode, Dict[EdgeKey, int]],
    ):
        """
        Add constraints: can't book more award seats than available.
        
        ∑{q,p,s} y[q,p][s,a][e] + y_native[q,p][a][e] <= award_seats[a][e]
        """
        count = 0
        
        for a in self.airlines:
            for e in self.edges:
                seats = award_seats.get(a, {}).get(e, 999)
                if seats >= 999:
                    continue
                
                # Transfer bookings
                transfer_bookings = pl.lpSum(
                    self.y[(q, p)][(s, a)][e]
                    for q in self.travelers
                    for p in self.travelers
                    if (q, p) in self.y
                    for (s, airline) in self.y[(q, p)].keys()
                    if airline == a
                )
                
                # Native bookings
                native_bookings = pl.lpSum(
                    self.y_native[(q, p)][a][e]
                    for q in self.travelers
                    for p in self.travelers
                    if (q, p) in self.y_native and a in self.y_native[(q, p)]
                )
                
                self._add_constraint(
                    transfer_bookings + native_bookings <= seats,
                    f"award_seats_{a}_{e}"
                )
                count += 1
        
        logger.debug(f"Added {count} award seat constraints")
    
    # =========================================================================
    # BUDGET CONSTRAINTS
    # =========================================================================
    
    def add_budget_constraints(
        self,
        budget_cash: Dict[TravelerId, float],
        cash_cost: Dict[EdgeKey, float],
        cash_surcharge: Dict[AirlineCode, Dict[EdgeKey, float]],
    ):
        """
        Add constraints: total cash spend must not exceed budget.
        
        ∑{p,e} z[q,p][e] * cash_cost[e] + ∑{p,s,a,e} y[q,p][s,a][e] * surcharge[a][e] <= budget[q]
        """
        count = 0
        
        for q in self.travelers:
            budget = budget_cash.get(q, 1e9)
            if budget >= 1e9:
                continue
            
            # Cash bookings
            cash_spend = pl.lpSum(
                self.z[(q, p)][e] * cash_cost.get(e, 0)
                for p in self.travelers
                if (q, p) in self.z
                for e in self.edges
            )
            
            # Surcharges on award bookings
            surcharge_spend = pl.lpSum(
                self.y[(q, p)][(s, a)][e] * cash_surcharge.get(a, {}).get(e, 0)
                for p in self.travelers
                if (q, p) in self.y
                for (s, a) in self.y[(q, p)].keys()
                for e in self.edges
            )
            
            self._add_constraint(
                cash_spend + surcharge_spend <= budget,
                f"budget_{q}"
            )
            count += 1
        
        logger.debug(f"Added {count} budget constraints")


# =============================================================================
# CONVENIENCE FUNCTION
# =============================================================================

def build_all_constraints(
    model: "pl.LpProblem",
    travelers: List[TravelerId],
    edges: List[EdgeKey],
    cities: List[str],
    airlines: List[AirlineCode],
    x: Dict, z: Dict, y: Dict, y_native: Dict, t_blocks: Dict,
    start_city: Dict[TravelerId, str],
    end_city: Dict[TravelerId, str],
    must_visit_cities: List[str],
    can_pay_for: Dict,
    sources_by_trav: Dict,
    source_balances: Dict,
    miles_balance: Dict,
    allowed_sa: Set,
    ratio: Dict,
    bonus: Dict,
    inc_source: Dict,
    award_points: Dict,
    link_ok: Dict,
    can_price: Dict,
    cash_cost: Dict,
    cash_surcharge: Dict,
    budget_cash: Dict,
    total_cash_seats: Dict,
    award_seats: Dict,
    edge_departure_minutes: Dict,
    edge_arrival_minutes: Dict,
) -> int:
    """
    Build all constraints for the ILP model.
    
    Returns the total number of constraints added.
    """
    builder = ConstraintBuilder(
        model, travelers, edges, cities, airlines,
        x, z, y, y_native, t_blocks
    )
    
    # Path constraints
    builder.add_start_constraints(start_city)
    builder.add_end_constraints(end_city)
    builder.add_flow_conservation(start_city, end_city)
    builder.add_must_visit_constraints(must_visit_cities, start_city, end_city)
    builder.add_transit_city_limits(must_visit_cities, start_city, end_city)
    builder.add_chronological_constraints(
        must_visit_cities, edge_departure_minutes, edge_arrival_minutes
    )
    
    # Payment constraints
    builder.add_payment_method_constraints(can_pay_for)
    
    # Transfer constraints
    builder.add_transfer_block_constraints(
        sources_by_trav, allowed_sa, ratio, bonus, inc_source, award_points
    )
    builder.add_source_balance_constraints(source_balances, inc_source)
    builder.add_native_miles_constraints(miles_balance, award_points)
    
    # Eligibility constraints
    builder.add_link_ok_constraints(link_ok, can_price)
    
    # Capacity constraints
    builder.add_cash_seat_constraints(total_cash_seats)
    builder.add_award_seat_constraints(award_seats)
    
    # Budget constraints
    builder.add_budget_constraints(budget_cash, cash_cost, cash_surcharge)
    
    return builder.constraint_count
