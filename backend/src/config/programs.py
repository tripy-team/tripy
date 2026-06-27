"""
Centralized Programs Configuration Loader
==========================================
Reads programs.yml (the single source of truth for transfer partners, airline
metadata, hotel metadata, and bank metadata) and exposes pre-computed data
structures that the rest of the backend imports.

Usage in any backend module:
    from src.config.programs import (
        BANKS,                  # dict of bank configs (raw YAML)
        AIRLINES,               # dict of airline configs (raw YAML)
        HOTELS,                 # dict of hotel configs (raw YAML)
        TRANSFER_PARTNERS,      # {"chase": ["UA","BA",...], ...}
        EXTENDED_TRANSFER_GRAPH,# {"chase": {"UA": {"ratio":1.0,"type":"airline","name":"..."},...},...}
        DEFAULT_TRANSFER_GRAPH, # {"chase": {"UA": 1.0, ...}, ...}  (simple ratio)
        BANK_METADATA,          # {"chase": {"name":..., "portal_url":...}, ...}
        PROGRAM_METADATA,       # {"UA": {"name":..., "booking_url":...}, ...}
        AIRLINE_DISPLAY_NAMES,  # {"UA": "United MileagePlus", ...}
        PROGRAM_DISPLAY_NAMES,  # combined airlines + banks
        BANK_PROGRAMS,          # {"chase","amex","citi","capitalone","bilt"}
        AIRLINE_PROGRAMS_SET,   # {"UA","AA","DL",...}
        HOTEL_PROGRAMS_SET,     # {"HH","MAR","HYATT","IHG"}
        HIGH_SURCHARGE_PROGRAMS,# {"BA","LH",...}
        BANK_NAME_MAPPINGS,     # {"amex_membership_rewards": "amex", ...}
        BANK_PREFIXES,          # ["amex","chase","citi","capitalone","bilt"]
        CREDIT_CARD_SUGGESTIONS,# {"chase": "Chase Sapphire...", ...}
        CREDIT_CARD_DETAILS,    # {"chase": {"cards":[...],"best_transfers":[...],...}, ...}
        ALLIANCE_PARTNERS,      # {"UA":["AC","LH",...], ...}
        FIXED_VALUE_BANKS,      # {"bank_of_america": {"name":...,"cpp":1.0}, ...}
        get_airline_name,
        get_bank_display_name,
        get_transfer_partners,
        is_bank_program,
        normalize_bank_key,
    )
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Load YAML
# ---------------------------------------------------------------------------

_CONFIG_DIR = Path(__file__).resolve().parent
_YAML_PATH = _CONFIG_DIR / "programs.yml"


def _load_yaml() -> Dict[str, Any]:
    with open(_YAML_PATH, "r") as f:
        return yaml.safe_load(f)


_RAW: Dict[str, Any] = _load_yaml()

# ---------------------------------------------------------------------------
# Raw sections (thin wrappers)
# ---------------------------------------------------------------------------

BANKS: Dict[str, Any] = _RAW.get("banks", {})
AIRLINES: Dict[str, Any] = _RAW.get("airlines", {})
HOTELS: Dict[str, Any] = _RAW.get("hotels", {})
FIXED_VALUE_BANKS: Dict[str, Any] = _RAW.get("fixed_value_banks", {})

# ---------------------------------------------------------------------------
# Derived: TRANSFER_PARTNERS  (bank -> [airline_code, ...])
# ---------------------------------------------------------------------------

TRANSFER_PARTNERS: Dict[str, List[str]] = {
    bank: list((cfg.get("airline_partners") or {}).keys())
    for bank, cfg in BANKS.items()
}

# ---------------------------------------------------------------------------
# Derived: EXTENDED_TRANSFER_GRAPH  (bank -> {airline: {ratio, type, name}})
# Used by transfer_strategy.py
# ---------------------------------------------------------------------------

def _build_extended_transfer_graph() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Source program -> {airline_code: {ratio, type, name}}.

    Sources include BOTH banks and hotels. Banks transfer to airlines (and
    hotels, tracked separately in DEFAULT_TRANSFER_GRAPH); hotels can also be a
    SOURCE of airline transfers (e.g. Marriott -> United) via their
    `airline_partners` block in programs.yml. Hotel codes are upper-cased keys
    (e.g. "MAR"), banks are lower-cased keys (e.g. "amex").
    """
    graph: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for bank, cfg in BANKS.items():
        partners: Dict[str, Dict[str, Any]] = {}
        for code, info in (cfg.get("airline_partners") or {}).items():
            airline_cfg = AIRLINES.get(code, {})
            partners[code] = {
                "ratio": info.get("ratio", 1.0),
                "type": "airline",
                "name": airline_cfg.get("name", code),
            }
        graph[bank] = partners
    # Hotels as transfer sources (hotel -> airline)
    for hotel, cfg in HOTELS.items():
        partners = {}
        for code, info in (cfg.get("airline_partners") or {}).items():
            airline_cfg = AIRLINES.get(code, {})
            partners[code] = {
                "ratio": info.get("ratio", 1.0),
                "type": "airline",
                "name": airline_cfg.get("name", code),
            }
        if partners:
            graph[hotel] = partners
    return graph


EXTENDED_TRANSFER_GRAPH: Dict[str, Dict[str, Dict[str, Any]]] = _build_extended_transfer_graph()

# ---------------------------------------------------------------------------
# Derived: CHAINED_TRANSFER_PATHS  (bank -> hotel -> airline, 2-hop)
# Composes bank->hotel edges with hotel->airline edges. Used by the strategy
# layer and the ILP adapter to surface chained transfers (e.g. Amex -> Marriott
# -> United) when a single hop cannot clear an award threshold.
# ---------------------------------------------------------------------------

def _build_chained_transfer_paths() -> List[Dict[str, Any]]:
    paths: List[Dict[str, Any]] = []
    for bank, cfg in BANKS.items():
        hotel_partners = (cfg.get("hotel_partners") or {})
        for hotel_code, hop1 in hotel_partners.items():
            hotel_cfg = HOTELS.get(hotel_code, {})
            r1 = hop1.get("ratio", 1.0)
            t1 = hop1.get("transfer_time", "1-2 days")
            for airline_code, hop2 in (hotel_cfg.get("airline_partners") or {}).items():
                r2 = hop2.get("ratio", 1.0)
                t2 = hop2.get("transfer_time", "1-2 days")
                airline_cfg = AIRLINES.get(airline_code, {})
                paths.append({
                    "source": bank,                    # lower-case bank key
                    "via": hotel_code,                 # upper-case hotel key
                    "via_name": hotel_cfg.get("name", hotel_code),
                    "destination": airline_code,       # upper-case airline key
                    "destination_name": airline_cfg.get("name", airline_code),
                    "base_compound_ratio": round(r1 * r2, 6),
                    "leg_ratios": [r1, r2],
                    "leg_times": [t1, t2],
                })
    return paths


CHAINED_TRANSFER_PATHS: List[Dict[str, Any]] = _build_chained_transfer_paths()


def get_chained_paths(source: str, destination: str) -> List[Dict[str, Any]]:
    """Return 2-hop bank->hotel->airline paths from `source` bank to `destination` airline."""
    src = source.lower()
    dst = destination.upper()
    return [
        p for p in CHAINED_TRANSFER_PATHS
        if p["source"] == src and p["destination"] == dst
    ]

# ---------------------------------------------------------------------------
# Derived: DEFAULT_TRANSFER_GRAPH  (bank -> {code: ratio})
# Simple ratio-only version used by optimizer / ILP
# Includes both airline AND hotel partners
# ---------------------------------------------------------------------------

def _build_default_transfer_graph() -> Dict[str, Dict[str, float]]:
    graph: Dict[str, Dict[str, float]] = {}
    for bank, cfg in BANKS.items():
        partners: Dict[str, float] = {}
        for code, info in (cfg.get("airline_partners") or {}).items():
            partners[code] = info.get("ratio", 1.0)
        for code, info in (cfg.get("hotel_partners") or {}).items():
            partners[code] = info.get("ratio", 1.0)
        graph[bank] = partners
    return graph


DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = _build_default_transfer_graph()

# ---------------------------------------------------------------------------
# Derived: BANK_METADATA  (bank -> {name, portal_url, ...})
# ---------------------------------------------------------------------------

def _build_bank_metadata() -> Dict[str, Dict[str, Any]]:
    meta: Dict[str, Dict[str, Any]] = {}
    for bank, cfg in BANKS.items():
        meta[bank] = {
            "name": cfg["name"],
            "portal_url": cfg.get("portal_url", ""),
            "default_transfer_time": cfg.get("default_transfer_time", "1-2 days"),
            "block_size": cfg.get("block_size", 1000),
        }
    # Fixed-value banks
    for bank, cfg in FIXED_VALUE_BANKS.items():
        meta[bank] = {
            "name": cfg["name"],
            "portal_url": cfg.get("portal_url", ""),
            "default_transfer_time": "N/A (fixed-value portal redemption)",
            "block_size": 1,
            "fixed_value": True,
            "cpp": cfg.get("cpp", 1.0),
        }
    return meta


BANK_METADATA: Dict[str, Dict[str, Any]] = _build_bank_metadata()

# ---------------------------------------------------------------------------
# Derived: PROGRAM_METADATA  (airline_code -> {name, type, booking_url})
# ---------------------------------------------------------------------------

PROGRAM_METADATA: Dict[str, Dict[str, Any]] = {
    code: {
        "name": cfg["name"],
        "type": "airline",
        "booking_url": cfg.get("booking_url", ""),
    }
    for code, cfg in AIRLINES.items()
}

# ---------------------------------------------------------------------------
# Derived: display name lookups
# ---------------------------------------------------------------------------

AIRLINE_DISPLAY_NAMES: Dict[str, str] = {
    code: cfg["name"] for code, cfg in AIRLINES.items()
}

# Also include hotels in this lookup
for code, cfg in HOTELS.items():
    AIRLINE_DISPLAY_NAMES[code] = cfg["name"]

PROGRAM_DISPLAY_NAMES: Dict[str, str] = {
    **{bank: cfg["name"] for bank, cfg in BANKS.items()},
    **AIRLINE_DISPLAY_NAMES,
}

# ---------------------------------------------------------------------------
# Derived: program sets
# ---------------------------------------------------------------------------

BANK_PROGRAMS: Set[str] = set(BANKS.keys())
AIRLINE_PROGRAMS_SET: Set[str] = set(AIRLINES.keys())
HOTEL_PROGRAMS_SET: Set[str] = set(HOTELS.keys())

# Airline programs list (ordered, for API queries)
AIRLINE_PROGRAMS_LIST: List[str] = list(AIRLINES.keys())

HIGH_SURCHARGE_PROGRAMS: Set[str] = {
    code for code, cfg in AIRLINES.items()
    if cfg.get("high_surcharge", False)
}

# ---------------------------------------------------------------------------
# Derived: bank name normalization
# ---------------------------------------------------------------------------

BANK_NAME_MAPPINGS: Dict[str, str] = _RAW.get("bank_name_mappings", {})
BANK_PREFIXES: List[str] = list(BANKS.keys())

# ---------------------------------------------------------------------------
# Derived: credit card data
# ---------------------------------------------------------------------------

CREDIT_CARD_SUGGESTIONS: Dict[str, str] = _RAW.get("credit_card_suggestions", {})

CREDIT_CARD_DETAILS: Dict[str, Dict[str, Any]] = {
    bank: {
        "cards": cfg.get("cards", []),
        "best_transfers": cfg.get("best_transfers", []),
        "sweet_spots": cfg.get("sweet_spots", []),
    }
    for bank, cfg in BANKS.items()
}

# ---------------------------------------------------------------------------
# Derived: TRANSFER_GRAPH (agents/config.py format: "Chase UR" keys)
# ---------------------------------------------------------------------------

def _build_agents_transfer_graph() -> Dict[str, Dict[str, Any]]:
    """Build the transfer graph in the format agents/config.py expects."""
    graph: Dict[str, Dict[str, Any]] = {}
    for bank, cfg in BANKS.items():
        short_name = cfg.get("short_name", cfg["name"])
        airlines = list((cfg.get("airline_partners") or {}).keys())
        hotels_list = list((cfg.get("hotel_partners") or {}).keys())
        ratios: Dict[str, float] = {}
        transfer_times: Dict[str, str] = {}
        for code, info in (cfg.get("airline_partners") or {}).items():
            ratios[code] = info.get("ratio", 1.0)
            transfer_times[code] = info.get("transfer_time", "1-2 days")
        for code, info in (cfg.get("hotel_partners") or {}).items():
            ratios[code] = info.get("ratio", 1.0)
            transfer_times[code] = info.get("transfer_time", "1-2 days")
        graph[short_name] = {
            "airlines": airlines,
            "hotels": hotels_list,
            "ratios": ratios,
            "transfer_times": transfer_times,
            "portal_url": cfg.get("portal_url", ""),
        }
    return graph


AGENTS_TRANSFER_GRAPH: Dict[str, Dict[str, Any]] = _build_agents_transfer_graph()

# ---------------------------------------------------------------------------
# Derived: AIRLINE_PROGRAMS (synthetic_pricing.py format, with transfer_partners)
# ---------------------------------------------------------------------------

def _build_airline_programs_with_transfer_partners() -> Dict[str, Dict[str, Any]]:
    """Build airline programs dict with reverse-mapped transfer_partners list."""
    # First build reverse map: airline -> [bank, ...]
    reverse: Dict[str, List[str]] = {}
    for bank, cfg in BANKS.items():
        for code in (cfg.get("airline_partners") or {}):
            reverse.setdefault(code, []).append(bank)

    programs: Dict[str, Dict[str, Any]] = {}
    for code, cfg in AIRLINES.items():
        programs[code] = {
            "name": cfg["name"],
            "hubs": cfg.get("hubs", []),
            "surcharge_multiplier": cfg.get("surcharge_multiplier", 1.0),
            "transfer_partners": reverse.get(code, []),
            "regions": cfg.get("regions", []),
            "alliance": cfg.get("alliance"),
            "booking_url": cfg.get("booking_url", ""),
            "high_surcharge": cfg.get("high_surcharge", False),
        }
    return programs


AIRLINE_PROGRAMS_FULL: Dict[str, Dict[str, Any]] = _build_airline_programs_with_transfer_partners()

# ---------------------------------------------------------------------------
# Derived: HOTEL_PROGRAMS (with reverse transfer_partners)
# ---------------------------------------------------------------------------

def _build_hotel_programs_with_transfer_partners() -> Dict[str, Dict[str, Any]]:
    reverse: Dict[str, List[str]] = {}
    for bank, cfg in BANKS.items():
        for code in (cfg.get("hotel_partners") or {}):
            reverse.setdefault(code, []).append(cfg.get("short_name", cfg["name"]))

    programs: Dict[str, Dict[str, Any]] = {}
    for code, cfg in HOTELS.items():
        programs[code] = {
            "name": cfg["name"],
            "typical_cpp": cfg.get("typical_cpp", 1.0),
            "transfer_partners": reverse.get(code, []),
            "brands": cfg.get("brands", []),
            "points_per_night_range": tuple(cfg.get("points_per_night_range", [5000, 50000])),
            "has_surcharge": cfg.get("has_surcharge", False),
        }
    return programs


HOTEL_PROGRAMS_FULL: Dict[str, Dict[str, Any]] = _build_hotel_programs_with_transfer_partners()

# ---------------------------------------------------------------------------
# Derived: ALLIANCE_PARTNERS  (airline -> [partner_codes])
# ---------------------------------------------------------------------------

def _build_alliance_partners() -> Dict[str, List[str]]:
    alliances = _RAW.get("alliances", {})
    partners: Dict[str, List[str]] = {}
    for _alliance_name, members in alliances.items():
        for member in members:
            others = [m for m in members if m != member]
            if member in partners:
                existing = set(partners[member])
                existing.update(others)
                partners[member] = list(existing)
            else:
                partners[member] = others
    return partners


ALLIANCE_PARTNERS: Dict[str, List[str]] = _build_alliance_partners()

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def get_airline_name(code: str) -> str:
    """Get display name for airline code."""
    return AIRLINE_DISPLAY_NAMES.get(code.upper(), code)


def get_bank_display_name(bank: str) -> str:
    """Get display name for bank program."""
    cfg = BANKS.get(bank.lower())
    if cfg:
        return cfg["name"]
    return bank


def get_transfer_partners(bank: str) -> List[str]:
    """Get airline transfer partner codes for a bank program."""
    return TRANSFER_PARTNERS.get(bank.lower(), [])


def is_bank_program(key: str) -> bool:
    """Check if a key represents a bank/credit card program."""
    k = key.lower()
    if k in BANK_PROGRAMS:
        return True
    k_norm = k.replace(" ", "_")
    if k_norm in BANK_NAME_MAPPINGS:
        return True
    for prefix in BANK_PREFIXES:
        if k.startswith(prefix):
            return True
    return False


def normalize_bank_key(key: str) -> str:
    """Normalize any bank key variant to the canonical form (e.g. 'amex')."""
    k = key.lower().replace(" ", "_")
    if k in BANK_NAME_MAPPINGS:
        return BANK_NAME_MAPPINGS[k]
    for prefix in BANK_PREFIXES:
        if k.startswith(prefix):
            return prefix
    return k


def get_credit_card_suggestion(bank: str) -> str:
    """Get credit card suggestion text for a bank program."""
    return CREDIT_CARD_SUGGESTIONS.get(bank.lower(), bank)


# ---------------------------------------------------------------------------
# Startup log
# ---------------------------------------------------------------------------

logger.info(
    "[PROGRAMS CONFIG] Loaded %d banks, %d airlines, %d hotels from %s",
    len(BANKS), len(AIRLINES), len(HOTELS), _YAML_PATH.name,
)
