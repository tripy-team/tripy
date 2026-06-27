"""
Airport -> timezone resolution for arrival coordination.

Coordinating arrivals across origins requires turning a local departure time
(HH:MM on a date, in the origin airport's local zone) into an absolute UTC
instant. That needs the ORIGIN airport's timezone. (We never need the
destination's zone for coordination: arrival_utc = departure_utc + duration.)

Resolution order:
  1. Curated IATA -> IANA map for major airports (exact, DST-correct via zoneinfo).
  2. Longitude-based fallback (offset ~= round(lon / 15)) using existing airport
     coordinates. Approximate and DST-naive, but never crashes and is good enough
     to order departures sensibly.
  3. UTC as a last resort.
"""

from __future__ import annotations

import logging
from datetime import timedelta, timezone, tzinfo
from typing import Dict, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py<3.9
    ZoneInfo = None  # type: ignore

logger = logging.getLogger(__name__)

# Curated map for the airports the product actually routes through today
# (the metro set in config/metro_airports.py) plus common international hubs.
# Keep IATA -> IANA; zoneinfo handles DST.
_IATA_TO_IANA: Dict[str, str] = {
    # US West
    "SEA": "America/Los_Angeles", "LAX": "America/Los_Angeles", "BUR": "America/Los_Angeles",
    "SNA": "America/Los_Angeles", "ONT": "America/Los_Angeles", "SFO": "America/Los_Angeles",
    "OAK": "America/Los_Angeles", "SJC": "America/Los_Angeles", "PDX": "America/Los_Angeles",
    "LAS": "America/Los_Angeles", "SAN": "America/Los_Angeles",
    # US Mountain
    "DEN": "America/Denver", "PHX": "America/Phoenix", "SLC": "America/Denver",
    # US Central
    "ORD": "America/Chicago", "MDW": "America/Chicago", "DFW": "America/Chicago",
    "DAL": "America/Chicago", "IAH": "America/Chicago", "HOU": "America/Chicago",
    "MSP": "America/Chicago", "AUS": "America/Chicago", "MCI": "America/Chicago",
    # US East
    "JFK": "America/New_York", "EWR": "America/New_York", "LGA": "America/New_York",
    "BOS": "America/New_York", "IAD": "America/New_York", "DCA": "America/New_York",
    "BWI": "America/New_York", "MIA": "America/New_York", "FLL": "America/New_York",
    "ATL": "America/New_York", "CLT": "America/New_York", "PHL": "America/New_York",
    "DTW": "America/New_York", "MCO": "America/New_York",
    # Canada
    "YYZ": "America/Toronto", "YVR": "America/Vancouver", "YUL": "America/Toronto",
    # Europe
    "LHR": "Europe/London", "LGW": "Europe/London", "STN": "Europe/London",
    "LTN": "Europe/London", "DUB": "Europe/Dublin",
    "CDG": "Europe/Paris", "ORY": "Europe/Paris", "AMS": "Europe/Amsterdam",
    "FRA": "Europe/Berlin", "MUC": "Europe/Berlin", "MXP": "Europe/Rome",
    "LIN": "Europe/Rome", "FCO": "Europe/Rome", "BCN": "Europe/Madrid",
    "MAD": "Europe/Madrid", "ZRH": "Europe/Zurich", "VIE": "Europe/Vienna",
    "CPH": "Europe/Copenhagen", "IST": "Europe/Istanbul",
    # Middle East
    "DXB": "Asia/Dubai", "DWC": "Asia/Dubai", "AUH": "Asia/Dubai",
    "DOH": "Asia/Qatar",
    # Asia
    "SIN": "Asia/Singapore", "HKG": "Asia/Hong_Kong", "NRT": "Asia/Tokyo",
    "HND": "Asia/Tokyo", "ICN": "Asia/Seoul", "GMP": "Asia/Seoul",
    "PVG": "Asia/Shanghai", "SHA": "Asia/Shanghai", "PEK": "Asia/Shanghai",
    "PKX": "Asia/Shanghai", "BKK": "Asia/Bangkok", "KUL": "Asia/Kuala_Lumpur",
    "DEL": "Asia/Kolkata", "BOM": "Asia/Kolkata", "TPE": "Asia/Taipei",
    # Oceania
    "SYD": "Australia/Sydney", "MEL": "Australia/Melbourne", "AKL": "Pacific/Auckland",
}


def _fixed(offset_hours: float) -> tzinfo:
    return timezone(timedelta(hours=offset_hours))


def get_timezone(iata: Optional[str]) -> tzinfo:
    """
    Resolve an IATA airport code to a tzinfo. Always returns something usable
    (never raises): curated IANA zone, else longitude-derived fixed offset,
    else UTC.
    """
    if not iata:
        return timezone.utc
    code = iata.strip().upper()

    iana = _IATA_TO_IANA.get(code)
    if iana and ZoneInfo is not None:
        try:
            return ZoneInfo(iana)
        except Exception:  # pragma: no cover - bad/missing tzdata
            logger.warning("airport_timezones: zoneinfo missing for %s (%s)", code, iana)

    # Longitude fallback using existing coordinate data.
    try:
        from src.award_pricing.airports import get_coords

        coords = get_coords(code)
        if coords:
            _lat, lon = coords
            offset = max(-12, min(14, round(lon / 15.0)))
            return _fixed(offset)
    except Exception:  # pragma: no cover - defensive
        pass

    logger.warning("airport_timezones: no timezone for %s, defaulting to UTC", code)
    return timezone.utc


def has_known_timezone(iata: Optional[str]) -> bool:
    """True when we have an exact (curated IANA) zone, not just a fallback."""
    return bool(iata) and iata.strip().upper() in _IATA_TO_IANA
