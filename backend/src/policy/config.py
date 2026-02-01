"""
Centralized configuration for booking policy rules.

All policy thresholds and values live here - NO hardcoded magic numbers
in other modules. This makes policy tuneable without code changes.

Usage:
    from policy.config import get_policy_config
    
    config = get_policy_config()
    if layover_minutes < config.mct_for_airport(airport, is_international):
        # Below MCT
        pass
"""

from dataclasses import dataclass, field, asdict
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PolicyConfig:
    """
    Centralized policy configuration.
    
    Frozen to prevent accidental mutation during evaluation.
    All times in minutes, all prices in USD.
    """
    
    # =========================================================================
    # MINIMUM CONNECTION TIME (MCT)
    # =========================================================================
    
    # Default MCT for domestic connections (same country)
    DEFAULT_DOMESTIC_MCT_MIN: int = 45
    
    # Default MCT for international connections (crossing borders)
    DEFAULT_INTL_MCT_MIN: int = 90
    
    # Airport-specific MCT overrides (always use these if available)
    # Format: {airport_code: {domestic: minutes, international: minutes}}
    MCT_BY_AIRPORT: dict = field(default_factory=lambda: {
        # Major US hubs
        "ATL": {"domestic": 45, "international": 90},
        "ORD": {"domestic": 60, "international": 120},  # O'Hare is notorious
        "DFW": {"domestic": 45, "international": 90},
        "DEN": {"domestic": 45, "international": 90},
        "LAX": {"domestic": 60, "international": 120},  # Terminal changes
        "JFK": {"domestic": 60, "international": 120},
        "SFO": {"domestic": 45, "international": 90},
        "MIA": {"domestic": 45, "international": 90},
        
        # European hubs
        "LHR": {"domestic": 60, "international": 90},   # Heathrow
        "CDG": {"domestic": 75, "international": 120},  # Paris - huge airport
        "FRA": {"domestic": 60, "international": 90},   # Frankfurt
        "AMS": {"domestic": 50, "international": 75},   # Amsterdam - efficient
        "FCO": {"domestic": 60, "international": 90},   # Rome
        "MAD": {"domestic": 60, "international": 90},   # Madrid
        "MUC": {"domestic": 45, "international": 75},   # Munich - efficient
        
        # Asian hubs
        "HKG": {"domestic": 60, "international": 90},   # Hong Kong
        "SIN": {"domestic": 60, "international": 90},   # Singapore
        "NRT": {"domestic": 75, "international": 120},  # Tokyo Narita
        "HND": {"domestic": 60, "international": 90},   # Tokyo Haneda
        "ICN": {"domestic": 60, "international": 90},   # Seoul Incheon
        "PVG": {"domestic": 75, "international": 120},  # Shanghai
        "PEK": {"domestic": 75, "international": 120},  # Beijing
        
        # Middle East hubs
        "DXB": {"domestic": 75, "international": 90},   # Dubai
        "DOH": {"domestic": 60, "international": 90},   # Doha
        "IST": {"domestic": 60, "international": 90},   # Istanbul
    })
    
    # Additional buffer for self-transfer (separate tickets)
    SELF_TRANSFER_BUFFER_MIN: int = 180  # 3 hours minimum for separate tickets
    
    # =========================================================================
    # FARE TYPE RESTRICTIONS
    # =========================================================================
    
    # Block basic economy in safe mode?
    BASIC_ECONOMY_BLOCK_IN_SAFE_MODE: bool = True
    
    # Keywords to detect basic economy fares
    BASIC_ECONOMY_KEYWORDS: tuple = (
        "basic economy",
        "basic fare",
        "light fare",
        "saver fare",
        "economy light",
        "base fare",
    )
    
    # =========================================================================
    # ROUND-TRIP vs ONE-WAY
    # =========================================================================
    
    # Recommend two one-ways for flexibility?
    ROUNDTRIP_DISCOURAGE: bool = True
    
    # Price threshold: only recommend one-ways if total is within this % of round-trip
    ONEWAY_PRICE_THRESHOLD_PERCENT: float = 1.15  # 15% premium acceptable
    
    # =========================================================================
    # HOTEL POLICY
    # =========================================================================
    
    # Warn on nonrefundable if within this % of refundable price
    HOTEL_NONREFUNDABLE_PRICE_DELTA_THRESHOLD: float = 0.10  # 10%
    
    # Always show resort/destination fees prominently
    SHOW_RESORT_FEES_ALWAYS: bool = True
    
    # Warning threshold for resort fees (as % of base rate)
    RESORT_FEE_WARNING_THRESHOLD_PERCENT: float = 0.10  # >10% of rate
    
    # Days before check-in to warn about cancellation deadline
    CANCELLATION_WARNING_DAYS: int = 7
    
    # =========================================================================
    # POINTS/TRANSFER POLICY
    # =========================================================================
    
    # Always warn about transfer irreversibility?
    ALWAYS_WARN_TRANSFER_IRREVERSIBLE: bool = True
    
    # Minimum transfer amount before warning
    MIN_TRANSFER_AMOUNT_FOR_WARNING: int = 5000
    
    # =========================================================================
    # TIMING THRESHOLDS
    # =========================================================================
    
    # Hours before flight to warn about tight timing
    TIGHT_BOOKING_WINDOW_HOURS: int = 24
    
    # Redeye departure range (24-hour format)
    REDEYE_START_HOUR: int = 0   # Midnight
    REDEYE_END_HOUR: int = 6     # 6 AM
    
    # Overnight connection threshold (hours)
    OVERNIGHT_CONNECTION_HOURS: int = 8
    
    # =========================================================================
    # RISK SCORING (for ranking)
    # =========================================================================
    
    # Penalty scores by code (higher = riskier, affects ranking)
    RISK_PENALTIES: dict = field(default_factory=lambda: {
        "FLIGHT_UNPROTECTED_CONNECTION": 1000,
        "FLIGHT_SELF_TRANSFER_RISK": 800,
        "FLIGHT_BELOW_MCT": 2000,
        "FLIGHT_BASIC_ECONOMY_RESTRICTED": 200,
        "FLIGHT_NONREFUNDABLE_RISK": 150,
        "FLIGHT_ROUNDTRIP_FLEX_RISK": 100,
        "HOTEL_NONREFUNDABLE_RISK": 300,
        "HOTEL_OTA_LOYALTY_LOSS": 100,
        "HOTEL_RESORT_FEES_PRESENT": 50,
        "POINTS_TRANSFER_IRREVERSIBLE": 200,
    })
    
    def mct_for_airport(
        self, 
        airport: str, 
        is_international: bool = False
    ) -> int:
        """
        Get the MCT for a specific airport and connection type.
        
        Args:
            airport: IATA airport code (e.g., "ORD")
            is_international: Whether the connection crosses international borders
        
        Returns:
            Minimum connection time in minutes
        """
        airport = airport.upper()
        
        if airport in self.MCT_BY_AIRPORT:
            airport_mct = self.MCT_BY_AIRPORT[airport]
            key = "international" if is_international else "domestic"
            return airport_mct.get(key, self.DEFAULT_INTL_MCT_MIN if is_international else self.DEFAULT_DOMESTIC_MCT_MIN)
        
        return self.DEFAULT_INTL_MCT_MIN if is_international else self.DEFAULT_DOMESTIC_MCT_MIN
    
    def get_risk_penalty(self, code: str) -> int:
        """Get the risk penalty score for a reason code."""
        return self.RISK_PENALTIES.get(code, 50)  # Default 50 for unknown codes
    
    def is_basic_economy(self, fare_brand: Optional[str]) -> bool:
        """Check if a fare brand indicates basic economy."""
        if not fare_brand:
            return False
        fare_lower = fare_brand.lower()
        return any(kw in fare_lower for kw in self.BASIC_ECONOMY_KEYWORDS)
    
    def is_redeye(self, departure_hour: int) -> bool:
        """Check if a departure time is a redeye."""
        return self.REDEYE_START_HOUR <= departure_hour < self.REDEYE_END_HOUR
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for logging/debugging."""
        return asdict(self)
    
    def log_snapshot(self, context: str = ""):
        """Log this config as a snapshot."""
        logger.info(
            f"Policy config snapshot {context}",
            extra={"config": self.to_dict()},
        )


# =============================================================================
# GLOBAL SINGLETON
# =============================================================================

_CONFIG: Optional[PolicyConfig] = None


def get_policy_config() -> PolicyConfig:
    """Get the current policy configuration."""
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = PolicyConfig()
    return _CONFIG


def set_policy_config(config: PolicyConfig):
    """Override the configuration (for testing)."""
    global _CONFIG
    _CONFIG = config


def reset_policy_config():
    """Reset to default configuration."""
    global _CONFIG
    _CONFIG = None
