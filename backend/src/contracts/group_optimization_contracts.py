"""
Group Optimization Contracts

Canonical response schema for group optimization endpoints.
Provides structured status, budget overrun tracking, and solve metadata.
"""

from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from dataclasses import dataclass, field, asdict


class OptimizationStatus(str, Enum):
    """Status of the optimization solve."""
    OPTIMAL_STRICT = "optimal_strict"       # Found solution within all budgets
    OPTIMAL_RELAXED = "optimal_relaxed"     # Found solution with budget overruns
    INFEASIBLE_NO_OPTIONS = "infeasible_no_options"  # No booking combination exists
    ERROR = "error"                          # Solver or system error


class BudgetOverrun(BaseModel):
    """Budget overrun information for group optimization."""
    group_overrun_usd: float = Field(
        default=0.0,
        description="Amount by which group total budget is exceeded"
    )
    member_overrun_usd: Dict[str, float] = Field(
        default_factory=dict,
        description="Per-member budget overruns (member_id -> overrun amount)"
    )
    max_member_overrun_usd: float = Field(
        default=0.0,
        description="Maximum overrun among all members"
    )
    total_overrun_usd: float = Field(
        default=0.0,
        description="Sum of all positive overruns (group + members)"
    )
    
    @classmethod
    def zero(cls) -> "BudgetOverrun":
        """Create a zero-overrun instance (for strict optimal)."""
        return cls(
            group_overrun_usd=0.0,
            member_overrun_usd={},
            max_member_overrun_usd=0.0,
            total_overrun_usd=0.0,
        )
    
    @classmethod
    def from_member_costs(
        cls,
        member_oop: Dict[str, float],
        member_budgets: Dict[str, float],
        group_oop: float = 0.0,
        group_budget: Optional[float] = None,
    ) -> "BudgetOverrun":
        """
        Compute overruns from actual costs vs budgets.
        
        Args:
            member_oop: Per-member out-of-pocket costs
            member_budgets: Per-member budget limits
            group_oop: Total group OOP
            group_budget: Optional group-level budget limit
        """
        member_overrun_usd = {}
        for member_id, oop in member_oop.items():
            budget = member_budgets.get(member_id)
            if budget is not None and oop > budget:
                member_overrun_usd[member_id] = round(oop - budget, 2)
        
        group_overrun = 0.0
        if group_budget is not None and group_oop > group_budget:
            group_overrun = round(group_oop - group_budget, 2)
        
        max_member = max(member_overrun_usd.values(), default=0.0)
        total = sum(member_overrun_usd.values()) + group_overrun
        
        return cls(
            group_overrun_usd=group_overrun,
            member_overrun_usd=member_overrun_usd,
            max_member_overrun_usd=round(max_member, 2),
            total_overrun_usd=round(total, 2),
        )
    
    def has_overrun(self) -> bool:
        """Check if any budget is exceeded."""
        return self.total_overrun_usd > 0.01


class SolveMeta(BaseModel):
    """Metadata about the optimization solve."""
    status: OptimizationStatus = Field(
        description="Status of the optimization"
    )
    is_relaxed: bool = Field(
        default=False,
        description="Whether budget constraints were relaxed"
    )
    solver: str = Field(
        default="CBC",
        description="Solver used (e.g., 'CBC', 'GLPK')"
    )
    time_limit_s: int = Field(
        default=60,
        description="Solver time limit in seconds"
    )
    solve_time_ms: int = Field(
        default=0,
        description="Actual solve time in milliseconds"
    )
    objective_value: Optional[float] = Field(
        default=None,
        description="Final objective value if solved"
    )
    strict_infeasible_reason: Optional[str] = Field(
        default=None,
        description="Reason why strict solve was infeasible"
    )
    relaxation_summary: Dict[str, Any] = Field(
        default_factory=dict,
        description="Summary of relaxation (weights used, slack values, etc.)"
    )
    
    @classmethod
    def strict_optimal(cls, solve_time_ms: int = 0, objective_value: float = None) -> "SolveMeta":
        """Create metadata for strict optimal solution."""
        return cls(
            status=OptimizationStatus.OPTIMAL_STRICT,
            is_relaxed=False,
            solve_time_ms=solve_time_ms,
            objective_value=objective_value,
        )
    
    @classmethod
    def relaxed_optimal(
        cls,
        solve_time_ms: int = 0,
        objective_value: float = None,
        strict_reason: str = None,
        relaxation_summary: Dict[str, Any] = None,
    ) -> "SolveMeta":
        """Create metadata for relaxed optimal solution."""
        return cls(
            status=OptimizationStatus.OPTIMAL_RELAXED,
            is_relaxed=True,
            solve_time_ms=solve_time_ms,
            objective_value=objective_value,
            strict_infeasible_reason=strict_reason,
            relaxation_summary=relaxation_summary or {},
        )
    
    @classmethod
    def infeasible(cls, reason: str = None, solve_time_ms: int = 0) -> "SolveMeta":
        """Create metadata for infeasible problem."""
        return cls(
            status=OptimizationStatus.INFEASIBLE_NO_OPTIONS,
            is_relaxed=False,
            solve_time_ms=solve_time_ms,
            strict_infeasible_reason=reason or "No feasible booking combination found",
        )
    
    @classmethod
    def error(cls, reason: str) -> "SolveMeta":
        """Create metadata for error state."""
        return cls(
            status=OptimizationStatus.ERROR,
            is_relaxed=False,
            strict_infeasible_reason=reason,
        )


class GroupOptimizationResult(BaseModel):
    """
    Canonical response for group optimization endpoints.
    
    This wraps the existing results format with additional metadata
    for status, budget overruns, and solve information.
    """
    meta: SolveMeta = Field(
        description="Metadata about the solve (status, timing, etc.)"
    )
    budget_overrun: BudgetOverrun = Field(
        default_factory=BudgetOverrun.zero,
        description="Budget overrun information"
    )
    results: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="List of optimization results/itineraries"
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Warning messages for the user"
    )
    
    # Legacy fields for backward compatibility
    status: str = Field(
        default="",
        description="Legacy status field (maps from meta.status)"
    )
    message: str = Field(
        default="",
        description="Legacy message field"
    )
    
    def model_post_init(self, __context) -> None:
        """Populate legacy fields from meta for backward compatibility."""
        if not self.status:
            self.status = self.meta.status.value
        if not self.message:
            if self.meta.status == OptimizationStatus.OPTIMAL_STRICT:
                self.message = "Found optimal solution within budget"
            elif self.meta.status == OptimizationStatus.OPTIMAL_RELAXED:
                overrun = self.budget_overrun.total_overrun_usd
                self.message = f"Found closest solution (exceeds budget by ${overrun:.2f})"
            elif self.meta.status == OptimizationStatus.INFEASIBLE_NO_OPTIONS:
                self.message = self.meta.strict_infeasible_reason or "No feasible solution found"
            else:
                self.message = "Error during optimization"
    
    @classmethod
    def from_strict_solution(
        cls,
        results: List[Dict[str, Any]],
        solve_time_ms: int = 0,
        objective_value: float = None,
        warnings: List[str] = None,
    ) -> "GroupOptimizationResult":
        """Create result from a strict (within-budget) solution."""
        return cls(
            meta=SolveMeta.strict_optimal(solve_time_ms, objective_value),
            budget_overrun=BudgetOverrun.zero(),
            results=results,
            warnings=warnings or [],
        )
    
    @classmethod
    def from_relaxed_solution(
        cls,
        results: List[Dict[str, Any]],
        budget_overrun: BudgetOverrun,
        strict_reason: str = None,
        relaxation_summary: Dict[str, Any] = None,
        solve_time_ms: int = 0,
        objective_value: float = None,
        warnings: List[str] = None,
    ) -> "GroupOptimizationResult":
        """Create result from a relaxed (over-budget) solution."""
        final_warnings = warnings or []
        
        # Add overrun warning
        if budget_overrun.has_overrun():
            overrun_msg = f"This is the closest option, exceeding budget by ${budget_overrun.total_overrun_usd:.2f}"
            if budget_overrun.max_member_overrun_usd > 0:
                overrun_msg += f" (max member overrun: ${budget_overrun.max_member_overrun_usd:.2f})"
            final_warnings.insert(0, overrun_msg)
        
        return cls(
            meta=SolveMeta.relaxed_optimal(
                solve_time_ms=solve_time_ms,
                objective_value=objective_value,
                strict_reason=strict_reason,
                relaxation_summary=relaxation_summary,
            ),
            budget_overrun=budget_overrun,
            results=results,
            warnings=final_warnings,
        )
    
    @classmethod
    def infeasible(
        cls,
        reason: str = None,
        suggestions: List[str] = None,
        solve_time_ms: int = 0,
    ) -> "GroupOptimizationResult":
        """Create result for infeasible problem."""
        warnings = []
        if reason:
            warnings.append(reason)
        if suggestions:
            warnings.extend(suggestions)
        
        return cls(
            meta=SolveMeta.infeasible(reason, solve_time_ms),
            budget_overrun=BudgetOverrun.zero(),
            results=[],
            warnings=warnings,
        )
    
    def is_within_budget(self) -> bool:
        """Check if solution is within all budgets."""
        return self.meta.status == OptimizationStatus.OPTIMAL_STRICT
    
    def is_over_budget(self) -> bool:
        """Check if solution exceeds budget but is still valid."""
        return self.meta.status == OptimizationStatus.OPTIMAL_RELAXED
    
    def has_results(self) -> bool:
        """Check if any results were found."""
        return len(self.results) > 0


# =============================================================================
# DATACLASS VERSION (for internal use in optimizer)
# =============================================================================

@dataclass
class BudgetOverrunData:
    """Dataclass version of BudgetOverrun for internal use."""
    group_overrun_usd: float = 0.0
    member_overrun_usd: Dict[str, float] = field(default_factory=dict)
    max_member_overrun_usd: float = 0.0
    total_overrun_usd: float = 0.0
    
    def to_model(self) -> BudgetOverrun:
        """Convert to Pydantic model."""
        return BudgetOverrun(
            group_overrun_usd=self.group_overrun_usd,
            member_overrun_usd=self.member_overrun_usd,
            max_member_overrun_usd=self.max_member_overrun_usd,
            total_overrun_usd=self.total_overrun_usd,
        )


@dataclass
class SolveMetaData:
    """Dataclass version of SolveMeta for internal use."""
    status: OptimizationStatus = OptimizationStatus.ERROR
    is_relaxed: bool = False
    solver: str = "CBC"
    time_limit_s: int = 60
    solve_time_ms: int = 0
    objective_value: Optional[float] = None
    strict_infeasible_reason: Optional[str] = None
    relaxation_summary: Dict[str, Any] = field(default_factory=dict)
    
    def to_model(self) -> SolveMeta:
        """Convert to Pydantic model."""
        return SolveMeta(
            status=self.status,
            is_relaxed=self.is_relaxed,
            solver=self.solver,
            time_limit_s=self.time_limit_s,
            solve_time_ms=self.solve_time_ms,
            objective_value=self.objective_value,
            strict_infeasible_reason=self.strict_infeasible_reason,
            relaxation_summary=self.relaxation_summary,
        )
