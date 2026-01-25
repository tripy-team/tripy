# Hardcoded Data Analysis: Transfer Strategy Implementation

## Executive Summary

This document analyzes the hardcoded data in Tripy's transfer strategy implementation, categorizing each data type by whether it **must** remain hardcoded, **should** be dynamic, or **could** be dynamic with trade-offs.

---

## 1. Current Hardcoded Data Inventory

### 1.1 TRANSFER_GRAPH (backend/src/agents/config.py)

| Field | Example | Currently Hardcoded |
|-------|---------|---------------------|
| Bank programs | "Chase UR", "Amex MR" | Yes |
| Transfer partners (airlines) | ["UA", "AA", "BA", ...] | Yes |
| Transfer partners (hotels) | ["HYATT", "MAR", "HH"] | Yes |
| Transfer ratios | {"UA": 1.0, "HH": 2.0} | Yes |
| Transfer times | {"UA": "Instant"} | Yes |
| Portal URLs | "https://ultimaterewardspoints.chase.com" | Yes |

### 1.2 BANK_METADATA (backend/src/agents/group_allocator.py)

| Field | Example | Currently Hardcoded |
|-------|---------|---------------------|
| Display name | "Chase Ultimate Rewards" | Yes |
| Portal URL | "https://ultimaterewardspoints.chase.com" | Yes |
| Default transfer time | "Instant" | Yes |

### 1.3 PROGRAM_METADATA (backend/src/agents/group_allocator.py)

| Field | Example | Currently Hardcoded |
|-------|---------|---------------------|
| Program name | "United MileagePlus" | Yes |
| Program type | "airline" or "hotel" | Yes |
| Booking URL | "https://www.united.com" | Yes |

### 1.4 AIRLINE_PROGRAMS (backend/src/agents/config.py)

| Field | Example | Currently Hardcoded |
|-------|---------|---------------------|
| Program name | "United MileagePlus" | Yes |
| Alliance | "Star Alliance" | Yes |
| High surcharge flag | True/False | Yes |

### 1.5 HOTEL_PROGRAMS (backend/src/agents/config.py)

| Field | Example | Currently Hardcoded |
|-------|---------|---------------------|
| Program name | "Hilton Honors" | Yes |
| Typical CPP | 0.5 | Yes |
| Transfer partners | ["Amex MR"] | Yes |

---

## 2. Analysis: What MUST Be Hardcoded

### 2.1 Bank/Issuer Identifiers
**Verdict: MUST be hardcoded**

The list of credit card issuers with transferable points is inherently limited and changes extremely rarely (maybe 1 new program every 2-3 years):
- Chase Ultimate Rewards
- Amex Membership Rewards
- Citi ThankYou Points
- Capital One Miles
- Bilt Rewards
- Wells Fargo Rewards (minor)

**Rationale:** No API exists for this. New banks entering the transferable points space is a major industry event that would warrant a code deployment anyway.

### 2.2 Program Type Classification
**Verdict: MUST be hardcoded**

Whether "UA" is an airline or "HH" is a hotel is fundamental classification that doesn't change.

### 2.3 Base Booking URLs
**Verdict: SHOULD be hardcoded**

URLs like `https://www.united.com` are stable. While they could theoretically change, they haven't in decades. Hardcoding is appropriate.

---

## 3. Analysis: What SHOULD Be Dynamic

### 3.1 Transfer Partnerships (Which banks transfer to which programs)

**Current state:** Hardcoded lists like `"Chase UR": { "airlines": ["UA", "AA", "BA", ...] }`

**Change frequency:** 
- New partnerships: 2-4 per year per bank
- Partnership endings: Rare but impactful (e.g., Bilt/American Airlines ended June 2024)

**Available data sources:**
1. **AwardWallet Credit Card API** - Provides transfer partner data in JSON format
   - Endpoint: `/cards` returns earning categories
   - Requires API key (contact for access)
   
2. **Manual scraping** of issuer pages:
   - Chase: https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points
   - Amex: https://global.americanexpress.com/rewards
   
3. **Community-maintained databases:**
   - transferpartnertool.com
   - pointsnav.com/point-transfer-guide

**Recommendation:** Implement a **hybrid approach**:
```python
# Keep hardcoded as fallback
TRANSFER_GRAPH_FALLBACK = { ... current hardcoded values ... }

# Fetch fresh data on startup or periodically
async def refresh_transfer_partners():
    try:
        fresh_data = await fetch_from_api_or_scrape()
        return merge_with_fallback(fresh_data, TRANSFER_GRAPH_FALLBACK)
    except:
        return TRANSFER_GRAPH_FALLBACK
```

### 3.2 Transfer Ratios

**Current state:** Hardcoded like `{"UA": 1.0, "HH": 2.0}`

**Change frequency:**
- Base ratios: Almost never change (1:1 for airlines, 1:2 for Amex→Hilton)
- Bonus ratios: Change frequently (promotions every few weeks)

**Dynamic data needed:**
- **Transfer bonus promotions** are temporary (days to weeks)
- As of January 2025, examples include:
  - Chase → IHG: 70% bonus (1:1.7) through Jan 15, 2026
  - Chase → Marriott: 70% bonus through Nov 30, 2025
  - Amex → Virgin Atlantic: 40% bonus through Dec 31, 2025

**Available data sources:**
1. **Web scraping** from:
   - NerdWallet: https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses
   - ThePointsGuy: https://thepointsguy.com/guide/best-current-credit-card-bonus-transfer-promotions/
   
2. **No official APIs exist** for transfer bonuses

**Recommendation:** 
- Keep **base ratios hardcoded** (stable)
- Add **optional bonus tracking** via scheduled scraping job:

```python
class TransferRatio:
    base: float = 1.0
    bonus: Optional[float] = None
    bonus_expires: Optional[datetime] = None
    
    @property
    def effective_ratio(self) -> float:
        if self.bonus and self.bonus_expires and datetime.now() < self.bonus_expires:
            return self.bonus
        return self.base
```

### 3.3 Transfer Times

**Current state:** Hardcoded like `{"UA": "Instant", "MAR": "1-2 days"}`

**Change frequency:** Rarely changes, but varies by specific transfer

**Best available data (from research):**

| Bank | Partner | Actual Time |
|------|---------|-------------|
| Chase UR | United | Instant |
| Chase UR | Marriott | 1-2 days |
| Amex MR | Delta | 1-2 days |
| Amex MR | Hilton | 24 hours |
| Citi TYP | Air France | Instant |
| Capital One | Most | Instant |
| Bilt | United | Under 60 seconds |
| Bilt | Marriott | Up to 48 hours |

**Recommendation:** 
- **Keep hardcoded** - transfer times are stable enough
- Update manually when user reports indicate changes
- Consider adding "Expected" qualifier in UI

---

## 4. Analysis: What COULD Be Dynamic (With Trade-offs)

### 4.1 Airline Alliance Memberships

**Current state:** Hardcoded in AIRLINE_PROGRAMS

**Change frequency:** Very rare (maybe 1 change every 2-3 years)

**Recent changes:**
- Virgin Atlantic joined SkyTeam (2024)
- Saudi Arabian Airlines joined SkyTeam (2023)

**Available sources:**
- Star Alliance: https://www.staralliance.com/en/members (25 members)
- oneworld: https://www.oneworld.com/members (15 members)  
- SkyTeam: https://www.skyteam.com/en/about/fact-sheet (18 members)

**Recommendation:** **Keep hardcoded** - changes are rare and high-impact enough to warrant code review.

### 4.2 Program Display Names

**Current state:** Hardcoded like `"UA": "United MileagePlus"`

**Change frequency:** Extremely rare (programs rebrand maybe once per decade)

**Recommendation:** **Keep hardcoded** - not worth the complexity of dynamic fetching.

### 4.3 CPP (Cents Per Point) Valuations

**Current state:** Hardcoded in HOTEL_PROGRAMS like `"typical_cpp": 0.5`

**Change frequency:** Fluctuates based on award chart changes and redemption values

**This SHOULD be dynamic** because:
- Hotel award charts change annually
- Airline dynamic pricing means CPP varies by redemption
- Users make decisions based on CPP comparisons

**Potential approach using AI:**

```python
async def estimate_program_cpp(program: str) -> float:
    """
    Use Claude/GPT to analyze recent redemptions and estimate CPP.
    """
    prompt = f"""
    Based on current award charts and typical redemptions for {program},
    what is a reasonable cents-per-point (CPP) valuation?
    
    Consider:
    - Economy vs premium cabin redemptions
    - Peak vs off-peak
    - Recent devaluations
    
    Return only a number (e.g., 1.5)
    """
    response = await anthropic_client.messages.create(
        model="claude-sonnet-4-20250514",
        messages=[{"role": "user", "content": prompt}]
    )
    return float(response.content[0].text)
```

---

## 5. External APIs Available

### 5.1 Seats.aero API (Award Flight Search)

**Access:** Pro subscription ($9.99/month) + API key
**Limits:** 1,000 calls/day
**Data available:**
- Cached award availability
- Routes and trips
- Bulk availability queries

**NOT available to non-commercial users:**
- Live search (real-time queries)

**Use case for Tripy:** Could supplement award flight searches but requires paid subscription.

```python
# Example seats.aero API call
headers = {"Partner-Authorization": "pro_xxxxxxxxxxxxxxxxxxxxx"}
response = requests.get(
    "https://api.seats.aero/v1/cached-search",
    headers=headers,
    params={"origin": "JFK", "destination": "LHR", "cabin": "business"}
)
```

### 5.2 AwardWallet APIs

**Credit Card Bonus API:**
- Returns category bonuses per card
- Includes multipliers and earning descriptions

**Loyalty API (Web Parsing):**
- Retrieves loyalty account balances
- Requires user authorization

**Contact:** Required for API credentials

### 5.3 Point.me (No Public API)

- Award flight aggregator
- No documented public API
- Would require partnership

### 5.4 AwardTool (No Public API)

- Real-time award search across 27 programs
- No public API documented
- Focuses on consumer interface

---

## 6. Recommended Implementation Strategy

### 6.1 Phase 1: Keep Hardcoded (Current State) ✓

All data remains hardcoded with well-documented constants. This is **acceptable** for launch because:
- Transfer partnerships are fairly stable
- Base ratios rarely change
- URLs are stable
- Manual updates are manageable

### 6.2 Phase 2: Add Refresh Capability

Implement a data refresh system without breaking the hardcoded fallback:

```python
# backend/src/services/transfer_data_service.py

import json
from datetime import datetime, timedelta
from pathlib import Path

class TransferDataService:
    CACHE_FILE = Path("data/transfer_partners.json")
    CACHE_TTL = timedelta(days=7)
    
    def __init__(self):
        self._cache = None
        self._cache_time = None
    
    def get_transfer_graph(self) -> dict:
        """Get transfer graph with fresh data if available."""
        if self._is_cache_valid():
            return self._cache
        
        # Try to load from cache file
        if self.CACHE_FILE.exists():
            try:
                data = json.loads(self.CACHE_FILE.read_text())
                if self._is_data_fresh(data):
                    self._cache = data["graph"]
                    return self._cache
            except:
                pass
        
        # Fall back to hardcoded
        from .config import TRANSFER_GRAPH
        return TRANSFER_GRAPH
    
    async def refresh_from_sources(self):
        """Manually triggered refresh from external sources."""
        # Implementation would scrape or call APIs
        pass
```

### 6.3 Phase 3: Add Transfer Bonus Tracking

Create a separate service for tracking temporary transfer bonuses:

```python
# backend/src/services/transfer_bonus_service.py

@dataclass
class TransferBonus:
    bank: str
    partner: str
    bonus_ratio: float  # e.g., 1.3 for 30% bonus
    expires: datetime
    source_url: str

class TransferBonusService:
    """Track temporary transfer bonus promotions."""
    
    async def scrape_current_bonuses(self) -> list[TransferBonus]:
        """Scrape NerdWallet/TPG for current bonuses."""
        # Could use BeautifulSoup or AI extraction
        pass
    
    def get_effective_ratio(self, bank: str, partner: str) -> float:
        """Get current effective ratio including any bonus."""
        base_ratio = TRANSFER_GRAPH[bank]["ratios"].get(partner, 1.0)
        bonus = self._get_active_bonus(bank, partner)
        if bonus and bonus.expires > datetime.now():
            return bonus.bonus_ratio
        return base_ratio
```

### 6.4 Phase 4: AI-Assisted Updates (Optional)

Use Claude/GPT to parse unstructured sources and update data:

```python
async def ai_extract_transfer_partners(html: str) -> dict:
    """Use AI to extract transfer partner data from webpage HTML."""
    prompt = f"""
    Extract credit card transfer partner information from this HTML.
    Return JSON with structure:
    {{
        "partners": [
            {{"program_code": "UA", "program_name": "United", "ratio": 1.0, "time": "Instant"}}
        ]
    }}
    
    HTML:
    {html[:10000]}
    """
    response = await anthropic_client.messages.create(
        model="claude-sonnet-4-20250514",
        messages=[{"role": "user", "content": prompt}]
    )
    return json.loads(response.content[0].text)
```

---

## 7. Data Update Frequency Recommendations

| Data Type | Update Frequency | Method |
|-----------|------------------|--------|
| Bank list | Never (code change for new bank) | Hardcoded |
| Transfer partnerships | Monthly or on-demand | Scraping + AI |
| Base transfer ratios | Quarterly | Manual review |
| Transfer bonuses | Daily or on-demand | Scraping |
| Transfer times | Quarterly | Manual review |
| Program names | Yearly | Manual review |
| Booking URLs | Yearly | Manual review |
| Alliance memberships | Yearly | Manual review |
| CPP valuations | Monthly | AI-assisted |

---

## 8. Cost-Benefit Analysis

### 8.1 Keeping Everything Hardcoded

**Pros:**
- Zero external dependencies
- No API costs
- Guaranteed availability
- Simple deployment

**Cons:**
- Data can become stale
- Manual updates required
- May miss transfer bonuses

**Verdict:** Acceptable for MVP and small-scale use.

### 8.2 Adding Dynamic Refresh

**Pros:**
- Fresher data
- Can capture transfer bonuses
- Better user experience

**Cons:**
- Added complexity
- Potential failure points
- Scraping may break

**Cost estimate:**
- Seats.aero API: $9.99/month
- Claude API for extraction: ~$10/month (estimated)
- Development time: 2-3 days

**Verdict:** Worth implementing for production scale.

---

## 9. Conclusion

### Immediate Actions (No Code Changes Needed)
1. **Document** the current hardcoded values and their sources
2. **Create** a tracking spreadsheet for manual updates
3. **Monitor** ThePointsGuy/NerdWallet for partnership changes

### Short-term Improvements
1. **Add** a TransferDataService with cache + fallback pattern
2. **Implement** transfer bonus tracking via scheduled scraping
3. **Create** an admin endpoint to trigger manual refresh

### Long-term Vision
1. **Integrate** with Seats.aero API for award availability
2. **Build** AI-powered data extraction for unstructured sources
3. **Consider** AwardWallet API partnership for loyalty data

---

## Appendix A: Complete Current Transfer Partner Data (January 2025)

### Chase Ultimate Rewards
- **Airlines (1:1):** United, Southwest, British Airways, Air France/KLM, Virgin Atlantic, Singapore, Iberia, Aer Lingus, Emirates, JetBlue, Air Canada Aeroplan
- **Hotels (1:1):** World of Hyatt, Marriott Bonvoy, IHG One Rewards
- **Transfer time:** Most instant, Marriott 1-2 days

### Amex Membership Rewards
- **Airlines (1:1 unless noted):** Delta, British Airways, Air France/KLM, ANA, Virgin Atlantic, Singapore, Emirates, JAL, Aeroplan, Avianca, Cathay Pacific, Etihad, Hawaiian, Iberia, JetBlue, Qantas, Qatar
- **Hotels:** Hilton (1:2), Marriott (1:1), Choice
- **Transfer time:** Delta 1-2 days, Hilton 24h, most others instant

### Citi ThankYou Points
- **Airlines (1:1):** Avianca LifeMiles, Qatar, Singapore, Turkish, Virgin Atlantic, Air France/KLM, Cathay Pacific, Emirates, Etihad, EVA Air, JetBlue, Qantas, Thai Airways
- **Hotels:** Choice, Wyndham
- **Transfer time:** Air France/JetBlue instant, others 24-48h

### Capital One Miles
- **Airlines (1:1):** Air France/KLM, British Airways, Turkish, Avianca, Qantas, TAP, Cathay, Emirates, Etihad, EVA, Finnair, JAL, JetBlue, Qatar, Singapore, Virgin Red, Aeromexico, Air Canada
- **Hotels:** Accor, Choice, Wyndham, I Prefer
- **Transfer time:** Most instant, some 24-36h

### Bilt Rewards
- **Airlines (1:1):** United, Air France/KLM, British Airways, Virgin Atlantic, Turkish, Iberia, Avianca, Alaska, Cathay, Emirates, JAL, Southwest, Etihad, Spirit, Aeroplan
- **Hotels:** World of Hyatt, IHG, Marriott, Accor, Hilton
- **Transfer time:** Most instant, Marriott up to 48h

---

## Appendix B: Useful URLs for Manual Updates

| Source | URL | Data Type |
|--------|-----|-----------|
| NerdWallet Transfer Bonuses | https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses | Current promotions |
| ThePointsGuy Chase | https://thepointsguy.com/guide/chase-transfer-partners/ | Chase partnerships |
| ThePointsGuy Amex | https://thepointsguy.com/guide/amex-membership-rewards-transfer-partners/ | Amex partnerships |
| Chase Official | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points | Official list |
| Amex Official | https://global.americanexpress.com/rewards | Official portal |
| Upgraded Points Bilt | https://upgradedpoints.com/news/bilt-rewards-adds-united-cathay-pacific-transfer-partners/ | Bilt updates |
