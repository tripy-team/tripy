"""
Feature flags for V3 optimization changes.

These flags allow quick rollback of individual fixes without
reverting entire deployments. Set to False to disable a fix.

Usage:
    from .flags import V3_MULTI_CURRENCY_ENRICHMENT_ENABLED
    if V3_MULTI_CURRENCY_ENRICHMENT_ENABLED:
        # new behavior
    else:
        # old behavior
"""

import os

# Phase 1 (P0) flags
V3_MULTI_CURRENCY_ENRICHMENT_ENABLED = os.environ.get("V3_MULTI_CURRENCY_ENRICHMENT", "true").lower() == "true"
V3_LEXICOGRAPHIC_OBJECTIVE_ENABLED = os.environ.get("V3_LEXICOGRAPHIC_OBJECTIVE", "true").lower() == "true"
V3_CLOSEST_PLAN_ENABLED = os.environ.get("V3_CLOSEST_PLAN", "true").lower() == "true"
V3_FINGERPRINT_MATCHING_ENABLED = os.environ.get("V3_FINGERPRINT_MATCHING", "true").lower() == "true"

# Phase 2 (P1) flags
V3_GREEDY_CURRENCY_CONSTRAINTS_ENABLED = os.environ.get("V3_GREEDY_CURRENCY_CONSTRAINTS", "true").lower() == "true"
V3_PROPORTIONAL_BUDGET_TIERS_ENABLED = os.environ.get("V3_PROPORTIONAL_BUDGET_TIERS", "true").lower() == "true"
