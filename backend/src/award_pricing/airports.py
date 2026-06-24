"""
Airport coordinate lookup + great-circle distance for the chart engine.

Reads IATA -> (lat, lon) from the bundled OurAirports CSV
(``backend/files/airports.csv``) — the same file ``services/airport_service.py``
uses — and caches it. Distance powers the Avios distance-band charts.
"""

from __future__ import annotations

import csv
import logging
import math
import threading
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

_AIRPORTS_CSV = Path(__file__).resolve().parents[2] / "files" / "airports.csv"

_coords: Optional[Dict[str, Tuple[float, float]]] = None
_lock = threading.Lock()


def _load() -> Dict[str, Tuple[float, float]]:
    global _coords
    if _coords is not None:
        return _coords
    with _lock:
        if _coords is not None:
            return _coords
        out: Dict[str, Tuple[float, float]] = {}
        if not _AIRPORTS_CSV.exists():
            logger.error("award_pricing.airports: CSV not found at %s", _AIRPORTS_CSV)
            _coords = out
            return out
        try:
            with open(_AIRPORTS_CSV, "r", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    iata = (row.get("iata_code") or "").strip().upper()
                    if not iata or len(iata) != 3:
                        continue
                    try:
                        lat = float(row["latitude_deg"])
                        lon = float(row["longitude_deg"])
                    except (TypeError, ValueError, KeyError):
                        continue
                    out[iata] = (lat, lon)
            logger.info("award_pricing.airports: loaded %d airport coordinates", len(out))
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("award_pricing.airports: load failed: %s", exc)
        _coords = out
        return out


def get_coords(iata: str) -> Optional[Tuple[float, float]]:
    """Return (lat, lon) for an IATA code, or None if unknown."""
    if not iata:
        return None
    return _load().get(iata.strip().upper())


def great_circle_miles(origin: str, destination: str) -> Optional[float]:
    """
    Great-circle distance in statute miles between two IATA airports.
    Returns None if either airport's coordinates are unknown.
    """
    a = get_coords(origin)
    b = get_coords(destination)
    if a is None or b is None:
        return None
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(min(1.0, math.sqrt(h)))
    return 3958.7613 * c  # Earth radius in miles
