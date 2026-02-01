"""
Namespaced reason codes for booking reality rules.

All codes are prefixed by domain: FLIGHT_*, HOTEL_*, POINTS_*, GLOBAL_*
This prevents collisions and makes filtering/dashboards cleaner.

Each code represents a specific booking reality that users need to understand
before proceeding. Codes are STABLE and should not be renamed once in use.

Usage:
    from policy.reason_codes import FLIGHT_UNPROTECTED_CONNECTION
    
    message = PolicyMessage(
        code=FLIGHT_UNPROTECTED_CONNECTION,
        severity="block",
        title="Connection is not protected",
        detail="...",
        context={"airport": "ORD", "layover_minutes": 45},
    )
"""

# =============================================================================
# FLIGHT CONNECTION CODES
# =============================================================================

# Ticketing/Protection issues
FLIGHT_UNPROTECTED_CONNECTION = "FLIGHT_UNPROTECTED_CONNECTION"
"""Multi-segment itinerary not on a single ticket - bags must be rechecked, 
no protection for missed connections."""

FLIGHT_SELF_TRANSFER_RISK = "FLIGHT_SELF_TRANSFER_RISK"
"""Self-transfer required - must collect bags, exit security, and check in again.
Airline will not protect misconnections."""

FLIGHT_BELOW_MCT = "FLIGHT_BELOW_MCT"
"""Connection time is below the Minimum Connection Time for this airport.
High risk of missing connection even on protected tickets."""

FLIGHT_UNKNOWN_PROTECTION = "FLIGHT_UNKNOWN_PROTECTION"
"""Cannot determine if connection is protected. May be safe, but not verified."""

# Fare type issues
FLIGHT_BASIC_ECONOMY_RESTRICTED = "FLIGHT_BASIC_ECONOMY_RESTRICTED"
"""Basic Economy fare - typically no changes allowed, no seat selection,
bags may cost extra, boarding last."""

FLIGHT_NONREFUNDABLE_RISK = "FLIGHT_NONREFUNDABLE_RISK"
"""Nonrefundable fare - no refund if plans change. Check change fees."""

# Booking structure
FLIGHT_ROUNDTRIP_FLEX_RISK = "FLIGHT_ROUNDTRIP_FLEX_RISK"
"""Round-trip ticket reduces flexibility. If one leg changes, the entire 
ticket may need to be modified. Consider booking as two one-ways."""

FLIGHT_SEPARATE_TICKETS_RISK = "FLIGHT_SEPARATE_TICKETS_RISK"
"""Booking separate tickets for outbound and return. No protection between
the two reservations if schedules change."""

# Timing issues
FLIGHT_OVERNIGHT_CONNECTION = "FLIGHT_OVERNIGHT_CONNECTION"
"""Connection requires overnight stay at connecting airport."""

FLIGHT_REDEYE_DEPARTURE = "FLIGHT_REDEYE_DEPARTURE"
"""Flight departs very early morning (midnight to 6am). Consider impact
on sleep and hotel checkout."""

FLIGHT_TIGHT_INTERNATIONAL_MCT = "FLIGHT_TIGHT_INTERNATIONAL_MCT"
"""International connection time is tight. Immigration/customs may cause delays."""

# Codeshare/operating carrier
FLIGHT_CODESHARE_DIFFERENT_TERMINAL = "FLIGHT_CODESHARE_DIFFERENT_TERMINAL"
"""Operating carrier may use different terminal than booking airline."""

FLIGHT_REGIONAL_JET = "FLIGHT_REGIONAL_JET"
"""Operated by regional carrier on small aircraft. May have different
baggage policies and less overhead space."""

FLIGHT_INVALID_TIMING = "FLIGHT_INVALID_TIMING"
"""Segment timing data is inconsistent (e.g., negative duration/layover).
This is usually a provider/data bug and makes booking guidance unreliable."""


# =============================================================================
# HOTEL CODES
# =============================================================================

HOTEL_NONREFUNDABLE_RISK = "HOTEL_NONREFUNDABLE_RISK"
"""Nonrefundable rate - no refund if plans change. Cannot cancel after booking."""

HOTEL_OTA_LOYALTY_LOSS = "HOTEL_OTA_LOYALTY_LOSS"
"""Booking through OTA (third-party). Elite benefits, points earning, and 
loyalty perks may not apply."""

HOTEL_RESORT_FEES_PRESENT = "HOTEL_RESORT_FEES_PRESENT"
"""Mandatory resort/destination fees not included in quoted rate.
True total cost is higher than displayed."""

HOTEL_PREPAY_REQUIRED = "HOTEL_PREPAY_REQUIRED"
"""Full payment required at time of booking, not at check-in."""

HOTEL_CANCELLATION_DEADLINE_SOON = "HOTEL_CANCELLATION_DEADLINE_SOON"
"""Free cancellation deadline is approaching or has passed."""

HOTEL_UNKNOWN_RATE_SOURCE = "HOTEL_UNKNOWN_RATE_SOURCE"
"""Cannot determine if booking is direct with hotel or through OTA."""

HOTEL_CITY_TAX_EXCLUDED = "HOTEL_CITY_TAX_EXCLUDED"
"""City/tourist tax not included in quoted rate. Paid at checkout."""


# =============================================================================
# POINTS/TRANSFER CODES
# =============================================================================

POINTS_TRANSFER_IRREVERSIBLE = "POINTS_TRANSFER_IRREVERSIBLE"
"""Point transfers are permanent. Once transferred to airline/hotel program,
points cannot be transferred back to bank."""

POINTS_TRANSFER_INSTANT_ONLY = "POINTS_TRANSFER_INSTANT_ONLY"
"""Only instant transfer partners available. Non-instant transfers may take
days and could miss award availability."""

POINTS_DEVALUATION_RISK = "POINTS_DEVALUATION_RISK"
"""Award chart or transfer ratios may change. Consider whether to transfer
now or wait until booking is confirmed."""

POINTS_INSUFFICIENT_BALANCE = "POINTS_INSUFFICIENT_BALANCE"
"""Not enough points to complete this booking. Need to transfer or earn more."""

POINTS_PROGRAM_EXPIRATION = "POINTS_PROGRAM_EXPIRATION"
"""Points in this program may expire if no activity. Check program rules."""


# =============================================================================
# GLOBAL CODES
# =============================================================================

GLOBAL_REQUIRES_USER_ACK = "GLOBAL_REQUIRES_USER_ACK"
"""This option has risks that require explicit user acknowledgment."""

GLOBAL_DATA_STALE = "GLOBAL_DATA_STALE"
"""Pricing or availability data may be outdated. Verify before booking."""

GLOBAL_PRICE_CHANGE_LIKELY = "GLOBAL_PRICE_CHANGE_LIKELY"
"""Price has changed recently or is volatile. Final price may differ."""

GLOBAL_BOOKING_WINDOW_CLOSING = "GLOBAL_BOOKING_WINDOW_CLOSING"
"""Booking deadline approaching. Book soon to secure this rate."""


# =============================================================================
# CODE CATEGORIES
# =============================================================================

# High-risk codes that ALWAYS require explicit acknowledgment
HIGH_RISK_CODES = {
    FLIGHT_UNPROTECTED_CONNECTION,
    FLIGHT_SELF_TRANSFER_RISK,
    FLIGHT_BELOW_MCT,
    HOTEL_NONREFUNDABLE_RISK,
    POINTS_TRANSFER_IRREVERSIBLE,
}

# Codes that should block in "safe" mode
SAFE_MODE_BLOCKERS = {
    FLIGHT_UNPROTECTED_CONNECTION,
    FLIGHT_SELF_TRANSFER_RISK,
    FLIGHT_BELOW_MCT,
    FLIGHT_BASIC_ECONOMY_RESTRICTED,
    HOTEL_NONREFUNDABLE_RISK,
}

# Codes that are purely informational (no action needed)
INFO_ONLY_CODES = {
    FLIGHT_OVERNIGHT_CONNECTION,
    FLIGHT_REDEYE_DEPARTURE,
    FLIGHT_REGIONAL_JET,
    HOTEL_CITY_TAX_EXCLUDED,
    GLOBAL_DATA_STALE,
}


def requires_ack(code: str) -> bool:
    """Check if a reason code requires explicit user acknowledgment."""
    return code in HIGH_RISK_CODES


def blocks_in_safe_mode(code: str) -> bool:
    """Check if a reason code should block the option in safe mode."""
    return code in SAFE_MODE_BLOCKERS


def is_info_only(code: str) -> bool:
    """Check if a reason code is purely informational."""
    return code in INFO_ONLY_CODES
