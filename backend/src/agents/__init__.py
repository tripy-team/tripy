"""
Agentic Architecture for Tripy Optimization

This module contains AI agents that orchestrate API queries and optimize
travel itineraries to minimize out-of-pocket (OOP) expense.

Agents:
- OrchestratorAgent: Coordinates the entire optimization pipeline
- FlightAgent: Intelligently queries flight APIs
- CostBreakdownAgent: Generates human-readable cost explanations
- GroupBookingAllocator: Assigns booking responsibilities to group members
"""

from .base import BaseAgent, AgentConfig
from .flight_agent import FlightAgent
from .cost_breakdown_agent import CostBreakdownAgent
from .orchestrator import OrchestratorAgent
from .group_allocator import GroupBookingAllocator, SegmentOption
from .group_models import (
    MemberBookingCapability,
    BookingAssignment,
    Settlement,
    MemberBookingSummary,
    BookingAllocationStrategy,
    GroupBookingPlan,
    SettlementSplitMethod,
    AllocationValidationResult,
    MemberState,
    TransferOption,
    TripStructure,
)

__all__ = [
    "BaseAgent",
    "AgentConfig", 
    "FlightAgent",
    "CostBreakdownAgent",
    "OrchestratorAgent",
    # Group booking allocation
    "GroupBookingAllocator",
    "SegmentOption",
    "MemberBookingCapability",
    "BookingAssignment",
    "Settlement",
    "MemberBookingSummary",
    "BookingAllocationStrategy",
    "GroupBookingPlan",
    "SettlementSplitMethod",
    "AllocationValidationResult",
    "MemberState",
    "TransferOption",
    "TripStructure",
]
