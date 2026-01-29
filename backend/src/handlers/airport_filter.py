import csv
import io
import logging
import threading
import requests
from typing import Optional, Set

# This module determines whether an airport is a commercial IATA airport by downloading the OurAirports dataset.
# OPTIMIZED: Uses a global cached set that is loaded once at startup and shared across all modules.

logger = logging.getLogger(__name__)

# Raw CSV (not the HTML page)
RAW_AIRPORTS_CSV = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv"

# Treat only these as "commercial"
_ALLOWED_TYPES = {"large_airport", "medium_airport", "small_airport"}

# Global cache for commercial airports - loaded once, shared everywhere
_commercial_set_cache: Optional[Set[str]] = None
_cache_lock = threading.Lock()
_cache_loaded = False


def _load_commercial_set_internal(url: str = RAW_AIRPORTS_CSV, timeout: int = 10) -> Set[str]:
    """
    Internal function to download and parse commercial airports.
    Should only be called once via get_commercial_airport_set().
    """
    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()

        commercial: Set[str] = set()
        text_stream = io.StringIO(r.text)
        reader = csv.DictReader(text_stream)

        for row in reader:
            iata = (row.get("iata_code") or "").strip().upper()
            if len(iata) != 3:  # skip blanks/non-IATA
                continue

            scheduled = (row.get("scheduled_service") or "").strip().lower() == "yes"
            typ = (row.get("type") or "").strip().lower()

            if scheduled and typ in _ALLOWED_TYPES:
                commercial.add(iata)

        logger.info(f"Loaded {len(commercial)} commercial airports from web")
        return commercial
    except (requests.Timeout, requests.RequestException) as e:
        # If loading fails due to timeout or network error, return empty set
        # Autocomplete endpoints will still work but won't filter commercial airports
        logger.warning(f"Failed to load commercial airports from web (timeout): {e}")
        return set()


def get_commercial_airport_set() -> Set[str]:
    """
    Get the cached commercial airport set. Thread-safe and loads only once.
    This is the preferred way to get the commercial set - DO NOT call load_commercial_iata_set_from_web directly.
    """
    global _commercial_set_cache, _cache_loaded
    
    if _cache_loaded:
        return _commercial_set_cache or set()
    
    with _cache_lock:
        # Double-check after acquiring lock
        if _cache_loaded:
            return _commercial_set_cache or set()
        
        _commercial_set_cache = _load_commercial_set_internal()
        _cache_loaded = True
        return _commercial_set_cache


def preload_commercial_airports():
    """
    Preload commercial airports in background. Call this at app startup.
    """
    def _preload():
        get_commercial_airport_set()
    
    thread = threading.Thread(target=_preload, daemon=True)
    thread.start()
    logger.info("Started background preload of commercial airport set")


def load_commercial_iata_set_from_web(
    url: str = RAW_AIRPORTS_CSV, timeout: int = 10
) -> Set[str]:
    """
    DEPRECATED: Use get_commercial_airport_set() instead.
    This function now returns the cached set for backwards compatibility.
    """
    return get_commercial_airport_set()


def is_commercial_airport(iata_code: str, commercial_set: Optional[Set[str]] = None) -> bool:
    """
    Returns True if the IATA code is commercial using a preloaded set.
    If no set is passed, uses the global cached set.
    """
    iata = (iata_code or "").strip().upper()
    if len(iata) != 3:
        return False
    if commercial_set is None:
        commercial_set = get_commercial_airport_set()
    return iata in commercial_set


# --- Example usage ---
if __name__ == "__main__":
    commercial_set = load_commercial_iata_set_from_web()  # fetch once
    print("SEA:", is_commercial_airport("SEA", commercial_set))  # True
    print(
        "PAE:", is_commercial_airport("FXE", commercial_set)
    )  # Likely False (seaplane base)
    print(
        "ITH:", is_commercial_airport("ITH", commercial_set)
    )  # Likely False (biz-jet)
