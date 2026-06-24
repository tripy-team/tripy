"""
Layer 1 — deterministic, bookable-exact award charts ($0 forever).

Loads the version-controlled YAML charts under ``charts/data/`` once and exposes
pure pricing functions:

  - Avios distance bands (BA / IB / EI / QR / AY)
  - Partner region charts (AS / AC / NH / VS)
  - Hyatt hotel categories (+ property -> category resolution)

Everything here is a pure function of the published chart + local airport
coordinates, so it is deterministic and unit-testable with golden files.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

from ..airports import great_circle_miles
from ..regions import region_of

logger = logging.getLogger(__name__)

_DATA = Path(__file__).resolve().parent / "data"


# ---------------------------------------------------------------------------
# Program -> regime classification
# ---------------------------------------------------------------------------

AVIOS_PROGRAMS = {"BA", "IB", "EI", "QR", "AY"}
PARTNER_FILES = {"AS": "alaska", "AC": "aeroplan", "NH": "ana", "VS": "virgin"}
CHART_FLIGHT_PROGRAMS = AVIOS_PROGRAMS | set(PARTNER_FILES)

HYATT_PROGRAMS = {"HYATT"}
CHART_HOTEL_PROGRAMS = set(HYATT_PROGRAMS)


def is_chart_flight_program(program: str) -> bool:
    return (program or "").upper() in CHART_FLIGHT_PROGRAMS


def is_chart_hotel_program(program: str) -> bool:
    return (program or "").upper() in CHART_HOTEL_PROGRAMS


# ---------------------------------------------------------------------------
# Cabin / tier normalization
# ---------------------------------------------------------------------------

_CABIN_ALIASES = {
    "economy": "economy", "eco": "economy", "y": "economy", "coach": "economy",
    "premium economy": "premium_economy", "premium_economy": "premium_economy",
    "premiumeconomy": "premium_economy", "w": "premium_economy",
    "business": "business", "biz": "business", "j": "business",
    "first": "first", "f": "first",
}


def normalize_cabin(cabin: Optional[str]) -> str:
    if not cabin:
        return "economy"
    return _CABIN_ALIASES.get(str(cabin).strip().lower(), "economy")


# ---------------------------------------------------------------------------
# YAML loaders (cached)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _avios() -> dict:
    with open(_DATA / "avios_distance_bands.yml") as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=None)
def _partner(file_stem: str) -> dict:
    with open(_DATA / "partner_charts" / f"{file_stem}.yml") as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=1)
def _hyatt() -> dict:
    with open(_DATA / "hotel_categories" / "hyatt.yml") as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=1)
def _hyatt_properties() -> dict:
    with open(_DATA / "hotel_property_categories.yml") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Avios distance engine
# ---------------------------------------------------------------------------

def _band_for_miles(miles: float) -> Optional[int]:
    for band in _avios()["bands"]:
        if miles <= band["max_miles"]:
            return band["id"]
    return None


def quote_avios(
    program: str, origin: str, destination: str, cabin: str, peak: Optional[bool] = None
) -> Optional[dict]:
    """
    Exact Avios for a single segment. Returns a dict with points + range, or None
    if distance is unknown or the cabin isn't charted.

    peak=None  -> tier unknown: point estimate = off-peak, range = [off_peak, peak]
    peak=False -> off-peak value;  peak=True -> peak value.
    """
    miles = great_circle_miles(origin, destination)
    if miles is None:
        return None
    band = _band_for_miles(miles)
    if band is None:
        return None
    cab = normalize_cabin(cabin)
    row = _avios()["chart"].get(band, {})
    pair = row.get(cab)
    if not pair:
        return None
    off_peak, peak_val = int(pair[0]), int(pair[1])
    mult = (_avios().get("programs", {}).get(program.upper(), {}) or {}).get("multiplier", 1.0)
    off_peak = int(round(off_peak * mult))
    peak_val = int(round(peak_val * mult))
    if peak is True:
        points, tier_unknown = peak_val, False
    elif peak is False:
        points, tier_unknown = off_peak, False
    else:
        points, tier_unknown = off_peak, True
    return {
        "points": points,
        "points_min": off_peak,
        "points_max": peak_val,
        "tier_unknown": tier_unknown,
        "band": band,
        "miles": round(miles),
    }


# ---------------------------------------------------------------------------
# Partner region charts (Alaska / Aeroplan / ANA / Virgin)
# ---------------------------------------------------------------------------

def _region_key(origin: str, destination: str) -> str:
    a, b = region_of(origin), region_of(destination)
    return "-".join(sorted([a, b]))


def quote_partner(program: str, origin: str, destination: str, cabin: str) -> Optional[dict]:
    """Exact partner-chart points for a single segment, or None if not charted."""
    stem = PARTNER_FILES.get(program.upper())
    if not stem:
        return None
    data = _partner(stem)
    cab = normalize_cabin(cabin)
    key = _region_key(origin, destination)
    row = data["chart"].get(key) or data.get("default")
    if not row or cab not in row:
        return None
    points = int(row[cab])
    if data.get("round_trip"):
        points = int(round(points / 2))  # chart is round-trip; quote one-way
    return {
        "points": points,
        "points_min": points,
        "points_max": points,
        "tier_unknown": False,
        "region_pair": key,
    }


def quote_chart_flight(
    program: str, origin: str, destination: str, cabin: str, peak: Optional[bool] = None
) -> Optional[dict]:
    """Dispatch to the right chart engine for a chart-based flight program."""
    p = (program or "").upper()
    if p in AVIOS_PROGRAMS:
        return quote_avios(p, origin, destination, cabin, peak=peak)
    if p in PARTNER_FILES:
        return quote_partner(p, origin, destination, cabin)
    return None


# ---------------------------------------------------------------------------
# Hyatt hotel category engine
# ---------------------------------------------------------------------------

def resolve_hyatt_category(hotel_name: str, city: str = "") -> Optional[int]:
    """
    Resolve a Hyatt property name to an award category:
      1. curated property substring match
      2. brand default substring match
      3. global default_category
    """
    cfg = _hyatt_properties()
    name = (hotel_name or "").strip().lower()
    if name:
        for prop, cat in cfg.get("properties", {}).items():
            if prop.lower() in name:
                return int(cat)
        for brand, cat in cfg.get("brand_defaults", {}).items():
            if brand.lower() in name:
                return int(cat)
    return int(cfg.get("default_category", 4))


def quote_hyatt(category: int, tier: Optional[str] = None) -> Optional[dict]:
    """
    Exact Hyatt points per night for a category.

    tier=None -> tier unknown: point estimate = `moderate`, range = [lowest, top]
    tier in {lowest,low,moderate,upper,top} -> that tier's value.
    """
    chart = _hyatt()["chart"].get(int(category))
    if not chart:
        return None
    order: List[str] = _hyatt()["tier_order"]
    vals = [int(v) for v in chart]
    by_tier = dict(zip(order, vals))
    default_tier = _hyatt().get("default_tier", "moderate")
    if tier and tier in by_tier:
        points, tier_unknown = by_tier[tier], False
    else:
        points, tier_unknown = by_tier[default_tier], True
    return {
        "points": points,
        "points_min": min(vals),
        "points_max": max(vals),
        "tier_unknown": tier_unknown,
        "category": int(category),
    }
