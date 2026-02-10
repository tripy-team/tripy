"""
Points Schemas for Solo Booking Flow

These schemas define the API contracts for points management.
"""
from pydantic import BaseModel, field_validator
from typing import List, Literal, Optional, Union

from .programs import PointsProgram


# Mapping from display names to canonical program IDs
DISPLAY_NAME_TO_PROGRAM = {
    # Chase
    "chase ultimate rewards": PointsProgram.CHASE_UR,
    "chase": PointsProgram.CHASE_UR,
    # Amex
    "amex membership rewards": PointsProgram.AMEX_MR,
    "american express membership rewards": PointsProgram.AMEX_MR,
    "amex": PointsProgram.AMEX_MR,
    # Citi
    "citi thankyou points": PointsProgram.CITI_TYP,
    "citi thankyou": PointsProgram.CITI_TYP,
    "citi": PointsProgram.CITI_TYP,
    # Capital One
    "capital one miles": PointsProgram.CAPITAL_ONE,
    "capital one": PointsProgram.CAPITAL_ONE,
    # Bilt
    "bilt rewards": PointsProgram.BILT,
    "bilt": PointsProgram.BILT,
    # Bank of America (fixed-value)
    "bank of america points": PointsProgram.BANK_OF_AMERICA,
    "bank of america": PointsProgram.BANK_OF_AMERICA,
    "boa": PointsProgram.BANK_OF_AMERICA,
    "bofa": PointsProgram.BANK_OF_AMERICA,
    # Wells Fargo (fixed-value)
    "wells fargo points": PointsProgram.WELLS_FARGO,
    "wells fargo": PointsProgram.WELLS_FARGO,
    # Discover (fixed-value)
    "discover miles": PointsProgram.DISCOVER,
    "discover": PointsProgram.DISCOVER,
    # US Bank (fixed-value)
    "us bank rewards": PointsProgram.US_BANK,
    "us bank": PointsProgram.US_BANK,
    # Airlines
    "united mileageplus": PointsProgram.UNITED,
    "united": PointsProgram.UNITED,
    "american aadvantage": PointsProgram.AMERICAN,
    "aadvantage": PointsProgram.AMERICAN,
    "delta skymiles": PointsProgram.DELTA,
    "delta": PointsProgram.DELTA,
    "southwest rapid rewards": PointsProgram.SOUTHWEST,
    "southwest": PointsProgram.SOUTHWEST,
    "jetblue trueblue": PointsProgram.JETBLUE,
    "jetblue": PointsProgram.JETBLUE,
    "alaska mileage plan": PointsProgram.ALASKA,
    "alaska": PointsProgram.ALASKA,
    "british airways avios": PointsProgram.BRITISH_AIRWAYS,
    "british airways": PointsProgram.BRITISH_AIRWAYS,
    "virgin atlantic flying club": PointsProgram.VIRGIN_ATLANTIC,
    "virgin atlantic": PointsProgram.VIRGIN_ATLANTIC,
    "air france klm flying blue": PointsProgram.AIR_FRANCE_KLM,
    "flying blue": PointsProgram.AIR_FRANCE_KLM,
    "singapore krisflyer": PointsProgram.SINGAPORE,
    "krisflyer": PointsProgram.SINGAPORE,
    "ana mileage club": PointsProgram.ANA,
    "ana": PointsProgram.ANA,
    # Hotels
    "marriott bonvoy": PointsProgram.MARRIOTT,
    "marriott": PointsProgram.MARRIOTT,
    "hilton honors": PointsProgram.HILTON,
    "hilton": PointsProgram.HILTON,
    "world of hyatt": PointsProgram.HYATT,
    "hyatt": PointsProgram.HYATT,
    "ihg one rewards": PointsProgram.IHG,
    "ihg": PointsProgram.IHG,
}


def normalize_program(value: Union[str, PointsProgram]) -> PointsProgram:
    """
    Normalize a program input to canonical PointsProgram enum.
    Accepts:
    - PointsProgram enum values
    - Canonical string values (e.g., "amex_mr")
    - Display names (e.g., "Amex Membership Rewards")
    - Underscore-separated names (e.g., "AMEX_MEMBERSHIP_REWARDS")
    """
    if isinstance(value, PointsProgram):
        return value
    
    if not isinstance(value, str):
        raise ValueError(f"Invalid program type: {type(value)}")
    
    # Try canonical value first
    try:
        return PointsProgram(value)
    except ValueError:
        pass
    
    # Try display name lookup (case insensitive)
    normalized = value.lower().strip()
    if normalized in DISPLAY_NAME_TO_PROGRAM:
        return DISPLAY_NAME_TO_PROGRAM[normalized]
    
    # Also try with underscores converted to spaces (for AMEX_MEMBERSHIP_REWARDS style)
    normalized_with_spaces = normalized.replace("_", " ")
    if normalized_with_spaces in DISPLAY_NAME_TO_PROGRAM:
        return DISPLAY_NAME_TO_PROGRAM[normalized_with_spaces]
    
    # If still not found, raise error with helpful message
    valid_programs = [p.value for p in PointsProgram]
    raise ValueError(
        f"Unknown program: '{value}'. Valid canonical IDs: {valid_programs}. "
        f"Or use display names like 'Amex Membership Rewards', 'Chase Ultimate Rewards', etc."
    )


class PointsBalance(BaseModel):
    """Single points balance for a program.
    
    Supports both exact and estimated balances:
    - owner_type: "user" for authenticated users, "anon" for anonymous sessions
    - confidence: "exact" (verified), "estimated" (conservative guess), "unknown" (user skipped)
    
    Multi-payer support:
    - payer_id: Optional identifier for the points owner in multi-payer trips
    - payer_name: Optional display name for the payer
    """
    program: Union[str, PointsProgram]  # Accept both string and enum
    balance: int
    updated_at: Optional[str] = None  # Issue #4 FIX: add updated_at
    owner_type: Optional[Literal["user", "anon"]] = "user"  # Who owns these points
    confidence: Optional[Literal["exact", "estimated", "unknown"]] = "exact"  # Balance confidence
    # Multi-payer: identify which person owns this balance
    payer_id: Optional[str] = None  # e.g., "alice" or a user ID
    payer_name: Optional[str] = None  # e.g., "Alice" for display
    
    @field_validator('program', mode='before')
    @classmethod
    def normalize_program_field(cls, v):
        """Normalize program to canonical enum value."""
        return normalize_program(v)


class UpsertPointsRequest(BaseModel):
    """Request to upsert points balances"""
    points: List[PointsBalance]  # Issue #3 FIX: field is named "points"


class PointsSummaryResponse(BaseModel):
    """Response containing points summary for a trip"""
    trip_id: str  # Issue #4 FIX: always include trip_id
    items: List[PointsBalance]
    total_points: int
