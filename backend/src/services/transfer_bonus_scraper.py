"""
Transfer Bonus Scraper
======================
Scrapes NerdWallet's transfer bonus page daily, parses the current promotions,
and exposes them in formats the ILP optimizer and API can consume.

Usage:
    from src.services.transfer_bonus_scraper import (
        get_active_bonuses,          # List[TransferBonusRecord]
        get_ilp_transfer_bonuses,    # Dict[(bank, airline), float multiplier]
        refresh_bonuses,             # Force re-scrape
    )
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

NERDWALLET_URL = "https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses"

# ---------------------------------------------------------------------------
# Name → internal code mappings
# ---------------------------------------------------------------------------

BANK_NAME_TO_CODE: Dict[str, str] = {
    "chase ultimate rewards": "chase",
    "chase": "chase",
    "american express membership rewards": "amex",
    "amex membership rewards": "amex",
    "amex": "amex",
    "citi thankyou points": "citi",
    "citi thankyou": "citi",
    "citi": "citi",
    "capital one miles": "capitalone",
    "capital one": "capitalone",
    "bilt rewards": "bilt",
    "bilt": "bilt",
}

PROGRAM_NAME_TO_CODE: Dict[str, str] = {
    # Airlines
    "united mileageplus": "UA",
    "united": "UA",
    "american aadvantage": "AA",
    "american airlines": "AA",
    "delta skymiles": "DL",
    "delta": "DL",
    "southwest rapid rewards": "WN",
    "southwest": "WN",
    "jetblue trueblue": "B6",
    "jetblue": "B6",
    "alaska mileage plan": "AS",
    "alaska": "AS",
    "british airways executive club": "BA",
    "british airways club": "BA",
    "british airways": "BA",
    "air france-klm flying blue": "AF",
    "air france/klm flying blue": "AF",
    "air france flying blue": "AF",
    "flying blue": "AF",
    "virgin atlantic flying club": "VS",
    "virgin atlantic": "VS",
    "singapore krisflyer": "SQ",
    "singapore airlines krisflyer": "SQ",
    "singapore": "SQ",
    "cathay pacific asia miles": "CX",
    "cathay pacific": "CX",
    "ana mileage club": "NH",
    "ana": "NH",
    "jal mileage bank": "JL",
    "japan airlines mileage bank": "JL",
    "japan airlines": "JL",
    "emirates skywards": "EK",
    "emirates": "EK",
    "qatar airways privilege club": "QR",
    "qatar airways": "QR",
    "etihad guest": "EY",
    "etihad": "EY",
    "turkish miles&smiles": "TK",
    "turkish airlines miles & smiles": "TK",
    "turkish airlines": "TK",
    "avianca lifemiles": "AV",
    "avianca": "AV",
    "iberia plus": "IB",
    "iberia club": "IB",
    "iberia": "IB",
    "qantas frequent flyer": "QF",
    "qantas airways frequent flyer": "QF",
    "qantas": "QF",
    "air canada aeroplan": "AC",
    "aeroplan": "AC",
    "aer lingus aerclub": "EI",
    "aer lingus aer club": "EI",
    "aer lingus": "EI",
    "finnair plus": "AY",
    "finnair": "AY",
    "tap air portugal miles&go": "TAP",
    "tap miles&go": "TAP",
    "tap air portugal": "TAP",
    "aeromexico club premier": "AM",
    "aeromexico": "AM",
    "spirit free spirit": "NK",
    "spirit": "NK",
    "eva air": "EVA",
    "virgin red": "VR",
    # Hotels
    "marriott bonvoy": "MAR",
    "marriott": "MAR",
    "hilton honors": "HH",
    "hilton": "HH",
    "world of hyatt": "HYATT",
    "hyatt": "HYATT",
    "ihg one rewards": "IHG",
    "ihg": "IHG",
    "accor live limitless": "ACCOR",
    "accor": "ACCOR",
    "choice privileges": "CHOICE",
    "choice hotels": "CHOICE",
    "choice": "CHOICE",
    "wyndham rewards": "WYNDHAM",
    "wyndham": "WYNDHAM",
}


def _normalize_bank(raw: str) -> Optional[str]:
    cleaned = re.sub(r'[®™℠]', '', raw).strip().lower()
    if cleaned in BANK_NAME_TO_CODE:
        return BANK_NAME_TO_CODE[cleaned]
    for key, code in BANK_NAME_TO_CODE.items():
        if key in cleaned or cleaned in key:
            return code
    return None


def _normalize_program(raw: str) -> Optional[str]:
    cleaned = re.sub(r'[®™℠]', '', raw).strip().rstrip('.').lower()
    if cleaned in PROGRAM_NAME_TO_CODE:
        return PROGRAM_NAME_TO_CODE[cleaned]
    for key, code in PROGRAM_NAME_TO_CODE.items():
        if key in cleaned or cleaned in key:
            return code
    return None


# Hotel program codes (used to categorize a transfer SOURCE).
_HOTEL_CODES = {"MAR", "HH", "HYATT", "IHG", "ACCOR", "CHOICE", "WYNDHAM"}


def _normalize_source(raw: str) -> Tuple[Optional[str], str]:
    """Normalize a transfer-bonus SOURCE program (the 'transfer from' column).

    Historically only banks could be a source. Hotel and airline programs can
    now also be sources (e.g. a Marriott -> airline bonus), so we try the bank
    map first, then fall back to the general program map.

    Returns (code, category) where category is one of "bank" | "hotel" | "airline".
    Bank codes are lower-case ("amex"); hotel/airline codes are upper-case ("MAR").
    """
    bank = _normalize_bank(raw)
    if bank:
        return bank, "bank"
    prog = _normalize_program(raw)
    if prog:
        return prog, ("hotel" if prog in _HOTEL_CODES else "airline")
    return None, "unknown"


def _parse_bonus_pct(raw: str) -> Optional[float]:
    """Extract numeric percentage from strings like '40%.' or 'up to 25%'."""
    m = re.search(r'(\d+)\s*%', raw)
    if m:
        return float(m.group(1))
    return None


def _parse_date(raw: str) -> Optional[date]:
    """Parse dates like 'Feb. 14, 2026.' or 'February 28, 2026'."""
    cleaned = raw.strip().rstrip('.')
    for fmt in ("%b. %d, %Y", "%b %d, %Y", "%B %d, %Y", "%b. %d %Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class TransferBonusRecord:
    bank_code: str          # SOURCE code: bank ("chase") OR hotel ("MAR")
    program_code: str       # DESTINATION code, e.g. "VS"
    bonus_pct: float        # e.g. 40.0
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    bank_display: str = ""
    program_display: str = ""
    source_category: str = "bank"  # "bank" | "hotel" | "airline"

    @property
    def is_active(self) -> bool:
        today = date.today()
        if self.start_date and today < self.start_date:
            return False
        if self.end_date and today > self.end_date:
            return False
        return True

    @property
    def multiplier(self) -> float:
        return 1.0 + self.bonus_pct / 100.0


# ---------------------------------------------------------------------------
# In-memory cache (thread-safe)
# ---------------------------------------------------------------------------

@dataclass
class _BonusCache:
    bonuses: List[TransferBonusRecord] = field(default_factory=list)
    last_refreshed: Optional[datetime] = None
    lock: threading.Lock = field(default_factory=threading.Lock)


_cache = _BonusCache()


# ---------------------------------------------------------------------------
# Scraping logic
# ---------------------------------------------------------------------------

def _scrape_and_parse(html: str) -> List[TransferBonusRecord]:
    """Parse the NerdWallet transfer bonus page HTML."""
    soup = BeautifulSoup(html, "html.parser")
    records: List[TransferBonusRecord] = []

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        if not rows:
            continue

        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]

        # Identify the "current bonuses" table by column headers
        has_transfer_from = any("transfer from" in h or "from" in h for h in headers)
        has_transfer_to = any("transfer to" in h or "to" in h for h in headers)
        has_bonus = any("bonus" in h for h in headers)

        if not (has_transfer_from and has_transfer_to and has_bonus):
            continue

        col_from = next((i for i, h in enumerate(headers) if "from" in h), 0)
        col_to = next((i for i, h in enumerate(headers) if "to" in h), 1)
        col_bonus = next((i for i, h in enumerate(headers) if "bonus" in h), 2)
        col_start = next((i for i, h in enumerate(headers) if "start" in h), None)
        col_end = next((i for i, h in enumerate(headers) if "end" in h), None)

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 3:
                continue

            raw_from = cells[col_from].get_text(strip=True)
            raw_to = cells[col_to].get_text(strip=True)
            raw_bonus = cells[col_bonus].get_text(strip=True)

            # SOURCE may be a bank, hotel, or airline (not bank-only anymore).
            source_code, source_category = _normalize_source(raw_from)
            program_code = _normalize_program(raw_to)
            bonus_pct = _parse_bonus_pct(raw_bonus)

            if not source_code or not program_code or bonus_pct is None:
                logger.warning(
                    "Could not parse transfer bonus row: from=%r to=%r bonus=%r -> source=%s program=%s pct=%s",
                    raw_from, raw_to, raw_bonus, source_code, program_code, bonus_pct,
                )
                continue

            start_date = _parse_date(cells[col_start].get_text(strip=True)) if col_start and col_start < len(cells) else None
            end_date = _parse_date(cells[col_end].get_text(strip=True)) if col_end and col_end < len(cells) else None

            records.append(TransferBonusRecord(
                bank_code=source_code,
                program_code=program_code,
                bonus_pct=bonus_pct,
                start_date=start_date,
                end_date=end_date,
                bank_display=raw_from,
                program_display=raw_to,
                source_category=source_category,
            ))

    logger.info("Parsed %d transfer bonus records from NerdWallet", len(records))
    return records


async def _fetch_html() -> str:
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    ) as client:
        resp = await client.get(NERDWALLET_URL)
        resp.raise_for_status()
        return resp.text


async def refresh_bonuses() -> List[TransferBonusRecord]:
    """Scrape NerdWallet and refresh the in-memory cache."""
    try:
        html = await _fetch_html()
        records = _scrape_and_parse(html)
        with _cache.lock:
            _cache.bonuses = records
            _cache.last_refreshed = datetime.utcnow()
        logger.info(
            "Transfer bonus cache refreshed: %d bonuses, %d active",
            len(records),
            sum(1 for r in records if r.is_active),
        )
        return records
    except Exception:
        logger.exception("Failed to scrape transfer bonuses from NerdWallet")
        return _cache.bonuses


def refresh_bonuses_sync() -> List[TransferBonusRecord]:
    """Synchronous wrapper for refresh_bonuses()."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(lambda: asyncio.run(refresh_bonuses())).result(timeout=60)
    else:
        return asyncio.run(refresh_bonuses())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_active_bonuses() -> List[TransferBonusRecord]:
    """Return only currently active bonuses from the cache."""
    with _cache.lock:
        return [b for b in _cache.bonuses if b.is_active]


def get_all_cached_bonuses() -> List[TransferBonusRecord]:
    """Return all cached bonuses (including expired), for API display."""
    with _cache.lock:
        return list(_cache.bonuses)


def _fetch_bonuses_from_frontend() -> Optional[Dict[Tuple[str, str], float]]:
    """
    Fetch transfer bonuses from the frontend's Prisma DB via the internal API.
    This is the same data source the dashboard displays, ensuring consistency.
    Returns None if the frontend is unreachable.
    """
    import os
    frontend_url = os.environ.get("FRONTEND_URL", "https://tripy.app")
    url = f"{frontend_url}/api/internal/transfer-bonuses"

    try:
        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        result: Dict[Tuple[str, str], float] = {}
        for key_str, multiplier in data.get("bonuses", {}).items():
            parts = key_str.split("|", 1)
            if len(parts) == 2:
                result[(parts[0], parts[1])] = float(multiplier)
        if result:
            logger.info(
                "Loaded %d transfer bonuses from frontend Prisma DB", len(result),
            )
        return result
    except Exception:
        logger.warning(
            "Could not fetch transfer bonuses from frontend (%s), "
            "falling back to NerdWallet scraper cache",
            url,
        )
        return None


def get_ilp_transfer_bonuses() -> Dict[Tuple[str, str], float]:
    """
    Return active bonuses in the format the ILP adapter expects:
    {(bank_code, program_code): multiplier}

    e.g. {("chase", "VS"): 1.4}  for a 40% bonus.

    Primary source: frontend Prisma DB (same data the dashboard shows).
    Fallback: NerdWallet scraper in-memory cache.
    """
    # Try frontend DB first — this is the source of truth for the dashboard
    from_frontend = _fetch_bonuses_from_frontend()
    if from_frontend is not None:
        return from_frontend

    # Fall back to NerdWallet scraper cache
    result: Dict[Tuple[str, str], float] = {}
    for b in get_active_bonuses():
        key = (b.bank_code, b.program_code)
        result[key] = b.multiplier
    return result


def get_bonus_for_transfer(source: str, program: str) -> Optional[TransferBonusRecord]:
    """Check if there's an active bonus for a specific source→program transfer.

    `source` may be a bank ("amex") or a hotel ("MAR"); we match against both
    the lower-cased and upper-cased forms so callers don't have to know the
    casing convention.
    """
    src_variants = {source, source.lower(), source.upper()}
    program_upper = program.upper()
    for b in get_active_bonuses():
        if b.bank_code in src_variants and b.program_code == program_upper:
            return b
    return None


# Default freshness window. Beyond this, callers should treat live bonuses as
# unreliable and fall back to base ratios (do NOT silently optimize on a promo
# that may have expired).
DEFAULT_MAX_BONUS_AGE_HOURS = 48


def bonuses_are_fresh(max_age_hours: int = DEFAULT_MAX_BONUS_AGE_HOURS) -> bool:
    """True if the bonus cache was refreshed within `max_age_hours`.

    Used as a circuit-breaker: when the freshest source is stale, bonus
    multipliers should not be applied to transfer paths.
    """
    with _cache.lock:
        last = _cache.last_refreshed
    if last is None:
        return False
    age_hours = (datetime.utcnow() - last).total_seconds() / 3600.0
    return age_hours <= max_age_hours


def get_cache_info() -> Dict:
    """Return metadata about the bonus cache."""
    with _cache.lock:
        last = _cache.last_refreshed
        total = len(_cache.bonuses)
        active = sum(1 for b in _cache.bonuses if b.is_active)
    is_fresh = bonuses_are_fresh()  # acquires the lock itself — call outside
    return {
        "total_cached": total,
        "active_count": active,
        "last_refreshed": last.isoformat() if last else None,
        "is_fresh": is_fresh,
    }
