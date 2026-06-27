"""
Award-chart region classification.

Region codes (NA, EU, AS_E, AS_SE, AS_S, ME, AF, OC, SA, CA, CB) are the same
ones used throughout the codebase (programs.yml `regions:` and the dummy
classifier), so we delegate to the single source of truth in
``handlers.synthetic_pricing.get_airport_region`` rather than maintain a parallel
table. Partner award charts (Alaska/Aeroplan/ANA/Virgin) look up by region pair.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Tuple


@lru_cache(maxsize=4096)
def region_of(iata: str) -> str:
    """Region code for an airport (defaults to 'EU' for unknown — neutral middle)."""
    from src.handlers.synthetic_pricing import get_airport_region

    return get_airport_region(iata)


def region_pair(origin: str, destination: str) -> Tuple[str, str]:
    """Ordered (origin_region, destination_region) pair."""
    return region_of(origin), region_of(destination)
