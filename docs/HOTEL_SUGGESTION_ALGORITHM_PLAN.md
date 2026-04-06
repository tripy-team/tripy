# Hotel Suggestion Algorithm: Implementation Plan

This document outlines the implementation plan for a hotel suggestion algorithm that mirrors the existing flight search system (`flight-search.ts`). The algorithm will fetch real hotel data from multiple sources, then use AI to score and rank each option based on client preferences, loyalty portfolio, and trip context.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Architecture Overview](#architecture-overview)
4. [Phase 1 — Hotel Data Fetching](#phase-1--hotel-data-fetching)
5. [Phase 2 — AI Scoring Engine](#phase-2--ai-scoring-engine)
6. [Phase 3 — Integration with Trip Generation](#phase-3--integration-with-trip-generation)
7. [Phase 4 — Frontend: Hotels Tab](#phase-4--frontend-hotels-tab)
8. [Phase 5 — Caching, Rate Limits & Edge Cases](#phase-5--caching-rate-limits--edge-cases)
9. [Data Models](#data-models)
10. [API Contract](#api-contract)
11. [Testing Strategy](#testing-strategy)
12. [Rollout Plan](#rollout-plan)

---

## Executive Summary

### Goal

Build a hotel suggestion system that:
- Fetches a **large pool of real hotel options** (cash pricing via SerpAPI Google Hotels + award/points pricing via AwardTool or program-specific lookups)
- Uses **AI (GPT-4o-mini) to score every hotel** on a 0–100 scale across multiple dimensions (value, location fit, loyalty optimization, client preferences)
- Returns a **ranked list** attached to the trip, similar to how `travelerFlights` are attached today

### How This Mirrors the Flights Algorithm

| Aspect | Flights (`flight-search.ts`) | Hotels (Proposed) |
|--------|------------------------------|-------------------|
| Cash pricing | SerpAPI `google_flights` | SerpAPI `google_hotels` |
| Award pricing | Seats.aero partner API | AwardTool hotel search (backend) |
| Deduplication | By route key | By hotel property + date range |
| Parallel fetch | Cash + Award per route | Cash + Award per stay window |
| Sorting | Award: miles ascending | AI score descending |
| AI involvement | None (raw data) | Score + rationale per hotel |
| Output location | `travelerFlights` on ItineraryJob | `travelerHotels` on ItineraryJob |

### Key Difference from the ILP Plan

The existing `HOTEL_ILP_IMPLEMENTATION_PLAN.md` focuses on **joint flight+hotel optimization** inside the backend ILP solver for points allocation. This plan focuses on the **suggestion/discovery layer** — fetching, scoring, and surfacing hotel options to the advisor in the Next.js frontend, analogous to how `flight-search.ts` works for flights. The two systems are complementary: this plan feeds hotel candidates that could later flow into the ILP optimizer.

---

## Current State Analysis

### What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| `HotelRecommendation` type (TS) | `frontend/src/lib/api.ts:2910` | Defined, used by UI card |
| `HotelRecommendation` type (Python) | `backend/src/agents/models.py:301` | Defined, used by mock provider |
| `HotelRecommendationCard` | `frontend/src/components/HotelRecommendationCard.tsx` | Fully built UI component |
| `genHotels()` (AI stub) | `frontend/src/lib/itinerary-ai.ts:425` | Exists but **not called** by `generateItinerary` |
| `MockHotelProvider` | `backend/src/services/hotel_recommendation_service.py` | Returns fake data |
| `get_google_hotels()` | `backend/src/services/serp_api_functions.py:526` | **Working SerpAPI integration** |
| `optimize_hotels_out_of_pocket()` | `backend/src/services/serp_api_functions.py:632` | Merges AwardTool + SerpAPI results |
| Hotel transfer partners | `frontend/src/lib/itinerary-ai.ts` (TRANSFER_PARTNERS) | All bank→hotel mappings defined |
| Stay window derivation | `backend/src/services/hotel_recommendation_service.py` | Working stay window logic |
| Hotel preferences in DB | `ClientPreference.preferredHotelTypes`, `roomPreferences`, `locationPreferences` | Schema exists |
| `ItineraryJob.result` JSON | `frontend/prisma/schema.prisma` | Already stores `travelerFlights`, can store `travelerHotels` |

### Gaps to Fill

1. **No frontend hotel search module** — equivalent of `flight-search.ts` for hotels does not exist
2. **No AI scoring** — existing `genHotels()` asks AI to *invent* hotels, not score real ones
3. **No award hotel search on frontend** — only the backend has AwardTool/SerpAPI hotel integration
4. **No per-hotel score** — the `HotelRecommendation` type lacks a `score` field
5. **`generateItinerary` returns empty `hotels: []`** — no hotel data attached to trip results

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TRIP GENERATION ROUTE                      │
│     POST /api/trip-requests/[id]/generate-itinerary          │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌─────────────┐ ┌──────────┐ ┌────────────────┐
   │ Flight      │ │ Hotel    │ │ AI Itinerary   │
   │ Search      │ │ Search   │ │ (transport,    │
   │ (existing)  │ │ (NEW)    │ │  daily plan)   │
   └──────┬──────┘ └────┬─────┘ └───────┬────────┘
          │              │               │
          │    ┌─────────┴──────────┐    │
          │    │                    │    │
          │    ▼                    ▼    │
          │  SerpAPI            AwardTool│
          │  google_hotels      /Backend │
          │  (cash)             (points) │
          │    │                    │    │
          │    └────────┬──────────┘    │
          │             ▼               │
          │    ┌────────────────┐       │
          │    │ Merge & Dedup  │       │
          │    │ Hotel Options  │       │
          │    └───────┬────────┘       │
          │            ▼                │
          │    ┌────────────────┐       │
          │    │ AI Scoring     │       │
          │    │ (GPT-4o-mini)  │       │
          │    │ Score 0-100    │       │
          │    └───────┬────────┘       │
          │            ▼                │
          │    ┌────────────────┐       │
          │    │ Ranked Hotels  │       │
          │    │ per stay window│       │
          │    └───────┬────────┘       │
          │            │                │
          └────────────┼────────────────┘
                       ▼
              ┌────────────────┐
              │ ItineraryJob   │
              │ .result JSON   │
              │ {              │
              │  travelerFlights│
              │  travelerHotels │ ← NEW
              │  ...           │
              │ }              │
              └────────────────┘
```

---

## Phase 1 — Hotel Data Fetching

### 1A. Create `hotel-search.ts` (Frontend)

Create a new module at `frontend/src/lib/hotel-search.ts` that mirrors the structure of `flight-search.ts`.

**File:** `frontend/src/lib/hotel-search.ts`

#### Types

```typescript
export interface HotelSearchParams {
  destination: string;       // City name or airport code
  checkIn: string;           // YYYY-MM-DD
  checkOut: string;          // YYYY-MM-DD
  adults?: number;
  rooms?: number;
  currency?: string;
  minStars?: number;
  sortBy?: "price" | "rating" | "relevance";
}

export interface CashHotelResult {
  source: "google_hotels";
  name: string;
  propertyToken?: string;
  cashTotal: number | null;
  cashPerNight: number;
  overallRating?: number;
  starRating?: number;
  neighborhood?: string;
  amenities?: string[];
  thumbnailUrl?: string;
  bookingUrl?: string;
}

export interface AwardHotelResult {
  source: "awardtool";
  hotelId: string;
  name: string;
  program: string;           // "HYATT", "MAR", "HH", "IHG"
  programDisplayName: string; // "World of Hyatt", "Marriott Bonvoy", etc.
  pointsPerNight: number;
  pointsTotal: number;
  surcharge: number;         // Taxes/resort fees on award stay
  cashCost?: number;         // Cash price for comparison
  starRating?: number;
  category?: number;         // Award category (1-8)
}

export interface HotelStayGroup {
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  cashOptions: CashHotelResult[];
  awardOptions: AwardHotelResult[];
}

export interface TravelerHotelGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  stays: HotelStayGroup[];
}
```

#### Cash Search: SerpAPI `google_hotels`

```typescript
export async function searchCashHotels(
  params: HotelSearchParams,
): Promise<CashHotelResult[]> {
  // Call SerpAPI with engine=google_hotels
  // Similar pattern to searchCashFlights()
  // Returns up to 20 hotels sorted by price
}
```

Implementation notes:
- Use `engine=google_hotels` with `sort_by=3` (lowest price) via SerpAPI
- Parse `properties` array from response
- Extract: name, price, rating, property_token, images
- Fallback to `serpapi_pagination.ads` if no properties
- 15-second timeout with `AbortSignal.timeout()`

#### Award Search: Call Backend API

The backend already has `optimize_hotels_out_of_pocket()` and `search_hotels()` in `handlers/hotels.py`. Instead of duplicating AwardTool logic on the frontend, call the backend via an internal API route.

```typescript
export async function searchAwardHotels(
  params: HotelSearchParams,
  programs?: string[],
): Promise<AwardHotelResult[]> {
  // POST to backend /api/hotels/search-awards
  // Backend calls AwardTool + formats response
  // Returns award options with points pricing
}
```

#### Combined Per-Traveler Search

```typescript
export interface TravelerHotelSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  stayWindows: {
    destination: string;
    checkIn: string;
    checkOut: string;
  }[];
  hotelPrograms?: string[];  // From loyalty balances
}

export async function searchHotelsForTravelers(
  travelers: TravelerHotelSearchInput[],
): Promise<TravelerHotelGroup[]> {
  // 1. Deduplicate stay windows across travelers
  // 2. Fire ALL searches in parallel (cash + award per window)
  // 3. Assemble results per traveler
}
```

### 1B. Backend Hotel Search Endpoint

**File:** `backend/src/app.py` — add route  
**File:** `backend/src/handlers/hotel_search_handler.py` — new handler

Create a FastAPI endpoint that wraps the existing `search_hotels()` and `get_google_hotels()` functions:

```
POST /api/hotels/search
{
  "destination": "Tokyo",
  "check_in": "2026-03-01",
  "check_out": "2026-03-08",
  "programs": ["HYATT", "MAR", "HH"],
  "guests": 2,
  "rooms": 1
}
```

Response returns both cash and award options in a unified format.

### 1C. Stay Window Derivation (Frontend)

Port the stay-window logic from `hotel_recommendation_service.py` to TypeScript, or compute it from the trip request data already available on the frontend:

- Single destination → one stay window (departure date to return date)
- Multi-city → split by leg dates or evenly divide total duration
- Room count estimated from traveler count (2 per room, rounded up)

---

## Phase 2 — AI Scoring Engine

This is the core differentiator from the flights algorithm. While flights are displayed as raw data (sorted by price/miles), hotels will each receive an **AI-generated score** and **rationale**.

### 2A. Scoring Dimensions

Each hotel is scored on a 0–100 composite scale, built from weighted sub-scores:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| **Value** | 0.25 | Price vs. market average, CPP for award bookings |
| **Location Fit** | 0.20 | Proximity to trip activities, neighborhood quality |
| **Loyalty Optimization** | 0.20 | Points value (CPP), transfer partner availability, elite status benefits |
| **Client Preference Match** | 0.20 | Hotel type, room preferences, brand affinity |
| **Quality & Amenities** | 0.15 | Star rating, guest reviews, amenities match |

### 2B. Scoring Function: `scoreHotels()`

**File:** `frontend/src/lib/hotel-scoring.ts`

```typescript
export interface ScoredHotel {
  // Original data
  hotel: CashHotelResult | MergedHotelResult;
  awardOption?: AwardHotelResult;

  // AI scores
  compositeScore: number;      // 0-100
  valueScore: number;           // 0-100
  locationScore: number;        // 0-100
  loyaltyScore: number;         // 0-100
  preferenceScore: number;      // 0-100
  qualityScore: number;         // 0-100

  // AI rationale
  rationale: string;            // 1-2 sentence explanation
  paymentRecommendation: "points" | "cash" | "mixed";
  highlights: string[];         // 2-3 key selling points

  // Computed fields
  cppValue?: number;            // Cents-per-point if award available
  estimatedSavings?: number;    // $ saved vs. cash if using points
}
```

### 2C. AI Scoring Strategy: Batch Prompt

Rather than making one AI call per hotel (expensive and slow), batch all hotels for a stay window into a **single prompt** and ask the model to score them all at once.

**Prompt structure:**

```
You are a luxury travel advisor scoring hotel options for a client.

TRIP CONTEXT:
- Client: {clientName}
- Destination: {destination}
- Dates: {checkIn} to {checkOut} ({nights} nights)
- Travelers: {travelerCount}
- Budget: ${budgetCash} total / ${budgetPerNight}/night

CLIENT PREFERENCES:
- Hotel types: {preferredHotelTypes}
- Room preferences: {roomPreferences}
- Location preference: {locationPreferences}
- Redemption style: {redemptionStyle}
- Budget sensitivity: {budgetSensitivity}

LOYALTY PORTFOLIO:
{loyaltyBalances with programs and balances}

TRANSFER PARTNERS AVAILABLE:
{relevant bank → hotel program transfer paths}

ACTIVE TRANSFER BONUSES:
{any active bonuses}

HOTEL OPTIONS TO SCORE:
{JSON array of all hotel options with cash + award pricing}

For each hotel, return a JSON object with:
- compositeScore (0-100)
- valueScore (0-100)
- locationScore (0-100)
- loyaltyScore (0-100)
- preferenceScore (0-100)
- qualityScore (0-100)
- rationale (1-2 sentences)
- paymentRecommendation ("points" | "cash" | "mixed")
- highlights (array of 2-3 strings)

Return {"scoredHotels": [...]} as valid JSON.
```

**Cost/Performance estimates:**
- ~20 hotels per stay window → ~2,000 tokens input + ~2,000 tokens output
- GPT-4o-mini at current pricing: ~$0.003 per scoring batch
- Latency: ~2-3 seconds per batch
- For a typical trip (1 destination): 1 AI call for hotels

### 2D. Fallback Heuristic Scoring

If the AI call fails or OPENAI_API_KEY is missing, fall back to a deterministic heuristic scorer:

```typescript
function heuristicScore(hotel: MergedHotelResult, context: ScoringContext): number {
  let score = 50; // Baseline

  // Value: lower price = higher score
  const avgNightlyRate = /* market average for destination */;
  if (hotel.cashPerNight < avgNightlyRate * 0.8) score += 15;
  else if (hotel.cashPerNight < avgNightlyRate) score += 8;
  else if (hotel.cashPerNight > avgNightlyRate * 1.5) score -= 10;

  // Star rating bonus
  if (hotel.starRating >= 5) score += 10;
  else if (hotel.starRating >= 4) score += 5;

  // Guest rating bonus
  if (hotel.overallRating && hotel.overallRating >= 4.5) score += 10;
  else if (hotel.overallRating && hotel.overallRating >= 4.0) score += 5;

  // Loyalty match: hotel program matches client's balances
  if (hotel.awardOption && clientHasBalance(hotel.awardOption.program)) {
    score += 12;
    if (hotel.cppValue && hotel.cppValue >= 1.5) score += 8; // Good CPP
  }

  // Preference match: hotel type matches client preferences
  if (matchesPreferredType(hotel, context.preferences)) score += 10;

  return Math.min(100, Math.max(0, score));
}
```

---

## Phase 3 — Integration with Trip Generation

### 3A. Wire Into `generate-itinerary` Route

**File:** `frontend/src/app/api/trip-requests/[id]/generate-itinerary/route.ts`

Currently the route runs in parallel:
1. `generateItinerary(input)` → AI transportation + daily plan
2. `searchFlightsForTravelers(...)` → live flight data

Add a third parallel call:
3. `searchAndScoreHotelsForTravelers(...)` → live hotel data + AI scores

```typescript
const [itinerary, travelerFlights, travelerHotels] = await Promise.all([
  generateItinerary(input),
  searchFlightsForTravelers(travelers, departureDate, returnDate, cabin),
  searchAndScoreHotelsForTravelers(hotelSearchInputs, scoringContext),
]);

// Attach both to result
const result = {
  ...itinerary,
  travelerFlights,
  travelerHotels,  // NEW
};
```

### 3B. `searchAndScoreHotelsForTravelers()` Orchestrator

**File:** `frontend/src/lib/hotel-search.ts`

This is the top-level function that:
1. Derives stay windows from trip data
2. Calls `searchHotelsForTravelers()` for raw data
3. Calls `scoreHotels()` for AI scoring
4. Returns merged, ranked results

```typescript
export async function searchAndScoreHotelsForTravelers(
  travelers: TravelerHotelSearchInput[],
  context: HotelScoringContext,
): Promise<TravelerHotelGroup[]> {
  // 1. Fetch raw hotel data (parallel cash + award)
  const rawGroups = await searchHotelsForTravelers(travelers);

  // 2. Score each stay window's hotels via AI
  for (const group of rawGroups) {
    for (const stay of group.stays) {
      const merged = mergeHotelOptions(stay.cashOptions, stay.awardOptions);
      const scored = await scoreHotels(merged, context);
      stay.scoredOptions = scored.sort((a, b) => b.compositeScore - a.compositeScore);
    }
  }

  return rawGroups;
}
```

### 3C. Update `ItineraryJob.result` Shape

The `ItineraryJob.result` JSON column already stores arbitrary data. Add `travelerHotels` alongside `travelerFlights`:

```typescript
interface ItineraryJobResult {
  // Existing
  summary: string;
  flights: FlightRecommendation[];
  hotels: HotelRecommendation[];
  transportation: TransportationRecommendation[];
  dailyItinerary: DayPlan[];
  budgetBreakdown: BudgetBreakdown;
  travelerFlights?: TravelerFlightGroup[];

  // NEW
  travelerHotels?: TravelerHotelGroup[];
}
```

No Prisma schema migration needed since `result` is a JSON column.

---

## Phase 4 — Frontend: Hotels Tab

### 4A. Hotels Tab on Trip Detail Page

Reuse and extend the existing `HotelRecommendationCard` component. Add a new "Hotels" tab alongside the existing "Flights" tab.

**New components needed:**

| Component | Purpose |
|-----------|---------|
| `HotelSearchResults.tsx` | Container: groups hotels by stay window, shows ranked list |
| `ScoredHotelCard.tsx` | Extended version of `HotelRecommendationCard` with score badge, rationale, dimension breakdown |
| `HotelScoreBadge.tsx` | Visual score indicator (color-coded 0-100) |
| `HotelFilterBar.tsx` | Filter by: star rating, price range, loyalty program, score threshold |
| `HotelCompareDrawer.tsx` | Side-by-side comparison of 2-3 selected hotels |

### 4B. Score Visualization

Display the composite score prominently on each card:

- **90-100**: Green badge — "Excellent Match"
- **75-89**: Blue badge — "Great Option"
- **60-74**: Yellow badge — "Good Option"
- **Below 60**: Gray badge — "Consider Alternatives"

Show expandable dimension breakdown on click:
```
Overall Score: 87/100
├── Value:              92/100  ████████████████████░░
├── Location Fit:       85/100  █████████████████░░░░░
├── Loyalty Match:      88/100  ██████████████████░░░░
├── Preference Match:   80/100  ████████████████░░░░░░
└── Quality:            90/100  ██████████████████░░░░
```

### 4C. Points vs. Cash Toggle

For hotels with both cash and award pricing, show a toggle to compare:
- **Cash view**: Total price, nightly rate
- **Points view**: Points required, transfer source, CPP value, taxes/fees
- **AI recommendation badge**: "Points Recommended" or "Cash Recommended" based on scoring

---

## Phase 5 — Caching, Rate Limits & Edge Cases

### 5A. Caching Strategy

| Data | Cache Duration | Storage |
|------|---------------|---------|
| SerpAPI hotel results | 1 hour | In-memory (Map) keyed by destination+dates |
| AwardTool results | 30 minutes | In-memory (Map) |
| AI scores | Same as raw data | Computed on fetch, stored with results |
| Full hotel search results | Until trip is regenerated | `ItineraryJob.result` JSON |

Cache key format: `hotel:{destination}:{checkIn}:{checkOut}:{rooms}:{currency}`

### 5B. Rate Limit Handling

- **SerpAPI**: Respect plan limits (typically 5,000 searches/month). Queue hotel searches behind flight searches. One hotel search per stay window.
- **AwardTool**: Rate limit to 2 concurrent requests. Retry with exponential backoff on 429.
- **OpenAI**: Batch scoring minimizes calls (1 per stay window). Retry once on failure, then fall back to heuristic scoring.

### 5C. Edge Cases

| Scenario | Handling |
|----------|----------|
| No hotels found (SerpAPI) | Return empty cash options, rely on award-only results. Show "No cash pricing available" |
| No award availability | Score cash-only. Set loyalty score to 0, adjust composite accordingly |
| Client has no hotel loyalty | Skip award search for hotel programs. Focus scoring on cash value + preferences |
| Very long stay (14+ nights) | Split into SerpAPI queries of 7-night blocks, merge results |
| Multi-city trip | One hotel search per city/stay-window, scored independently |
| API key missing (SerpAPI) | Log warning, skip cash search, use award-only if available |
| API key missing (OpenAI) | Use heuristic scoring fallback |

---

## Data Models

### Merged Hotel Result (Internal)

```typescript
export interface MergedHotelResult {
  // Identity
  hotelId: string;             // propertyToken or awardtool hotel_id
  name: string;
  destination: string;

  // Stay details
  checkIn: string;
  checkOut: string;
  nights: number;

  // Cash pricing
  cashPerNight: number | null;
  cashTotal: number | null;

  // Award pricing (if available)
  awardOption?: {
    program: string;
    programDisplayName: string;
    pointsPerNight: number;
    pointsTotal: number;
    surcharge: number;
    category?: number;
    transferSources: {
      bank: string;
      bankDisplayName: string;
      ratio: number;
      transferTime: string;
    }[];
  };

  // Hotel attributes
  starRating?: number;
  overallRating?: number;
  neighborhood?: string;
  amenities: string[];
  thumbnailUrl?: string;
  bookingUrl?: string;

  // Computed
  cppValue?: number;  // cents-per-point: (cashTotal - surcharge) / pointsTotal * 100
}
```

### Scoring Context

```typescript
export interface HotelScoringContext {
  clientName: string;
  tripTitle: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  travelerCount: number;
  budgetCash?: number;

  // From ClientPreference
  preferences: {
    preferredHotelTypes?: string[];
    roomPreferences?: string[];
    locationPreferences?: string;
    budgetSensitivity?: string;
    redemptionStyle?: string;
  };

  // From ClientLoyaltyBalance
  loyaltyBalances: {
    programName: string;
    programCode: string;
    category: string;
    balance: number;
  }[];

  // From TRANSFER_PARTNERS constant
  transferBonuses?: {
    fromProgram: string;
    toProgram: string;
    bonusPercent: number;
    endsAt: string;
  }[];
}
```

---

## API Contract

### Frontend → Backend: Hotel Search

```
POST /api/hotels/search
```

**Request:**
```json
{
  "destination": "Tokyo",
  "checkIn": "2026-03-01",
  "checkOut": "2026-03-08",
  "guests": 2,
  "rooms": 1,
  "programs": ["HYATT", "MAR", "HH", "IHG"],
  "minStars": 3,
  "sortBy": "price"
}
```

**Response:**
```json
{
  "cashOptions": [
    {
      "source": "google_hotels",
      "name": "Park Hyatt Tokyo",
      "propertyToken": "abc123",
      "cashPerNight": 580,
      "cashTotal": 4060,
      "overallRating": 4.7,
      "starRating": 5,
      "amenities": ["Pool", "Spa", "Fitness Center"]
    }
  ],
  "awardOptions": [
    {
      "source": "awardtool",
      "hotelId": "hyatt-park-tokyo",
      "name": "Park Hyatt Tokyo",
      "program": "HYATT",
      "programDisplayName": "World of Hyatt",
      "pointsPerNight": 25000,
      "pointsTotal": 175000,
      "surcharge": 0,
      "cashCost": 4060,
      "category": 7
    }
  ],
  "searchDurationMs": 2340
}
```

### Internal: AI Scoring

The scoring happens entirely on the frontend via OpenAI API calls (same pattern as `itinerary-ai.ts`). No additional backend endpoint needed.

---

## Testing Strategy

### Unit Tests

| Test | File | What It Verifies |
|------|------|-----------------|
| Stay window derivation | `hotel-search.test.ts` | Single-dest, multi-city, edge dates |
| Cash search parsing | `hotel-search.test.ts` | SerpAPI response → `CashHotelResult[]` |
| Award search parsing | `hotel-search.test.ts` | Backend response → `AwardHotelResult[]` |
| Hotel merging | `hotel-search.test.ts` | Cash + award → `MergedHotelResult` with CPP |
| Heuristic scoring | `hotel-scoring.test.ts` | Score ranges, preference matching, loyalty boost |
| AI prompt construction | `hotel-scoring.test.ts` | Prompt includes all context, valid JSON schema |
| Transfer partner lookup | `hotel-scoring.test.ts` | Correct bank→hotel program mappings |

### Integration Tests

| Test | What It Verifies |
|------|-----------------|
| End-to-end hotel search | SerpAPI + backend → merged results with scores |
| Trip generation with hotels | `generate-itinerary` route returns `travelerHotels` |
| Empty results handling | Graceful degradation when no hotels found |
| Scoring with no loyalty | Hotels scored without points dimension affecting rank |

### Manual QA Scenarios

1. **Luxury trip to Tokyo** — Verify Hyatt/Marriott award options appear, CPP calculated correctly
2. **Budget trip to Cancun** — Verify lower-star hotels scored well on value, cash recommendations dominate
3. **Points-heavy client** — Verify loyalty optimization scores boost hotels bookable via existing balances
4. **No hotel preferences set** — Verify algorithm still produces reasonable rankings without preferences
5. **Multi-city trip (3 cities)** — Verify separate hotel lists per city, each independently scored

---

## Rollout Plan

### Phase 1: Data Fetching (Week 1-2)
- [ ] Create `frontend/src/lib/hotel-search.ts` with types and `searchCashHotels()`
- [ ] Create `backend/src/handlers/hotel_search_handler.py` for award search endpoint
- [ ] Add `POST /api/hotels/search` route to backend
- [ ] Port stay-window derivation to TypeScript utility
- [ ] Implement `searchHotelsForTravelers()` with dedup + parallel fetch
- [ ] Add frontend API wrapper to call backend hotel search

### Phase 2: AI Scoring (Week 2-3)
- [ ] Create `frontend/src/lib/hotel-scoring.ts` with types
- [ ] Implement `mergeHotelOptions()` to combine cash + award data
- [ ] Build AI scoring prompt with full context (preferences, loyalty, trip)
- [ ] Implement `scoreHotels()` using `aiCall()` pattern from `itinerary-ai.ts`
- [ ] Implement `heuristicScore()` fallback
- [ ] Build `searchAndScoreHotelsForTravelers()` orchestrator

### Phase 3: Trip Integration (Week 3-4)
- [ ] Add `searchAndScoreHotelsForTravelers()` to `generate-itinerary` route (parallel with flights)
- [ ] Attach `travelerHotels` to `ItineraryJob.result`
- [ ] Update `GeneratedItinerary` type to include `travelerHotels`
- [ ] Update `generateItinerary()` to populate hotel-related budget fields

### Phase 4: Frontend (Week 4-5)
- [ ] Create `ScoredHotelCard.tsx` with score badge and dimension breakdown
- [ ] Create `HotelSearchResults.tsx` container component
- [ ] Create `HotelScoreBadge.tsx` component
- [ ] Create `HotelFilterBar.tsx` (star rating, price, program, score filters)
- [ ] Add "Hotels" tab to trip detail page
- [ ] Wire up data flow from `ItineraryJob.result.travelerHotels` to UI

### Phase 5: Polish & Edge Cases (Week 5-6)
- [ ] Add caching layer for SerpAPI and AwardTool results
- [ ] Handle rate limits with retry/backoff
- [ ] Handle all edge cases (no results, missing API keys, long stays)
- [ ] Create `HotelCompareDrawer.tsx` for side-by-side comparison
- [ ] Points vs. cash toggle on hotel cards
- [ ] Performance testing (target: <5s total hotel search + scoring)
- [ ] Write unit and integration tests

---

## Files to Create / Modify

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/lib/hotel-search.ts` | Hotel data fetching (SerpAPI + backend) |
| `frontend/src/lib/hotel-scoring.ts` | AI scoring engine + heuristic fallback |
| `backend/src/handlers/hotel_search_handler.py` | Backend hotel search endpoint |
| `frontend/src/components/ScoredHotelCard.tsx` | Hotel card with AI score |
| `frontend/src/components/HotelSearchResults.tsx` | Hotels tab container |
| `frontend/src/components/HotelScoreBadge.tsx` | Score visualization badge |
| `frontend/src/components/HotelFilterBar.tsx` | Filter controls |
| `frontend/src/components/HotelCompareDrawer.tsx` | Comparison drawer |

### Modified Files
| File | Changes |
|------|---------|
| `frontend/src/app/api/trip-requests/[id]/generate-itinerary/route.ts` | Add parallel hotel search + scoring |
| `frontend/src/lib/itinerary-ai.ts` | Update `GeneratedItinerary` type, update `generateItinerary()` |
| `frontend/src/lib/api.ts` | Extend `HotelRecommendation` with score fields |
| `backend/src/app.py` | Register hotel search route |
| Trip detail page component | Add Hotels tab |

---

## Open Questions

1. **SerpAPI budget**: How many hotel searches/month can we afford? This determines whether we search for every trip regeneration or cache more aggressively.
2. **AwardTool hotel coverage**: Which hotel programs does AwardTool support? If limited, we may need to supplement with program-specific APIs (Hyatt API, Marriott API).
3. **Score transparency**: Should we show the raw sub-scores to advisors, or just the composite + rationale? Showing sub-scores helps advisors understand why a hotel ranked where it did.
4. **Real-time vs. batch**: Should hotel scoring happen at trip generation time (batch) or on-demand when the advisor opens the Hotels tab (lazy)?
