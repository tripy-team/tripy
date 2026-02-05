"""
Shared contract/invariant helpers.

These helpers are intentionally low-level and dependency-free so they can be
used across provider parsing, optimization adapters, persistence (snapshots/
caches), and API boundary code.
"""

from .group_optimization_contracts import (
    OptimizationStatus,
    BudgetOverrun,
    SolveMeta,
    GroupOptimizationResult,
    BudgetOverrunData,
    SolveMetaData,
)

