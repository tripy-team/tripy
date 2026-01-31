"""
Enums for V3/V4 optimization connection protection.

These enums prevent stringly-typed bugs and make the code self-documenting.
"""

from enum import Enum


class TicketingType(Enum):
    """How the itinerary is ticketed."""
    SINGLE_TICKET = "single_ticket"      # One PNR, airline handles connections
    SEPARATE_TICKETS = "separate_tickets"  # Multiple PNRs, passenger bears risk
    UNKNOWN = "unknown"


class ConnectionProtection(Enum):
    """Who protects the passenger if they miss a connection."""
    AIRLINE_PROTECTED = "airline_protected"  # Airline will rebook for free
    OTA_GUARANTEE = "ota_guarantee"          # OTA offers some guarantee (not same as airline)
    UNPROTECTED = "unprotected"              # Passenger bears all risk
    UNKNOWN = "unknown"


class SelfTransferRequired(Enum):
    """Whether passenger must handle their own transfer between flights."""
    YES = "yes"      # Must collect bags, re-check, go through security
    NO = "no"        # Bags checked through, stay airside (usually)
    UNKNOWN = "unknown"


class TransferType(Enum):
    """Physical transfer requirements at connection."""
    NOT_APPLICABLE = "not_applicable"  # Direct flight (no transfer)
    AIRSIDE = "airside"                # Stay in secure area
    LANDSIDE_REQUIRED = "landside"     # Must exit secure area
    UNKNOWN = "unknown"


class TransferConfidence(Enum):
    """Confidence level in transfer type determination."""
    HIGH = "high"      # Certain (e.g., chain break, US port of entry)
    MEDIUM = "medium"  # Likely but not certain
    LOW = "low"        # Guess based on limited data


class WarningSeverity(Enum):
    """Severity of connection warnings."""
    INFO = "info"        # FYI only
    WARNING = "warning"  # User should be aware
    ERROR = "error"      # Something is wrong


class WarningCategory(Enum):
    """Category of connection warnings."""
    TRANSFER = "transfer"        # Transfer-related (landside, timing)
    DATA_QUALITY = "data_quality"  # Data issues (missing segments, unknown codes)
    PROTECTION = "protection"    # Protection-related
    TIMING = "timing"            # Connection time issues
