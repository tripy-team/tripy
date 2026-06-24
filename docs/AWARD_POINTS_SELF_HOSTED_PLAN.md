# Self-Hosted Award Points Engine — Implementation Plan

**Goal:** Replace the paid AwardTool API as the source of *how many points a flight/hotel
costs* with a self-hosted engine. Constraints set by the user:

- **Accuracy target:** near-exact / bookable (the number we show should match what the
  user actually pays in points at booking).
- **Budget:** **zero paid award APIs.** We may reuse data we *already* pay for (SerpAPI
  cash prices), local charts/formulas, and free scraping. No per-award-search billing.

---

## 0. The honest tension (read this first)

"Near-exact" and "zero paid APIs" pull in opposite directions, and the right architecture
depends on splitting award programs into two regimes:

| Regime | Programs (examples) | Can we be exact for free? | How |
|---|---|---|---|
| **Chart-based (fixed)** | Hyatt (hotels), all Avios airlines (BA / Iberia / Aer Lingus / Qatar / Finnair), Alaska, Air Canada Aeroplan, ANA, Virgin Atlantic | **Yes — exactly.** The published chart *is* the bookable price. | Hard-code the chart once; compute distance/category locally. **$0 forever.** |
| **Dynamic (cash-linked)** | United, Delta SkyMiles, American (dynamic routes), Southwest, JetBlue, Marriott, Hilton, IHG | **Not from a formula.** Points float daily with cash price. | Only two free options: (a) **scrape** the airline/hotel award page → exact but fragile; (b) **derive from cash** (`points ≈ cash ÷ cents-per-point`) → free and instant but an *estimate*, not bookable-exact. |

**Strategic consequence:** We get near-exact-for-free on the *chart-based* programs — which
happen to be the highest-value redemptions Tripy should be recommending anyway. For
*dynamic* programs, "near-exact + free" forces a **scraping** tier (fragile, ToS-sensitive,
needs anti-bot handling), with **cash-derived estimation** as the labeled-lower-confidence
fallback when a scrape fails.

This plan builds the chart layer first (high value, low risk, fully deterministic), then the
cash-derived fallback (free, already-paid data), then the scraping tier last (highest effort
and maintenance).

---

## 1. What exists today (so we don't rebuild it)

- **Live AwardTool call sites** to be displaced:
  - Flights: `search_award_flights_v2()` in
    [backend/src/handlers/awardtool_v2.py](../backend/src/handlers/awardtool_v2.py),
    called from [handlers/flights.py:258](../backend/src/handlers/flights.py); also the v2
    pipeline `fetch_award_options()` in
    [system/itinerary_v2/providers/award_provider.py](../backend/src/system/itinerary_v2/providers/award_provider.py).
  - Hotels: `POST https://www.awardtool-api.com/search_hotel` in
    [handlers/hotels.py:25](../backend/src/handlers/hotels.py).
  - Calendar: [handlers/award_calendar.py](../backend/src/handlers/award_calendar.py).
- **The dummy estimator is already a real heuristic engine**, not a stub:
  [handlers/awardtool_dummy.py](../backend/src/handlers/awardtool_dummy.py) classifies routes
  into 6 distance tiers across ~200 airports, has cabin×route point ranges, surcharge
  multipliers, and hotel city-tier/star pricing. **We promote and refine this rather than
  starting over.**
- **The switch is centralized:** `is_awardtool_dummy_mode()` in
  [config/__init__.py:114](../backend/src/config/__init__.py). One function already gates
  dummy-vs-live everywhere. Our new engine plugs in here.
- **Canonical output shape the optimizer needs** (`AwardOption` in
  [optimization/models_v3.py:97](../backend/src/optimization/models_v3.py)):
  `program`, `miles_required`, `surcharge`, `cabin_or_room_type`, `cash_equivalent`,
  `availability_score`, `is_waitlisted`. Raw rows downstream use
  `award_points` / `surcharge` / `program_code` / `cabin`. **The optimizer is source-agnostic
  — it consumes whatever produces this shape, so we can swap the source with no solver
  changes.**
- **Local data already present:** [config/programs.yml](../backend/src/config/programs.yml)
  has airlines (hubs, surcharge multipliers, alliance, regions), hotels (per-night ranges),
  banks + transfer ratios. Missing: actual award charts.
- **Cash prices we already pay for:** SerpAPI Google Flights/Hotels via
  [services/serp_api_functions.py](../backend/src/services/serp_api_functions.py) — the input
  for cash-derived estimation, **already in the request flow at no extra cost.**
- **A working scraping pattern to copy:**
  [services/transfer_bonus_scraper.py](../backend/src/services/transfer_bonus_scraper.py)
  (httpx + BeautifulSoup + in-process daily-refresh cache + thread lock).
- **A DynamoDB award cache already exists:** `cache_award_get/set` in
  [system/itinerary_v2/cache.py](../backend/src/system/itinerary_v2/cache.py).

---

## 2. Target architecture: a layered AwardPricingEngine

Introduce one new module, `backend/src/award_pricing/`, exposing a single interface that
mirrors the current AwardTool output contract so it drops into existing call sites.

```
search_award_flights(origin, dest, date, cabins, pax, programs) -> List[AwardQuote]
search_award_hotels(city, check_in, check_out, guests, programs) -> List[AwardQuote]

# AwardQuote (matches existing raw shape -> adapter_v3 already knows it):
#   program_code, award_points, surcharge, cabin/room_type,
#   source: "chart" | "cash_derived" | "scrape" | "estimate",
#   confidence: float (0-1), as_of: iso8601
```

Resolution order per (program, route/property) — **first layer that returns wins; lower
layers are fallbacks**:

1. **Layer 1 — Chart engine (deterministic, exact, $0).**
   - **Avios distance charts:** great-circle distance from local airport coords →
     band → points. (We already have airport data via
     [scripts/generate_airports_data.py](../scripts/generate_airports_data.py).)
   - **Partner award charts:** Alaska, Aeroplan, ANA, Virgin Atlantic — region-pair lookup
     tables in YAML (`origin_region × dest_region × cabin → points`).
   - **Hotel category charts:** Hyatt category 1–8 (peak/standard/off-peak), plus any other
     chain still publishing fixed categories. Requires a `property → category` mapping table.
   - Surcharges from existing `surcharge_multiplier` in programs.yml, refined per program.
   - **Confidence ≈ 0.95.** This is the bookable-exact tier.

2. **Layer 2 — Cash-derived estimate (free, reuses SerpAPI, instant).**
   - For dynamic programs, `points ≈ round( cash_cents ÷ cents_per_point )`, using a
     per-program peg table (United ≈ 1.3¢, Delta ≈ 1.2¢, Marriott ≈ 0.7¢, Hilton ≈ 0.5¢…).
     Seed pegs from TPG valuations already wired in
     [handlers/tpg_valuations.py](../backend/src/handlers/tpg_valuations.py) /
     [services/points_service.py](../backend/src/services/points_service.py).
   - Reuses the cash quote already fetched in the same request → **no new API call.**
   - **Confidence ≈ 0.6.** Labeled "estimated" in the UI.

3. **Layer 3 — Scraper (free, near-exact for dynamic programs, fragile).**
   - Only invoked for high-value/dynamic programs where Layer 1 doesn't apply and Layer 2's
     estimate isn't good enough — and results are heavily cached so each scrape serves many
     requests.
   - Per-program adapters (United, Delta, AA, Marriott, Hilton) following the
     `transfer_bonus_scraper` pattern; headless browser (Playwright) where pages need JS /
     bot-protection handling.
   - **Confidence ≈ 0.85.** See §5 for the serious caveats.

4. **Layer 4 — Promoted dummy estimator (always-succeeds floor).**
   - The refined [awardtool_dummy.py](../backend/src/handlers/awardtool_dummy.py) logic, so
     the engine never returns empty. **Confidence ≈ 0.3,** clearly "rough estimate."

Every quote carries `source`, `confidence`, and `as_of` so the optimizer and UI can prefer
higher-confidence numbers and warn the user appropriately (the
[CONFIDENCE_AND_WARNINGS.md](CONFIDENCE_AND_WARNINGS.md) framework already exists to surface
this).

---

## 3. Caching strategy (this is what actually keeps it free + fast)

- **Reuse `cache_award_get/set`** ([cache.py](../backend/src/system/itinerary_v2/cache.py))
  keyed by `(layer, program, origin, dest/city, date, cabin, pax)`.
- **TTLs by layer:** chart = ~30 days (changes rarely); cash-derived = per-request (cash is
  already cached upstream); scrape = 12–48h; dummy = 30 days.
- **Charts ship in-repo as YAML** → effectively infinite cache, versioned in git.
- Goal: a given route/property is scraped at most once per TTL window regardless of how many
  users/optimizer iterations touch it.

---

## 4. Data we must author once (the real work of Layer 1)

Stored as version-controlled YAML under `backend/src/award_pricing/charts/`:

- `avios_distance_bands.yml` — distance→points bands (BA/Iberia/AerLingus/Qatar variants).
- `partner_charts/{alaska,aeroplan,ana,virgin}.yml` — region-pair × cabin → points.
- `hotel_categories/hyatt.yml` — category → {peak,standard,off-peak} points.
- `hotel_property_categories.yml` — `chain + property_id → category` (the laborious mapping;
  seed top N properties per destination Tripy actually surfaces, expand over time).
- `redemption_pegs.yml` — per-program cents-per-point for Layer 2 (seed from TPG, override
  manually).
- `region_map.yml` — airport/country → award-chart region (many charts share regions; build
  once, reuse).

These are public, static, and slow-changing — a one-time data-entry effort that then costs
nothing and never calls an API.

---

## 5. Scraping caveats (Layer 3) — must be explicit

- **ToS / legal:** Airline and hotel sites generally prohibit automated scraping. Acceptable
  risk profile differs for personal/low-volume use vs. a commercial product. **Decide the
  posture before building Layer 3.** If Tripy is commercial, prefer Layers 1–2 + manual chart
  curation and treat Layer 3 as optional/region-limited.
- **Fragility:** Award pages use heavy JS, login walls, captchas, and rotating markup.
  Expect ongoing maintenance per adapter. Budget for breakage.
- **Rate/anti-bot:** Needs polite throttling, caching (§3), realistic headers, and possibly
  residential egress. Do **not** hammer endpoints.
- **Mitigation:** Aggressive caching means few real scrapes; degrade gracefully to Layer 2/4
  on any failure (never error the optimization). Per-adapter feature flags so a broken
  scraper can be disabled without a deploy.

Given the commercial-product context, **my recommendation is: ship Layers 1, 2, and 4 first;
treat Layer 3 as a later, flagged, route-limited add-on** rather than a core dependency. That
yields exact-for-free on chart programs and labeled estimates everywhere else, with no paid
APIs — and revisit scraping only if the estimate gap proves material for specific dynamic
programs.

---

## 6. Phased rollout

| Phase | Deliverable | Risk | Cuts API cost by |
|---|---|---|---|
| **P0** | `award_pricing/` module + `AwardQuote` shape + engine skeleton that wraps the **promoted dummy** (Layer 4) behind `is_awardtool_dummy_mode()`. Wire into flight + hotel + provider call sites. | Low | Removes AwardTool dependency immediately (estimates only) |
| **P1** | **Layer 1 charts**: Avios distance engine + Hyatt category engine + region map. Highest value, fully deterministic. | Low | Exact-for-free on top redemptions |
| **P2** | **Layer 2 cash-derived** estimation reusing SerpAPI; `redemption_pegs.yml` from TPG. Confidence labeling end-to-end. | Med | Covers all dynamic programs for free |
| **P3** | Expand `partner_charts/*` (Alaska/Aeroplan/ANA/VS) + more hotel category maps. | Med (data entry) | More programs exact-for-free |
| **P4** | *(Optional, flagged)* Layer 3 scrapers for select dynamic programs, with caching + graceful fallback. | High (maintenance) | Near-exact on dynamic programs |

Each phase is independently shippable; P0 alone severs the paid dependency.

---

## 7. Validation / "is it actually near-exact?"

- **Golden-file tests** per chart (e.g., JFK→LHR in BA Avios = known published number);
  reuse the existing test harness pattern in `backend/tests/`.
- **Backtest harness:** keep AwardTool key around in a dev-only script to spot-compare engine
  output vs. live AwardTool on a sample of routes/properties; report per-program error %.
  This tells us where the estimate gap is large enough to justify Layer 3.
- **Regression tests** in the optimizer to confirm the new shape feeds `adapter_v3` →
  `solver_v3` unchanged.
- **Confidence surfaced to UI** so the user knows "exact (chart)" vs "estimated."

---

## 8. Open decisions for you

1. **Scraping posture (§5):** OK to build Layer 3 for personal/limited use, or keep Tripy on
   Layers 1–2 + manual chart curation only? (Affects whether P4 happens.)
2. **Chart coverage breadth:** which programs/chains to chart first? Suggest starting with the
   ones Tripy recommends most (likely Hyatt + the Avios family + United/Delta as
   cash-derived).
3. **Hotel property→category mapping:** auto-seed from a one-time list vs. curate manually?
   This is the biggest data-entry item.

---

### TL;DR

Build a layered `AwardPricingEngine`: **(1) local award charts = exact & free** for the
high-value chart-based programs and Hyatt hotels; **(2) cash-derived estimates = free** for
dynamic programs by reusing the SerpAPI cash prices we already pay for; **(3) the existing
dummy estimator as the always-on floor.** Optional, flagged **scraping** is the only way to
get bookable-exact numbers on *dynamic* programs for free, but it's fragile and ToS-sensitive
— recommend deferring it. Everything is cached in the existing DynamoDB award cache and feeds
the optimizer through the unchanged `AwardOption` shape. **P0 removes the AwardTool bill on
day one.**
