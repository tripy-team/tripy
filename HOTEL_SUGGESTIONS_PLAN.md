# Hotel Suggestions Feature — Implementation Plan

_Author: Claude · Date: 2026-06-26_

## 0. TL;DR

The hotel recommendation pipeline **already exists end-to-end** in this codebase,
backed by a `MockHotelProvider`. Stay-window derivation, budget allocation,
points-vs-cash evaluation, client-preference ranking, and the frontend
`HotelRecommendationCard` are all built. The real deliverable is:

1. **A live `RoomsAeroHotelProvider`** implementing the existing `HotelProvider`
   protocol (`tripy/backend/src/services/hotel_recommendation_service.py:204`).
2. **A normalization layer** mapping the provider's raw rooms/award data into the
   existing `HotelRecommendation` model (`tripy/backend/src/agents/models.py:331`).
3. **Config, caching, and rate-limit handling** for the seats.aero key.
4. **A multi-candidate ("top-3 categorized") suggestion layer** mirroring the
   flight `recommendation_engine.py`, since the current hotel path returns one
   best pick per window rather than a categorized set.

Because the scoring/budget/points machinery is done, the bulk of the effort is
the provider adapter + resolving two blockers below.

---

## 1. Blockers / open questions (resolve BEFORE coding)

These are genuine risks, not formalities. Both came directly from the seats.aero docs.

### 1.1 There is no documented public rooms.aero / hotel API
The seats.aero Partner API (`developers.seats.aero`) publicly documents **flight
award endpoints only**: Bulk Availability, Cached Search, Live Search, Get Trips.
rooms.aero is a *consumer web product* bundled with Pro — no hotel endpoint
appears in the developer reference or `llms.txt`.

**Assumption being made by the request:** "the Pro key also works with rooms.aero."
This is **unverified**. Three possible realities:
- (a) An undocumented hotel endpoint exists on the same Partner API and accepts the
  same `Partner-Authorization` header. (Best case — direct adapter.)
- (b) rooms.aero has its own API gated behind a separate commercial agreement.
- (c) No programmatic hotel access exists; data must come from another vendor.

**Action:** Before building, confirm (a) by either (i) emailing seats.aero
support for the hotel API contract, or (ii) inspecting authenticated rooms.aero
network traffic to discover the internal endpoint + auth. **Do not hard-code
guessed endpoints.** Design the provider so the endpoint/parse logic is the only
thing that changes once the contract is known.

### 1.2 Commercial-use restriction
Pro API access is documented as **"non-commercial, personal use,"** 1,000
calls/day, with **commercial/production use requiring explicit written approval**
and Live Search restricted to approved partners. TripsHacker is a commercial
advisor product (clients, advisors, bookings).

**Action:** Flag to product owner. We likely need a commercial agreement with
seats.aero before shipping. The implementation can proceed behind a feature flag
in non-production, but **do not enable in production without written approval.**

### 1.3 Fallback strategy
Given 1.1/1.2, the provider layer must be **vendor-agnostic** so we can drop in
an alternative hotel source (SerpAPI Hotels, Amadeus Hotel Search, Booking.com
affiliate, or the existing `award_pricing` self-hosted engine which already
claims hotel support) without touching the scoring pipeline. The `HotelProvider`
protocol already gives us this seam — keep it clean.

---

## 2. Assumptions

### 2.1 What people look for in hotels (ranking dimensions)
Ordered by how the engine should weight them, and all derivable from existing
intake fields (`preferredAccommodationBrands`, `accommodationDealbreakers`,
`desiredExperiences`, plus `ClientPreference.hotel*`):

1. **Total trip cost fit** — cash price (+ taxes/resort fees) or points cost must
   fit the *remaining* budget after flights. This is the hard constraint.
2. **Location** — proximity to the reason for travel (city center, conference,
   beach, the airport for a layover). Biggest driver of real-world satisfaction.
3. **Loyalty / points value** — redemption value (cents-per-point) and whether
   the stay uses a chain the client already has status/points with.
4. **Quality signal** — star level + guest rating (treated together; a 4★ with a
   4.7 rating can beat a 5★ with 4.1).
5. **Brand preference / dealbreakers** — preferred chains (soft boost), avoided
   chains (soft penalty), hard dealbreakers (e.g. "no motels," "must have
   kitchen") become filters.
6. **Amenities & trip-purpose fit** — pool, breakfast, gym, kid-friendly,
   business center, pet-friendly, accessibility needs (the last is a hard filter
   when stated).
7. **Cancellation flexibility** — refundable vs non-refundable, surfaced as a
   risk note rather than a score driver.

> Per existing memory: **do not auto-suggest specific brands on preferred/avoid
> fields** — treat brand inputs as client-provided, not system-recommended.

### 2.2 Operating assumptions
- **One stay window per destination leg.** Reuse `derive_stay_windows_from_trip`
  as-is; do not re-derive dates.
- **Budget is split after flights.** Hotels consume the *remaining* cash budget,
  allocated per-window by nights × rooms (`_allocate_cash_budget` already does
  this). Hotels never block the flight itinerary — failures are logged & skipped.
- **2 travelers per room** unless rooming prefs say otherwise (`estimate_room_count`).
- **Points are per-chain.** Balances keyed by chain via `_CHAIN_PROGRAM_ALIASES`
  (Marriott/Hilton/Hyatt/IHG). Extend aliases as new programs appear.
- **Prefer points only when redemption clears ≥ 1.0 cpp** (`_MIN_POINTS_CPP`) OR
  cash wouldn't fit — keeps cash free for flights/experiences.
- **Resort fees / taxes are part of "cash price."** If the API returns base-only,
  estimate taxes; never show a price the client can't actually book at.

---

## 3. How suggestions are generated, rated, and constrained

### 3.1 Pipeline (existing, reused)
```
trip → derive_stay_windows_from_trip()          # per-destination windows
     → _allocate_cash_budget()                  # remaining cash split per window
     → provider.recommend(window, cash_budget, user_points)   # ← NEW live provider
     → _evaluate()                              # points-vs-cash + fits_budget
     → _apply_client_preferences()              # soft rank + deviation notes
     → HotelRecommendation[]                    # → frontend cards
```

### 3.2 Rating model (extend the current single-pick into a categorized top-3)
The flight side returns three labeled options (`recommendation_engine.py:220`):
**Best Overall / Lowest Cost / Best Experience**. Mirror that for hotels so the
advisor gets a comparison, not a single answer:

- **Best Value** — minimizes effective out-of-pocket (cash, or points valued at
  their cpp), subject to fitting budget.
- **Best Points Redemption** — maximizes cents-per-point; only appears when the
  client has enough balance and cpp ≥ threshold.
- **Best Stay** — maximizes a quality score (star × rating × amenity match ×
  location), subject to fitting budget.

**Composite score (per candidate), 0–1, weighted by the client's `budget_style`**
(reuse the flight weights: budget 70/30 cost/quality → ultra-premium 15/85):
```
cost_score    = 1 - (effective_oop / per_window_budget_ceiling)   # clamp [0,1]
quality_score = 0.45*star_norm + 0.35*rating_norm + 0.20*amenity_match
points_score  = clamp(cpp / target_cpp, 0, 1)                     # only if feasible
composite     = w_cost*cost_score + w_quality*quality_score + w_points*points_score
```
- **Hard constraints (filter, not score):** dealbreakers, accessibility needs,
  max nightly rate, fits_budget=false candidates are surfaced only if *no*
  feasible option exists (with an explicit "over budget by $X" note — the code
  already does this at `:440`).
- **Tradeoffs & risks** per option (mirror `_identify_tradeoffs`/`_identify_risks`):
  e.g. "non-refundable," "resort fee not included," "preferred chain unavailable —
  selected best alternative," "uses 80% of remaining hotel budget."

### 3.3 Budget + points enforcement
- `fits_budget` is set in `_evaluate()` by comparing `price_total` to the
  per-window cash allocation and `points_total` to the chain balance.
- Points chosen over cash only when `cpp ≥ _MIN_POINTS_CPP` OR cash doesn't fit.
- The categorized layer never returns an option that breaks a *hard* constraint;
  it ranks within the feasible set and explains every deviation.

---

## 4. Work breakdown

### Phase 1 — Verify contract & config (blocking)
- [ ] Confirm rooms.aero/hotel API contract (§1.1). Capture: base URL, path,
      auth header, request params (city/dates/guests/program), response shape,
      pagination, rate limits.
- [ ] Confirm commercial-use approval status (§1.2).
- [ ] Add `SEATS_AERO_API_KEY` (and `ROOMS_AERO_BASE_URL`, `USE_LIVE_HOTEL_PROVIDER`
      flag) to `.env.example` and config loading. Never log the key.

### Phase 2 — Provider adapter (core)
- [ ] New file `tripy/backend/src/handlers/rooms_aero.py`: async httpx client,
      `Partner-Authorization` header, `X-RateLimit-Remaining` handling, retries
      with backoff, per-request timeout, graceful partial/empty return.
- [ ] **Caching** (critical — 1,000 calls/day cap): cache by
      `(city, check_in, check_out, guests)` via existing `src.utils.cache_layer`,
      TTL ~6–24h. A single optimize run touches many windows × candidates; without
      caching we exhaust quota fast.
- [ ] New `RoomsAeroHotelProvider` implementing `HotelProvider.recommend(...)`:
      call client → normalize each room/award into `HotelRecommendation`
      (map nightly rate, taxes→price_total, loyalty program, points_per_night,
      booking_url, star_level, rating, amenities), then return the full candidate
      list (let the existing `_evaluate`/ranking pick the winner).
- [ ] Wire `set_hotel_provider(RoomsAeroHotelProvider())` at startup behind
      `USE_LIVE_HOTEL_PROVIDER`; default off → keeps `MockHotelProvider`.

### Phase 3 — Categorized suggestions (UX parity with flights)
- [ ] New `tripy/backend/src/services/hotel_suggestion_engine.py` mirroring
      `recommendation_engine.generate_top_3`: take candidates per window, return
      `CategorizedHotelSuggestion[]` (Best Value / Best Points / Best Stay) with
      tradeoffs, risks, why_this_option, score.
- [ ] Add models `HotelPreferenceRequest` and `CategorizedHotelSuggestion` to
      `tripy/backend/src/agents/models.py`.
- [ ] Extend the optimize request/response (`routes/optimize.py`) to carry
      `hotel_budget` / `hotel_preferences` and return categorized hotels per
      window. Keep hotels optional so flight-only flows are unchanged.

### Phase 4 — Frontend
- [ ] Extend `HotelRecommendationCard.tsx` (or add `HotelSuggestionsCard.tsx`) to
      render the 3 categories with comparison badges (value / points / stay),
      budget-fit badge, cpp, deviation notes.
- [ ] Add hotel preference fields to the intake/preference UI (star min, preferred
      chains, avoid chains, amenities, max nightly rate, accessibility) — these map
      straight onto the existing `ClientPreference` shape. **No brand
      auto-suggestions on the preferred/avoid inputs.**
- [ ] Add `searchHotels` / `suggestHotels` methods to `frontend/src/lib/api-client.ts`.

### Phase 5 — Testing & safety
- [ ] Unit tests for `RoomsAeroHotelProvider` normalization against a captured
      sample response (add a `rooms_aero_response.json` fixture, mirroring
      `awardtool_response.json`).
- [ ] Dummy/offline mode (`USE_HOTEL_DUMMY_DATA`) like the awardtool dummy, so CI
      and local dev never hit the live API or burn quota.
- [ ] Tests for budget/points enforcement edge cases: nothing fits, points-only
      fits, cash-only fits, multi-window allocation.
- [ ] Rate-limit guard: stop calling and degrade to cached/dummy when
      `X-RateLimit-Remaining` is near zero; log it (no silent truncation).

---

## 5. Files touched (map)

| Concern | File | Action |
|---|---|---|
| Live client | `backend/src/handlers/rooms_aero.py` | **new** |
| Provider | `backend/src/services/hotel_recommendation_service.py:453` | swap provider behind flag |
| Suggestion layer | `backend/src/services/hotel_suggestion_engine.py` | **new** |
| Models | `backend/src/agents/models.py:331` | add `HotelPreferenceRequest`, `CategorizedHotelSuggestion` |
| Routes | `backend/src/routes/optimize.py`, `backend/src/app.py:4431` | extend with hotel suggest |
| Config | `.env.example`, config loader | add key + flags |
| Cache | `backend/src/utils/cache_layer` | reuse for hotel responses |
| Frontend cards | `frontend/src/components/HotelRecommendationCard.tsx` | extend to categorized |
| Frontend prefs | intake form + `PreferenceProfile.tsx` | add hotel pref fields |
| API client | `frontend/src/lib/api-client.ts` | add hotel methods |
| Tests/fixtures | `backend/.../tests`, `rooms_aero_response.json` | **new** |

---

## 6. Decisions (LOCKED — 2026-06-26)
1. **Proceed behind a flag.** Build the full pipeline now, gated by
   `USE_LIVE_HOTEL_PROVIDER` (off in prod). Verify the rooms.aero contract +
   commercial approval in parallel; **do not enable prod until written approval.**
2. **Fallback = in-repo `award_pricing` hotel engine** if rooms.aero has no usable
   API. No new vendor/key; the provider adapter targets `award_pricing` so the
   `HotelProvider` seam stays the swap point.
3. **Categorized top-3** (Best Value / Best Points / Best Stay), matching the flight
   recommendation UX (Phase 3 is in scope for v1, not deferred).

## 7. Execution order (given the decisions above)
1. **Phase 1 config + flags** — `SEATS_AERO_API_KEY`, `ROOMS_AERO_BASE_URL`,
   `USE_LIVE_HOTEL_PROVIDER` (default off). In parallel: chase the rooms.aero
   contract + commercial approval.
2. **Phase 3 categorized layer first** — `hotel_suggestion_engine.py` +
   `CategorizedHotelSuggestion` model. It's vendor-independent and testable
   against `MockHotelProvider` today, de-risking the UX before any live API.
3. **Phase 2 provider** — build `RoomsAeroHotelProvider`; if the contract doesn't
   pan out, point the same adapter at `award_pricing` (fallback) with no change to
   scoring.
4. **Phase 4 frontend** + **Phase 5 tests/dummy mode**.
