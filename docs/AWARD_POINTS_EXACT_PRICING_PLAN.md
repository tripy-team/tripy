# Exact Award Pricing Engine — Implementation Plan

**Goal:** Stop paying the **AwardTool Enterprise API** (`apisv2.awardtoolapi.com`) for "how many
points does this flight/hotel cost," and instead get that number from a self-hosted engine that
is **as close to bookable-exact as physics allows**, while **paying little or nothing**.

This supersedes and sharpens [AWARD_POINTS_SELF_HOSTED_PLAN.md](AWARD_POINTS_SELF_HOSTED_PLAN.md)
with (a) the user's new emphasis on *exact* pricing and (b) 2026 market research. Read that doc
for the original layered design; this doc resolves its **open decisions** and adds the concrete
exact-pricing strategy.

---

## 0. The one fact that drives the whole architecture

**There is no formula for the exact award price of a *dynamic* program.** It floats with the cash
price, day by day, and only exists inside the airline's / hotel's own award engine. AwardTool and
seats.aero don't "compute" it — they *continuously scrape the airlines and cache it*. So:

> **Exact + dynamic + no-aggregator ⟹ *we* must query the airline ourselves.**
> There is no fourth option. Anyone selling you "exact dynamic award prices" is reselling a scrape.

That single fact splits every program into two regimes, and the right plan treats them completely
differently:

| Regime | Programs | Exact for free? | Mechanism |
|---|---|---|---|
| **Chart-based (fixed)** | **Hotels:** Hyatt. **Flights:** Avios family (BA, Iberia, Aer Lingus, Qatar, Finnair), Alaska, Air Canada Aeroplan, ANA, Virgin Atlantic | **Yes — exactly, $0 forever.** | The published chart *is* the bookable price. Compute distance/region/category locally. |
| **Dynamic (cash-linked)** | **Flights:** United, Delta, American (most routes), Southwest, JetBlue. **Hotels:** Marriott, Hilton, IHG | **No.** No formula exists. | Either (a) **estimate** from cash (free, ~±15%), or (b) **query the live award engine** (exact, but fragile + ToS/legal exposure). |

**Strategic consequence:** We can be **bookable-exact for free** on the chart-based programs —
which are exactly the high-value redemptions Tripy *should* be steering advisors toward. For the
dynamic programs, "exact + free" is a genuine tradeoff, not a feature we can simply build, and the
plan must say so honestly and put a confidence label on every number.

---

## 1. 2026 cost & feasibility landscape (why the obvious shortcuts don't work)

What I found researching the alternatives to AwardTool Enterprise:

- **seats.aero** — returns exact mileage + taxes per cabin via its
  [Cached Search API](https://developers.seats.aero/reference/cached-search). But Pro ($9.99/mo)
  is **"non-commercial, personal use" only**; commercial/production use is **partner-gated and
  requires written approval** ([docs](https://docs.seats.aero/article/68-seatsaero-pro-api-access-limits-and-usage)).
  **Not a legal drop-in for Tripy** (a commercial B2B product). Same posture at Roame ($109.99/yr)
  and point.me — all consumer-licensed.
- **AwardTool itself** — the $9.99/mo "PRO" tier is the *consumer UI*. Tripy uses the *Enterprise
  API* ([awardtool.com/enterprise-api](https://www.awardtool.com/enterprise-api)), which is the
  bill we're killing. There is no cheaper *commercial* award-price API that is materially better
  than building the chart engine ourselves.
- **Self-scraping the airlines in 2026 is harder than in the original plan's framing.**
  [United now requires login to view *any* award price](https://liveandletsfly.com/united-airlines-ai-award-pricing/);
  airlines run WAFs, CAPTCHAs, rate-limits, and
  [actively litigate scrapers](https://vercara.digicert.com/resources/fare-scraping-attacks-on-airline-apis).
  Scraping is viable for **personal/low-volume** use; for a **commercial** product it is a
  legal/maintenance liability that should be opt-in and narrowly scoped, never a core dependency.
- **The chart programs are stable and public**, so charting them is a one-time data-entry cost
  that then runs at $0 — the genuinely cheap path the user is asking for.

**Bottom line on "pay a lower price than rely on an API":** the cheapest *and* most defensible
build is **local charts (exact, free) + cash-derived estimates (free) + the existing dummy floor**,
with live-scrape as a **flagged, narrow, opt-in** add-on only if a specific dynamic program's
estimate error proves material. That's this plan.

---

## 2. Target architecture (drop-in, source-agnostic)

One new module, `backend/src/award_pricing/`, exposing the **exact contract the optimizer already
consumes** so it slots into existing call sites with no solver changes:

```
search_award_flights(origin, dest, date, cabins, pax, programs) -> List[AwardQuote]
search_award_hotels(city/property, check_in, check_out, guests, programs) -> List[AwardQuote]
```

`AwardQuote` mirrors the real AwardTool row that `flights.py:_merge_award_edges` /
`adapter_v3` already parse — so nothing downstream changes:

```
program_code, award_points, surcharge, cabin_or_room_type,
cash_equivalent, availability_score, is_waitlisted,
transfer_options: [{program, points}],          # banks -> program ratios (from programs.yml)
source:     "chart" | "cash_derived" | "scrape" | "dummy",
confidence: float (0-1),
as_of:      iso8601
```

This maps cleanly onto today's structures (per the codebase map):
- Optimizer model `AwardOption` — `models_v3.py:98-137` (`miles_required`, `surcharge`,
  `cabin_or_room_type`, `cash_equivalent`, `availability_score`, `is_waitlisted`).
- Raw-row consumer — `adapter_v3.py:57-177` (fingerprint match + Pareto keep-2-per-program;
  it already scrubs `-1` sentinels, so our `None`/confidence fields are safe).
- Real shape reference — `backend/awardtool_response.json` (`award_points`, `surcharge`,
  `cabin_prices{}`, `fare.products[]`, `transfer_options[]`).

**Resolution order** per (program, route/property) — first layer that returns a confident quote
wins; lower layers are fallbacks. Every quote keeps `source`/`confidence`/`as_of` so
[CONFIDENCE_AND_WARNINGS.md](CONFIDENCE_AND_WARNINGS.md) can surface "exact (chart)" vs "estimated."

| Layer | Mechanism | Programs | Exactness | Cost | Confidence |
|---|---|---|---|---|---|
| **L1 Chart** | Local YAML charts + great-circle distance / region / category lookup | Avios family, Alaska, Aeroplan, ANA, Virgin; Hyatt hotels | **Bookable-exact** | $0 | 0.92–0.97 |
| **L2 Cash-derived** | `points ≈ cash_cents ÷ peg` reusing the SerpAPI cash quote already in-request | All dynamic programs | Estimate (~±15%) | $0 | 0.55–0.65 |
| **L3 Live scrape** *(flagged, opt-in)* | Per-program Playwright/httpx adapters, heavily cached | Select dynamic programs | Near-exact | infra-only (proxies) | 0.85 |
| **L4 Dummy floor** | Promote existing `awardtool_dummy.py` heuristic so the engine never returns empty | Any | Rough | $0 | 0.30 |

---

## 3. Layer 1 — the exact, free core (build this first; it's the whole value prop)

Charts ship as **version-controlled YAML** under `backend/src/award_pricing/charts/`. They're
public, static, slow-changing — author once, run forever. We already have airport coordinates via
`scripts/generate_airports_data.py`, so distance math is local.

**Flights:**
- `avios_distance_bands.yml` — single-segment distance → Avios, per cabin, with **peak/off-peak**
  columns. Covers BA, Iberia, Aer Lingus, Qatar, Finnair (each has its own band table). Compute
  great-circle miles between airport coords → band → points. *Caveat:* BA doesn't publish its
  peak/off-peak *calendar*, so we return both columns + a `tier_unknown` flag (still exact once the
  date's tier is known; default to a configurable peak/off-peak assumption and label it).
- `partner_charts/{alaska,aeroplan,ana,virgin}.yml` — `origin_region × dest_region × cabin →
  points`. These are region-pair tables, not distance.
- `region_map.yml` — airport/country → award-chart region (most charts reuse the same region
  concept; build once).

**Hotels:**
- `hotel_categories/hyatt.yml` — **must encode the new May-20-2026 chart**: 8 categories × **5
  demand tiers** (Lowest/Low/Moderate/Upper/Top), 3,000–45,000+ pts/night
  ([Hyatt chart 2026](https://awardtravelfinder.com/award-charts/hyatt)). Like Avios peak/off-peak,
  *which* tier applies on a given date isn't published, so a property+date resolves to a tier
  *range* unless we also have the tier calendar — return the standard/Moderate tier as the point
  estimate plus min/max, labeled.
- `hotel_property_categories.yml` — `chain + property_id → category`. **This is the biggest
  data-entry item.** Seed the top-N Hyatt properties in destinations Tripy actually surfaces;
  expand over time. (Open decision below: auto-seed vs. manual.)

**Surcharges:** reuse `surcharge_multiplier` already in `config/programs.yml`, refined per program
(BA/LH fuel surcharges are the ones that matter; flagged `HIGH_SURCHARGE_PROGRAMS` already exists).

**Why this is the right first build:** it's deterministic, has zero ongoing cost, no ToS/legal
risk, and covers the redemptions an advisor-facing tool *should* recommend. Validate with
golden-file tests (e.g., LHR→JFK BA Avios = known published number).

---

## 4. Layer 2 — cash-derived estimate (free, covers every dynamic program)

For dynamic programs, `award_points ≈ round(cash_cents ÷ peg_cents_per_point)` using a per-program
peg table. **The cash quote is already fetched in the same request** via
`services/serp_api_functions.py` (`serp_route_to_leg_map` for flights, hotel cash in `hotels.py`),
so this costs **no new API call**.

- `redemption_pegs.yml` — per-program cents/point (United ≈1.3¢, Delta ≈1.2¢, AA ≈1.4¢,
  Southwest ≈1.3¢, Marriott ≈0.7¢, Hilton ≈0.5¢, IHG ≈0.5¢). Seed from the TPG valuations already
  wired in (`handlers/tpg_valuations.py` / `services/points_service.py`); allow manual override.
- This is an **estimate, not bookable-exact** — confidence ≈0.6, UI label "estimated." Good enough
  for the optimizer to make cash-vs-points tradeoffs (see
  [DIRECT_CASH_VS_INDIRECT_POINTS_RESEARCH.md](DIRECT_CASH_VS_INDIRECT_POINTS_RESEARCH.md)); not
  good enough to promise an advisor an exact number.

The peg per program is itself tunable from the L3 backtest (§7): if scraped reality says United's
effective peg drifted, we adjust the YAML — improving the free estimate without scraping in prod.

---

## 5. Layer 3 — live scrape for exact dynamic prices (flagged, opt-in, last)

This is the **only** way to get bookable-exact numbers on dynamic programs without an aggregator —
and it carries the most risk. Build only if a specific program's L2 error proves material, and gate
each adapter behind a feature flag so a break disables it without a deploy.

- **Pattern to copy:** `services/transfer_bonus_scraper.py` (httpx + BeautifulSoup + in-process
  daily-refresh cache + thread lock). For JS/login-walled award pages, escalate to **Playwright**
  (headless) with realistic headers; United now requires a logged-in MileagePlus session, so that
  adapter needs a managed account + cookie jar.
- **Caching is what keeps it cheap and polite:** reuse `cache_award_get/set`
  (`system/itinerary_v2/cache.py`, key = SHA256 of origin/dest/date/cabins/programs/pax). Bump the
  award TTL for scraped rows to **12–48h** (today it's 6h / `AWARD_CACHE_TTL=21600`) so one scrape
  serves thousands of optimizer iterations. A route is scraped at most once per TTL window.
- **Cost:** infrastructure only — a small worker + residential proxy egress (~$3–15/GB). No
  per-search billing. Far below AwardTool Enterprise *if* volume stays low, which caching ensures.
- **Hard caveats (must be explicit before building):** ToS prohibition, active litigation risk,
  login walls, CAPTCHAs, rotating markup → ongoing per-adapter maintenance. **Recommendation for a
  commercial product: do not ship L3 by default.** Treat it as opt-in/personal/region-limited, and
  always degrade gracefully to L2/L4 on any failure (never error the optimization).

---

## 6. Layer 4 — dummy floor (already built; promote it)

`handlers/awardtool_dummy.py` is already a real heuristic engine (distance tiers, cabin multipliers,
region classifiers, hotel star pricing), not a stub. Wrap it as the always-succeeds L4 so the
engine never returns empty; confidence ≈0.3, labeled "rough estimate." The mode switch
`is_awardtool_dummy_mode()` (`config/__init__.py:101-112`) is the centralized seam the new engine
plugs into — it already auto-falls-back when `AWARDTOOL_API_KEY` is unset.

---

## 7. Phased rollout (each phase independently shippable)

| Phase | Deliverable | Risk | Effect on the AwardTool bill |
|---|---|---|---|
| **P0** | `award_pricing/` module + `AwardQuote` shape + engine skeleton wrapping the **promoted dummy (L4)** behind `is_awardtool_dummy_mode()`. Wire into flight (`flights.py:442`), hotel (`hotels.py:152`), provider (`award_provider.py`), and calendar (`award_calendar.py`) call sites. | Low | **Severs the dependency immediately** (estimates only) |
| **P1** | **L1 charts:** Avios distance engine + Hyatt category engine + `region_map.yml`. Golden-file tests. | Low | Exact-for-free on top redemptions |
| **P2** | **L2 cash-derived** reusing SerpAPI; `redemption_pegs.yml` from TPG; confidence labeling end-to-end. | Med | Covers all dynamic programs for free |
| **P3** | Expand `partner_charts/*` (Alaska/Aeroplan/ANA/VS) + more Hyatt property→category coverage. | Med (data entry) | More programs exact-for-free |
| **P3.5 (gate)** | **Backtest** engine vs. live AwardTool per program; report median error %. Decides whether any P4 happens and for which programs. | Low | — (decision gate) |
| **P4** | *(Conditional — only for programs failing the P3.5 error threshold)* flagged L3 scrapers, heavily cached, graceful fallback. | High (legal + maintenance) | Near-exact on the few programs that need it |

**P0 alone removes the bill.** P1+P2 deliver "exact where we can, labeled-estimate elsewhere" — the
honest, free product. **P3.5 is the gate:** P4 only fires for programs the backtest proves need it.
P4 is a deliberate, reversible, per-program bet — never a foundation.

---

## 8. Validation — "is it actually exact?"

- **Golden-file tests** per chart (known published numbers: LHR→JFK Avios, a Hyatt Cat-4 night),
  reusing the `backend/tests/` harness.
- **Backtest harness:** keep an AwardTool key in a **dev-only** script to spot-compare engine output
  vs. live on a sample of routes/properties; report **per-program error %**. This (a) proves L1 is
  exact, and (b) tells us exactly which dynamic programs have an L2 gap large enough to justify L4
  scraping — i.e., it makes the §5 decision data-driven instead of a guess.
- **Optimizer regression tests** confirming the new shape feeds `adapter_v3` → `solver_v3`
  unchanged.

---

## 9. Decisions (locked)

1. **Scraping posture → data-driven.** No scraping in the initial build. Ship **P0–P3**, then run
   the §8 AwardTool-vs-engine backtest and **only build a P4 scraper for a *specific* program if
   its estimate error proves materially large** (define the threshold up front — e.g. >15% median
   error on routes Tripy actually surfaces). This makes the legal/maintenance bet evidence-based
   instead of speculative. The backtest is therefore a **gating deliverable**, not optional polish.
2. **First chart/peg coverage → all four tracks.** Chart **Hyatt** (hotels), the **Avios family**
   (BA/Iberia/Aer Lingus/Qatar/Finnair), and the **partner charts** (Alaska/Aeroplan/ANA/Virgin)
   for L1; seed **United/Delta** (and the other dynamic programs) as L2 cash-derived. Sequence the
   data-entry by Tripy's recommendation frequency, but all four are in scope for P1–P3.
3. **Hotel property→category mapping → auto-seed then curate.** Auto-seed the top-N Hyatt
   properties in the destinations Tripy surfaces (one-time list), then hand-correct over time. This
   is the largest data-entry item; front-load the properties advisors actually book.

---

### TL;DR

Exact award price for *dynamic* programs has no formula — aggregators only resell their own scrapes,
and the cheap consumer ones (seats.aero/Roame/point.me) ban commercial use. So the cheapest *and*
most defensible build is a **layered `AwardPricingEngine`**: **(L1) local charts = bookable-exact &
free** for Hyatt + the Avios family + Alaska/Aeroplan/ANA/VS; **(L2) cash-derived estimates = free**
for dynamic programs by reusing the SerpAPI cash prices we already pay for; **(L4) the existing dummy
estimator as the always-on floor.** Every quote is confidence-labeled. **Optional, flagged scraping
(L3/P4)** is the only path to exact dynamic prices for free, but it's fragile and ToS-sensitive —
defer it and make it data-driven via the backtest. **P0 kills the AwardTool Enterprise bill on day
one;** everything plugs into the unchanged `AwardOption` contract, so the optimizer never notices.
