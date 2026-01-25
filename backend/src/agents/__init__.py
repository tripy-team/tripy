"""
Agentic Architecture for Tripy Optimization

This module contains AI agents that orchestrate API queries and optimize
travel itineraries to minimize out-of-pocket (OOP) expense.

Agents:
- OrchestratorAgent: Coordinates the entire optimization pipeline
- FlightAgent: Intelligently queries flight APIs
- HotelAgent: Searches hotel options across programs
- CostBreakdownAgent: Generates human-readable cost explanations
- GroupBookingAllocator: Assigns booking responsibilities to group members
"""

from .base import BaseAgent, AgentConfig
from .flight_agent import FlightAgent
from .hotel_agent import HotelAgent
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
)

__all__ = [
    "BaseAgent",
    "AgentConfig", 
    "FlightAgent",
    "HotelAgent",
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
]
