# Dynamic Transfer Data Implementation Plan

## Overview

This document provides a detailed implementation plan for making Tripy's transfer partner data dynamic, moving from hardcoded constants to a hybrid system that can fetch fresh data while maintaining reliable fallbacks.

**Based on:** `research/HARDCODED_DATA_ANALYSIS.md`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Transfer Data Service (Foundation)](#2-phase-1-transfer-data-service-foundation)
3. [Phase 2: Web Scraping Implementation](#3-phase-2-web-scraping-implementation)
4. [Phase 3: Transfer Bonus Tracking](#4-phase-3-transfer-bonus-tracking)
5. [Phase 4: AI-Assisted Data Extraction](#5-phase-4-ai-assisted-data-extraction)
6. [Phase 5: Seats.aero API Integration](#6-phase-5-seatsaero-api-integration)
7. [Testing Strategy](#7-testing-strategy)
8. [Deployment & Monitoring](#8-deployment--monitoring)
9. [Assumptions & Nuances](#9-assumptions--nuances)

---

## 1. Architecture Overview

### 1.1 High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TransferDataService                          │
│  (Single source of truth for all transfer-related data)             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   In-Memory  │    │  File Cache  │    │  Hardcoded   │          │
│  │    Cache     │───▶│  (JSON)      │───▶│   Fallback   │          │
│  │  (TTL: 1hr)  │    │ (TTL: 7 days)│    │  (Always)    │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         ▲                   ▲                                        │
│         │                   │                                        │
│  ┌──────┴───────────────────┴──────────────────────────────────┐   │
│  │                    Data Refresh Pipeline                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Web Scraper │  │  AI Parser  │  │ Manual API  │          │   │
│  │  │ (httpx +    │  │  (Claude)   │  │ (Admin)     │          │   │
│  │  │ BeautifulS) │  │             │  │             │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              TransferBonusService (Separate)                  │   │
│  │  - Scrapes NerdWallet/TPG daily for bonus promotions         │   │
│  │  - Separate cache with 24hr TTL                               │   │
│  │  - Merges with base ratios at query time                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
Request for transfer data
         │
         ▼
┌────────────────────┐
│ Check in-memory    │──── Hit ────▶ Return cached data
│ cache (TTL: 1hr)   │
└────────┬───────────┘
         │ Miss
         ▼
┌────────────────────┐
│ Check file cache   │──── Fresh ──▶ Load to memory, return
│ (TTL: 7 days)      │
└────────┬───────────┘
         │ Stale/Missing
         ▼
┌────────────────────┐
│ Attempt refresh    │──── Success ─▶ Update caches, return
│ from web sources   │
└────────┬───────────┘
         │ Failure
         ▼
┌────────────────────┐
│ Use hardcoded      │
│ fallback           │
└────────────────────┘
```

### 1.3 File Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── __init__.py
│   │   ├── transfer_data_service.py    # Main service
│   │   ├── transfer_bonus_service.py   # Bonus tracking
│   │   ├── scraper/
│   │   │   ├── __init__.py
│   │   │   ├── base_scraper.py         # Abstract base
│   │   │   ├── nerdwallet_scraper.py   # NerdWallet implementation
│   │   │   ├── tpg_scraper.py          # ThePointsGuy implementation
│   │   │   └── ai_extractor.py         # Claude-based extraction
│   │   └── external_apis/
│   │       ├── __init__.py
│   │       └── seats_aero.py           # Seats.aero client
│   ├── agents/
│   │   └── config.py                   # Keep TRANSFER_GRAPH as fallback
│   └── routes/
│       └── admin.py                    # Manual refresh endpoints
├── data/
│   ├── transfer_partners.json          # Cached transfer graph
│   ├── transfer_bonuses.json           # Cached bonuses
│   └── scrape_history.json             # Scrape attempt logs
└── tests/
    └── services/
        ├── test_transfer_data_service.py
        └── test_scrapers.py
```

---

## 2. Phase 1: Transfer Data Service (Foundation)

### 2.1 Core Models

```python
# backend/src/services/models.py

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class DataSource(Enum):
    HARDCODED = "hardcoded"
    FILE_CACHE = "file_cache"
    MEMORY_CACHE = "memory_cache"
    SCRAPED = "scraped"
    AI_EXTRACTED = "ai_extracted"
    MANUAL = "manual"


@dataclass
class TransferPartner:
    """A single transfer partner relationship."""
    program_code: str           # "UA", "HH"
    program_name: str           # "United MileagePlus"
    program_type: str           # "airline" or "hotel"
    base_ratio: float           # 1.0, 2.0 for Hilton
    transfer_time: str          # "Instant", "1-2 days"
    booking_url: str            # "https://www.united.com"
    
    # Optional bonus (from TransferBonusService)
    bonus_ratio: Optional[float] = None
    bonus_expires: Optional[datetime] = None
    
    @property
    def effective_ratio(self) -> float:
        """Return bonus ratio if active, otherwise base."""
        if self.bonus_ratio and self.bonus_expires:
            if datetime.now() < self.bonus_expires:
                return self.bonus_ratio
        return self.base_ratio
    
    @property
    def has_active_bonus(self) -> bool:
        return (
            self.bonus_ratio is not None and 
            self.bonus_expires is not None and 
            datetime.now() < self.bonus_expires
        )


@dataclass
class BankProgram:
    """A credit card bank's transfer program."""
    code: str                   # "Chase UR"
    name: str                   # "Chase Ultimate Rewards"
    portal_url: str             # "https://ultimaterewardspoints.chase.com"
    default_transfer_time: str  # "Instant"
    partners: list[TransferPartner] = field(default_factory=list)


@dataclass
class TransferGraph:
    """Complete transfer graph with all banks and partners."""
    banks: dict[str, BankProgram]  # code -> BankProgram
    last_updated: datetime
    source: DataSource
    version: str = "1.0"
    
    def get_partners_for_bank(self, bank_code: str) -> list[TransferPartner]:
        """Get all transfer partners for a bank."""
        bank = self.banks.get(bank_code)
        return bank.partners if bank else []
    
    def get_ratio(self, bank_code: str, program_code: str) -> Optional[float]:
        """Get effective transfer ratio (including any bonus)."""
        bank = self.banks.get(bank_code)
        if not bank:
            return None
        for partner in bank.partners:
            if partner.program_code == program_code:
                return partner.effective_ratio
        return None
    
    def can_transfer(self, bank_code: str, program_code: str) -> bool:
        """Check if a transfer path exists."""
        return self.get_ratio(bank_code, program_code) is not None
```

### 2.2 Transfer Data Service Implementation

```python
# backend/src/services/transfer_data_service.py

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import asyncio
from functools import lru_cache

from .models import TransferGraph, BankProgram, TransferPartner, DataSource


logger = logging.getLogger(__name__)


class TransferDataService:
    """
    Central service for transfer partner data.
    
    Implements a three-tier caching strategy:
    1. In-memory cache (TTL: 1 hour) - fastest
    2. File cache (TTL: 7 days) - persists across restarts
    3. Hardcoded fallback - always available
    
    Usage:
        service = TransferDataService()
        graph = await service.get_transfer_graph()
        ratio = graph.get_ratio("Chase UR", "UA")
    """
    
    # Configuration
    CACHE_DIR = Path("data")
    CACHE_FILE = CACHE_DIR / "transfer_partners.json"
    MEMORY_TTL = timedelta(hours=1)
    FILE_TTL = timedelta(days=7)
    
    def __init__(self):
        self._memory_cache: Optional[TransferGraph] = None
        self._memory_cache_time: Optional[datetime] = None
        self._refresh_lock = asyncio.Lock()
        
        # Ensure cache directory exists
        self.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # =========================================================================
    # PUBLIC API
    # =========================================================================
    
    async def get_transfer_graph(self) -> TransferGraph:
        """
        Get the current transfer graph.
        
        Returns data from the fastest available source:
        1. Memory cache if fresh
        2. File cache if fresh
        3. Hardcoded fallback
        
        Does NOT trigger background refresh - call refresh_if_stale() for that.
        """
        # Try memory cache first
        if self._is_memory_cache_valid():
            logger.debug("Returning transfer graph from memory cache")
            return self._memory_cache
        
        # Try file cache
        file_data = self._load_file_cache()
        if file_data and self._is_file_cache_fresh(file_data):
            logger.debug("Returning transfer graph from file cache")
            self._update_memory_cache(file_data)
            return file_data
        
        # Fall back to hardcoded
        logger.info("Using hardcoded transfer graph fallback")
        return self._get_hardcoded_fallback()
    
    async def refresh_if_stale(self) -> bool:
        """
        Check if data is stale and refresh in background if needed.
        
        Returns True if refresh was triggered, False if data is fresh.
        Call this on application startup and periodically.
        """
        if self._is_memory_cache_valid():
            return False
        
        file_data = self._load_file_cache()
        if file_data and self._is_file_cache_fresh(file_data):
            self._update_memory_cache(file_data)
            return False
        
        # Data is stale, trigger background refresh
        asyncio.create_task(self._background_refresh())
        return True
    
    async def force_refresh(self, source: str = "scrape") -> TransferGraph:
        """
        Force a refresh from external sources.
        
        Args:
            source: "scrape" for web scraping, "ai" for AI extraction
        
        Returns:
            Fresh TransferGraph
            
        Raises:
            RefreshError if all sources fail
        """
        async with self._refresh_lock:
            return await self._do_refresh(source)
    
    def get_effective_ratio(
        self, 
        bank_code: str, 
        program_code: str,
        include_bonus: bool = True
    ) -> Optional[float]:
        """
        Synchronous helper to get transfer ratio.
        
        Uses cached data only - will not fetch fresh data.
        For async contexts, use get_transfer_graph() instead.
        """
        if self._memory_cache:
            return self._memory_cache.get_ratio(bank_code, program_code)
        
        # Use hardcoded
        fallback = self._get_hardcoded_fallback()
        return fallback.get_ratio(bank_code, program_code)
    
    # =========================================================================
    # CACHE MANAGEMENT
    # =========================================================================
    
    def _is_memory_cache_valid(self) -> bool:
        """Check if memory cache exists and is within TTL."""
        if not self._memory_cache or not self._memory_cache_time:
            return False
        age = datetime.now() - self._memory_cache_time
        return age < self.MEMORY_TTL
    
    def _update_memory_cache(self, graph: TransferGraph) -> None:
        """Update the in-memory cache."""
        self._memory_cache = graph
        self._memory_cache_time = datetime.now()
    
    def _load_file_cache(self) -> Optional[TransferGraph]:
        """Load transfer graph from file cache."""
        if not self.CACHE_FILE.exists():
            return None
        
        try:
            data = json.loads(self.CACHE_FILE.read_text())
            return self._deserialize_graph(data)
        except Exception as e:
            logger.warning(f"Failed to load file cache: {e}")
            return None
    
    def _save_file_cache(self, graph: TransferGraph) -> None:
        """Save transfer graph to file cache."""
        try:
            data = self._serialize_graph(graph)
            self.CACHE_FILE.write_text(json.dumps(data, indent=2, default=str))
            logger.info(f"Saved transfer graph to {self.CACHE_FILE}")
        except Exception as e:
            logger.error(f"Failed to save file cache: {e}")
    
    def _is_file_cache_fresh(self, graph: TransferGraph) -> bool:
        """Check if file cache data is within TTL."""
        if not graph.last_updated:
            return False
        age = datetime.now() - graph.last_updated
        return age < self.FILE_TTL
    
    # =========================================================================
    # REFRESH LOGIC
    # =========================================================================
    
    async def _background_refresh(self) -> None:
        """Background task to refresh data without blocking."""
        try:
            async with self._refresh_lock:
                await self._do_refresh("scrape")
        except Exception as e:
            logger.error(f"Background refresh failed: {e}")
    
    async def _do_refresh(self, source: str) -> TransferGraph:
        """
        Actually perform the refresh from external sources.
        
        Tries multiple sources in order:
        1. Web scraping (primary)
        2. AI extraction (backup)
        3. Raises exception if all fail
        """
        errors = []
        
        # Try web scraping first
        if source in ("scrape", "all"):
            try:
                graph = await self._refresh_from_scraping()
                self._update_memory_cache(graph)
                self._save_file_cache(graph)
                logger.info("Successfully refreshed from web scraping")
                return graph
            except Exception as e:
                errors.append(f"Scraping: {e}")
                logger.warning(f"Web scraping failed: {e}")
        
        # Try AI extraction as backup
        if source in ("ai", "all"):
            try:
                graph = await self._refresh_from_ai()
                self._update_memory_cache(graph)
                self._save_file_cache(graph)
                logger.info("Successfully refreshed from AI extraction")
                return graph
            except Exception as e:
                errors.append(f"AI: {e}")
                logger.warning(f"AI extraction failed: {e}")
        
        raise RefreshError(f"All refresh sources failed: {errors}")
    
    async def _refresh_from_scraping(self) -> TransferGraph:
        """Refresh data via web scraping."""
        from .scraper import TransferPartnerScraper
        
        scraper = TransferPartnerScraper()
        return await scraper.scrape_all_banks()
    
    async def _refresh_from_ai(self) -> TransferGraph:
        """Refresh data via AI extraction."""
        from .scraper import AITransferExtractor
        
        extractor = AITransferExtractor()
        return await extractor.extract_all_banks()
    
    # =========================================================================
    # HARDCODED FALLBACK
    # =========================================================================
    
    @lru_cache(maxsize=1)
    def _get_hardcoded_fallback(self) -> TransferGraph:
        """
        Get the hardcoded fallback transfer graph.
        
        This imports from config.py and converts to TransferGraph format.
        Cached indefinitely since hardcoded data doesn't change.
        """
        from ..agents.config import TRANSFER_GRAPH
        from ..agents.group_allocator import BANK_METADATA, PROGRAM_METADATA
        
        banks = {}
        
        for bank_code, bank_data in TRANSFER_GRAPH.items():
            meta = BANK_METADATA.get(bank_code, {})
            
            partners = []
            all_programs = bank_data.get("airlines", []) + bank_data.get("hotels", [])
            
            for prog_code in all_programs:
                prog_meta = PROGRAM_METADATA.get(prog_code, {})
                partners.append(TransferPartner(
                    program_code=prog_code,
                    program_name=prog_meta.get("name", prog_code),
                    program_type=prog_meta.get("type", "airline"),
                    base_ratio=bank_data.get("ratios", {}).get(prog_code, 1.0),
                    transfer_time=bank_data.get("transfer_times", {}).get(prog_code, "1-2 days"),
                    booking_url=prog_meta.get("booking_url", ""),
                ))
            
            banks[bank_code] = BankProgram(
                code=bank_code,
                name=meta.get("name", bank_code),
                portal_url=meta.get("portal_url", bank_data.get("portal_url", "")),
                default_transfer_time=meta.get("default_transfer_time", "Instant"),
                partners=partners,
            )
        
        return TransferGraph(
            banks=banks,
            last_updated=datetime.now(),
            source=DataSource.HARDCODED,
        )
    
    # =========================================================================
    # SERIALIZATION
    # =========================================================================
    
    def _serialize_graph(self, graph: TransferGraph) -> dict:
        """Convert TransferGraph to JSON-serializable dict."""
        return {
            "version": graph.version,
            "last_updated": graph.last_updated.isoformat(),
            "source": graph.source.value,
            "banks": {
                code: {
                    "code": bank.code,
                    "name": bank.name,
                    "portal_url": bank.portal_url,
                    "default_transfer_time": bank.default_transfer_time,
                    "partners": [
                        {
                            "program_code": p.program_code,
                            "program_name": p.program_name,
                            "program_type": p.program_type,
                            "base_ratio": p.base_ratio,
                            "transfer_time": p.transfer_time,
                            "booking_url": p.booking_url,
                            "bonus_ratio": p.bonus_ratio,
                            "bonus_expires": p.bonus_expires.isoformat() if p.bonus_expires else None,
                        }
                        for p in bank.partners
                    ]
                }
                for code, bank in graph.banks.items()
            }
        }
    
    def _deserialize_graph(self, data: dict) -> TransferGraph:
        """Convert JSON dict back to TransferGraph."""
        banks = {}
        
        for code, bank_data in data.get("banks", {}).items():
            partners = [
                TransferPartner(
                    program_code=p["program_code"],
                    program_name=p["program_name"],
                    program_type=p["program_type"],
                    base_ratio=p["base_ratio"],
                    transfer_time=p["transfer_time"],
                    booking_url=p["booking_url"],
                    bonus_ratio=p.get("bonus_ratio"),
                    bonus_expires=datetime.fromisoformat(p["bonus_expires"]) if p.get("bonus_expires") else None,
                )
                for p in bank_data.get("partners", [])
            ]
            
            banks[code] = BankProgram(
                code=bank_data["code"],
                name=bank_data["name"],
                portal_url=bank_data["portal_url"],
                default_transfer_time=bank_data["default_transfer_time"],
                partners=partners,
            )
        
        return TransferGraph(
            banks=banks,
            last_updated=datetime.fromisoformat(data["last_updated"]),
            source=DataSource(data["source"]),
            version=data.get("version", "1.0"),
        )


class RefreshError(Exception):
    """Raised when all refresh sources fail."""
    pass
```

---

## 3. Phase 2: Web Scraping Implementation

### 3.1 Base Scraper

```python
# backend/src/services/scraper/base_scraper.py

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import httpx
import logging


logger = logging.getLogger(__name__)


@dataclass
class ScrapeResult:
    """Result of a single scrape operation."""
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    source_url: str = ""
    scraped_at: datetime = None
    
    def __post_init__(self):
        if self.scraped_at is None:
            self.scraped_at = datetime.now()


class BaseScraper(ABC):
    """
    Abstract base class for web scrapers.
    
    Provides common functionality:
    - HTTP client with proper headers
    - Rate limiting
    - Error handling
    - Logging
    """
    
    # Override in subclasses
    SOURCE_NAME: str = "base"
    BASE_URL: str = ""
    
    # Common browser-like headers to avoid blocks
    DEFAULT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }
    
    # Rate limiting
    REQUEST_DELAY_SECONDS = 2.0
    
    def __init__(self):
        self._last_request_time: Optional[datetime] = None
        self._client: Optional[httpx.AsyncClient] = None
    
    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            headers=self.DEFAULT_HEADERS,
            timeout=30.0,
            follow_redirects=True,
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._client:
            await self._client.aclose()
    
    async def fetch_page(self, url: str) -> str:
        """
        Fetch a page with rate limiting and error handling.
        
        Returns the HTML content as a string.
        """
        await self._rate_limit()
        
        try:
            response = await self._client.get(url)
            response.raise_for_status()
            return response.text
        except httpx.HTTPError as e:
            logger.error(f"HTTP error fetching {url}: {e}")
            raise
    
    async def _rate_limit(self):
        """Ensure we don't make requests too quickly."""
        import asyncio
        
        if self._last_request_time:
            elapsed = (datetime.now() - self._last_request_time).total_seconds()
            if elapsed < self.REQUEST_DELAY_SECONDS:
                await asyncio.sleep(self.REQUEST_DELAY_SECONDS - elapsed)
        
        self._last_request_time = datetime.now()
    
    @abstractmethod
    async def scrape(self) -> ScrapeResult:
        """
        Perform the scrape operation.
        
        Must be implemented by subclasses.
        """
        pass
```

### 3.2 NerdWallet Scraper (Transfer Bonuses)

```python
# backend/src/services/scraper/nerdwallet_scraper.py

"""
NerdWallet Transfer Bonus Scraper

Scrapes: https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses

NUANCES:
- Page structure may change - uses multiple selectors as fallback
- Dates are in various formats ("through January 15, 2026", "ends Dec 31")
- Bonus percentages shown as "30% bonus" or "1,000 → 1,300 (30%)"
- Some bonuses are targeted/not available to all cardholders

ASSUMPTIONS:
- NerdWallet updates this page within 24-48 hours of new bonuses
- Page is publicly accessible without authentication
- HTML structure uses semantic elements we can parse
"""

import re
from datetime import datetime, timedelta
from typing import Optional
from bs4 import BeautifulSoup
import logging

from .base_scraper import BaseScraper, ScrapeResult
from ..models import TransferPartner


logger = logging.getLogger(__name__)


class NerdWalletBonusScraper(BaseScraper):
    """
    Scrapes NerdWallet for current transfer bonus promotions.
    """
    
    SOURCE_NAME = "nerdwallet"
    BASE_URL = "https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses"
    
    # Mapping of bank names in NerdWallet to our codes
    BANK_NAME_MAP = {
        "chase ultimate rewards": "Chase UR",
        "chase": "Chase UR",
        "amex membership rewards": "Amex MR",
        "american express": "Amex MR",
        "amex": "Amex MR",
        "citi thankyou": "Citi TYP",
        "citi": "Citi TYP",
        "capital one": "Capital One",
        "bilt": "Bilt",
        "bilt rewards": "Bilt",
    }
    
    # Mapping of partner names to our codes
    PARTNER_NAME_MAP = {
        "united": "UA",
        "united mileageplus": "UA",
        "american airlines": "AA",
        "aadvantage": "AA",
        "delta": "DL",
        "delta skymiles": "DL",
        "british airways": "BA",
        "avios": "BA",
        "air france": "AF",
        "flying blue": "AF",
        "virgin atlantic": "VS",
        "singapore": "SQ",
        "krisflyer": "SQ",
        "hilton": "HH",
        "hilton honors": "HH",
        "marriott": "MAR",
        "marriott bonvoy": "MAR",
        "hyatt": "HYATT",
        "world of hyatt": "HYATT",
        "ihg": "IHG",
        "avianca": "AV",
        "lifemiles": "AV",
        "turkish": "TK",
        "turkish airlines": "TK",
        "air canada": "AC",
        "aeroplan": "AC",
        "jetblue": "B6",
        "qatar": "QR",
        "emirates": "EK",
        "ana": "NH",
        "all nippon": "NH",
        "jal": "JL",
        "japan airlines": "JL",
    }
    
    async def scrape(self) -> ScrapeResult:
        """
        Scrape NerdWallet for current transfer bonuses.
        
        Returns:
            ScrapeResult with list of bonus dictionaries:
            {
                "bank": "Chase UR",
                "partner": "UA",
                "bonus_percentage": 30,  # 30% bonus
                "bonus_ratio": 1.3,      # Effective ratio
                "expires": datetime,
                "description": "30% bonus through Jan 15, 2026"
            }
        """
        try:
            async with self:
                html = await self.fetch_page(self.BASE_URL)
                bonuses = self._parse_bonuses(html)
                
                return ScrapeResult(
                    success=True,
                    data={"bonuses": bonuses},
                    source_url=self.BASE_URL,
                )
        except Exception as e:
            logger.error(f"NerdWallet scrape failed: {e}")
            return ScrapeResult(
                success=False,
                error=str(e),
                source_url=self.BASE_URL,
            )
    
    def _parse_bonuses(self, html: str) -> list[dict]:
        """
        Parse the HTML to extract transfer bonuses.
        
        NerdWallet typically structures bonuses in a table or card format.
        We try multiple parsing strategies for resilience.
        """
        soup = BeautifulSoup(html, "html.parser")
        bonuses = []
        
        # Strategy 1: Look for structured tables
        tables = soup.find_all("table")
        for table in tables:
            bonuses.extend(self._parse_table(table))
        
        # Strategy 2: Look for card/list structures
        # NerdWallet often uses divs with specific classes
        cards = soup.find_all("div", class_=re.compile(r"(bonus|transfer|promo)", re.I))
        for card in cards:
            bonus = self._parse_card(card)
            if bonus:
                bonuses.append(bonus)
        
        # Strategy 3: Look for any text matching bonus pattern
        if not bonuses:
            bonuses = self._parse_text_fallback(soup)
        
        # Deduplicate by (bank, partner) key
        seen = set()
        unique_bonuses = []
        for b in bonuses:
            key = (b.get("bank"), b.get("partner"))
            if key not in seen and all(key):
                seen.add(key)
                unique_bonuses.append(b)
        
        logger.info(f"Parsed {len(unique_bonuses)} transfer bonuses from NerdWallet")
        return unique_bonuses
    
    def _parse_table(self, table) -> list[dict]:
        """Parse a bonus table."""
        bonuses = []
        rows = table.find_all("tr")
        
        # Try to identify header row
        headers = []
        if rows:
            header_row = rows[0]
            headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        
        # Parse data rows
        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            
            row_text = " ".join(cell.get_text(strip=True) for cell in cells)
            bonus = self._extract_bonus_from_text(row_text)
            if bonus:
                bonuses.append(bonus)
        
        return bonuses
    
    def _parse_card(self, card) -> Optional[dict]:
        """Parse a bonus card/div."""
        text = card.get_text(separator=" ", strip=True)
        return self._extract_bonus_from_text(text)
    
    def _parse_text_fallback(self, soup) -> list[dict]:
        """
        Fallback: search entire page for bonus patterns.
        
        Patterns we look for:
        - "Chase → United: 30% bonus through Jan 15"
        - "Transfer 1,000 Amex MR to Hilton, receive 2,600 points (30% bonus)"
        """
        bonuses = []
        text = soup.get_text(separator=" ", strip=True)
        
        # Pattern: "X% bonus" with context
        bonus_pattern = r'(\d+)%\s*bonus'
        matches = re.finditer(bonus_pattern, text, re.IGNORECASE)
        
        for match in matches:
            # Get surrounding context (200 chars before and after)
            start = max(0, match.start() - 200)
            end = min(len(text), match.end() + 200)
            context = text[start:end]
            
            bonus = self._extract_bonus_from_text(context)
            if bonus:
                bonuses.append(bonus)
        
        return bonuses
    
    def _extract_bonus_from_text(self, text: str) -> Optional[dict]:
        """
        Extract bonus info from a text snippet.
        
        Tries to identify:
        - Bank name
        - Partner name
        - Bonus percentage
        - Expiration date
        """
        text_lower = text.lower()
        
        # Find bank
        bank = None
        for name, code in self.BANK_NAME_MAP.items():
            if name in text_lower:
                bank = code
                break
        
        # Find partner
        partner = None
        for name, code in self.PARTNER_NAME_MAP.items():
            if name in text_lower:
                partner = code
                break
        
        # Find bonus percentage
        bonus_match = re.search(r'(\d+)%?\s*bonus', text_lower)
        bonus_pct = int(bonus_match.group(1)) if bonus_match else None
        
        # Find expiration date
        expires = self._parse_expiration(text)
        
        if bank and partner and bonus_pct:
            return {
                "bank": bank,
                "partner": partner,
                "bonus_percentage": bonus_pct,
                "bonus_ratio": 1.0 + (bonus_pct / 100),
                "expires": expires,
                "description": text[:200] if len(text) > 200 else text,
            }
        
        return None
    
    def _parse_expiration(self, text: str) -> Optional[datetime]:
        """
        Parse expiration date from text.
        
        Handles formats like:
        - "through January 15, 2026"
        - "ends Dec 31, 2025"
        - "expires 1/15/26"
        - "until 2026-01-15"
        """
        # Pattern 1: "through/until/ends MONTH DAY, YEAR"
        pattern1 = r'(?:through|until|ends?|expires?)\s+(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})'
        match = re.search(pattern1, text, re.IGNORECASE)
        if match:
            try:
                month_str, day, year = match.groups()
                date_str = f"{month_str} {day}, {year}"
                return datetime.strptime(date_str, "%B %d, %Y")
            except ValueError:
                pass
        
        # Pattern 2: "M/D/YY" or "M/D/YYYY"
        pattern2 = r'(\d{1,2})/(\d{1,2})/(\d{2,4})'
        match = re.search(pattern2, text)
        if match:
            try:
                month, day, year = match.groups()
                if len(year) == 2:
                    year = "20" + year
                return datetime(int(year), int(month), int(day))
            except ValueError:
                pass
        
        # Pattern 3: ISO format "YYYY-MM-DD"
        pattern3 = r'(\d{4})-(\d{2})-(\d{2})'
        match = re.search(pattern3, text)
        if match:
            try:
                return datetime.strptime(match.group(), "%Y-%m-%d")
            except ValueError:
                pass
        
        # Default: assume 30 days from now if no date found
        return datetime.now() + timedelta(days=30)
```

### 3.3 ThePointsGuy Scraper (Transfer Partners)

```python
# backend/src/services/scraper/tpg_scraper.py

"""
ThePointsGuy Transfer Partners Scraper

Scrapes partner pages like:
- https://thepointsguy.com/guide/chase-transfer-partners/
- https://thepointsguy.com/guide/amex-membership-rewards-transfer-partners/

NUANCES:
- TPG articles include a lot of editorial content around the data
- Partner lists are often in tables but sometimes in bullet lists
- Transfer times mentioned in prose, not always structured
- Some partners are "limited time" or "targeted"

ASSUMPTIONS:
- TPG pages are updated when partnerships change
- Main partner table/list is identifiable by structure
- We can fall back to AI extraction if parsing fails
"""

import re
from datetime import datetime
from typing import Optional
from bs4 import BeautifulSoup
import logging

from .base_scraper import BaseScraper, ScrapeResult


logger = logging.getLogger(__name__)


class TPGPartnerScraper(BaseScraper):
    """
    Scrapes ThePointsGuy for transfer partner information.
    """
    
    SOURCE_NAME = "thepointsguy"
    
    # URLs for each bank's partner page
    BANK_URLS = {
        "Chase UR": "https://thepointsguy.com/guide/chase-transfer-partners/",
        "Amex MR": "https://thepointsguy.com/guide/amex-membership-rewards-transfer-partners/",
        "Citi TYP": "https://thepointsguy.com/guide/citi-transfer-partners/",
        "Capital One": "https://thepointsguy.com/loyalty-programs/capital-one-transfer-partners/",
        "Bilt": "https://thepointsguy.com/guide/bilt-rewards-transfer-partners/",
    }
    
    # Partner name to code mapping (same as NerdWallet, could be shared)
    PARTNER_NAME_MAP = {
        "united mileageplus": "UA",
        "united": "UA",
        "american aadvantage": "AA",
        "american airlines": "AA",
        "delta skymiles": "DL",
        "delta": "DL",
        "british airways": "BA",
        "avios": "BA",
        "air france-klm flying blue": "AF",
        "air france": "AF",
        "flying blue": "AF",
        "virgin atlantic": "VS",
        "singapore krisflyer": "SQ",
        "singapore airlines": "SQ",
        "hilton honors": "HH",
        "hilton": "HH",
        "marriott bonvoy": "MAR",
        "marriott": "MAR",
        "world of hyatt": "HYATT",
        "hyatt": "HYATT",
        "ihg one rewards": "IHG",
        "ihg": "IHG",
        "avianca lifemiles": "AV",
        "lifemiles": "AV",
        "turkish miles&smiles": "TK",
        "turkish airlines": "TK",
        "air canada aeroplan": "AC",
        "aeroplan": "AC",
        "jetblue trueblue": "B6",
        "jetblue": "B6",
        "qatar privilege club": "QR",
        "qatar airways": "QR",
        "emirates skywards": "EK",
        "emirates": "EK",
        "ana mileage club": "NH",
        "all nippon airways": "NH",
        "jal mileage bank": "JL",
        "japan airlines": "JL",
        "cathay pacific": "CX",
        "asia miles": "CX",
        "etihad guest": "EY",
        "etihad": "EY",
        "qantas": "QF",
        "iberia plus": "IB",
        "iberia": "IB",
        "southwest rapid rewards": "WN",
        "southwest": "WN",
        "alaska mileage plan": "AS",
        "alaska airlines": "AS",
    }
    
    async def scrape(self) -> ScrapeResult:
        """
        Scrape TPG for all banks' transfer partners.
        
        Returns:
            ScrapeResult with dict of bank -> partners list
        """
        all_partners = {}
        errors = []
        
        try:
            async with self:
                for bank_code, url in self.BANK_URLS.items():
                    try:
                        html = await self.fetch_page(url)
                        partners = self._parse_partners_page(html, bank_code)
                        all_partners[bank_code] = partners
                        logger.info(f"Scraped {len(partners)} partners for {bank_code}")
                    except Exception as e:
                        errors.append(f"{bank_code}: {e}")
                        logger.warning(f"Failed to scrape {bank_code}: {e}")
        except Exception as e:
            return ScrapeResult(
                success=False,
                error=str(e),
                source_url="thepointsguy.com",
            )
        
        if not all_partners:
            return ScrapeResult(
                success=False,
                error=f"All scrapes failed: {errors}",
                source_url="thepointsguy.com",
            )
        
        return ScrapeResult(
            success=True,
            data={"banks": all_partners, "errors": errors},
            source_url="thepointsguy.com",
        )
    
    def _parse_partners_page(self, html: str, bank_code: str) -> list[dict]:
        """
        Parse a TPG partner page to extract partner list.
        
        Returns list of dicts:
        {
            "code": "UA",
            "name": "United MileagePlus",
            "type": "airline",
            "ratio": 1.0,
            "transfer_time": "Instant",
        }
        """
        soup = BeautifulSoup(html, "html.parser")
        partners = []
        
        # Strategy 1: Look for tables with partner data
        for table in soup.find_all("table"):
            partners.extend(self._parse_partner_table(table))
        
        # Strategy 2: Look for list items
        if not partners:
            for ul in soup.find_all(["ul", "ol"]):
                partners.extend(self._parse_partner_list(ul))
        
        # Strategy 3: Look for specific div patterns
        if not partners:
            partners = self._parse_partner_divs(soup)
        
        # Deduplicate
        seen = set()
        unique = []
        for p in partners:
            if p.get("code") and p["code"] not in seen:
                seen.add(p["code"])
                unique.append(p)
        
        return unique
    
    def _parse_partner_table(self, table) -> list[dict]:
        """Parse partner info from a table."""
        partners = []
        rows = table.find_all("tr")
        
        for row in rows[1:]:  # Skip header
            cells = row.find_all(["td", "th"])
            if len(cells) >= 2:
                partner = self._extract_partner_from_cells(cells)
                if partner:
                    partners.append(partner)
        
        return partners
    
    def _extract_partner_from_cells(self, cells) -> Optional[dict]:
        """Extract partner info from table cells."""
        text = " ".join(cell.get_text(strip=True) for cell in cells)
        text_lower = text.lower()
        
        # Find partner code
        code = None
        name = None
        for partner_name, partner_code in self.PARTNER_NAME_MAP.items():
            if partner_name in text_lower:
                code = partner_code
                name = partner_name.title()
                break
        
        if not code:
            return None
        
        # Determine type
        prog_type = "hotel" if code in ("HH", "MAR", "HYATT", "IHG") else "airline"
        
        # Try to extract ratio
        ratio = 1.0
        ratio_match = re.search(r'(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)', text)
        if ratio_match:
            try:
                from_pts, to_pts = float(ratio_match.group(1)), float(ratio_match.group(2))
                ratio = to_pts / from_pts
            except:
                pass
        
        # Special case: Amex to Hilton is 1:2
        if code == "HH":
            ratio = 2.0
        
        # Try to extract transfer time
        transfer_time = "1-2 days"  # Default
        if "instant" in text_lower:
            transfer_time = "Instant"
        elif "24 hour" in text_lower or "same day" in text_lower:
            transfer_time = "24 hours"
        elif "48 hour" in text_lower or "2 day" in text_lower:
            transfer_time = "1-2 days"
        
        return {
            "code": code,
            "name": name,
            "type": prog_type,
            "ratio": ratio,
            "transfer_time": transfer_time,
        }
    
    def _parse_partner_list(self, ul) -> list[dict]:
        """Parse partner info from a list."""
        partners = []
        for li in ul.find_all("li"):
            text = li.get_text(strip=True)
            partner = self._extract_partner_from_text(text)
            if partner:
                partners.append(partner)
        return partners
    
    def _parse_partner_divs(self, soup) -> list[dict]:
        """Fallback: look for partner mentions in divs."""
        partners = []
        
        # Look for any element containing partner names
        for name, code in self.PARTNER_NAME_MAP.items():
            elements = soup.find_all(string=re.compile(name, re.IGNORECASE))
            for elem in elements:
                parent = elem.find_parent()
                if parent:
                    text = parent.get_text(strip=True)
                    partner = self._extract_partner_from_text(text)
                    if partner:
                        partners.append(partner)
                        break  # Only one per partner
        
        return partners
    
    def _extract_partner_from_text(self, text: str) -> Optional[dict]:
        """Extract partner info from arbitrary text."""
        text_lower = text.lower()
        
        for partner_name, code in self.PARTNER_NAME_MAP.items():
            if partner_name in text_lower:
                prog_type = "hotel" if code in ("HH", "MAR", "HYATT", "IHG") else "airline"
                
                # Try to find ratio
                ratio = 2.0 if code == "HH" else 1.0
                
                # Try to find transfer time
                transfer_time = "1-2 days"
                if "instant" in text_lower:
                    transfer_time = "Instant"
                
                return {
                    "code": code,
                    "name": partner_name.title(),
                    "type": prog_type,
                    "ratio": ratio,
                    "transfer_time": transfer_time,
                }
        
        return None
```

### 3.4 Scraper Orchestrator

```python
# backend/src/services/scraper/__init__.py

"""
Scraper module for fetching transfer data from external sources.

Usage:
    from services.scraper import TransferPartnerScraper
    
    scraper = TransferPartnerScraper()
    graph = await scraper.scrape_all_banks()
"""

from datetime import datetime
import logging
from typing import Optional

from ..models import TransferGraph, BankProgram, TransferPartner, DataSource
from .nerdwallet_scraper import NerdWalletBonusScraper
from .tpg_scraper import TPGPartnerScraper


logger = logging.getLogger(__name__)


class TransferPartnerScraper:
    """
    Orchestrates scraping from multiple sources to build a complete TransferGraph.
    
    Combines data from:
    1. ThePointsGuy (partner lists)
    2. NerdWallet (bonus promotions)
    
    Merges with hardcoded data for completeness.
    """
    
    def __init__(self):
        self.tpg_scraper = TPGPartnerScraper()
        self.nerdwallet_scraper = NerdWalletBonusScraper()
    
    async def scrape_all_banks(self) -> TransferGraph:
        """
        Scrape all sources and build a complete TransferGraph.
        
        Returns:
            TransferGraph with merged data from all sources
            
        Raises:
            Exception if scraping completely fails
        """
        # Scrape TPG for partner lists
        tpg_result = await self.tpg_scraper.scrape()
        
        # Scrape NerdWallet for bonuses
        bonus_result = await self.nerdwallet_scraper.scrape()
        
        # Build graph from scraped data
        if tpg_result.success:
            graph = self._build_graph_from_tpg(tpg_result.data)
        else:
            # Fall back to hardcoded base
            from ..transfer_data_service import TransferDataService
            service = TransferDataService()
            graph = service._get_hardcoded_fallback()
            graph.source = DataSource.SCRAPED  # Mark as attempted
        
        # Merge in bonuses
        if bonus_result.success:
            graph = self._merge_bonuses(graph, bonus_result.data.get("bonuses", []))
        
        # Update timestamp
        graph.last_updated = datetime.now()
        
        return graph
    
    def _build_graph_from_tpg(self, tpg_data: dict) -> TransferGraph:
        """Build TransferGraph from TPG scrape data."""
        from ..transfer_data_service import TransferDataService
        from ...agents.group_allocator import BANK_METADATA, PROGRAM_METADATA
        
        # Get hardcoded as base for metadata
        service = TransferDataService()
        fallback = service._get_hardcoded_fallback()
        
        banks = {}
        
        for bank_code, partners_data in tpg_data.get("banks", {}).items():
            # Get bank metadata from hardcoded
            fallback_bank = fallback.banks.get(bank_code)
            meta = BANK_METADATA.get(bank_code, {})
            
            partners = []
            for p in partners_data:
                prog_meta = PROGRAM_METADATA.get(p["code"], {})
                partners.append(TransferPartner(
                    program_code=p["code"],
                    program_name=prog_meta.get("name", p.get("name", p["code"])),
                    program_type=p.get("type", prog_meta.get("type", "airline")),
                    base_ratio=p.get("ratio", 1.0),
                    transfer_time=p.get("transfer_time", "1-2 days"),
                    booking_url=prog_meta.get("booking_url", ""),
                ))
            
            banks[bank_code] = BankProgram(
                code=bank_code,
                name=meta.get("name", bank_code),
                portal_url=meta.get("portal_url", fallback_bank.portal_url if fallback_bank else ""),
                default_transfer_time=meta.get("default_transfer_time", "Instant"),
                partners=partners,
            )
        
        return TransferGraph(
            banks=banks,
            last_updated=datetime.now(),
            source=DataSource.SCRAPED,
        )
    
    def _merge_bonuses(self, graph: TransferGraph, bonuses: list[dict]) -> TransferGraph:
        """Merge bonus data into the transfer graph."""
        for bonus in bonuses:
            bank_code = bonus.get("bank")
            partner_code = bonus.get("partner")
            
            if bank_code not in graph.banks:
                continue
            
            bank = graph.banks[bank_code]
            for partner in bank.partners:
                if partner.program_code == partner_code:
                    partner.bonus_ratio = bonus.get("bonus_ratio")
                    partner.bonus_expires = bonus.get("expires")
                    logger.debug(
                        f"Applied {bonus.get('bonus_percentage')}% bonus to "
                        f"{bank_code} → {partner_code}"
                    )
                    break
        
        return graph
```

---

## 4. Phase 3: Transfer Bonus Tracking

### 4.1 Dedicated Bonus Service

```python
# backend/src/services/transfer_bonus_service.py

"""
Transfer Bonus Service

Tracks temporary transfer bonus promotions separately from base partnerships.
Updates more frequently (daily) since bonuses change often.

NUANCES:
- Bonuses are time-limited (days to weeks)
- Multiple bonuses can be active for same bank
- Some bonuses are "targeted" (not available to all cardholders)
- Bonus percentages compound with base ratios

ASSUMPTIONS:
- We scrape NerdWallet daily for bonus updates
- Base ratios in TRANSFER_GRAPH are correct (bonuses are additive)
- Expired bonuses should be cleaned up automatically
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import asyncio

from .scraper.nerdwallet_scraper import NerdWalletBonusScraper


logger = logging.getLogger(__name__)


@dataclass
class TransferBonus:
    """A single transfer bonus promotion."""
    bank: str                    # "Chase UR"
    partner: str                 # "UA"
    bonus_percentage: int        # 30 for 30% bonus
    bonus_ratio: float           # 1.3 (includes base 1.0)
    expires: datetime
    description: str = ""
    source_url: str = ""
    is_targeted: bool = False    # If true, not available to all cardholders
    scraped_at: datetime = field(default_factory=datetime.now)
    
    @property
    def is_active(self) -> bool:
        return datetime.now() < self.expires
    
    @property
    def days_remaining(self) -> int:
        delta = self.expires - datetime.now()
        return max(0, delta.days)


class TransferBonusService:
    """
    Manages transfer bonus promotions.
    
    Separate from TransferDataService because:
    1. Bonuses change more frequently (daily vs weekly)
    2. Bonuses have expiration dates that need monitoring
    3. We want to merge bonuses at query time, not cache time
    
    Usage:
        service = TransferBonusService()
        await service.refresh_bonuses()
        ratio = service.get_effective_ratio("Chase UR", "UA", base_ratio=1.0)
    """
    
    CACHE_FILE = Path("data/transfer_bonuses.json")
    CACHE_TTL = timedelta(hours=24)
    
    def __init__(self):
        self._bonuses: list[TransferBonus] = []
        self._last_refresh: Optional[datetime] = None
        self._refresh_lock = asyncio.Lock()
        
        # Load from cache on init
        self._load_cache()
    
    # =========================================================================
    # PUBLIC API
    # =========================================================================
    
    def get_active_bonuses(self) -> list[TransferBonus]:
        """Get all currently active bonuses."""
        return [b for b in self._bonuses if b.is_active]
    
    def get_bonus(self, bank: str, partner: str) -> Optional[TransferBonus]:
        """Get active bonus for a specific bank→partner transfer."""
        for bonus in self._bonuses:
            if bonus.bank == bank and bonus.partner == partner and bonus.is_active:
                return bonus
        return None
    
    def get_effective_ratio(
        self, 
        bank: str, 
        partner: str, 
        base_ratio: float = 1.0
    ) -> float:
        """
        Get effective transfer ratio including any active bonus.
        
        Args:
            bank: Bank code ("Chase UR")
            partner: Partner code ("UA")
            base_ratio: Base transfer ratio from TRANSFER_GRAPH
            
        Returns:
            Effective ratio (base * bonus if bonus active, else base)
        """
        bonus = self.get_bonus(bank, partner)
        if bonus:
            # Bonus ratio already includes the base (1.3 for 30% bonus)
            # But we need to account for non-1:1 base ratios
            if base_ratio == 1.0:
                return bonus.bonus_ratio
            else:
                # For Hilton (base 2.0), a 30% bonus means 2.0 * 1.3 = 2.6
                return base_ratio * (bonus.bonus_ratio / 1.0)
        return base_ratio
    
    def get_bonuses_for_bank(self, bank: str) -> list[TransferBonus]:
        """Get all active bonuses for a specific bank."""
        return [b for b in self._bonuses if b.bank == bank and b.is_active]
    
    async def refresh_bonuses(self, force: bool = False) -> int:
        """
        Refresh bonus data from external sources.
        
        Args:
            force: If True, refresh even if cache is fresh
            
        Returns:
            Number of active bonuses found
        """
        if not force and self._is_cache_fresh():
            return len(self.get_active_bonuses())
        
        async with self._refresh_lock:
            scraper = NerdWalletBonusScraper()
            result = await scraper.scrape()
            
            if result.success:
                self._bonuses = [
                    TransferBonus(**b) 
                    for b in result.data.get("bonuses", [])
                ]
                self._last_refresh = datetime.now()
                self._save_cache()
                logger.info(f"Refreshed {len(self._bonuses)} transfer bonuses")
            else:
                logger.warning(f"Bonus refresh failed: {result.error}")
            
            return len(self.get_active_bonuses())
    
    async def refresh_if_stale(self) -> bool:
        """Refresh if cache is stale. Returns True if refresh was triggered."""
        if self._is_cache_fresh():
            return False
        await self.refresh_bonuses()
        return True
    
    # =========================================================================
    # CACHE MANAGEMENT
    # =========================================================================
    
    def _is_cache_fresh(self) -> bool:
        """Check if cache is within TTL."""
        if not self._last_refresh:
            return False
        age = datetime.now() - self._last_refresh
        return age < self.CACHE_TTL
    
    def _load_cache(self) -> None:
        """Load bonuses from file cache."""
        if not self.CACHE_FILE.exists():
            return
        
        try:
            data = json.loads(self.CACHE_FILE.read_text())
            self._bonuses = [
                TransferBonus(
                    bank=b["bank"],
                    partner=b["partner"],
                    bonus_percentage=b["bonus_percentage"],
                    bonus_ratio=b["bonus_ratio"],
                    expires=datetime.fromisoformat(b["expires"]),
                    description=b.get("description", ""),
                    source_url=b.get("source_url", ""),
                    is_targeted=b.get("is_targeted", False),
                    scraped_at=datetime.fromisoformat(b["scraped_at"]) if b.get("scraped_at") else datetime.now(),
                )
                for b in data.get("bonuses", [])
            ]
            self._last_refresh = datetime.fromisoformat(data["last_refresh"]) if data.get("last_refresh") else None
            
            # Clean up expired bonuses
            self._bonuses = [b for b in self._bonuses if b.is_active]
            
            logger.info(f"Loaded {len(self._bonuses)} bonuses from cache")
        except Exception as e:
            logger.warning(f"Failed to load bonus cache: {e}")
    
    def _save_cache(self) -> None:
        """Save bonuses to file cache."""
        try:
            data = {
                "last_refresh": self._last_refresh.isoformat() if self._last_refresh else None,
                "bonuses": [
                    {
                        "bank": b.bank,
                        "partner": b.partner,
                        "bonus_percentage": b.bonus_percentage,
                        "bonus_ratio": b.bonus_ratio,
                        "expires": b.expires.isoformat(),
                        "description": b.description,
                        "source_url": b.source_url,
                        "is_targeted": b.is_targeted,
                        "scraped_at": b.scraped_at.isoformat(),
                    }
                    for b in self._bonuses
                ]
            }
            
            self.CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            self.CACHE_FILE.write_text(json.dumps(data, indent=2))
            logger.debug(f"Saved {len(self._bonuses)} bonuses to cache")
        except Exception as e:
            logger.error(f"Failed to save bonus cache: {e}")
    
    def cleanup_expired(self) -> int:
        """Remove expired bonuses. Returns count of removed."""
        before = len(self._bonuses)
        self._bonuses = [b for b in self._bonuses if b.is_active]
        removed = before - len(self._bonuses)
        if removed > 0:
            self._save_cache()
            logger.info(f"Cleaned up {removed} expired bonuses")
        return removed
```

---

## 5. Phase 4: AI-Assisted Data Extraction

### 5.1 Claude-Based Extractor

```python
# backend/src/services/scraper/ai_extractor.py

"""
AI-Assisted Transfer Data Extractor

Uses Claude to extract structured data from unstructured web pages.
This is a FALLBACK when traditional scraping fails (e.g., page structure changed).

NUANCES:
- Claude API has rate limits and costs money (~$0.003 per 1K input tokens)
- Results should be validated against known patterns
- HTML can be very large - need to truncate intelligently
- AI may hallucinate partners that don't exist

ASSUMPTIONS:
- ANTHROPIC_API_KEY is set in environment
- We only use this as a fallback, not primary source
- We validate AI output against known bank/partner codes
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional
import httpx

from ..models import TransferGraph, BankProgram, TransferPartner, DataSource


logger = logging.getLogger(__name__)


# Known valid codes for validation
VALID_BANK_CODES = {"Chase UR", "Amex MR", "Citi TYP", "Capital One", "Bilt"}
VALID_PARTNER_CODES = {
    "UA", "AA", "DL", "BA", "AF", "VS", "SQ", "NH", "JL", "EK", "QF", "TK",
    "IB", "AV", "TP", "CX", "EY", "QR", "AS", "WN", "B6", "AC",  # Airlines
    "HH", "MAR", "HYATT", "IHG",  # Hotels
}


class AITransferExtractor:
    """
    Uses Claude to extract transfer partner data from web pages.
    
    This is expensive and should only be used as a fallback when
    regular scraping fails.
    
    Usage:
        extractor = AITransferExtractor()
        graph = await extractor.extract_all_banks()
    """
    
    ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
    MODEL = "claude-sonnet-4-20250514"  # Balance of cost and capability
    MAX_HTML_CHARS = 50000  # Truncate HTML to control costs
    
    # URLs to extract from
    BANK_URLS = {
        "Chase UR": "https://thepointsguy.com/guide/chase-transfer-partners/",
        "Amex MR": "https://thepointsguy.com/guide/amex-membership-rewards-transfer-partners/",
        "Citi TYP": "https://thepointsguy.com/guide/citi-transfer-partners/",
        "Capital One": "https://thepointsguy.com/loyalty-programs/capital-one-transfer-partners/",
        "Bilt": "https://upgradedpoints.com/news/bilt-rewards-adds-united-cathay-pacific-transfer-partners/",
    }
    
    def __init__(self):
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable not set")
    
    async def extract_all_banks(self) -> TransferGraph:
        """
        Extract transfer data for all banks using AI.
        
        Returns:
            TransferGraph built from AI-extracted data
        """
        banks = {}
        
        async with httpx.AsyncClient() as client:
            for bank_code, url in self.BANK_URLS.items():
                try:
                    # Fetch the page
                    response = await client.get(url, follow_redirects=True)
                    html = response.text
                    
                    # Extract with AI
                    partners = await self._extract_partners(bank_code, html)
                    
                    if partners:
                        banks[bank_code] = self._build_bank_program(bank_code, partners)
                        logger.info(f"AI extracted {len(partners)} partners for {bank_code}")
                    else:
                        logger.warning(f"AI extraction found no partners for {bank_code}")
                        
                except Exception as e:
                    logger.error(f"AI extraction failed for {bank_code}: {e}")
        
        if not banks:
            raise Exception("AI extraction failed for all banks")
        
        return TransferGraph(
            banks=banks,
            last_updated=datetime.now(),
            source=DataSource.AI_EXTRACTED,
        )
    
    async def _extract_partners(self, bank_code: str, html: str) -> list[dict]:
        """
        Use Claude to extract partner data from HTML.
        
        Returns list of partner dicts.
        """
        # Truncate HTML to control costs
        html_truncated = html[:self.MAX_HTML_CHARS]
        
        prompt = f"""
You are extracting credit card transfer partner data from a webpage about {bank_code}.

Extract ALL transfer partners mentioned on this page. For each partner, provide:
1. program_code: The airline/hotel code (e.g., "UA" for United, "HH" for Hilton)
2. program_name: Full name (e.g., "United MileagePlus")
3. program_type: "airline" or "hotel"
4. ratio: Transfer ratio (1.0 for 1:1, 2.0 for 1:2 like Amex to Hilton)
5. transfer_time: Expected transfer time (e.g., "Instant", "1-2 days")

IMPORTANT:
- Only include partners that {bank_code} can transfer to
- Use standard 2-letter airline codes (UA, AA, DL, BA, etc.)
- Use these hotel codes: HH (Hilton), MAR (Marriott), HYATT (Hyatt), IHG (IHG)
- Default ratio is 1.0 unless explicitly stated otherwise
- Default transfer time is "1-2 days" unless stated as instant

Return ONLY a valid JSON array, no other text:
[
  {{"program_code": "UA", "program_name": "United MileagePlus", "program_type": "airline", "ratio": 1.0, "transfer_time": "Instant"}},
  ...
]

HTML content:
{html_truncated}
"""
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.ANTHROPIC_API_URL,
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.MODEL,
                        "max_tokens": 4096,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    timeout=60.0,
                )
                response.raise_for_status()
                
                result = response.json()
                content = result["content"][0]["text"]
                
                # Parse JSON from response
                partners = json.loads(content)
                
                # Validate partners
                validated = self._validate_partners(partners)
                
                return validated
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            return []
        except Exception as e:
            logger.error(f"AI API call failed: {e}")
            raise
    
    def _validate_partners(self, partners: list[dict]) -> list[dict]:
        """
        Validate AI-extracted partners against known codes.
        
        Filters out:
        - Unknown partner codes (possible hallucinations)
        - Invalid ratios
        - Duplicate entries
        """
        validated = []
        seen = set()
        
        for p in partners:
            code = p.get("program_code", "").upper()
            
            # Skip unknown codes
            if code not in VALID_PARTNER_CODES:
                logger.warning(f"AI extracted unknown partner code: {code}")
                continue
            
            # Skip duplicates
            if code in seen:
                continue
            seen.add(code)
            
            # Validate ratio
            ratio = p.get("ratio", 1.0)
            if not isinstance(ratio, (int, float)) or ratio < 0.1 or ratio > 10:
                ratio = 1.0
            
            # Validate type
            prog_type = p.get("program_type", "airline")
            if code in ("HH", "MAR", "HYATT", "IHG"):
                prog_type = "hotel"
            elif prog_type not in ("airline", "hotel"):
                prog_type = "airline"
            
            validated.append({
                "program_code": code,
                "program_name": p.get("program_name", code),
                "program_type": prog_type,
                "ratio": ratio,
                "transfer_time": p.get("transfer_time", "1-2 days"),
            })
        
        return validated
    
    def _build_bank_program(self, bank_code: str, partners_data: list[dict]) -> BankProgram:
        """Build a BankProgram from extracted data."""
        from ...agents.group_allocator import BANK_METADATA, PROGRAM_METADATA
        
        meta = BANK_METADATA.get(bank_code, {})
        
        partners = [
            TransferPartner(
                program_code=p["program_code"],
                program_name=p["program_name"],
                program_type=p["program_type"],
                base_ratio=p["ratio"],
                transfer_time=p["transfer_time"],
                booking_url=PROGRAM_METADATA.get(p["program_code"], {}).get("booking_url", ""),
            )
            for p in partners_data
        ]
        
        return BankProgram(
            code=bank_code,
            name=meta.get("name", bank_code),
            portal_url=meta.get("portal_url", ""),
            default_transfer_time=meta.get("default_transfer_time", "Instant"),
            partners=partners,
        )
```

---

## 6. Phase 5: Seats.aero API Integration

### 6.1 Seats.aero Client

```python
# backend/src/services/external_apis/seats_aero.py

"""
Seats.aero API Client

Provides access to cached award flight availability data.

NUANCES:
- Requires Pro subscription ($9.99/month)
- Limited to 1,000 API calls per day
- Only "Cached Search" available to non-commercial users
- Live search requires commercial partnership

ASSUMPTIONS:
- SEATS_AERO_API_KEY is set in environment
- We track daily usage to avoid hitting limits
- This supplements, not replaces, our primary award data sources
"""

import os
import logging
from datetime import datetime, date
from dataclasses import dataclass
from typing import Optional
import httpx


logger = logging.getLogger(__name__)


@dataclass
class AwardAvailability:
    """A single award availability result."""
    origin: str
    destination: str
    date: date
    airline: str
    flight_number: str
    cabin: str  # "economy", "business", "first"
    miles_required: int
    taxes_and_fees: float
    seats_available: int
    source_program: str  # Which program has this award


@dataclass
class SeatsAeroUsage:
    """Track daily API usage."""
    date: date
    calls_made: int
    calls_remaining: int


class SeatsAeroClient:
    """
    Client for seats.aero Pro API.
    
    Provides cached award search across major alliances.
    
    Usage:
        client = SeatsAeroClient()
        awards = await client.search_cached(
            origin="JFK",
            destination="LHR",
            date="2025-06-15",
            cabin="business"
        )
    """
    
    BASE_URL = "https://api.seats.aero/v1"
    DAILY_LIMIT = 1000
    
    def __init__(self):
        self.api_key = os.environ.get("SEATS_AERO_API_KEY")
        if not self.api_key:
            logger.warning("SEATS_AERO_API_KEY not set - seats.aero integration disabled")
        
        self._daily_usage = SeatsAeroUsage(
            date=date.today(),
            calls_made=0,
            calls_remaining=self.DAILY_LIMIT,
        )
    
    @property
    def is_configured(self) -> bool:
        """Check if API key is configured."""
        return self.api_key is not None
    
    @property
    def calls_remaining(self) -> int:
        """Get remaining API calls for today."""
        self._reset_daily_if_needed()
        return self._daily_usage.calls_remaining
    
    async def search_cached(
        self,
        origin: str,
        destination: str,
        date: str,  # YYYY-MM-DD
        cabin: str = "business",
    ) -> list[AwardAvailability]:
        """
        Search for cached award availability.
        
        Args:
            origin: Origin airport code (e.g., "JFK")
            destination: Destination airport code (e.g., "LHR")
            date: Travel date in YYYY-MM-DD format
            cabin: Cabin class ("economy", "premium_economy", "business", "first")
            
        Returns:
            List of AwardAvailability results
            
        Raises:
            RateLimitError if daily limit exceeded
            APIError for other API errors
        """
        if not self.is_configured:
            raise ValueError("Seats.aero API key not configured")
        
        self._check_rate_limit()
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.BASE_URL}/cached-search",
                    headers={
                        "Partner-Authorization": self.api_key,
                    },
                    params={
                        "origin": origin,
                        "destination": destination,
                        "date": date,
                        "cabin": cabin,
                    },
                    timeout=30.0,
                )
                
                # Update usage tracking
                self._update_usage(response)
                
                response.raise_for_status()
                data = response.json()
                
                return self._parse_results(data)
                
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise RateLimitError("Daily API limit exceeded")
            raise APIError(f"Seats.aero API error: {e}")
    
    async def get_routes(
        self,
        source_program: Optional[str] = None,
    ) -> list[dict]:
        """
        Get available routes (for exploring options).
        
        Args:
            source_program: Filter by program (e.g., "united", "american")
            
        Returns:
            List of route dictionaries
        """
        if not self.is_configured:
            raise ValueError("Seats.aero API key not configured")
        
        self._check_rate_limit()
        
        try:
            async with httpx.AsyncClient() as client:
                params = {}
                if source_program:
                    params["source"] = source_program
                
                response = await client.get(
                    f"{self.BASE_URL}/routes",
                    headers={"Partner-Authorization": self.api_key},
                    params=params,
                    timeout=30.0,
                )
                
                self._update_usage(response)
                response.raise_for_status()
                
                return response.json().get("routes", [])
                
        except httpx.HTTPStatusError as e:
            raise APIError(f"Seats.aero API error: {e}")
    
    def _check_rate_limit(self):
        """Check if we have API calls remaining."""
        self._reset_daily_if_needed()
        if self._daily_usage.calls_remaining <= 0:
            raise RateLimitError(
                f"Daily API limit ({self.DAILY_LIMIT}) exceeded. "
                f"Resets at midnight UTC."
            )
    
    def _reset_daily_if_needed(self):
        """Reset daily counter if it's a new day."""
        today = date.today()
        if self._daily_usage.date != today:
            self._daily_usage = SeatsAeroUsage(
                date=today,
                calls_made=0,
                calls_remaining=self.DAILY_LIMIT,
            )
    
    def _update_usage(self, response: httpx.Response):
        """Update usage from response headers."""
        self._daily_usage.calls_made += 1
        
        # seats.aero returns remaining calls in header
        remaining = response.headers.get("X-RateLimit-Remaining")
        if remaining:
            self._daily_usage.calls_remaining = int(remaining)
        else:
            self._daily_usage.calls_remaining -= 1
    
    def _parse_results(self, data: dict) -> list[AwardAvailability]:
        """Parse API response into AwardAvailability objects."""
        results = []
        
        for item in data.get("results", []):
            try:
                results.append(AwardAvailability(
                    origin=item["origin"],
                    destination=item["destination"],
                    date=datetime.strptime(item["date"], "%Y-%m-%d").date(),
                    airline=item.get("airline", ""),
                    flight_number=item.get("flight_number", ""),
                    cabin=item.get("cabin", ""),
                    miles_required=item.get("miles", 0),
                    taxes_and_fees=item.get("taxes", 0.0),
                    seats_available=item.get("seats", 0),
                    source_program=item.get("source", ""),
                ))
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse award result: {e}")
                continue
        
        return results


class RateLimitError(Exception):
    """Raised when API rate limit is exceeded."""
    pass


class APIError(Exception):
    """Raised for general API errors."""
    pass
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

```python
# backend/tests/services/test_transfer_data_service.py

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

from src.services.transfer_data_service import TransferDataService, RefreshError
from src.services.models import TransferGraph, BankProgram, TransferPartner, DataSource


class TestTransferDataService:
    """Tests for TransferDataService."""
    
    @pytest.fixture
    def service(self, tmp_path):
        """Create service with temp cache directory."""
        service = TransferDataService()
        service.CACHE_DIR = tmp_path
        service.CACHE_FILE = tmp_path / "transfer_partners.json"
        return service
    
    # =========================================================================
    # Cache Layer Tests
    # =========================================================================
    
    def test_returns_memory_cache_when_fresh(self, service):
        """Should return memory cache if within TTL."""
        # Setup: Put data in memory cache
        mock_graph = self._create_mock_graph()
        service._memory_cache = mock_graph
        service._memory_cache_time = datetime.now()
        
        # Act
        import asyncio
        result = asyncio.run(service.get_transfer_graph())
        
        # Assert
        assert result == mock_graph
    
    def test_returns_file_cache_when_memory_stale(self, service):
        """Should load from file cache when memory cache is stale."""
        # Setup: Stale memory cache, fresh file cache
        mock_graph = self._create_mock_graph()
        service._memory_cache = None
        service._save_file_cache(mock_graph)
        
        # Act
        import asyncio
        result = asyncio.run(service.get_transfer_graph())
        
        # Assert
        assert result.banks.keys() == mock_graph.banks.keys()
    
    def test_returns_hardcoded_when_all_caches_stale(self, service):
        """Should fall back to hardcoded when all caches are stale."""
        # Setup: No cache
        service._memory_cache = None
        
        # Act
        import asyncio
        result = asyncio.run(service.get_transfer_graph())
        
        # Assert
        assert result.source == DataSource.HARDCODED
        assert "Chase UR" in result.banks
    
    # =========================================================================
    # Refresh Tests
    # =========================================================================
    
    @pytest.mark.asyncio
    async def test_force_refresh_calls_scraper(self, service):
        """Force refresh should call the scraper."""
        with patch.object(service, '_refresh_from_scraping') as mock_scrape:
            mock_graph = self._create_mock_graph()
            mock_scrape.return_value = mock_graph
            
            result = await service.force_refresh(source="scrape")
            
            mock_scrape.assert_called_once()
            assert result == mock_graph
    
    @pytest.mark.asyncio
    async def test_refresh_falls_back_to_ai_on_scrape_failure(self, service):
        """Should try AI extraction when scraping fails."""
        with patch.object(service, '_refresh_from_scraping') as mock_scrape:
            with patch.object(service, '_refresh_from_ai') as mock_ai:
                mock_scrape.side_effect = Exception("Scrape failed")
                mock_ai.return_value = self._create_mock_graph()
                
                result = await service.force_refresh(source="all")
                
                mock_scrape.assert_called_once()
                mock_ai.assert_called_once()
    
    # =========================================================================
    # Integration Tests
    # =========================================================================
    
    def test_get_effective_ratio_uses_cached_data(self, service):
        """Should return correct ratio from cached data."""
        mock_graph = self._create_mock_graph()
        service._memory_cache = mock_graph
        service._memory_cache_time = datetime.now()
        
        ratio = service.get_effective_ratio("Chase UR", "UA")
        
        assert ratio == 1.0
    
    # =========================================================================
    # Helpers
    # =========================================================================
    
    def _create_mock_graph(self) -> TransferGraph:
        """Create a mock TransferGraph for testing."""
        return TransferGraph(
            banks={
                "Chase UR": BankProgram(
                    code="Chase UR",
                    name="Chase Ultimate Rewards",
                    portal_url="https://ultimaterewardspoints.chase.com",
                    default_transfer_time="Instant",
                    partners=[
                        TransferPartner(
                            program_code="UA",
                            program_name="United MileagePlus",
                            program_type="airline",
                            base_ratio=1.0,
                            transfer_time="Instant",
                            booking_url="https://www.united.com",
                        ),
                    ],
                ),
            },
            last_updated=datetime.now(),
            source=DataSource.SCRAPED,
        )
```

### 7.2 Integration Tests

```python
# backend/tests/services/test_scrapers.py

import pytest
from datetime import datetime

from src.services.scraper.nerdwallet_scraper import NerdWalletBonusScraper
from src.services.scraper.tpg_scraper import TPGPartnerScraper


class TestNerdWalletScraper:
    """Integration tests for NerdWallet scraper."""
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_scrape_returns_bonuses(self):
        """Should return bonus data from NerdWallet."""
        scraper = NerdWalletBonusScraper()
        result = await scraper.scrape()
        
        # May fail if NerdWallet structure changes
        if result.success:
            assert "bonuses" in result.data
            # Bonuses may be empty if no current promotions
            for bonus in result.data.get("bonuses", []):
                assert "bank" in bonus
                assert "partner" in bonus
                assert "bonus_ratio" in bonus
    
    def test_parse_expiration_various_formats(self):
        """Should parse various date formats."""
        scraper = NerdWalletBonusScraper()
        
        # Test various formats
        test_cases = [
            ("through January 15, 2026", datetime(2026, 1, 15)),
            ("ends Dec 31, 2025", datetime(2025, 12, 31)),
            ("expires 1/15/26", datetime(2026, 1, 15)),
        ]
        
        for text, expected in test_cases:
            result = scraper._parse_expiration(text)
            if expected:
                assert result.date() == expected.date(), f"Failed for: {text}"


class TestTPGScraper:
    """Integration tests for ThePointsGuy scraper."""
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_scrape_returns_partners(self):
        """Should return partner data from TPG."""
        scraper = TPGPartnerScraper()
        result = await scraper.scrape()
        
        if result.success:
            assert "banks" in result.data
            # Should have at least some banks
            assert len(result.data["banks"]) > 0
```

---

## 8. Deployment & Monitoring

### 8.1 Admin API Endpoints

```python
# backend/src/routes/admin.py

"""
Admin endpoints for managing transfer data.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from datetime import datetime

from ..services.transfer_data_service import TransferDataService
from ..services.transfer_bonus_service import TransferBonusService


router = APIRouter(prefix="/admin", tags=["admin"])

transfer_service = TransferDataService()
bonus_service = TransferBonusService()


class RefreshResponse(BaseModel):
    success: bool
    message: str
    source: str
    timestamp: datetime
    banks_updated: int = 0
    bonuses_updated: int = 0


@router.post("/transfer-data/refresh")
async def refresh_transfer_data(
    background_tasks: BackgroundTasks,
    source: str = "scrape",  # "scrape", "ai", or "all"
    force: bool = False,
) -> RefreshResponse:
    """
    Trigger a refresh of transfer partner data.
    
    Args:
        source: Data source to use ("scrape", "ai", or "all")
        force: If True, refresh even if cache is fresh
    """
    try:
        graph = await transfer_service.force_refresh(source=source)
        
        return RefreshResponse(
            success=True,
            message=f"Successfully refreshed transfer data from {source}",
            source=graph.source.value,
            timestamp=graph.last_updated,
            banks_updated=len(graph.banks),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transfer-bonuses/refresh")
async def refresh_transfer_bonuses(force: bool = False) -> RefreshResponse:
    """Trigger a refresh of transfer bonus data."""
    try:
        count = await bonus_service.refresh_bonuses(force=force)
        
        return RefreshResponse(
            success=True,
            message=f"Successfully refreshed transfer bonuses",
            source="nerdwallet",
            timestamp=datetime.now(),
            bonuses_updated=count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transfer-data/status")
async def get_transfer_data_status():
    """Get current status of transfer data."""
    graph = await transfer_service.get_transfer_graph()
    active_bonuses = bonus_service.get_active_bonuses()
    
    return {
        "transfer_graph": {
            "source": graph.source.value,
            "last_updated": graph.last_updated,
            "banks_count": len(graph.banks),
            "total_partners": sum(len(b.partners) for b in graph.banks.values()),
        },
        "bonuses": {
            "active_count": len(active_bonuses),
            "last_refresh": bonus_service._last_refresh,
            "bonuses": [
                {
                    "bank": b.bank,
                    "partner": b.partner,
                    "bonus_percentage": b.bonus_percentage,
                    "expires": b.expires,
                    "days_remaining": b.days_remaining,
                }
                for b in active_bonuses
            ],
        },
    }
```

### 8.2 Scheduled Tasks

```python
# backend/src/tasks/scheduled.py

"""
Scheduled tasks for data refresh.
"""

import asyncio
import logging
from datetime import datetime

from ..services.transfer_data_service import TransferDataService
from ..services.transfer_bonus_service import TransferBonusService


logger = logging.getLogger(__name__)


async def refresh_transfer_data_task():
    """
    Scheduled task to refresh transfer partner data.
    
    Run weekly or on-demand via admin endpoint.
    """
    service = TransferDataService()
    
    try:
        triggered = await service.refresh_if_stale()
        if triggered:
            logger.info("Transfer data refresh triggered")
    except Exception as e:
        logger.error(f"Transfer data refresh failed: {e}")


async def refresh_transfer_bonuses_task():
    """
    Scheduled task to refresh transfer bonuses.
    
    Run daily since bonuses change frequently.
    """
    service = TransferBonusService()
    
    try:
        triggered = await service.refresh_if_stale()
        if triggered:
            logger.info("Transfer bonuses refresh triggered")
        
        # Also cleanup expired bonuses
        removed = service.cleanup_expired()
        if removed:
            logger.info(f"Cleaned up {removed} expired bonuses")
    except Exception as e:
        logger.error(f"Transfer bonuses refresh failed: {e}")


# For use with APScheduler or similar
SCHEDULED_TASKS = [
    {
        "func": refresh_transfer_data_task,
        "trigger": "cron",
        "day_of_week": "sun",  # Weekly on Sunday
        "hour": 3,
        "minute": 0,
    },
    {
        "func": refresh_transfer_bonuses_task,
        "trigger": "cron",
        "hour": 6,  # Daily at 6am
        "minute": 0,
    },
]
```

---

## 9. Assumptions & Nuances

### 9.1 Critical Assumptions

| Assumption | Risk if Wrong | Mitigation |
|------------|---------------|------------|
| NerdWallet page structure is parseable | Scraping breaks | AI fallback + hardcoded fallback |
| TPG pages are publicly accessible | Scraping fails | Multiple source URLs + caching |
| Transfer partnerships are accurate on TPG | Incorrect data shown to users | Validation against known codes |
| Base ratios rarely change | Users see wrong ratios | Manual review quarterly |
| Claude API is available | AI extraction fails | Primary scraping, AI is backup |
| Seats.aero Pro subscription maintained | Award search unavailable | Feature is additive, not required |

### 9.2 Known Nuances

#### Web Scraping
1. **Anti-bot measures**: Some sites block scrapers
   - Mitigation: Browser-like headers, rate limiting, rotating user agents
   
2. **Page structure changes**: HTML may change without notice
   - Mitigation: Multiple parsing strategies, AI fallback, alerts on failure

3. **Dynamic content**: Some pages load data via JavaScript
   - Mitigation: Use playwright/selenium if needed, or target API endpoints

#### AI Extraction
1. **Hallucinations**: Claude may invent partners that don't exist
   - Mitigation: Validate against known code lists

2. **Cost**: Each extraction costs ~$0.01-0.05
   - Mitigation: Use as fallback only, cache aggressively

3. **Rate limits**: Anthropic API has rate limits
   - Mitigation: Batch requests, implement backoff

#### Transfer Bonuses
1. **Targeted offers**: Some bonuses aren't available to all cardholders
   - Mitigation: Mark as "targeted" in UI, disclaimer

2. **Date parsing**: Expiration dates in various formats
   - Mitigation: Multiple regex patterns, default to 30 days

3. **Stale data**: Bonuses may expire before we scrape
   - Mitigation: Daily refresh, show "as of" timestamp

### 9.3 Future Considerations

1. **Real-time bonus alerts**: Push notifications when new bonuses appear
2. **User-reported updates**: Allow users to report partnership changes
3. **Partner page monitoring**: Use change detection on official pages
4. **Commercial API access**: Apply for seats.aero commercial API if needed
5. **AwardWallet integration**: Partner for loyalty balance data

---

## Appendix: Environment Variables

```bash
# Required for AI extraction
ANTHROPIC_API_KEY=sk-ant-...

# Required for seats.aero integration  
SEATS_AERO_API_KEY=pro_...

# Optional: Override cache TTLs
TRANSFER_DATA_MEMORY_TTL_HOURS=1
TRANSFER_DATA_FILE_TTL_DAYS=7
TRANSFER_BONUS_TTL_HOURS=24
```

---

## Implementation Timeline

| Phase | Effort | Dependencies | Priority |
|-------|--------|--------------|----------|
| Phase 1: TransferDataService | 1-2 days | None | High |
| Phase 2: Web Scraping | 2-3 days | Phase 1 | High |
| Phase 3: Bonus Tracking | 1-2 days | Phase 1 | High |
| Phase 4: AI Extraction | 1-2 days | Phase 1, Anthropic API | Medium |
| Phase 5: Seats.aero | 1-2 days | Seats.aero subscription | Low |
| Testing & Monitoring | 1-2 days | All phases | High |

**Total estimated effort: 8-13 days**
