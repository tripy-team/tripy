"""
Booking risk modes for the policy engine.

Users can select their risk tolerance:
- SAFE: Block anything risky, only show protected options
- BALANCED: Allow risky options with warnings and acknowledgment required
- AGGRESSIVE: Show everything, warnings only (no blocks)

Usage:
    from policy.modes import BookingRiskMode, get_mode_policy
    
    mode = BookingRiskMode.BALANCED
    policy = get_mode_policy(mode)
    
    if policy.blocks_self_transfer:
        # Self-transfer options will be blocked
        pass
"""

from dataclasses import dataclass
from typing import Literal
from enum import Enum


# =============================================================================
# RISK MODE ENUM
# =============================================================================

class BookingRiskMode(str, Enum):
    """
    User-selectable risk tolerance mode.
    
    - SAFE: Conservative - only show fully protected options
    - BALANCED: Default - allow with acknowledgment for risky options  
    - AGGRESSIVE: Permissive - warn but allow everything
    """
    SAFE = "safe"
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"


# Type alias for Pydantic compatibility
RiskModeType = Literal["safe", "balanced", "aggressive"]


# =============================================================================
# MODE POLICY
# =============================================================================

@dataclass(frozen=True)
class ModePolicy:
    """
    Policy behavior for a specific risk mode.
    
    Defines what to block, warn, or allow for each risk type.
    """
    mode: BookingRiskMode
    
    # Connection protection
    blocks_unprotected_connection: bool
    blocks_self_transfer: bool
    blocks_below_mct: bool
    
    # Fare types
    blocks_basic_economy: bool
    blocks_nonrefundable_fare: bool
    
    # Hotels
    blocks_nonrefundable_hotel: bool
    blocks_ota_booking: bool
    
    # Points
    blocks_irreversible_transfer: bool
    
    # General behavior
    require_ack_for_warnings: bool  # Require acknowledgment for warnings?
    hide_blocked_options: bool  # Hide blocked options or show as disabled?
    
    # Scoring adjustments
    risk_penalty_multiplier: float  # Multiply risk penalties by this


# =============================================================================
# PREDEFINED MODE POLICIES
# =============================================================================

SAFE_MODE_POLICY = ModePolicy(
    mode=BookingRiskMode.SAFE,
    
    # Block all connection risks
    blocks_unprotected_connection=True,
    blocks_self_transfer=True,
    blocks_below_mct=True,
    
    # Block risky fare types
    blocks_basic_economy=True,
    blocks_nonrefundable_fare=False,  # Too restrictive to block
    
    # Hotels
    blocks_nonrefundable_hotel=False,  # Too restrictive
    blocks_ota_booking=False,
    
    # Points
    blocks_irreversible_transfer=False,  # Always warn but don't block
    
    # Behavior
    require_ack_for_warnings=True,
    hide_blocked_options=True,
    
    # High penalty multiplier pushes risky options down
    risk_penalty_multiplier=2.0,
)

BALANCED_MODE_POLICY = ModePolicy(
    mode=BookingRiskMode.BALANCED,
    
    # Warn but don't block connection risks (require ack)
    blocks_unprotected_connection=False,
    blocks_self_transfer=False,
    blocks_below_mct=False,  # Require ack instead
    
    # Allow fare types with warnings
    blocks_basic_economy=False,
    blocks_nonrefundable_fare=False,
    
    # Hotels
    blocks_nonrefundable_hotel=False,
    blocks_ota_booking=False,
    
    # Points
    blocks_irreversible_transfer=False,
    
    # Behavior
    require_ack_for_warnings=True,  # Must acknowledge risky options
    hide_blocked_options=False,
    
    # Standard penalty multiplier
    risk_penalty_multiplier=1.0,
)

AGGRESSIVE_MODE_POLICY = ModePolicy(
    mode=BookingRiskMode.AGGRESSIVE,
    
    # Don't block anything
    blocks_unprotected_connection=False,
    blocks_self_transfer=False,
    blocks_below_mct=False,
    
    blocks_basic_economy=False,
    blocks_nonrefundable_fare=False,
    
    blocks_nonrefundable_hotel=False,
    blocks_ota_booking=False,
    
    blocks_irreversible_transfer=False,
    
    # Behavior
    require_ack_for_warnings=False,  # Just warn, no ack needed
    hide_blocked_options=False,
    
    # Reduced penalty to allow risky options to rank higher
    risk_penalty_multiplier=0.5,
)


# =============================================================================
# MODE POLICY LOOKUP
# =============================================================================

_MODE_POLICIES = {
    BookingRiskMode.SAFE: SAFE_MODE_POLICY,
    BookingRiskMode.BALANCED: BALANCED_MODE_POLICY,
    BookingRiskMode.AGGRESSIVE: AGGRESSIVE_MODE_POLICY,
    # String versions for flexibility
    "safe": SAFE_MODE_POLICY,
    "balanced": BALANCED_MODE_POLICY,
    "aggressive": AGGRESSIVE_MODE_POLICY,
}


def get_mode_policy(mode: BookingRiskMode | str) -> ModePolicy:
    """
    Get the policy for a specific risk mode.
    
    Args:
        mode: Risk mode (enum or string)
    
    Returns:
        ModePolicy for the specified mode
    
    Raises:
        ValueError: If mode is not recognized
    """
    if mode in _MODE_POLICIES:
        return _MODE_POLICIES[mode]
    
    # Try string conversion
    if isinstance(mode, str):
        mode_lower = mode.lower()
        if mode_lower in _MODE_POLICIES:
            return _MODE_POLICIES[mode_lower]
    
    raise ValueError(f"Unknown risk mode: {mode}. Must be one of: safe, balanced, aggressive")


def parse_risk_mode(value: str | None) -> BookingRiskMode:
    """
    Parse a risk mode string into enum.
    
    Args:
        value: String risk mode or None
    
    Returns:
        BookingRiskMode enum (defaults to BALANCED if None/invalid)
    """
    if not value:
        return BookingRiskMode.BALANCED
    
    try:
        return BookingRiskMode(value.lower())
    except ValueError:
        return BookingRiskMode.BALANCED
