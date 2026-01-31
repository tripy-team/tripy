"""
Optimization metrics for debugging and explainability.

CRITICAL: Add these EARLY - they'll save days of debugging.

These counters track the optimization pipeline stages and provide
visibility into what's happening at each step.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional
import logging


@dataclass
class OptimizationMetrics:
    """Counters for optimization pipeline stages."""
    
    # ═══════════════════════════════════════════════════════════════════════
    # INPUT COUNTS
    # ═══════════════════════════════════════════════════════════════════════
    
    flights_input: int = 0
    hotels_input: int = 0
    transfers_input: int = 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # FILTER STAGES
    # ═══════════════════════════════════════════════════════════════════════
    
    # After single-ticket filter
    flights_after_ticket_filter: int = 0
    flights_dropped_separate_tickets: int = 0
    flights_dropped_unknown_tickets: int = 0
    
    # After date feasibility filter
    flights_after_date_filter: int = 0
    flights_dropped_date_infeasible: int = 0
    
    # After pruning
    flights_after_prune: int = 0
    hotels_after_prune: int = 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # AWARD OPTIONS
    # ═══════════════════════════════════════════════════════════════════════
    
    award_options_total: int = 0
    award_options_low_availability: int = 0
    award_options_waitlisted: int = 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # MILP STATS
    # ═══════════════════════════════════════════════════════════════════════
    
    milp_variables: int = 0
    milp_constraints: int = 0
    milp_binary_vars: int = 0
    milp_integer_vars: int = 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # SOLVE STATS
    # ═══════════════════════════════════════════════════════════════════════
    
    solve_time_seconds: float = 0.0
    pass1_status: str = ""
    pass1_objective: float = 0.0
    pass1_slack: float = 0.0
    pass2_status: str = ""
    pass2_objective: float = 0.0
    
    # ═══════════════════════════════════════════════════════════════════════
    # PER-LEG/SEGMENT DETAILS
    # ═══════════════════════════════════════════════════════════════════════
    
    flights_per_leg: Dict[int, int] = field(default_factory=dict)
    hotels_per_segment: Dict[int, int] = field(default_factory=dict)
    
    # ═══════════════════════════════════════════════════════════════════════
    # WARNINGS AND ISSUES
    # ═══════════════════════════════════════════════════════════════════════
    
    warnings: List[str] = field(default_factory=list)
    
    def log_summary(self, logger: Optional[logging.Logger] = None):
        """Log a summary of the metrics."""
        
        if logger is None:
            logger = logging.getLogger(__name__)
        
        logger.info("═" * 60)
        logger.info("OPTIMIZATION METRICS SUMMARY")
        logger.info("═" * 60)
        
        # Input → Filter → Prune flow
        logger.info(f"FLIGHTS:")
        logger.info(f"  Input:          {self.flights_input}")
        logger.info(f"  After ticket:   {self.flights_after_ticket_filter} "
                   f"(dropped {self.flights_dropped_separate_tickets} separate, "
                   f"{self.flights_dropped_unknown_tickets} unknown)")
        logger.info(f"  After date:     {self.flights_after_date_filter} "
                   f"(dropped {self.flights_dropped_date_infeasible} infeasible)")
        logger.info(f"  After prune:    {self.flights_after_prune}")
        
        logger.info(f"HOTELS:")
        logger.info(f"  Input:          {self.hotels_input}")
        logger.info(f"  After prune:    {self.hotels_after_prune}")
        
        logger.info(f"AWARD OPTIONS:")
        logger.info(f"  Total:          {self.award_options_total}")
        logger.info(f"  Low avail:      {self.award_options_low_availability}")
        logger.info(f"  Waitlisted:     {self.award_options_waitlisted}")
        
        logger.info(f"MILP:")
        logger.info(f"  Variables:      {self.milp_variables} "
                   f"({self.milp_binary_vars} binary, {self.milp_integer_vars} integer)")
        logger.info(f"  Constraints:    {self.milp_constraints}")
        
        logger.info(f"SOLVE:")
        logger.info(f"  Time:           {self.solve_time_seconds:.2f}s")
        logger.info(f"  Pass 1:         {self.pass1_status}, obj={self.pass1_objective:.2f}, "
                   f"slack={self.pass1_slack:.2f}")
        logger.info(f"  Pass 2:         {self.pass2_status}, obj={self.pass2_objective:.2f}")
        
        # Per-leg/segment details
        if self.flights_per_leg:
            logger.info(f"FLIGHTS PER LEG:")
            for leg_id, count in sorted(self.flights_per_leg.items()):
                logger.info(f"  Leg {leg_id}: {count}")
        
        if self.hotels_per_segment:
            logger.info(f"HOTELS PER SEGMENT:")
            for seg_id, count in sorted(self.hotels_per_segment.items()):
                logger.info(f"  Segment {seg_id}: {count}")
        
        if self.warnings:
            logger.info(f"WARNINGS ({len(self.warnings)}):")
            for w in self.warnings[:10]:  # Show first 10
                logger.info(f"  - {w}")
            if len(self.warnings) > 10:
                logger.info(f"  ... and {len(self.warnings) - 10} more")
        
        logger.info("═" * 60)
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "input": {
                "flights": self.flights_input,
                "hotels": self.hotels_input,
                "transfers": self.transfers_input,
            },
            "after_filters": {
                "flights_after_ticket": self.flights_after_ticket_filter,
                "flights_after_date": self.flights_after_date_filter,
                "flights_after_prune": self.flights_after_prune,
                "hotels_after_prune": self.hotels_after_prune,
            },
            "dropped": {
                "separate_tickets": self.flights_dropped_separate_tickets,
                "unknown_tickets": self.flights_dropped_unknown_tickets,
                "date_infeasible": self.flights_dropped_date_infeasible,
            },
            "awards": {
                "total": self.award_options_total,
                "low_availability": self.award_options_low_availability,
                "waitlisted": self.award_options_waitlisted,
            },
            "milp": {
                "variables": self.milp_variables,
                "constraints": self.milp_constraints,
                "binary_vars": self.milp_binary_vars,
                "integer_vars": self.milp_integer_vars,
            },
            "solve": {
                "time_seconds": self.solve_time_seconds,
                "pass1_status": self.pass1_status,
                "pass1_objective": self.pass1_objective,
                "pass1_slack": self.pass1_slack,
                "pass2_status": self.pass2_status,
                "pass2_objective": self.pass2_objective,
            },
            "per_leg_flights": self.flights_per_leg,
            "per_segment_hotels": self.hotels_per_segment,
            "warning_count": len(self.warnings),
        }


def create_metrics() -> OptimizationMetrics:
    """Create a new metrics instance."""
    return OptimizationMetrics()
