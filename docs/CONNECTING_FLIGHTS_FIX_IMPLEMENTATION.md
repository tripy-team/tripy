# Connecting Flights: Production Implementation Spec

**Version:** 4.1 (Ready to implement)
**Status:** All runtime/import bugs fixed

## File Naming Convention

**Recommendation:** Use stable filenames WITHOUT version suffixes:

| Spec Reference | Implementation File |
|----------------|---------------------|
| `models_v3.py` (in spec) | `models.py` (in code) |
| `adapter_v3.py` (in spec) | `adapter.py` (in code) |
| `solver_v3.py` (in spec) | `solver.py` (in code) |

Version history belongs in git commits and this changelog, not in filenames.
This prevents import confusion and makes refactoring easier.

## Changelog

- **V4.1**: Fixed import bug (`is_same_airport_code`), policy-driven incomplete check, sorted allowed list for deterministic logs, JSON set kept private (`_us_preclearance_set`), added `is_valid_iata()` for smart chain-break warnings, `make_edge_raw()` helper, removed `strict_mode=True` from tests
- **V4**: Fixed discovery source trust levels, medium-trust doesn't assert SINGLE_TICKET, policy-driven validation, chain break handling, JSON list→set normalization, OTA protection is policy-configurable
- **V3**: Enums, provider contracts, single derivation pipeline, transfer confidence
- **V2**: Separated ticketing/protection/transfer concepts, airport data files
- **V1**: Initial plan (had critical bugs)

---

## Executive Summary

This spec ensures the optimizer only shows flight connections that are:
1. **Protected** - Airline will rebook if misconnect
2. **Not self-transfer** - Passenger doesn't carry risk between legs
3. **Clearly warned** - Landside transfers (bags/security) are shown, not hidden

Key design principles:
- **Separate concepts**: ticketing ≠ protection ≠ physical transfer
- **Provider contracts**: `offer_id` alone doesn't prove protection
- **Data-driven**: Airport/country mappings from datasets, not hardcoded lists
- **Conservative defaults**: Unknown = blocked in strict mode
- **Enums not strings**: Prevent typo bugs

---

## Part 1: Data Model

### 1.1 Enums (Stringly-Typed Bug Prevention)

```python
# backend/src/optimization/enums.py

from enum import Enum


class TicketingType(Enum):
    """How the itinerary is ticketed."""
    SINGLE_TICKET = "single_ticket"      # One PNR, one ticket
    SEPARATE_TICKETS = "separate_tickets"  # Multiple independent bookings
    UNKNOWN = "unknown"


class ConnectionProtection(Enum):
    """Who protects the passenger if they misconnect."""
    AIRLINE_PROTECTED = "airline_protected"  # Airline will rebook
    OTA_GUARANTEE = "ota_guarantee"          # OTA (not airline) provides guarantee
    UNPROTECTED = "unprotected"              # No protection
    UNKNOWN = "unknown"


class SelfTransferRequired(Enum):
    """Does passenger need to self-transfer between legs?"""
    YES = "yes"      # Must collect bags, recheck, potentially different terminals/airports
    NO = "no"        # Airline handles connection
    UNKNOWN = "unknown"


class TransferType(Enum):
    """Physical transfer requirements at connection."""
    NOT_APPLICABLE = "not_applicable"  # Direct flight (no transfer)
    AIRSIDE = "airside"                # Stay in secure area
    LANDSIDE_REQUIRED = "landside"     # Must exit secure area
    UNKNOWN = "unknown"


class TransferConfidence(Enum):
    """How confident are we in the transfer_type determination?"""
    HIGH = "high"      # Based on rules we're sure about (airport change, US entry)
    MEDIUM = "medium"  # Based on heuristics
    LOW = "low"        # Guess / default
    UNKNOWN = "unknown"


class WarningSeverity(Enum):
    """Severity of connection warnings."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class WarningCategory(Enum):
    """Category of connection warning."""
    PROTECTION = "protection"
    TRANSFER = "transfer"
    TIMING = "timing"
    CARRIER = "carrier"
    DATA_QUALITY = "data_quality"
```

### 1.2 Provider Contract Registry

```python
# backend/src/optimization/provider_contracts.py

from dataclasses import dataclass
from typing import Optional
from .enums import ConnectionProtection


@dataclass(frozen=True)
class ProviderContract:
    """
    Defines what guarantees a pricing source provides.
    
    This is the KEY insight: offer_id alone doesn't mean protection.
    The SOURCE of the offer determines the protection semantics.
    """
    
    provider_id: str
    display_name: str
    
    # Does this provider's offer_id imply airline-issued ticket?
    offers_airline_ticketing: bool
    
    # Does this provider's offer_id imply airline protection?
    offers_airline_protection: bool
    
    # Does this provider do virtual interlining (coordinated but not protected)?
    does_virtual_interlining: bool
    
    # If they do VI, do they offer their own guarantee?
    offers_ota_guarantee: bool
    
    # Trust level for inferring protection
    # HIGH = we can trust offer_id means protected
    # MEDIUM = we trust it's a real price but protection unclear
    # LOW = can't infer anything
    trust_level: str  # "high" | "medium" | "low"


# ═══════════════════════════════════════════════════════════════════════════════
# PROVIDER CONTRACT TABLE
# ═══════════════════════════════════════════════════════════════════════════════
# 
# This table codifies what each data source actually guarantees.
# Update this when integrating new providers.
# ═══════════════════════════════════════════════════════════════════════════════

PROVIDER_CONTRACTS = {
    # ─────────────────────────────────────────────────────────────────────────
    # GDS / AIRLINE DIRECT (HIGH TRUST)
    # These return airline-issued fare quotes with ticketing guarantees
    # ─────────────────────────────────────────────────────────────────────────
    
    "amadeus_gds": ProviderContract(
        provider_id="amadeus_gds",
        display_name="Amadeus GDS",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "sabre_gds": ProviderContract(
        provider_id="sabre_gds",
        display_name="Sabre GDS",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "travelport_gds": ProviderContract(
        provider_id="travelport_gds",
        display_name="Travelport GDS",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "airline_ndc": ProviderContract(
        provider_id="airline_ndc",
        display_name="Airline NDC Direct",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "duffel": ProviderContract(
        provider_id="duffel",
        display_name="Duffel",
        offers_airline_ticketing=True,  # They aggregate GDS/NDC
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # AWARD SEARCH / DISCOVERY (LOW-MEDIUM TRUST)
    # 
    # IMPORTANT: These are DISCOVERY layers, not ticketing/booking sources.
    # They show availability/pricing but the actual ticket is issued elsewhere.
    # "Discovery ID" ≠ "Bookable offer ID"
    # 
    # Only upgrade to high trust if you have a REAL booking artifact
    # from an airline booking flow that yields an actual PNR.
    # ─────────────────────────────────────────────────────────────────────────
    
    "awardtool": ProviderContract(
        provider_id="awardtool",
        display_name="AwardTool",
        offers_airline_ticketing=False,  # Discovery layer only
        offers_airline_protection=False,  # Can't guarantee until booked
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="medium",  # Shows real availability but not bookable artifact
    ),
    
    "seats_aero": ProviderContract(
        provider_id="seats_aero",
        display_name="Seats.aero",
        offers_airline_ticketing=False,  # Discovery/aggregation
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",  # Aggregates from multiple sources
    ),
    
    "point_me": ProviderContract(
        provider_id="point_me",
        display_name="Point.me",
        offers_airline_ticketing=False,  # Discovery
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # VIRTUAL INTERLINING PLATFORMS (LOW TRUST FOR PROTECTION)
    # These combine flights but passenger carries the risk
    # ─────────────────────────────────────────────────────────────────────────
    
    "kiwi": ProviderContract(
        provider_id="kiwi",
        display_name="Kiwi.com",
        offers_airline_ticketing=False,  # They combine separate tickets
        offers_airline_protection=False,
        does_virtual_interlining=True,
        offers_ota_guarantee=True,  # Kiwi Guarantee (their own, not airline)
        trust_level="low",
    ),
    
    "skiplagged": ProviderContract(
        provider_id="skiplagged",
        display_name="Skiplagged",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=True,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # METASEARCH / UNKNOWN (CANNOT INFER)
    # ─────────────────────────────────────────────────────────────────────────
    
    "google_flights": ProviderContract(
        provider_id="google_flights",
        display_name="Google Flights",
        offers_airline_ticketing=False,  # Redirects to airline/OTA
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",  # We don't know who actually tickets it
    ),
    
    "serpapi": ProviderContract(
        provider_id="serpapi",
        display_name="SerpAPI (scraped)",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # DEFAULT (when source unknown)
    # ─────────────────────────────────────────────────────────────────────────
    
    "unknown": ProviderContract(
        provider_id="unknown",
        display_name="Unknown Source",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
}


def get_provider_contract(source: Optional[str]) -> ProviderContract:
    """Get provider contract, defaulting to unknown."""
    if not source:
        return PROVIDER_CONTRACTS["unknown"]
    
    # Normalize source name
    normalized = source.lower().replace("-", "_").replace(" ", "_")
    
    return PROVIDER_CONTRACTS.get(normalized, PROVIDER_CONTRACTS["unknown"])
```

### 1.3 Airport Data Module

```python
# backend/src/optimization/airport_data.py

"""
Airport data module.

DESIGN: Use data files, not hardcoded lists.
Data sources:
- OurAirports (https://ourairports.com/data/) - free, updated
- OpenFlights - also free
- CBP Preclearance locations (https://www.cbp.gov/travel/preclearance)

For MVP: ship a static JSON file, update monthly.
Later: fetch from data API or CDN.
"""

import json
from pathlib import Path
from functools import lru_cache
from typing import Optional, Set


DATA_DIR = Path(__file__).parent / "data"


@lru_cache(maxsize=1)
def _load_airport_data() -> dict:
    """
    Load airport data from JSON file.
    
    IMPORTANT: Normalizes membership-heavy lists to sets for O(1) lookup.
    """
    path = DATA_DIR / "airports.json"
    if not path.exists():
        # Fallback to minimal embedded data
        data = _get_fallback_airport_data()
    else:
        with open(path) as f:
            data = json.load(f)
    
    # ═══════════════════════════════════════════════════════════════════════
    # NORMALIZE: Create O(1) sets for membership checks
    # 
    # Keep original lists for serialization (json.dumps would fail on sets),
    # but create private _set versions for fast lookup.
    # ═══════════════════════════════════════════════════════════════════════
    
    if "us_preclearance_airports" in data:
        data["_us_preclearance_set"] = set(data["us_preclearance_airports"])
    else:
        data["_us_preclearance_set"] = set()
    
    # Future: normalize other membership-heavy lists here
    # e.g., data["_schengen_set"] = set(data.get("schengen_airports", []))
    
    return data


def get_airport_country(iata_code: str) -> Optional[str]:
    """Get ISO country code for an airport."""
    data = _load_airport_data()
    airport = data.get("airports", {}).get(iata_code.upper())
    if airport:
        return airport.get("country")
    return None


def is_us_airport(iata_code: str) -> bool:
    """Check if airport is in the United States."""
    return get_airport_country(iata_code) == "US"


def has_us_preclearance(iata_code: str) -> bool:
    """
    Check if airport has US Customs preclearance.
    
    At preclearance airports, passengers clear US customs BEFORE departure.
    They arrive as "domestic" passengers and don't need to re-clear.
    
    Source: https://www.cbp.gov/travel/preclearance
    """
    data = _load_airport_data()
    # Use private set for O(1) lookup (original list kept for serialization)
    preclearance = data.get("_us_preclearance_set", set())
    return iata_code.upper() in preclearance


def is_valid_iata(iata_code: str) -> bool:
    """
    Check if an IATA code is in our airport dataset.
    
    Used to distinguish real airport changes from parse corruption.
    Returns False for empty/None or codes not in our dataset.
    """
    if not iata_code:
        return False
    
    data = _load_airport_data()
    airports = data.get("airports", {})
    return iata_code.upper() in airports


def is_same_airport_code(iata1: str, iata2: str) -> bool:
    """
    Check if two airport codes are the exact same airport.
    
    NOTE: This is intentionally named precisely. It does NOT check:
    - Metro area (JFK, LGA, EWR are all NYC but different airports)
    - Terminal groupings
    - City pairs
    
    For transfer feasibility, we need exact airport match.
    Different IATA codes = different airports = likely landside transfer.
    
    DO NOT "upgrade" this to treat JFK/LGA/EWR as "same system" -
    you cannot stay airside between them!
    
    For search expansion (showing flights to any NYC airport), use a 
    separate `same_city_cluster()` function (not implemented here).
    """
    if not iata1 or not iata2:
        return False
    return iata1.upper() == iata2.upper()


def _get_fallback_airport_data() -> dict:
    """
    Fallback data when JSON file not available.
    
    This is a MINIMAL set for critical functionality.
    Production should use the full data file.
    """
    return {
        "airports": {
            # Major US airports
            "JFK": {"country": "US", "city": "New York"},
            "LAX": {"country": "US", "city": "Los Angeles"},
            "ORD": {"country": "US", "city": "Chicago"},
            "DFW": {"country": "US", "city": "Dallas"},
            "MIA": {"country": "US", "city": "Miami"},
            "SFO": {"country": "US", "city": "San Francisco"},
            "EWR": {"country": "US", "city": "Newark"},
            "ATL": {"country": "US", "city": "Atlanta"},
            "BOS": {"country": "US", "city": "Boston"},
            "SEA": {"country": "US", "city": "Seattle"},
            "IAD": {"country": "US", "city": "Washington"},
            "IAH": {"country": "US", "city": "Houston"},
            "DEN": {"country": "US", "city": "Denver"},
            "PHX": {"country": "US", "city": "Phoenix"},
            "LAS": {"country": "US", "city": "Las Vegas"},
            
            # Major international
            "LHR": {"country": "GB", "city": "London"},
            "LGW": {"country": "GB", "city": "London"},
            "CDG": {"country": "FR", "city": "Paris"},
            "FRA": {"country": "DE", "city": "Frankfurt"},
            "AMS": {"country": "NL", "city": "Amsterdam"},
            "NRT": {"country": "JP", "city": "Tokyo"},
            "HND": {"country": "JP", "city": "Tokyo"},
            "ICN": {"country": "KR", "city": "Seoul"},
            "SIN": {"country": "SG", "city": "Singapore"},
            "HKG": {"country": "HK", "city": "Hong Kong"},
            "DXB": {"country": "AE", "city": "Dubai"},
            "DOH": {"country": "QA", "city": "Doha"},
            "IST": {"country": "TR", "city": "Istanbul"},
            
            # Canada (for preclearance testing)
            "YYZ": {"country": "CA", "city": "Toronto"},
            "YVR": {"country": "CA", "city": "Vancouver"},
            "YUL": {"country": "CA", "city": "Montreal"},
            
            # Ireland (preclearance)
            "DUB": {"country": "IE", "city": "Dublin"},
            "SNN": {"country": "IE", "city": "Shannon"},
            
            # UAE (preclearance)
            "AUH": {"country": "AE", "city": "Abu Dhabi"},
        },
        
        # CBP Preclearance locations as of 2024
        # Source: https://www.cbp.gov/travel/preclearance
        "us_preclearance_airports": {
            # Canada
            "YYZ", "YVR", "YUL", "YOW", "YWG", "YHZ", "YEG", "YYC",
            # Ireland
            "DUB", "SNN",
            # Caribbean
            "AUA",  # Aruba
            "BDA",  # Bermuda
            "FPO",  # Freeport, Bahamas
            "NAS",  # Nassau, Bahamas
            # UAE
            "AUH",  # Abu Dhabi
        },
    }
```

### 1.4 Data File Structure

Create `backend/src/optimization/data/airports.json`:

```json
{
  "_meta": {
    "version": "1.0.0",
    "last_updated": "2024-01-15",
    "sources": [
      "https://ourairports.com/data/",
      "https://www.cbp.gov/travel/preclearance"
    ]
  },
  "airports": {
    "JFK": {"country": "US", "city": "New York", "name": "John F Kennedy Intl"},
    "LAX": {"country": "US", "city": "Los Angeles", "name": "Los Angeles Intl"},
    ...
  },
  "us_preclearance_airports": ["YYZ", "YVR", "YUL", "DUB", "SNN", "AUH", ...]
}
```

### 1.5 Updated FlightItineraryEdge

```python
# backend/src/optimization/models_v3.py (updated)

from dataclasses import dataclass, field
from datetime import datetime, date
from typing import List, Optional, Dict
from .enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired,
    TransferType, TransferConfidence, WarningSeverity, WarningCategory,
)


@dataclass
class ConnectionWarning:
    """A warning about a connection point."""
    
    severity: WarningSeverity
    category: WarningCategory
    message: str
    connection_index: int = 0
    
    user_action_required: bool = False
    action_description: Optional[str] = None
    
    # For UX rendering
    icon: Optional[str] = None  # e.g., "customs", "security", "clock"


@dataclass
class FlightItineraryEdge:
    """
    A complete flight itinerary as a single decision unit.
    
    INVARIANTS:
    1. This represents ONE bookable itinerary (direct or connecting)
    2. The optimizer selects ONE of these per leg - no stitching
    3. Protection/transfer attributes are derived via finalize_itinerary()
    """
    
    edge_id: str
    leg_id: int
    origin: str
    destination: str
    segments: List["FlightSegment"] = field(default_factory=list)
    
    departure_datetime: Optional[datetime] = None
    arrival_datetime: Optional[datetime] = None
    total_time_minutes: int = 0
    
    # ═══════════════════════════════════════════════════════════════════════
    # PRICING
    # ═══════════════════════════════════════════════════════════════════════
    
    cash_cost: float = 0.0
    award_options: List["AwardOption"] = field(default_factory=list)
    
    # ═══════════════════════════════════════════════════════════════════════
    # SOURCE / ARTIFACT (raw from provider)
    # ═══════════════════════════════════════════════════════════════════════
    
    pricing_source: Optional[str] = None  # Provider ID (maps to contract)
    
    # Priced offer artifacts (evidence of real pricing)
    # NOTE: "Discovery ID" ≠ "Bookable offer ID"
    # These only count as strong evidence from high-trust providers
    offer_id: Optional[str] = None
    pricing_id: Optional[str] = None
    fare_id: Optional[str] = None
    pnr: Optional[str] = None
    
    # Carrier info
    validating_carrier: Optional[str] = None
    
    # ═══════════════════════════════════════════════════════════════════════
    # DERIVED FLAGS (set by finalize_itinerary, not asserted as truth)
    # ═══════════════════════════════════════════════════════════════════════
    
    # True if we have a pricing artifact, regardless of whether we trust the source
    # This is SEPARATE from ticketing_type - having an artifact doesn't prove single-ticket
    pricing_artifact_present: bool = False
    
    # ═══════════════════════════════════════════════════════════════════════
    # TICKETING / PROTECTION (derived via finalize_itinerary)
    # ═══════════════════════════════════════════════════════════════════════
    
    ticketing_type: TicketingType = TicketingType.UNKNOWN
    connection_protection: ConnectionProtection = ConnectionProtection.UNKNOWN
    self_transfer_required: SelfTransferRequired = SelfTransferRequired.UNKNOWN
    
    # Who provides the protection (if any)?
    protection_provider: Optional[str] = None  # "airline", "kiwi_guarantee", etc.
    
    # ═══════════════════════════════════════════════════════════════════════
    # TRANSFER TYPE (physical, derived via finalize_itinerary)
    # ═══════════════════════════════════════════════════════════════════════
    
    transfer_type: TransferType = TransferType.UNKNOWN
    transfer_confidence: TransferConfidence = TransferConfidence.UNKNOWN
    landside_reasons: List[str] = field(default_factory=list)
    
    # ═══════════════════════════════════════════════════════════════════════
    # DATA COMPLETENESS
    # ═══════════════════════════════════════════════════════════════════════
    
    segments_incomplete: bool = False
    num_stops_hint: Optional[int] = None
    
    # Was this edge finalized (derived attributes computed)?
    # IMMUTABILITY RULE: After finalize_itinerary() is called, the edge should
    # be treated as immutable. Do not modify segments or raw fields after finalization.
    _finalized: bool = False
    
    # Chain breaks detected in _compute_completeness (internal use)
    # List of {index, from_airport, to_airport}
    _chain_breaks: List[dict] = field(default_factory=list)
    
    # ═══════════════════════════════════════════════════════════════════════
    # WARNINGS (populated by finalize_itinerary)
    # ═══════════════════════════════════════════════════════════════════════
    
    connection_warnings: List[ConnectionWarning] = field(default_factory=list)
    
    # ═══════════════════════════════════════════════════════════════════════
    # COMPUTED PROPERTIES
    # ═══════════════════════════════════════════════════════════════════════
    
    @property
    def num_stops(self) -> int:
        """
        Number of stops, accounting for incomplete data.
        
        INVARIANT: Never let missing segments make a connection look direct.
        """
        if self.segments_incomplete:
            # Use hint if available, otherwise assume at least 1 stop
            if self.num_stops_hint is not None:
                return max(self.num_stops_hint, 1)
            return 1  # Conservative: incomplete = at least 1 stop
        
        computed = max(0, len(self.segments) - 1)
        
        # If hint contradicts, use higher value
        if self.num_stops_hint is not None:
            return max(computed, self.num_stops_hint)
        
        return computed
    
    @property
    def is_direct(self) -> bool:
        """True only if we're CERTAIN this is a direct flight."""
        if self.segments_incomplete:
            return False
        if self.num_stops_hint is not None and self.num_stops_hint > 0:
            return False
        return len(self.segments) == 1
    
    @property
    def has_priced_offer(self) -> bool:
        """True if we have any priced itinerary artifact."""
        return bool(self.offer_id or self.pricing_id or self.fare_id or self.pnr)
    
    @property
    def is_airline_protected(self) -> bool:
        """True if connection is protected by AIRLINE (not OTA)."""
        return self.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
    
    @property
    def has_some_protection(self) -> bool:
        """
        True if connection has some form of protection.
        
        NOTE: This includes OTA guarantees which are NOT equivalent to airline protection.
        Use is_airline_protected for strict checks.
        """
        return self.connection_protection in {
            ConnectionProtection.AIRLINE_PROTECTED,
            ConnectionProtection.OTA_GUARANTEE,
        }
    
    @property
    def is_safe_to_show(self) -> bool:
        """
        True if this itinerary is safe to show to users under STRICT policy.
        
        For policy-driven checks, use the validator instead.
        
        MVP criteria:
        - Direct flights: always safe
        - Connections: must be AIRLINE protected AND not self-transfer
        """
        if self.is_direct:
            return True
        
        return (
            self.is_airline_protected and  # NOT has_some_protection!
            self.self_transfer_required == SelfTransferRequired.NO
        )
    
    def add_warning(
        self,
        severity: WarningSeverity,
        category: WarningCategory,
        message: str,
        conn_idx: int = 0,
        action_required: bool = False,
        action_desc: Optional[str] = None,
        icon: Optional[str] = None,
    ):
        """Add a warning to this itinerary."""
        self.connection_warnings.append(ConnectionWarning(
            severity=severity,
            category=category,
            message=message,
            connection_index=conn_idx,
            user_action_required=action_required,
            action_description=action_desc,
            icon=icon,
        ))
```

---

## Part 2: Derivation Pipeline

All attribute derivation happens in ONE place: `finalize_itinerary()`.

```python
# backend/src/optimization/derivation.py

"""
Single derivation pipeline for flight itinerary attributes.

All protection/transfer logic lives here. The adapter just extracts raw data.
The validator just applies rules.
"""

import logging
from typing import List, Optional

from .models_v3 import FlightItineraryEdge, FlightSegment, ConnectionWarning
from .enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired,
    TransferType, TransferConfidence, WarningSeverity, WarningCategory,
)
from .provider_contracts import get_provider_contract, ProviderContract
from .airport_data import (
    is_us_airport, has_us_preclearance, get_airport_country,
    is_same_airport_code, is_valid_iata,
)

logger = logging.getLogger(__name__)


def finalize_itinerary(edge: FlightItineraryEdge) -> FlightItineraryEdge:
    """
    Finalize a flight itinerary by deriving all protection/transfer attributes.
    
    This is the SINGLE PLACE where derivation logic lives.
    
    Steps:
    1. Normalize carriers/airports
    2. Compute completeness (stops, segments)
    3. Derive ticketing/protection from provider contract
    4. Derive transfer type with confidence
    5. Generate warnings
    
    Returns the same edge with derived attributes populated.
    """
    
    if edge._finalized:
        return edge
    
    # Step 1: Normalize (for now, just uppercase airports)
    _normalize_edge(edge)
    
    # Step 2: Compute completeness
    _compute_completeness(edge)
    
    # Step 3: Derive protection (uses provider contract)
    _derive_protection(edge)
    
    # Step 4: Derive transfer type
    _derive_transfer_type(edge)
    
    # Step 5: Generate warnings
    _generate_warnings(edge)
    
    edge._finalized = True
    return edge


def _normalize_edge(edge: FlightItineraryEdge):
    """Normalize airports and carriers."""
    edge.origin = edge.origin.upper() if edge.origin else ""
    edge.destination = edge.destination.upper() if edge.destination else ""
    
    for seg in edge.segments:
        seg.origin = seg.origin.upper() if seg.origin else ""
        seg.destination = seg.destination.upper() if seg.destination else ""
        seg.operating_carrier = (seg.operating_carrier or "").upper()
        seg.marketing_carrier = (seg.marketing_carrier or "").upper()
    
    if edge.validating_carrier:
        edge.validating_carrier = edge.validating_carrier.upper()


def _compute_completeness(edge: FlightItineraryEdge):
    """
    Determine if segment data is complete and detect chain breaks.
    
    Chain breaks (segment[i].destination != segment[i+1].origin) are either:
    - Airport change (real - requires landside transfer)
    - Data corruption (bad parse)
    
    We record both for downstream handling.
    """
    
    # If no segments at all, definitely incomplete
    if not edge.segments:
        edge.segments_incomplete = True
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # Check segment chain integrity and record breaks
    # ═══════════════════════════════════════════════════════════════════════
    
    chain_breaks = []
    
    for i in range(len(edge.segments) - 1):
        s1, s2 = edge.segments[i], edge.segments[i + 1]
        
        if s1.destination and s2.origin and s1.destination != s2.origin:
            from_apt = s1.destination
            to_apt = s2.origin
            
            chain_breaks.append({
                "index": i,
                "from_airport": from_apt,
                "to_airport": to_apt,
            })
            
            # Determine if this is a real airport change vs parse corruption
            # If both are valid IATA codes, treat as transfer fact (no data quality warning)
            # If either is invalid/unknown, add data quality warning
            from_valid = is_valid_iata(from_apt)
            to_valid = is_valid_iata(to_apt)
            
            if not from_valid or not to_valid:
                # Unknown airport code - could be parse corruption
                edge.add_warning(
                    severity=WarningSeverity.WARNING,
                    category=WarningCategory.DATA_QUALITY,
                    message=f"Segment chain break with unknown airport: {from_apt} → {to_apt}",
                    conn_idx=i,
                )
            # If both valid, don't add DATA_QUALITY warning - _derive_transfer_type
            # will handle this as a transfer fact
    
    # Store chain breaks for transfer type derivation (HIGH confidence landside)
    edge._chain_breaks = chain_breaks
    
    # ═══════════════════════════════════════════════════════════════════════
    # Check if hint contradicts segments
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.num_stops_hint is not None:
        expected_segments = edge.num_stops_hint + 1
        if len(edge.segments) < expected_segments:
            edge.segments_incomplete = True
            logger.warning(
                f"{edge.edge_id}: Expected {expected_segments} segments "
                f"(from num_stops_hint={edge.num_stops_hint}), "
                f"got {len(edge.segments)}. Marking incomplete."
            )


def _derive_protection(edge: FlightItineraryEdge):
    """
    Derive ticketing and protection attributes.
    
    Uses the provider contract to understand what guarantees exist.
    
    IMPORTANT: We only assert ticketing_type=SINGLE_TICKET when we have
    STRONG evidence. Medium/low trust sources leave it as UNKNOWN.
    "Discovery ID" ≠ "Bookable offer ID"
    
    NOTE: If fields are already set to non-default values, they are preserved.
    This allows tests and adapters to pre-set fields before finalization.
    """
    
    # Set pricing artifact flag first (separate from whether we trust it)
    edge.pricing_artifact_present = edge.has_priced_offer
    
    # ═══════════════════════════════════════════════════════════════════════
    # PRESERVE PRE-SET VALUES
    # If adapter or test has already set protection fields, don't overwrite
    # ═══════════════════════════════════════════════════════════════════════
    
    already_derived = (
        edge.connection_protection != ConnectionProtection.UNKNOWN or
        edge.self_transfer_required != SelfTransferRequired.UNKNOWN or
        edge.ticketing_type != TicketingType.UNKNOWN
    )
    if already_derived:
        # Fields were pre-set, preserve them
        return
    
    # Direct flights are trivially protected
    if edge.is_direct:
        edge.ticketing_type = TicketingType.SINGLE_TICKET
        edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
        edge.self_transfer_required = SelfTransferRequired.NO
        edge.protection_provider = "airline"
        return
    
    # Get provider contract
    contract = get_provider_contract(edge.pricing_source)
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 0: Check for explicit self-transfer markers
    # Some providers explicitly mark virtual interline / self-transfer
    # ═══════════════════════════════════════════════════════════════════════
    
    # (This would come from raw provider data - adapter should extract it)
    # For now, check if provider is known to do virtual interlining
    if contract.does_virtual_interlining:
        edge.self_transfer_required = SelfTransferRequired.YES
        edge.ticketing_type = TicketingType.SEPARATE_TICKETS
        edge.connection_protection = ConnectionProtection.UNPROTECTED
        
        if contract.offers_ota_guarantee:
            # Provider offers their own guarantee (e.g., Kiwi Guarantee)
            edge.connection_protection = ConnectionProtection.OTA_GUARANTEE
            edge.protection_provider = f"{contract.display_name} Guarantee"
        
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 1: Check for priced offer from HIGH TRUST provider
    # Only high-trust providers can assert single-ticket + protected
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.has_priced_offer and contract.trust_level == "high":
        if contract.offers_airline_protection:
            edge.ticketing_type = TicketingType.SINGLE_TICKET
            edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
            edge.self_transfer_required = SelfTransferRequired.NO
            edge.protection_provider = "airline"
            return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 2: Has priced offer but provider not fully trusted
    # 
    # CRITICAL: Do NOT assert SINGLE_TICKET here!
    # "Discovery ID" from awardtool/seats.aero ≠ bookable single ticket
    # Keep everything UNKNOWN until user actually books via trusted channel
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.has_priced_offer and contract.trust_level in {"medium", "low"}:
        # We have a pricing artifact but can't trust it means single-ticket
        edge.ticketing_type = TicketingType.UNKNOWN  # NOT single_ticket!
        edge.connection_protection = ConnectionProtection.UNKNOWN
        edge.self_transfer_required = SelfTransferRequired.UNKNOWN
        # pricing_artifact_present=True (set above) lets downstream know
        # "there's something here but not verified"
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 3: Has validating carrier (suggests ticketing POSSIBLE, not proven)
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.validating_carrier:
        # Validating carrier suggests someone COULD ticket it
        # But we don't have proof it WAS ticketed as single itinerary
        edge.ticketing_type = TicketingType.UNKNOWN  # NOT single_ticket!
        edge.connection_protection = ConnectionProtection.UNKNOWN
        edge.self_transfer_required = SelfTransferRequired.UNKNOWN
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 4: No evidence - all unknown
    # ═══════════════════════════════════════════════════════════════════════
    
    edge.ticketing_type = TicketingType.UNKNOWN
    edge.connection_protection = ConnectionProtection.UNKNOWN
    edge.self_transfer_required = SelfTransferRequired.UNKNOWN


def _derive_transfer_type(edge: FlightItineraryEdge):
    """
    Derive physical transfer requirements at each connection.
    
    This is SEPARATE from protection - even a protected ticket
    can require landside transfer (e.g., US port of entry).
    """
    
    if edge.is_direct:
        # Direct flights have no transfer - not applicable
        edge.transfer_type = TransferType.NOT_APPLICABLE
        edge.transfer_confidence = TransferConfidence.HIGH
        return
    
    # Start optimistic for connections
    edge.transfer_type = TransferType.AIRSIDE
    edge.transfer_confidence = TransferConfidence.MEDIUM
    
    # ═══════════════════════════════════════════════════════════════════════
    # CHECK 0: Chain breaks from _compute_completeness (HIGH confidence)
    # These are definitively different airports
    # ═══════════════════════════════════════════════════════════════════════
    
    chain_breaks = getattr(edge, '_chain_breaks', [])
    for brk in chain_breaks:
        edge.transfer_type = TransferType.LANDSIDE_REQUIRED
        edge.transfer_confidence = TransferConfidence.HIGH
        edge.landside_reasons.append(
            f"Airport change: {brk['from_airport']} → {brk['to_airport']}"
        )
        
        # Different airports without explicit protection = self-transfer
        if edge.self_transfer_required == SelfTransferRequired.UNKNOWN:
            if edge.connection_protection != ConnectionProtection.AIRLINE_PROTECTED:
                edge.self_transfer_required = SelfTransferRequired.YES
    
    # ═══════════════════════════════════════════════════════════════════════
    # CHECK 1: Different airports (redundant with chain breaks but explicit)
    # ═══════════════════════════════════════════════════════════════════════
    
    for i in range(len(edge.segments) - 1):
        s1, s2 = edge.segments[i], edge.segments[i + 1]
        
        if not is_same_airport_code(s1.destination, s2.origin):
            # Skip if already recorded from chain breaks
            reason = f"Airport change: {s1.destination} → {s2.origin}"
            if reason not in edge.landside_reasons:
                edge.transfer_type = TransferType.LANDSIDE_REQUIRED
                edge.transfer_confidence = TransferConfidence.HIGH
                edge.landside_reasons.append(reason)
                
                # Different airports without protection = likely self-transfer
                if edge.self_transfer_required == SelfTransferRequired.UNKNOWN:
                    if edge.connection_protection != ConnectionProtection.AIRLINE_PROTECTED:
                        edge.self_transfer_required = SelfTransferRequired.YES
        
        # ═══════════════════════════════════════════════════════════════════
        # CHECK 2: US port of entry
        # ═══════════════════════════════════════════════════════════════════
        
        origin_country = get_airport_country(s1.origin)
        arrival_airport = s1.destination
        
        if _is_us_port_of_entry(origin_country, arrival_airport, s1.origin):
            edge.transfer_type = TransferType.LANDSIDE_REQUIRED
            edge.transfer_confidence = TransferConfidence.HIGH
            reason = f"US port of entry at {arrival_airport}: customs/immigration required"
            if reason not in edge.landside_reasons:
                edge.landside_reasons.append(reason)
        
        # ═══════════════════════════════════════════════════════════════════
        # CHECK 3: Other known landside requirements could go here
        # (Schengen/non-Schengen, etc. - not implemented for MVP)
        # ═══════════════════════════════════════════════════════════════════


def _is_us_port_of_entry(origin_country: Optional[str], arrival_airport: str, departure_airport: str) -> bool:
    """
    Check if this is a US port of entry requiring customs/immigration.
    
    Conditions:
    - Arriving at a US airport
    - Departing from non-US country
    - Departure airport does NOT have US preclearance
    """
    
    # Must be arriving at US airport
    if not is_us_airport(arrival_airport):
        return False
    
    # If origin is US, this is domestic (no customs)
    if origin_country == "US":
        return False
    
    # If departure has preclearance, passengers clear customs before departure
    if has_us_preclearance(departure_airport):
        return False
    
    return True


def _generate_warnings(edge: FlightItineraryEdge):
    """Generate user-facing warnings for this itinerary."""
    
    if edge.is_direct:
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # Protection warnings
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.connection_protection == ConnectionProtection.UNKNOWN:
        edge.add_warning(
            severity=WarningSeverity.WARNING,
            category=WarningCategory.PROTECTION,
            message="Connection protection could not be verified",
            action_required=True,
            action_desc="Verify with airline that this is a single booking with rebooking protection",
            icon="shield_question",
        )
    
    if edge.connection_protection == ConnectionProtection.OTA_GUARANTEE:
        edge.add_warning(
            severity=WarningSeverity.INFO,
            category=WarningCategory.PROTECTION,
            message=f"Connection protected by {edge.protection_provider} (not airline)",
            action_required=False,
            icon="shield_check",
        )
    
    if edge.self_transfer_required == SelfTransferRequired.YES:
        edge.add_warning(
            severity=WarningSeverity.CRITICAL,
            category=WarningCategory.PROTECTION,
            message="Self-transfer required - you carry the risk if you miss your connection",
            action_required=True,
            action_desc="Allow extra time; airline will NOT rebook you if you miss connection",
            icon="warning",
        )
    
    # ═══════════════════════════════════════════════════════════════════════
    # Transfer type warnings
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.transfer_type == TransferType.LANDSIDE_REQUIRED:
        for reason in edge.landside_reasons:
            if "US port of entry" in reason:
                edge.add_warning(
                    severity=WarningSeverity.INFO,
                    category=WarningCategory.TRANSFER,
                    message=reason,
                    action_required=True,
                    action_desc="You must: clear immigration, collect bags, re-clear security",
                    icon="customs",
                )
            elif "Airport change" in reason:
                edge.add_warning(
                    severity=WarningSeverity.WARNING,
                    category=WarningCategory.TRANSFER,
                    message=reason,
                    action_required=True,
                    action_desc="You must travel between airports - allow extra time",
                    icon="airport_shuttle",
                )
    
    # ═══════════════════════════════════════════════════════════════════════
    # Timing warnings
    # ═══════════════════════════════════════════════════════════════════════
    
    for i in range(len(edge.segments) - 1):
        s1, s2 = edge.segments[i], edge.segments[i + 1]
        
        if s1.arrival and s2.departure:
            conn_minutes = (s2.departure - s1.arrival).total_seconds() / 60
            
            if conn_minutes < 45:
                edge.add_warning(
                    severity=WarningSeverity.CRITICAL,
                    category=WarningCategory.TIMING,
                    message=f"Very short connection at {s1.destination}: {int(conn_minutes)} min",
                    conn_idx=i,
                    action_required=True,
                    action_desc="High risk of missing connection even without delays",
                    icon="clock_warning",
                )
            elif conn_minutes < 60:
                edge.add_warning(
                    severity=WarningSeverity.WARNING,
                    category=WarningCategory.TIMING,
                    message=f"Short connection at {s1.destination}: {int(conn_minutes)} min",
                    conn_idx=i,
                    icon="clock",
                )
            elif conn_minutes > 480:
                edge.add_warning(
                    severity=WarningSeverity.INFO,
                    category=WarningCategory.TIMING,
                    message=f"Long layover at {s1.destination}: {int(conn_minutes / 60)} hours",
                    conn_idx=i,
                    icon="clock",
                )
    
    # ═══════════════════════════════════════════════════════════════════════
    # Data quality warnings
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.segments_incomplete:
        edge.add_warning(
            severity=WarningSeverity.WARNING,
            category=WarningCategory.DATA_QUALITY,
            message="Incomplete flight data - some segment details unavailable",
            icon="data_warning",
        )
```

---

## Part 3: Validator Rules

### 3.1 Validation Policy Configuration

```python
# backend/src/optimization/validation_policy.py

"""
Validation policy configuration.

This makes protection level requirements a PRODUCT DECISION, not a hardcoded rule.
"""

from dataclasses import dataclass, field
from typing import Set
from .enums import ConnectionProtection


@dataclass
class ValidationPolicy:
    """
    Policy for what connection types are allowed.
    
    This allows product teams to tune strictness without changing validator code.
    """
    
    # Which protection levels are allowed for connections?
    # Default (strict MVP): only airline protected
    allowed_protection_levels: Set[ConnectionProtection] = field(
        default_factory=lambda: {ConnectionProtection.AIRLINE_PROTECTED}
    )
    
    # Require explicit self_transfer=NO, or allow unknown?
    require_explicit_no_self_transfer: bool = True
    
    # Allow incomplete segments if protection is confirmed?
    allow_incomplete_with_protection: bool = True
    
    # Log dropped flights for debugging?
    log_drops: bool = True


# ═══════════════════════════════════════════════════════════════════════════════
# PREDEFINED POLICIES
# ═══════════════════════════════════════════════════════════════════════════════

STRICT_MVP_POLICY = ValidationPolicy(
    allowed_protection_levels={ConnectionProtection.AIRLINE_PROTECTED},
    require_explicit_no_self_transfer=True,
    allow_incomplete_with_protection=True,
)

# Future: allow OTA guarantees for users who opt-in
PERMISSIVE_POLICY = ValidationPolicy(
    allowed_protection_levels={
        ConnectionProtection.AIRLINE_PROTECTED,
        ConnectionProtection.OTA_GUARANTEE,  # Include OTA-protected
    },
    require_explicit_no_self_transfer=True,
    allow_incomplete_with_protection=True,
)

# For testing / debugging
ALLOW_ALL_POLICY = ValidationPolicy(
    allowed_protection_levels={
        ConnectionProtection.AIRLINE_PROTECTED,
        ConnectionProtection.OTA_GUARANTEE,
        ConnectionProtection.UNPROTECTED,
        ConnectionProtection.UNKNOWN,
    },
    require_explicit_no_self_transfer=False,
    allow_incomplete_with_protection=True,
)
```

### 3.2 Validator

```python
# backend/src/optimization/validators.py (updated)

"""
Validators for V3 optimization.

The validator applies RULES. It does not derive attributes.
Derivation happens in finalize_itinerary().
"""

import logging
from typing import List, Tuple, Optional
from .models_v3 import FlightItineraryEdge
from .enums import ConnectionProtection, SelfTransferRequired
from .derivation import finalize_itinerary
from .validation_policy import ValidationPolicy, STRICT_MVP_POLICY, ALLOW_ALL_POLICY

logger = logging.getLogger(__name__)


def validate_connection_eligibility(
    flights: List[FlightItineraryEdge],
    policy: Optional[ValidationPolicy] = None,
    strict_mode: bool = True,  # Deprecated, use policy instead
) -> Tuple[List[FlightItineraryEdge], List[str]]:
    """
    Validate that connections are safe to show to users.
    
    POLICY-DRIVEN RULES:
    1. Direct flights: always OK
    2. Connections must have:
       - connection_protection ∈ policy.allowed_protection_levels
       - self_transfer_required == NO (if policy.require_explicit_no_self_transfer)
    3. Incomplete segments are allowed only if protection is confirmed
       (and policy.allow_incomplete_with_protection)
    
    Transfer warnings are generated but don't affect eligibility.
    
    Args:
        flights: List of flight edges to validate
        policy: Validation policy (defaults to STRICT_MVP_POLICY)
        strict_mode: Deprecated, use policy instead
    
    Returns:
        (filtered_flights, drop_reasons)
    """
    
    # Use policy if provided, otherwise derive from strict_mode for backwards compat
    if policy is None:
        policy = STRICT_MVP_POLICY if strict_mode else ALLOW_ALL_POLICY
    
    filtered = []
    drop_reasons = []
    
    for edge in flights:
        # Ensure edge is finalized
        if not edge._finalized:
            edge = finalize_itinerary(edge)
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 1: Direct flights always pass
        # ═══════════════════════════════════════════════════════════════════
        
        if edge.is_direct:
            filtered.append(edge)
            continue
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 2: Check protection level against policy
        # ═══════════════════════════════════════════════════════════════════
        
        protection_ok = edge.connection_protection in policy.allowed_protection_levels
        
        if not protection_ok:
            # Sort allowed list for deterministic log/test output
            allowed = sorted(p.value for p in policy.allowed_protection_levels)
            reason = (
                f"Dropped {edge.edge_id}: {edge.num_stops}-stop connection "
                f"with protection={edge.connection_protection.value} "
                f"(allowed: {allowed})"
            )
            drop_reasons.append(reason)
            if policy.log_drops:
                logger.info(reason)
            continue
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 3: Check self-transfer requirement
        # ═══════════════════════════════════════════════════════════════════
        
        if policy.require_explicit_no_self_transfer:
            if edge.self_transfer_required != SelfTransferRequired.NO:
                reason = (
                    f"Dropped {edge.edge_id}: {edge.num_stops}-stop connection "
                    f"with self_transfer={edge.self_transfer_required.value} "
                    f"(policy requires explicit NO)"
                )
                drop_reasons.append(reason)
                if policy.log_drops:
                    logger.info(reason)
                continue
        
        # ═══════════════════════════════════════════════════════════════════
        # RULE 4: Check incomplete segments
        # ═══════════════════════════════════════════════════════════════════
        
        if edge.segments_incomplete:
            if not policy.allow_incomplete_with_protection:
                reason = f"Dropped {edge.edge_id}: incomplete segment data (policy disallows)"
                drop_reasons.append(reason)
                continue
            
            # Allow incomplete only if protection is in the allowed set (policy-driven!)
            if edge.connection_protection not in policy.allowed_protection_levels:
                allowed = sorted(p.value for p in policy.allowed_protection_levels)
                reason = (
                    f"Dropped {edge.edge_id}: incomplete segment data "
                    f"with protection={edge.connection_protection.value} "
                    f"(allowed for incomplete: {allowed})"
                )
                drop_reasons.append(reason)
                if policy.log_drops:
                    logger.info(reason)
                continue
        
        # ═══════════════════════════════════════════════════════════════════
        # PASSED ALL CHECKS
        # ═══════════════════════════════════════════════════════════════════
        
        filtered.append(edge)
    
    return filtered, drop_reasons


def validate_optimizer_invariant(
    flights_by_leg: dict,
    spec,
) -> List[str]:
    """
    Verify the optimizer invariant: each flight is a complete itinerary.
    
    This catches data issues BEFORE building the MILP.
    """
    
    issues = []
    
    for leg in spec.legs:
        leg_flights = flights_by_leg.get(leg.leg_id, [])
        
        for edge in leg_flights:
            # Check origin matches leg
            if edge.origin and leg.origin_city:
                if not _same_city(edge.origin, leg.origin_city):
                    issues.append(
                        f"Flight {edge.edge_id} origin {edge.origin} "
                        f"doesn't match leg origin {leg.origin_city}"
                    )
            
            # Check destination matches leg
            if edge.destination and leg.destination_city:
                if not _same_city(edge.destination, leg.destination_city):
                    issues.append(
                        f"Flight {edge.edge_id} destination {edge.destination} "
                        f"doesn't match leg destination {leg.destination_city}"
                    )
            
            # Check segment chain
            if not edge.segments_incomplete:
                for i in range(len(edge.segments) - 1):
                    s1, s2 = edge.segments[i], edge.segments[i + 1]
                    # Note: don't fail on airport change - that's handled by transfer_type
    
    return issues


def _same_city(airport1: str, city_or_airport2: str) -> bool:
    """Check if two airport/city codes refer to the same city."""
    # Simple check for now
    # TODO: Use city mapping (JFK, LGA, EWR all = NYC)
    return airport1.upper() == city_or_airport2.upper()
```

---

## Part 4: Test Matrix

```python
# backend/tests/test_connection_protection.py

import pytest
from datetime import datetime, timedelta

from backend.src.optimization.models_v3 import FlightItineraryEdge, FlightSegment
from backend.src.optimization.enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired, 
    TransferType, TransferConfidence,
)
from backend.src.optimization.derivation import finalize_itinerary
from backend.src.optimization.validators import validate_connection_eligibility
from backend.src.optimization.validation_policy import (
    STRICT_MVP_POLICY, PERMISSIVE_POLICY, ALLOW_ALL_POLICY,
)


# ═══════════════════════════════════════════════════════════════════════════════
# TEST FIXTURES
# ═══════════════════════════════════════════════════════════════════════════════

def make_segment(origin: str, dest: str, offset_hours: int = 0) -> FlightSegment:
    base = datetime(2024, 6, 15, 10, 0)
    return FlightSegment(
        segment_id=f"seg_{origin}_{dest}",
        flight_number="XX100",
        operating_carrier="XX",
        marketing_carrier="XX",
        origin=origin,
        destination=dest,
        departure=base + timedelta(hours=offset_hours),
        arrival=base + timedelta(hours=offset_hours + 2),
    )


def make_edge(
    segments: list,
    pricing_source: str = "unknown",
    offer_id: str = None,
    finalize: bool = True,
    **kwargs,
) -> FlightItineraryEdge:
    """
    Helper to create test edges.
    
    Args:
        segments: List of (origin, destination) tuples
        pricing_source: Provider source
        offer_id: Optional offer ID
        finalize: If True (default), call finalize_itinerary(). 
                  Set to False if you need to modify the edge before finalizing.
        **kwargs: Additional edge fields
    """
    edge = FlightItineraryEdge(
        edge_id=f"test_{segments[0][0]}_{segments[-1][1]}",
        leg_id=0,
        origin=segments[0][0],
        destination=segments[-1][1],
        segments=[make_segment(s[0], s[1], i*3) for i, s in enumerate(segments)],
        pricing_source=pricing_source,
        offer_id=offer_id,
        **kwargs,
    )
    if finalize:
        return finalize_itinerary(edge)
    return edge


def make_edge_raw(
    segments: list,
    pricing_source: str = "unknown",
    offer_id: str = None,
    **kwargs,
) -> FlightItineraryEdge:
    """
    Helper to create NON-finalized test edges.
    
    Use when you need to modify edge attributes before validation,
    then call finalize_itinerary() manually.
    
    This respects the immutability-after-finalize rule.
    """
    return make_edge(segments, pricing_source, offer_id, finalize=False, **kwargs)


# ═══════════════════════════════════════════════════════════════════════════════
# PROTECTION DERIVATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestProtectionDerivation:
    """Test that protection is derived correctly from provider contracts."""
    
    def test_direct_flight_always_protected(self):
        """Direct flights are trivially protected."""
        edge = make_edge([("JFK", "LAX")], pricing_source="unknown")
        
        assert edge.is_direct
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
        assert edge.self_transfer_required == SelfTransferRequired.NO
        assert edge.transfer_type == TransferType.NOT_APPLICABLE  # Direct = no transfer
    
    def test_gds_offer_is_protected(self):
        """GDS priced offer = airline protected."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="AMADEUS123",
        )
        
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
        assert edge.self_transfer_required == SelfTransferRequired.NO
        assert edge.ticketing_type == TicketingType.SINGLE_TICKET
    
    def test_duffel_offer_is_protected(self):
        """Duffel (GDS aggregator) = airline protected."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="duffel",
            offer_id="DUFFEL_OFFER_123",
        )
        
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
    
    def test_kiwi_is_self_transfer(self):
        """Kiwi virtual interline = self-transfer."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        assert edge.self_transfer_required == SelfTransferRequired.YES
        assert edge.connection_protection == ConnectionProtection.OTA_GUARANTEE
    
    def test_unknown_source_is_unknown(self):
        """Unknown source = unknown protection."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="some_random_api",
        )
        
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.self_transfer_required == SelfTransferRequired.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_offer_without_trusted_source_is_unknown(self):
        """Offer ID from untrusted source doesn't guarantee protection."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="google_flights",
            offer_id="SOME_ID",
        )
        
        # Has artifact but source is low trust
        assert edge.pricing_artifact_present  # We have something
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN  # NOT single_ticket!
    
    def test_discovery_source_not_protected(self):
        """Discovery sources (seats.aero, point.me) are NOT high trust."""
        for source in ["seats_aero", "point_me", "awardtool"]:
            edge = make_edge(
                [("JFK", "ORD"), ("ORD", "LAX")],
                pricing_source=source,
                offer_id="DISCOVERY_ID_123",
            )
            
            # Discovery ID ≠ Bookable offer ID
            assert edge.pricing_artifact_present
            assert edge.connection_protection == ConnectionProtection.UNKNOWN
            assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_medium_trust_does_not_assert_single_ticket(self):
        """Medium trust sources should NOT assert SINGLE_TICKET."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="awardtool",  # Medium trust
            offer_id="DISCOVERY_123",
        )
        
        # Critical: ticketing_type must remain UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
        assert edge.connection_protection == ConnectionProtection.UNKNOWN


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFER TYPE TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestTransferType:
    """Test physical transfer type derivation."""
    
    def test_us_port_of_entry_is_landside(self):
        """International → US = landside (customs required)."""
        edge = make_edge(
            [("LHR", "JFK"), ("JFK", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        # Even though protected, transfer is landside
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert "US port of entry" in edge.landside_reasons[0]
    
    def test_us_preclearance_is_airside(self):
        """Dublin → US has preclearance, no customs at US airport."""
        edge = make_edge(
            [("DUB", "JFK"), ("JFK", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        # Dublin has preclearance - passengers clear customs before departure
        assert edge.transfer_type == TransferType.AIRSIDE
    
    def test_different_airports_is_landside(self):
        """Different airports = landside transfer."""
        edge = make_edge(
            [("JFK", "LHR"), ("LGW", "CDG")],  # LHR → LGW!
            pricing_source="unknown",
        )
        
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert any("Airport change" in r for r in edge.landside_reasons)
    
    def test_different_airports_implies_self_transfer(self):
        """Different airports without protection = self-transfer."""
        edge = make_edge(
            [("JFK", "LHR"), ("LGW", "CDG")],
            pricing_source="unknown",
        )
        
        # Can't be on single ticket with different airports (usually)
        assert edge.self_transfer_required == SelfTransferRequired.YES
    
    def test_domestic_us_is_airside(self):
        """Domestic US connection = airside."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        assert edge.transfer_type == TransferType.AIRSIDE


# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATOR TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestValidator:
    """Test the eligibility validator with policy-driven rules."""
    
    def test_direct_always_passes(self):
        """Direct flights always pass regardless of source."""
        edge = make_edge([("JFK", "LAX")], pricing_source="unknown")
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 1
    
    def test_protected_connection_passes(self):
        """Protected connection with no self-transfer passes."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 1
    
    def test_unknown_protection_dropped_strict(self):
        """Unknown protection dropped in strict mode."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="unknown",
        )
        
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
        assert any("protection" in r for r in reasons)
    
    def test_ota_guarantee_dropped_in_strict_policy(self):
        """OTA guarantee is NOT enough for strict MVP policy."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        # Kiwi has OTA_GUARANTEE but strict policy only allows AIRLINE_PROTECTED
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
        # Should be dropped for protection level, not self-transfer (though both apply)
        assert any("protection" in r or "self_transfer" in r for r in reasons)
    
    def test_ota_guarantee_allowed_in_permissive_policy(self):
        """OTA guarantee passes with permissive policy (if no self-transfer)."""
        # Note: Kiwi also sets self_transfer=YES, so we need a hypothetical
        # OTA-protected-but-not-self-transfer case
        # 
        # Use make_edge_raw to modify BEFORE finalize (respects immutability rule)
        edge = make_edge_raw(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        # Set attributes before finalization
        edge.connection_protection = ConnectionProtection.OTA_GUARANTEE
        edge.self_transfer_required = SelfTransferRequired.NO
        # Now finalize (these fields won't be overwritten by derivation
        # because they're already set - derivation only sets UNKNOWN fields)
        edge = finalize_itinerary(edge)
        
        filtered, _ = validate_connection_eligibility([edge], policy=PERMISSIVE_POLICY)
        assert len(filtered) == 1
    
    def test_self_transfer_dropped_even_with_protection(self):
        """Self-transfer always dropped when require_explicit_no_self_transfer=True."""
        # Use make_edge_raw to modify before finalize (respects immutability)
        edge = make_edge_raw(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        # Force self-transfer before finalization
        edge.self_transfer_required = SelfTransferRequired.YES
        edge = finalize_itinerary(edge)
        
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
        assert any("self_transfer" in r for r in reasons)
    
    def test_landside_warning_not_blocking(self):
        """Landside transfer is warned but not blocked."""
        edge = make_edge(
            [("LHR", "JFK"), ("JFK", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        
        # Passes despite landside transfer
        assert len(filtered) == 1
        # But has warning
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert len(edge.connection_warnings) > 0
    
    def test_discovery_source_dropped(self):
        """Discovery sources are dropped because they can't confirm protection."""
        for source in ["seats_aero", "point_me", "awardtool"]:
            edge = make_edge(
                [("JFK", "ORD"), ("ORD", "LAX")],
                pricing_source=source,
                offer_id="DISCOVERY_123",
            )
            
            filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
            assert len(filtered) == 0, f"Expected {source} to be dropped"


# ═══════════════════════════════════════════════════════════════════════════════
# DATA COMPLETENESS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestDataCompleteness:
    """Test handling of incomplete data."""
    
    def test_incomplete_segments_never_looks_direct(self):
        """Missing segments must not make connection look direct."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX", 0)],  # Only 1 segment
            num_stops_hint=2,  # But provider says 2 stops
            segments_incomplete=True,
        )
        edge = finalize_itinerary(edge)
        
        assert edge.num_stops == 2  # Uses hint
        assert not edge.is_direct  # Not direct!
    
    def test_incomplete_without_protection_dropped(self):
        """Incomplete segments without protection are dropped."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX", 0)],
            num_stops_hint=1,
            segments_incomplete=True,
            pricing_source="unknown",
        )
        edge = finalize_itinerary(edge)
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
    
    def test_multiple_flight_numbers_without_segments(self):
        """Multiple flight numbers = connection even without segment data."""
        # Simulating what the adapter should do
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX", 0)],  # Adapter only got 1
            num_stops_hint=1,  # But knows there's a stop
            segments_incomplete=True,
        )
        edge = finalize_itinerary(edge)
        
        assert not edge.is_direct
        assert edge.num_stops >= 1


# ═══════════════════════════════════════════════════════════════════════════════
# REGRESSION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestRegressions:
    """Tests for specific bugs that were fixed."""
    
    def test_offer_id_doesnt_guarantee_protection_from_untrusted_source(self):
        """
        Regression: offer_id alone was being treated as proof of protection.
        Fix: must check provider contract trust level.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="random_ota",  # Unknown/untrusted
            offer_id="THEIR_OFFER_123",
        )
        
        # Has artifact but source is not trusted
        assert edge.pricing_artifact_present
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN  # NOT SINGLE_TICKET!
    
    def test_single_segment_with_stop_hint_is_connection(self):
        """
        Regression: missing segments made connection look direct.
        Fix: num_stops_hint overrides len(segments)-1.
        """
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX", 0)],
            num_stops_hint=1,  # Provider says 1 stop
        )
        edge = finalize_itinerary(edge)
        
        # Should NOT be treated as direct
        assert edge.num_stops == 1
        assert not edge.is_direct
    
    def test_medium_trust_source_doesnt_assert_single_ticket(self):
        """
        Regression: medium trust sources were asserting SINGLE_TICKET.
        Fix: only high-trust sources can assert ticketing_type.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="awardtool",  # Medium trust discovery
            offer_id="DISCOVERY_123",
        )
        
        # Discovery ID ≠ Bookable offer - can't assert single ticket
        assert edge.ticketing_type == TicketingType.UNKNOWN
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
    
    def test_chain_break_detected_as_landside(self):
        """
        Regression: segment chain breaks were silently ignored.
        Fix: chain breaks are now recorded and treated as HIGH confidence landside.
        """
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="CDG",
            segments=[
                make_segment("JFK", "LHR", 0),
                make_segment("LGW", "CDG", 3),  # LHR→LGW break!
            ],
        )
        edge = finalize_itinerary(edge)
        
        # Chain break should be detected
        assert len(edge._chain_breaks) == 1
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert edge.transfer_confidence == TransferConfidence.HIGH
        assert any("Airport change" in r for r in edge.landside_reasons)
    
    def test_ota_guarantee_not_treated_as_airline_protected(self):
        """
        Regression: OTA_GUARANTEE was being treated same as AIRLINE_PROTECTED.
        Fix: is_airline_protected only returns True for AIRLINE_PROTECTED.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        assert edge.connection_protection == ConnectionProtection.OTA_GUARANTEE
        assert not edge.is_airline_protected  # NOT airline protected
        assert edge.has_some_protection  # But has some form of protection
```

---

## Part 5: Migration / Backwards Compatibility

### Changes Required

1. **Data model** (`models_v3.py`):
   - Add new enum fields (with defaults = UNKNOWN for backwards compat)
   - Add `_finalized` flag
   - Change string fields to enums

2. **Adapter** (`adapter_v3.py`):
   - Extract `pricing_source` from raw data
   - Extract `offer_id` / `pricing_id` / `fare_id`
   - Set `num_stops_hint` when available
   - Set `segments_incomplete` when data is partial
   - Call `finalize_itinerary()` after construction

3. **Solver** (`solver_v3.py`):
   - Validate flights via `validate_connection_eligibility()` before building MILP
   - Log dropped flights and reasons

4. **Tests**:
   - Add all tests from Part 4
   - Run against existing test data to catch regressions

### Rollout Plan

1. **Phase 1**: Add enums, provider contracts, airport data (no behavior change)
2. **Phase 2**: Add derivation pipeline, call it after adapter (still allow all)
3. **Phase 3**: Enable strict validator (start dropping unsafe connections)
4. **Phase 4**: Add UX warnings display

---

## Summary: What Changed from V2 → V3 (Final)

| V2 (Previous) | V3 (Final) |
|---------------|------------|
| Hardcoded airport lists | Data-driven from JSON file with set normalization |
| `offer_id => protected` assumption | Provider contract table with trust levels |
| Discovery sources = high trust | Discovery sources (awardtool, seats.aero) = low/medium trust |
| Alliance-based interline eligibility | Alliance for warnings only, not eligibility |
| String fields | Enums (prevent typos) |
| Derivation in multiple places | Single `finalize_itinerary()` function |
| Medium trust asserts SINGLE_TICKET | Medium trust keeps ticketing_type=UNKNOWN |
| Unknown self-transfer allowed | Unknown self-transfer blocked in strict mode |
| Transfer warnings had no confidence | `transfer_confidence` field |
| OTA_GUARANTEE same as AIRLINE_PROTECTED | OTA_GUARANTEE is separate, policy-driven |
| Hardcoded protection rules | Policy-driven via `ValidationPolicy` |
| Chain breaks silently ignored | Chain breaks recorded and treated as HIGH confidence landside |
| `is_same_airport_system` (misleading name) | `is_same_airport_code` (precise name) |
| Direct flights had AIRSIDE transfer type | Direct flights have NOT_APPLICABLE transfer type |

## Key Invariants

1. **`is_direct` is conservative**: Only true if we're CERTAIN it's direct
2. **`num_stops` uses hint**: Missing segments can't make connection look direct
3. **Provider contracts gate protection**: `offer_id` from untrusted source ≠ protected
4. **"Discovery ID" ≠ "Bookable offer ID"**: Discovery sources can't assert single-ticket
5. **Medium trust = all UNKNOWN**: Don't assert ticketing_type without strong evidence
6. **Strict MVP: airline protected only**: OTA guarantees require explicit policy opt-in
7. **Policy-driven validation**: Protection levels are product decisions, not hardcoded
8. **Transfer warnings are non-blocking**: Landside is shown, not hidden
9. **Immutability after finalize**: Edges should not be modified after `finalize_itinerary()`
10. **Chain breaks = HIGH confidence landside**: Segment chain breaks are definitively different airports