# Implementation Plan: Align ILP/V3 Optimization With `OPTIMIZATION_ALGORITHM_EXPLAINED.md`

This plan describes the concrete code changes needed to make the **running system** behave exactly as described in `docs/OPTIMIZATION_ALGORITHM_EXPLAINED.md` (two-layer architecture, metro-airport flexibility like SEA↔NYC, connection trade-offs, points transfer optimization).

The main gap today is **airport-group (metro) semantics**: the V3 MILP solver can already choose between multiple airports **if** it is given flight candidates for those airports, but the current orchestrator → V3 adapter path primarily treats each leg’s `origin`/`destination` as a single airport code. So we need to (a) represent “any airport in city/metro” as **allowed airport sets**, and (b) ensure the search layer actually fetches flights across **all airport-pair combinations** and tags them into the correct `leg_id`.

---

## Goals (What “aligned” means)

### Airport flexibility (Seattle ↔ NYC)
- User can specify **city/metro** or airport code in leg endpoints (e.g., “Seattle”, “SEA”, “NYC”, “New York City”).
- System expands endpoints to **allowed airports** (e.g., Seattle → `["SEA", ...]`, NYC → `["JFK","LGA","EWR"]`).
- Search fetches flights for **all allowed airport pairs**, and the MILP chooses the best combination automatically.

### Constraints and trade-offs
- Hard constraints are enforced:
  - **Max stops**, **max total duration**, **date feasibility**, and **single-ticket** connection protection policy.
- Soft trade-offs are reflected in the objective:
  - Fewer stops, shorter time, lower cash, better CPP depending on mode.

### Tripy mission alignment
- The chosen itinerary should represent a global optimum across:
  - **Cash out-of-pocket**, **points consumed**, **redemption value**, and **convenience** (depending on mode).

---

## Plan Critique + Scope/Ordering (to keep this landable)

This plan is intentionally ambitious. To make it ship, we should (a) tighten scope and ordering, (b) make “drift-proof” contracts explicit between search/adapter/solver, and (c) avoid adding unnecessary constraints/variables to the MILP.

### What’s strongest (keep)
- **Adapter V3 Nuances**: these are real correctness blockers (traveler IDs, award-option shape, transfer re-derivation, silent date fallback, bank-key canonicalization).
- **Layering**: hard filters → pruning → objective is the right approach for performance and solvability.
- **Real-world travel nuances**: these prevent “solver-optimal but user-hates-it” outcomes.

### What to adjust (key critiques incorporated)
- **Metro-airport resolution** should be split into:\n  - a *catalog* (pure mapping + metadata), and\n  - a *policy* (deterministic top‑K, caps, confidence, logging).\n  This prevents a single function turning into an untestable dumping ground.
- **Airport expansion budget** should be **top‑K per side** (K1 origins, K2 destinations), not “max pairs”, so behavior is predictable and logging can reveal what got trimmed.
- **Date parsing** must be **hard errors** (never `today()` fallback) to avoid silent corruption.
- **Transfers and cash breakdown** should come from a canonical **solution accounting ledger** so the adapter can’t “lie” by reconstructing from IDs.
- **Award quote merging** requires an **itinerary fingerprint** so we can dedup safely and union award quotes across programs.
- For “allowed airport guard-rails”, pick **filter+validator** by default; only add MILP constraints if you intentionally keep infeasible candidates around.
- For real-world nuances, start with **warnings + light objective terms** (do not overload the MILP with deep stochastic modeling in MVP).

**Caching / idempotency note (metro & hotel resolution)**\n- Cache resolver outputs keyed by:\n  - normalized query\n  - locale\n  - optional country/region context\n- Preserve deterministic ordering so repeated requests produce stable expansions (critical for trust/debuggability).

### Suggested landing sequence (5 PRs)

**PR 1 — correctness blockers + accounting (must land first)**\n- Thread traveler IDs (remove hard-coded `\"user\"`).\n- Remove all `date.today()` fallbacks; parsing failures become validation errors.\n- Canonicalize bank keys end-to-end.\n- Add `SolutionAccounting` / `payment_ledger` and stop guessing transfers/cash components in the adapter.\n
**PR 2 — metro-airport end-to-end + Candidate Contract validation**\n- TripSpec adds `allowed_*_airports` fields.\n- Catalog+policy resolver (with ambiguity behavior).\n- Search expansion using top‑K-per-side.\n- Candidate Contract validation at adapter boundary (including UTC datetimes + ticketing schema).\n- Solver filter+validator for allowed airports.\n- Integration test proving SEA↔NYC can choose among JFK/LGA/EWR.\n
**PR 3 — award sweet spots + fingerprinting + explainability reason codes**\n- `award_quotes[]` schema + `itinerary_fingerprint` normalization.\n- Dedup/merge quotes across searches.\n- Add systematic rejection reason codes (see Contract B / sidecar).\n
**PR 4 — Hotel MVP parity (H1–H4)**\n- Hotel Candidate Contract validation (nights/occupancy/currency, all-in definition, per-night aggregation rules).\n- Hotel geo area resolution.\n- Search expansion + property fingerprinting + collision guard.\n- Consecutive-night feasibility enforcement.\n
**PR 5 — Hotel explainability (H5) + UI rendering**\n- Hotel cash-vs-points provenance.\n- Render standardized reason codes and ledger breakdowns.\n
### Explicit contracts (to prevent drift)

These contracts should be treated as “API boundaries” inside the backend. If they are enforced, future refactors won’t silently break metro-airport behavior, award modeling, or transfer correctness.

**Contract A — Candidate Contract (search → optimization)**\n- Define required fields for flight candidates and validate them before solving:\n  - `leg_id`, `origin`, `destination` (IATA)\n  - `departure_datetime_utc`, `arrival_datetime_utc` (**UTC required; no naive datetimes**)\n  - `total_time_minutes`, `num_stops`\n  - single-ticket evidence (e.g., `ticketing_type`, connection protection fields)\n  - cash breakdown (where available): base / taxes / carrier-imposed surcharges\n  - `award_quotes[]` (program, miles, surcharge, cabin, availability_score, freshness)\n  - `itinerary_fingerprint` and/or provider `offer_id`\n- Add `validate_candidates_or_raise()` at the adapter boundary to fail fast (instead of producing misleading optimization results).\n\n**Timezone/display fields (optional, non-solver)**\n- If you want local times for display, carry them separately and treat them as derived:\n  - `departure_local`, `arrival_local`, `origin_tz`, `destination_tz`\n\nAcceptance criteria:\n- No solver input contains naive datetimes.

**Where contract validation runs (and what it returns)**\n- Validation should run in `backend/src/optimization/adapter_v3.py` (or a small shared module it calls), immediately before invoking `optimize_trip(...)`.\n- Validation failures must return a stable, testable error shape (not a generic exception).\n\nRecommended error object:\n- `OptimizationInputError(code, message, details)`\n  - `details` should include:\n    - `leg_id` / `segment_id` when applicable\n    - `missing_fields`\n    - `bad_values`\n    - `sample_candidate_ids`\n\nAcceptance criteria:\n- When candidates are malformed, the API returns actionable diagnostics without disabling validation in production.\n\n**Executable validator entrypoints + “raise only when necessary”**\n- Add explicit validators that return rejections rather than only raising:\n  - `validate_flight_candidates(cands) -> (valid_cands, rejections[])`\n  - `validate_hotel_candidates(cands) -> (valid_cands, rejections[])`\n- Add a wrapper:\n  - `validate_candidates_or_raise(...)` raises `OptimizationInputError` only when:\n    - the entire solve cannot proceed (e.g., missing leg dates, no legs, all legs empty after filtering), **or**\n    - malformed candidates exceed a threshold (e.g., ≥80% missing required fields suggests upstream regression)\n- Rationale: strictness without losing partial results when one provider is messy.\n\n**Minimum viable candidates per leg/segment**\n- After filtering/validation, require:\n  - per flight leg: `MIN_FLIGHT_CANDIDATES_PER_LEG` (suggest 3)\n  - per hotel segment: `MIN_HOTEL_CANDIDATES_PER_SEGMENT` (suggest 5)\n- If not met, return a clear infeasibility reason:\n  - `INSUFFICIENT_CANDIDATES_AFTER_FILTERING`

**Single-ticket evidence schema (avoid stringly typing)**\n- Define a canonical ticketing evidence payload on each flight candidate:\n  - `ticketing = { type: SINGLE_TICKET | SELF_TRANSFER | UNKNOWN, provider_confidence: HIGH|MED|LOW|UNKNOWN, source: string, evidence: object }`\n\nAcceptance criteria:\n- Under MVP policy, **no itinerary** with `ticketing.type != SINGLE_TICKET` can pass.\n- If `ticketing.type == UNKNOWN`, it is rejected by default unless a non-MVP policy explicitly allows it.\n\n**Define what `provider_confidence` means (ticketing + availability)**\n- Use coarse buckets (not continuous floats) for MVP stability.\n- Ticketing confidence rubric (comparable across sources):\n  - `HIGH`: confirmed single-ticket with booking handle (e.g., offer_id/PNR-able) from a provider that guarantees ticketing\n  - `MED`: strong evidence but missing proof (same-provider itinerary with consistent fare/fare-family and no self-transfer indicators)\n  - `LOW`: scraped itinerary without booking handle / incomplete evidence\n  - `UNKNOWN`: not provided\n- Availability confidence rubric (use same buckets on award/cash quotes):\n  - `HIGH`: live priced/validated recently with booking handle\n  - `MED`: quoted with freshness within a defined TTL\n  - `LOW`: stale/indirect/scraped availability\n  - `UNKNOWN`: not provided\n\n**Clarify “single-ticket only” rule for nonstop vs connecting (MVP policy)**\n- Derive `num_stops` from segments (not provider metadata).\n- If `num_stops == 0`: allow `ticketing.type ∈ {SINGLE_TICKET, UNKNOWN}` (warn if UNKNOWN).\n- Else (`num_stops >= 1`): require `ticketing.type == SINGLE_TICKET` under MVP.

**Contract B — Accounting Ledger (solver → adapter/UI)**\n- Produce a canonical `payment_ledger` / `SolutionAccounting` in solver output extraction.\n- Adapter renders from this ledger verbatim:\n  - bank points transferred (by payer/bank/program)\n  - miles delivered vs miles spent\n  - cash paid broken down (fare vs taxes vs surcharges vs hotels)\n  - ratio/bonus/block size used\n- This prevents the adapter from guessing transfers by parsing IDs.

**Systematic rejection reason codes (for truthful explainability)**\n- Add a structured `rejections[]` sidecar on the result or within `SolutionAccounting`:\n  - `rejections: List[{ kind, candidate_id, leg_or_segment_id, reason_code }]`\n- Example reason codes:\n  - `AIRPORT_NOT_ALLOWED`\n  - `TICKETING_NOT_SINGLE`\n  - `DATE_PARSE_ERROR`\n  - `MISSING_AWARD_FIELDS`\n  - `SURCHARGE_TOO_HIGH`\n  - `HOTEL_INCOMPLETE_PRICING`\n  - `HOTEL_NOT_CONSECUTIVE_NIGHTS`\n- The UI/explainability layer should render from these recorded reasons rather than re-inferring after the fact.\n\n**Stable explanation output contract (`OptimizationExplanation`)**\n- Return an `OptimizationExplanation` payload alongside the selected itinerary:\n  - `objective_breakdown: { cash_usd, points_shadow_cost_usd, time_penalty_usd, stop_penalty_usd, risk_penalty_usd }`\n  - `constraints_enforced: [ ... ]` (e.g., `SINGLE_TICKET_ONLY`, `MAX_STOPS`, `MAX_DURATION`, `ALLOWED_AIRPORTS`)\n  - `rejections_summary: { reason_code -> count }`\n  - `warnings: [...]`\n- This makes PR3/PR5 “done” measurable in QA and prevents bespoke explainability logic.

**Terminology mapping (avoid “award_quotes[] vs AwardOption” confusion)**\n- `award_quotes[]`: raw search-layer inputs, 0..N per itinerary/property, potentially across multiple programs.\n- `AwardOption[]`: optimization-layer objects attached to a single `FlightItineraryEdge` (or hotel/room), created by the adapter from `award_quotes[]`.\n\nAcceptance criteria:\n- Each itinerary edge may have **0..N** `AwardOption`s, and all are derived from `award_quotes[]` with stable IDs.

## Current-State Reality Check (What is already true)

### Already implemented in V3 optimization (`backend/src/optimization/…`)
- **MILP solver**: `solver_v3.py` uses PuLP/CBC with binary/integer vars.
- **Hard validators + safety**: `validators.py` + `validation_policy.py` enforce feasibility and “single-ticket only” filtering.
- **Connection trade-offs**:
  - Hard caps (stops/duration) in pruning/validators.
  - Soft penalties for stops/time in the mode-specific objective and in balanced soft values (`precompute.py`, `pruning.py`).
- **Transfer modeling + no pooling**:
  - Funding sources and integer-safe transfer blocks exist in V3.
- **Surcharge rejection utilities** exist (`constants.py`, `utils.py`).

### Not guaranteed end-to-end today
- “Seattle”/“NYC” style **metro** inputs being expanded into multiple airports *and* the flight search fetching **all combinations** for each leg.
- Ensuring the MILP never selects an airport outside the user’s allowed airport set (today this is “implicitly true” only if search results were limited correctly).

---

## Adapter V3 Nuances (Critique + Required Fixes)

This section focuses on `backend/src/optimization/adapter_v3.py`. These issues affect correctness, future extensibility, and alignment with `OPTIMIZATION_ALGORITHM_EXPLAINED.md`.

### 1) Airport semantics are currently “stringly typed”

**What the adapter does today**
- `convert_trip_to_spec()` builds `OrderedLeg(origin_city=seg["origin"], destination_city=seg["destination"])`.
- Those fields are often treated as if they were airport codes (e.g., “SEA”), but they can also be city/metro strings depending on upstream input.

**Why this matters**
- The V3 solver can choose among airports *only if* it receives candidates for those airports.
- Today the adapter does not carry any “allowed airport set” semantics; so the system can’t reliably implement “any Seattle airport → any NYC airport” end-to-end.

**Suggested improvement**
- Add explicit airport-set fields to `OrderedLeg` and populate them in the adapter (see Milestones 1–2).
- Treat `origin_city`/`destination_city` as display/intent fields, and `allowed_*_airports` as the enforceable constraint set.

### 2) Traveler IDs are hard-coded in legs/segments

**What the adapter does today**
- `_build_legs_and_segments()` and `OrderedLeg(... traveler_ids=["user"])` / `StaySegment(... traveler_ids=["user"])` hard-code `"user"`.

**Why this matters**
- It “works” only because `run_v3_optimization()` currently calls `convert_trip_to_spec(..., user_id="user")` implicitly.
- It will break as soon as:\n  - you pass a real `user_id` (not equal to `"user"`), or\n  - you implement group trips, or\n  - you run optimization for stored trips where traveler IDs differ.

**Suggested improvement**
- Thread `user_id` through `_build_legs_and_segments()` and use it consistently.\n  - This is a correctness fix (even before metro-airports).

### 3) Award modeling is currently too narrow for “partner sweet spots”

**What the adapter does today**
- `_convert_flight_option()` builds at most **one** `AwardOption` per `FlightItineraryEdge`:\n  - `if opt.award_available and opt.award_points > 0: award_options.append(AwardOption(program=normalize_program(opt.award_program or \"UA\"), ...))`

**Why this matters**
`OPTIMIZATION_ALGORITHM_EXPLAINED.md` explicitly expects:\n- a single underlying itinerary could be bookable via **multiple programs** (e.g., United vs Turkish vs Aeroplan).\n\nIf only one award option is attached, the MILP cannot “discover” that alternative redemption.\n
**Suggested improvement**
- Update the upstream flight search result schema so each flight option can include **multiple award quotes**.
  - Example shape: `opt.award_quotes: List[{ program, miles, surcharge, cabin, availability_score }]`
- Update `_convert_flight_option()` to create one `AwardOption` per quote, with stable IDs:
  - `option_id=f"{edge_id}_{program}_{cabin}_{miles}_{surcharge}"` (or provider-offer-based where available)
- Add a merge/dedup step when combining results from multiple airport-pair searches:
  - Deduplicate the *itinerary*, but union the award options across programs.

**Additional requirement (to avoid incorrect merges)**
- Introduce an `itinerary_fingerprint` (hashable string) computed from the segment sequence:
  - (operating carrier, flight number, origin, destination, dep_utc, arr_utc) per segment
- Dedup by fingerprint; then merge `award_quotes` across programs for the same fingerprint.

**Fingerprint normalization rules (MVP)**
- Use UTC as the canonical time basis.
- Prefer exact segment identity when available:
  - carrier + flight number + departure date + origin + destination
- Use timestamps as a fallback when flight number is missing.
- Normalize timestamps to survive provider drift:
  - **MVP rule**: round `dep_utc`/`arr_utc` to nearest 5 minutes for fingerprint construction
  - **Debug-only**: optionally apply a ±2 minute tolerance window as a secondary merge check (should not change the primary fingerprinting rule)

**Merge safety gate (prevents silent corrupt merges)**\n- Before unioning `award_quotes` across two candidates with the same fingerprint, require:\n  - same number of segments\n  - same ordered (origin, destination) per segment\n  - dep/arr within tolerance (if using debug tolerance checks)\n- If the merge gate fails:\n  - do not merge; treat as separate itineraries\n  - emit a `FINGERPRINT_COLLISION` event/rejection for debugging/metrics

### 4) Transfer path normalization inconsistencies (bank keys)

**What exists today**
- `normalize_bank()` canonicalizes Capital One as `\"capital_one\"`.\n- `DEFAULT_TRANSFER_GRAPH` (in `backend/src/optimization/constants.py`) uses the key `\"capitalone\"` (no underscore).\n- `build_transfer_paths()` iterates that graph and calls `normalize_bank(bank)` which yields `\"capital_one\"`, so it mostly works.\n
**Why this matters**
- It’s easy to accidentally mix `capitalone`/`capital_one` across:\n  - funding source IDs (`transfer_{owner}_{from_bank}_{to_program}`),\n  - UI display strings,\n  - caches, and\n  - any future “airport-pair expansion” metrics keyed by bank.\n
**Suggested improvement**
- Establish a single canonical representation (prefer `normalize_bank()` output everywhere: `capital_one`).\n- If needed, add a helper in `constants.py` (or reuse an existing one if present) to normalize transfer-graph keys once at load time.

### 5) Transfer instructions are reconstructed heuristically (can be wrong)

**What the adapter does today**
- In `convert_result_to_itineraries()`, it infers transfers by parsing `payment_choice.funding_source_id` and then emits a `TransferInstruction` whose `points_to_transfer == payment_choice.points_amount`.\n
**Why this matters**
- In V3, transfers are modeled in **integer blocks** and can include ratios/bonuses.\n- The miles delivered to the program are not necessarily equal to the bank points transferred.\n- Therefore, `points_amount` (miles used) is **not** a reliable “bank points transferred” value.\n
**Suggested improvement**
- Add a canonical solution accounting ledger (e.g., `SolutionAccounting` / `payment_ledger`) produced during solver solution extraction.\n- Derive ledger fields from:\n  - `solution.transfers_used` (blocks)\n  - the chosen `TransferPath` (min increment, ratio, bonus)\n  - the chosen `AwardOption` (miles spent, surcharge)\n- The adapter should render transfers/cash breakdown from the ledger verbatim (no parsing IDs), and generate transfer instructions via `backend/src/handlers/transfer_strategy.py` rather than placeholder URLs.\n
### 6) Dates are “single-day fixed” and parse-fallbacks can silently corrupt the spec

**What the adapter does today**
- For flights: `earliest_departure == latest_departure == parsed_date`.\n- If parsing fails, it falls back to `date.today()`.\n- For hotels: if parsing fails, it also falls back to `date.today()`.\n
**Why this matters**
- Silent fallbacks can create invalid or misleading problems:\n  - The solver might return infeasible due to wrong dates.\n  - Or it might return a solution that doesn’t align with the user’s requested dates.\n
**Suggested improvement**
- Treat parse failures as **hard errors** and surface them back to the user (4xx; do not run optimization).\n- If “flexible date” is a future feature, explicitly encode this rather than using `today()`.\n
### 7) Payments/metrics in the adapter should be based on solver truth, not re-derived guesses

**What the adapter does today**
- It recomputes “cash_saved” and CPP for flights/hotels on the fly.\n
**Suggested improvement**
- Prefer using:\n  - `AwardOption.cpp` and the chosen `AwardOption.raw_value`\n  - `solution.total_value` and `solution.total_cash` where applicable\n- Keep recomputation only as a fallback when references are missing.

---

## Real-World Travel Nuances (Hidden Costs, Risk, and Operational Reality)

To match how travel *actually* works (and avoid returning “mathematically optimal but practically bad” itineraries), the system should explicitly model or at least surface the following realities. This section also translates each concern into **implementable** model/constraint/objective changes.

### 1) Transfer friction: time, irreversibility, and failure risk

**Reality**
- Bank → airline transfers can be instant, delayed (hours–days), or fail / require verification.
- Transfers are generally **irreversible**.
- Award inventory can disappear while waiting for points to arrive.

**What to include**
- Transfer time and reliability should affect the objective (risk penalty) and/or generate warnings.
- If an award is “low availability”, the algorithm should prefer native balances or instant partners (or cash, depending on mode).

**Implementation suggestions**
- Extend `TransferPath` (or attach metadata) with:\n  - `transfer_time_hours_estimate`\n  - `transfer_reliability_score` (0–1)
- Incorporate into objective:\n  - penalize selecting `FundingSource.transfer` when `transfer_time` is slow and `AwardOption.availability_score` is low.
- Output:\n  - warnings like “Transfer may take 24–48h; award seats may disappear.”

### 2) “Cost of transferring points” is mostly opportunity cost (not cash) — but it matters

**Reality**
- Transfers usually have no direct fee, but they have opportunity cost (you can’t easily “untransfer” bank points).
- Different bank points have different “reserve value” for users (cash-out rates, portal value, future flexibility).

**What to include**
- In OOP mode, “use points whenever savings > 0” is directionally right, but you still often want a small “point spend penalty” so the solver doesn’t burn points for trivial savings.

**Implementation suggestions**
- Add per-bank “shadow price” defaults (user-configurable):\n  - e.g., `value_per_bank_point_usd = { chase: 0.0125, amex: 0.012 }`
- Add an objective term:\n  - `+ point_spend_penalty * bank_points_transferred` (or program points spent)
- Keep it small in OOP; stronger in CPP/Balanced.

**Critique / guard rail**
- Don’t make “opportunity cost” a hard constraint in MVP.\n- Keep it as a small linear penalty, otherwise you risk surprising behavior where the solver ignores large cash savings to “protect points”.

### Configuration: `OptimizationWeights` (defaults, tuning, source of truth)

If we introduce penalties like “point shadow price” or “transfer risk penalty”, we must define where the weights live and how they’re tuned.

**Add a config object**
- `OptimizationWeights` (code defaults; optionally request-level overrides)\n  - `oop_point_shadow_price_usd_per_point` (tiny; prevents burning points for trivial savings)\n  - `cpp_value_weight` / thresholds handling (already exists conceptually)\n  - `balanced_time_penalty_per_hour`, `balanced_connection_penalty`, `redeye_penalty` (already exists in configs)\n  - `transfer_delay_risk_penalty` (only applied when availability is low and transfer bucket is DAYS)\n
**Defaults per mode (MVP)**
- OOP:\n  - shadow price enabled but small\n  - transfer risk mostly warnings\n- CPP:\n  - thresholds dominate; stronger stop penalties\n- Balanced:\n  - convenience penalties active; optional transfer risk penalty\n
**Where it lives**
- MVP: code defaults (checked-in) + optional request override for experimentation.\n- Later: DB-backed or remote-config-backed for tuning without redeploy.

**Acceptance criteria**
- A/B tuning does not require code changes.\n- Weight changes can be audited (log config snapshot used for a solve).

### 3) Taxes, fees, fuel surcharges, and “carrier-imposed charges”

**Reality**
- Award tickets include taxes/fees; some programs add large carrier-imposed surcharges.
- These surcharges are real cash out-of-pocket and can dominate.

**What to include**
- Ensure surcharge rejection is consistently applied and **scaled correctly per passenger**.
- In the UI, clearly separate “taxes” from “carrier surcharges” when available.

**Implementation suggestions**
- Ensure `AwardOption.surcharge` is “all-in cash due at checkout” per passenger.
- Apply hard filters/penalties consistently:\n  - `surcharge > MAX_SURCHARGE_ABSOLUTE`\n  - `surcharge > MAX_SURCHARGE_RATIO * cash_cost`

### 4) Baggage fees and seat fees (ancillary costs) can flip the decision

**Reality**
- Basic Economy, ULCCs, and some carriers can add fees for bags/seats.
- Cards/status can waive fees for specific airlines.

**What to include**
- “Total out-of-pocket” should include expected ancillaries, or the UI should show an “estimated extras” range.

**Implementation suggestions**
- Extend `FlightItineraryEdge` with optional estimates:\n  - `checked_bag_fee_estimate`, `carryon_fee_estimate`, `seat_fee_estimate`
- Use traveler attributes (status/card benefits) to reduce those estimates.
- Add objective term:\n  - `+ expected_ancillary_cost`

### 5) Self-transfer, airport changes, and terminal changes (operational feasibility)

**Reality**
- Some “connections” are really self-transfers (recheck bags, re-clear security).
- Airport changes within a metro area (JFK↔LGA) can be infeasible without long buffers.
- Overnight layovers can require hotels and transportation.

**What to include**
- Explicitly block airport-change itineraries unless the user opts in.
- Penalize or warn on tight/overnight connections.

**Implementation suggestions**
- Add hard filter:\n  - reject itineraries with intermediate airport changes (unless allowed).
- Add penalties:\n  - tight connections,\n  - overnight layovers,\n  - landside transfers.
- Surface blocker-level warnings:\n  - “Requires airport transfer from JFK to LGA.”

### 6) Award volatility: phantom availability, married segments, dynamic repricing

**Reality**
- Awards can “price” but fail at checkout; partner availability can be stale.
- Dynamic pricing can change rapidly.

**What to include**
- Availability should be a first-class input and affect mode behavior (especially Balanced).

**Implementation suggestions**
- Populate `AwardOption.availability_score` based on provider confidence + freshness.
- Produce near-optimal fallbacks:\n  - return 1–3 alternatives if the best solution relies on low availability.

### 7) Change/cancel fees and flexibility

**Reality**
- Refundability varies widely (cash fares, award redeposit policies).

**What to include**
- Flexibility should be displayed and optionally optimized for (Balanced).

**Implementation suggestions**
- Add fields such as `cancellation_policy_score` (0–1) to flights/hotels.
- Add objective preferences when the user selects “flexibility”.

### 8) Immigration/visa and preclearance constraints (edge-case but important)

**Reality**
- Some routings require transit visas, and preclearance/country constraints can matter.

**Implementation suggestions**
- Use airport country metadata (e.g., `airport_data.py`) to:\n  - block certain transit countries when configured,\n  - or warn in UI.

## Milestone 0: Decide the Single Source of Truth for “Allowed Airports”

### Decision
Implement metro-airport resolution with **catalog vs policy separation**, and re-use it in both:
- **Search** (to fetch all airport-pairs)
- **Optimization** (to validate/filter candidates and enforce guard rails)

### Recommended implementation
Create a dedicated module pair (backend service-layer), for example:
- `backend/src/services/metro_airport_catalog.py`
- `backend/src/services/airport_choice_policy.py`
- (optional facade) `backend/src/services/metro_airport_service.py` that wires them together

Responsibilities:
- `metro_airport_catalog`:\n  - Pure mapping + metadata (commercial, airport size rank, metro code, country/region).\n  - Deterministic ordering.\n- `airport_choice_policy`:\n  - Deterministic top‑K selection per side.\n  - Exposes `confidence`, `trimmed`, and `dropped_airports`.\n- Both:\n  - Cacheable (stable ordering, TTL cache).

Inputs:
- Free-text city or airport string
- Optional country/region context (future)

Outputs:
- `AirportResolution`:\n  - `airports: List[str]` (IATA codes, uppercase)\n  - `type: EXACT|METRO|AMBIGUOUS`\n  - `confidence: float`\n  - `trimmed: bool`\n  - `dropped_airports: List[str]`\n  - `reason: str`

**Ambiguity behavior (do not guess for low confidence)**\n- If input is exactly 3 letters: treat as exact IATA code (no disambiguation).\n- If `type == AMBIGUOUS` and `confidence < 0.7`: return a validation error asking for clarification (or apply an explicit locale-based default if the product requires it).\n- If `type == AMBIGUOUS` and `confidence >= 0.7`: proceed with deterministic ordering and include a warning in the result (“interpreted as …”).

**Input normalization rules (cache determinism + fewer surprises)**\n- Normalize endpoint strings with deterministic steps:\n  - `strip()` and collapse whitespace\n  - uppercase for IATA detection\n  - canonicalize common tokens (examples):\n    - `NYC`, `NEW YORK`, `NEW YORK CITY` → `NYC`\n    - `SEA`, `SEATTLE`, `SEATAC` → `SEA` (or a single canonical key used by the catalog)\n  - if exactly 3 letters **and** exists in the known IATA list → `EXACT`\n\n**Caps at two levels (prevents blowups as catalogs expand)**\n- Keep top‑K per side, and also enforce an absolute ceiling:\n  - `MAX_TOTAL_PAIRS_PER_LEG` (suggest 16)\n- If `K1 * K2 > MAX_TOTAL_PAIRS_PER_LEG`, trim the larger side further and record dropped airports.

---

## Milestone 1: Extend V3 Trip Spec to Carry Airport Sets (No behavior change yet)

### Change
Add optional fields to `OrderedLeg`:
- `allowed_origin_airports: Optional[List[str]]`
- `allowed_destination_airports: Optional[List[str]]`

Files:
- `backend/src/optimization/trip_spec.py`

### Acceptance criteria
- Existing callers continue to work (fields are optional).
- `TripPlanSpec.validate()` remains valid for current input shapes.

### Notes
Do **not** put airport expansion logic inside `trip_spec.py`. Keep it a data model only.

---

## Milestone 2: Populate Airport Sets in the Orchestrator → V3 Adapter

### Change
Update `convert_trip_to_spec()` in:
- `backend/src/optimization/adapter_v3.py`

Steps:
- For each `OrderedLeg(origin_city, destination_city)`:
  - If the field looks like an IATA code (3 letters), treat as singleton list: `[IATA]`.
  - Else call `metro_airport_service` (catalog + policy) to get an `AirportResolution` and set allowed airports from it.
  - Store the resulting airport lists on the leg’s new fields.

### Acceptance criteria
- For a Seattle → NYC request, the produced `TripPlanSpec` contains:
  - `allowed_origin_airports` including `"SEA"` (and any configured Seattle-area airports)
  - `allowed_destination_airports` including `"JFK","LGA","EWR"`

### Logging/metrics
- Log airport-resolution results per leg (count + sample).

---

## Milestone 3: Update the Flight Search Layer to Fetch All Airport-Pair Combinations

This is the biggest functional gap relative to `OPTIMIZATION_ALGORITHM_EXPLAINED.md`.

### Change
Where the backend currently requests flights for a leg:
- Expand endpoints to airport sets.
- Issue flight searches for each `(origin_airport, dest_airport)` pair.
- Merge/deduplicate results.
- Assign results to the correct `leg_id`.

Likely integration points (confirm in codebase):
- `backend/src/agents/orchestrator.py` (trip orchestration)
- `backend/src/services/itinerary_service.py` (legacy ILP path; also where flight search is invoked)
- flight handlers under `backend/src/handlers/…`

### Implementation details
- Add a helper:
  - `build_leg_search_pairs(allowed_origins, allowed_dests) -> List[Tuple[str,str]]`
  - Guard rails:
    - Use top‑K per side:\n      - `max_origin_airports = K1`, `max_dest_airports = K2`\n      - expand Cartesian product of the trimmed sets\n    - Always log dropped origins/destinations and why they were dropped\n    - Prefer large airports first (SEA before BFI/PAE; JFK/LGA/EWR)
- Merge logic:
  - Deduplicate flights by provider identifiers when available (offer_id / flight numbers + times).
  - Require an `itinerary_fingerprint` for reliable dedup (then merge award quotes across programs for the same fingerprint).
  - Preserve award options (union programs where appropriate).

**Concurrency, timeout, and fail-soft behavior (keeps latency sane)**\n- Pair-search concurrency:\n  - `max_pair_search_concurrency` (suggest 4–6)\n- Per-leg timeout:\n  - `per_leg_timeout_seconds` (suggest 12–20s)\n- Fail-soft:\n  - if some pairs time out, keep successful pairs, attach warnings, and include a rejection summary for timed-out pairs.

**Cache at the pair-search layer (metro expansion multiplies calls)**\n- Cache key should include:\n  - `(origin_airport, dest_airport, date, cabin, pax_count, mode, provider)`\n  - plus any provider-specific request-shaping params\n- TTL guidance:\n  - shorter TTL for award availability; longer TTL for cash prices (provider dependent)\n- Always log cache hit-rate and time saved (for ops tuning).

### Acceptance criteria
- A Seattle → NYC leg produces flight candidates that include:
  - SEA→JFK, SEA→LGA, SEA→EWR (and any other allowed combos)
- The V3 adapter `convert_search_results_to_flights()` emits `FlightItineraryEdge` entries across these airports *all under the same `leg_id`*.

---

## Milestone 4: Enforce “Allowed Airports” Inside the MILP as a Guard Rail

Even if the search layer expands correctly, the solver should explicitly enforce user constraints.

### Change
In `backend/src/optimization/solver_v3.py`:
- **Preferred (keeps the MILP small)**:\n  - Filter out-of-set flights **before variable creation**.\n  - Add a strict validator assertion at the solver boundary (“no out-of-set flights passed to the solver”).\n- **Only if needed for diagnostics**:\n  - Keep infeasible edges and add `x_f[(leg, edge)] <= airport_feasible[(leg, edge)]` constraints.\n  - This should be debug-mode only because it increases model size.

**Remove (to keep MVP simpler)**
- Do not keep infeasible candidates in the MILP for diagnostics in MVP.
- If you need diagnostics, log/return rejected candidates and rejection reason codes from filtering/validation instead.

**Allowed airports semantics (hard allowlist)**
- If `allowed_origin_airports` is set for a leg, reject any flight whose **first segment origin** is not in the allowlist.
- If `allowed_destination_airports` is set for a leg, reject any flight whose **final destination** is not in the allowlist.
- Each `leg_id` uses its own allowlists (multi-leg trips can differ by leg).

**Airport-change connections inside an itinerary edge**
- Require operational continuity for connections:\n  - `segments[i].destination == segments[i+1].origin`
- If violated, reject with `AIRPORT_CHANGE_CONNECTION` (even if upstream claims “single ticket”).

### Acceptance criteria
- If a flight candidate accidentally contains an out-of-set airport, it is never selected.
- If all candidates are filtered out by airport feasibility, solver returns a clear infeasibility reason.

---

## Milestone 5: Align Connection Handling With the Doc (Validate + Document + Tune)

The doc describes three layers: hard filters, pruning, and objective penalties. V3 already implements these patterns, but we should ensure they are consistently applied end-to-end.

### Changes
- Ensure `filter_single_ticket_only()` is always applied before solve (already in `solver_v3.py`, keep it mandatory).
- Ensure stop/duration caps align with `STRICT_MVP_POLICY` (single source of truth).
- Ensure pruning configs are stable and mode-aware (if needed):
  - Keep “fewest stops” criterion (already in `pruning.py`).

### Acceptance criteria
- No itineraries with >2 stops or >36 hours total time appear.
- No “self-stitched” connections are selected under MVP policy.

---

## Milestone 6: Align “Cash vs Points” Messaging With Actual Solver Decisions

`OPTIMIZATION_ALGORITHM_EXPLAINED.md` describes mode-driven behavior (OOP uses points whenever savings > 0; CPP uses thresholds; Balanced uses soft value adjustments).

### Change
Update the result conversion layer so user-facing output matches the internal rationale:
- `backend/src/optimization/adapter_v3.py` (`convert_result_to_itineraries`)

Improvements:
- When points are used, display:
  - CPP achieved (already computed)
  - Why points were chosen (e.g., “above threshold”, “max savings”, “balanced score”)
- When cash is used, display:
  - “points option rejected due to low CPP / high surcharge / low availability” (if applicable)

### Acceptance criteria
- The itinerary explanation reflects the same constraints and penalties the solver used.

---

## Milestone 7: Tests (Regression + Behavior)

### Unit tests
Add tests for airport resolution:
- `Seattle` includes `SEA`
- `NYC` includes `JFK,LGA,EWR`

Add tests for solver airport feasibility:
- If `allowed_destination_airports=["JFK"]`, solver never selects an `EWR` flight even if present.

Files:
- `backend/tests/test_optimization_v3.py` (or a new test module)

### Integration tests (high value)
- Simulate a 1-leg trip with:
  - 3 candidate flights SEA→JFK, SEA→EWR, SEA→LGA with different prices/stops
  - Verify chosen airport changes by mode:
    - OOP might choose cheaper (even if 1 stop) if penalty still wins
    - Balanced should prefer nonstop/shorter time more often

---

## Hotel Track (H1–H5): Bring Hotels to “Doc-Aligned” Parity With Flights

The current plan is flight-first (with some hotel correctness notes), but to truly match `OPTIMIZATION_ALGORITHM_EXPLAINED.md` end-to-end, hotels need the same treatment: **explicit geo semantics**, **candidate contracts**, **search expansion + dedup**, **multi-program award modeling**, and **stay-specific feasibility rules**.

This “Hotel Track” is intentionally scoped so MVP changes do **not** explode the MILP:\n- we encode complex/nonlinear hotel realities as **precomputed coefficients**,\n- keep “unknown” fees as warnings rather than invented numbers,\n- and only add new constraints where correctness requires it (e.g., consecutive-night availability).

### H1) Hotel candidate contract + date correctness (adapter boundary)

**Hard requirement**
- Remove all `date.today()` fallbacks for hotel dates (same as flights).\n- Parse failures → validation error and do not run optimization.
- Parse failures → validation error and do not run optimization.\n\n**Explicit MVP fallback behavior**\n- If a candidate only has per-night pricing and you cannot aggregate reliably into an all-nights quote:\n  - reject the candidate at validation\n  - return a count/summary warning like “X hotels excluded due to incomplete per-night pricing / aggregation unavailable”\n  - do not silently approximate by multiplying a single-night price unless the provider explicitly states it is constant across nights

**Hotel Candidate Contract (search → optimization)**
- Define and validate required fields before calling the solver:\n  - `segment_id`\n  - `property_id` (provider ID)\n  - stay configuration:\n    - `check_in`, `check_out`, `nights`\n    - `num_rooms`, `num_guests` (or an explicit occupancy model)\n    - `currency`\n  - `hotel_name`, `address` (if available)\n  - `lat`, `lng` (if available)\n  - `city_id` / requested geo area key\n  - `cash_total_all_in` (ideally split into base/taxes/fees) + explicit fee flags:\n    - `includes_taxes: true|false|unknown`\n    - `includes_resort_fee: true|false|unknown`\n    - `is_per_night_pricing_aggregated: true|false` (MVP should require `true`)\n  - `room_quotes[]` (see H3) where each quote includes award + cash due\n  - `property_fingerprint` (see H3) for dedup/merge\n

**Formal definition: `cash_total_all_in` (MVP)**\n- `cash_total_all_in = base + taxes + mandatory fees charged by property/provider at booking checkout`.\n- Explicitly classify “maybe-external” costs (do not include unless known):\n  - optional parking\n  - optional incidentals/deposit\n  - optional breakfast\n  - unknown resort/destination fee if provider can’t confirm\n\nMVP requirement:\n- If mandatory resort/destination fee is known, it must be included in `cash_total_all_in`.\n- If resort fee applicability is unknown, set `includes_resort_fee=unknown` and attach a warning (do not silently assume included).
**Why**
- Hotels frequently have “hidden” out-of-pocket components (taxes, destination/resort fees). We must either model them explicitly or surface “unknown fees” warnings.

### H2) Hotel “metro semantics”: city → hotel search area (geo resolution)

Flights use metro-airport sets; hotels need an analogous geo concept.

**Define** a `HotelSearchAreaResolution`:
- `type: CITY|NEIGHBORHOOD|CUSTOM_BOUNDS|AMBIGUOUS`\n- `bounds` (bbox) or `place_id` / neighborhood IDs\n- `confidence`, `trimmed`, `reason`, `dropped_areas`\n
**MVP approach**
- Start with a city-level bounding box + a deterministic “city center” point derived from known data.\n- If the user specifies a neighborhood/place_id, use that as the target point/bounds.\n- Add optional neighborhood inputs later (e.g., “Manhattan”).

**Objective hook**
- Add a precomputed `location_score` or `distance_km_to_target` for each hotel.\n- Balanced mode can penalize being far from the target area.
- Balanced mode can penalize being far from the target area.

**Acceptance criteria**
- The same user input always produces the same target point/bounds (stable results).

### H3) Hotel search expansion + cross-provider dedup + award-quote merging

Hotels often come from multiple sources; even within one provider you may query multiple geo tiles or neighborhoods.

**Search expansion**
- Query multiple areas/tiles when needed (bounded by top‑K policy similar to flights), and log trimmed areas.\n
**Dedup**
- Prefer provider `property_id` when stable.\n- Otherwise compute `property_fingerprint` using a conservative fallback:\n  - normalize name + address + (lat/lng bucketed) and hash\n- Dedup by fingerprint; merge `room_quotes` / award quotes across sources.\n\n**Collision guard (do not merge materially different properties)**\n- If two candidates share a `property_fingerprint` but differ materially, do not merge:\n  - e.g., lat/lng distance exceeds a threshold (recommend > 0.5–1.0 km)\n  - or normalized addresses differ strongly\n- Treat them as separate properties and log a “fingerprint collision” event.

**Hotel award quote schema (analogous to flight `award_quotes[]`)**
- `award_quotes[]` per property/room (MVP can attach to a “room quote”):\n  - `{ program, points_per_night, fees_due_total, room_type, availability_score, cancel_policy_score, freshness_ts }`\n- Ensure fees are modeled as:\n  - per-night vs per-stay correctly,\n  - and include resort fees if the provider indicates they apply to award stays.
- Add two additional “trust” fields for MVP correctness and explainability:\n  - `award_type: STANDARD | DYNAMIC | CASH_ONLY | UNKNOWN`\n  - `includes_resort_fee: true|false|unknown`\n- Ensure fees are modeled as:\n  - per-night vs per-stay correctly,\n  - and include resort fees if the provider indicates they apply to award stays.

### H4) Stay feasibility + objective alignment (multi-night specifics)

Hotels differ from flights because stays span multiple nights.

**MVP feasibility rule**
- Only allow selecting a hotel/room quote if it represents **all nights available** for the stay segment.\n- If the provider only returns per-night data, the adapter/search must pre-aggregate into a “consecutive nights available” quote (or mark it infeasible).

**Fees correctness**
- Ensure the optimization cost uses:\n  - `cash_total_all_in` for cash stays,\n  - and for award stays: `fees_due_total + points_per_night * nights` (with correct nights and room counts).

**Program-specific benefits (defer unless already supported)**
- “5th night free” and other nonlinear loyalty rules should start as:\n  - precomputed effective points-per-night or an adjusted quote,\n  - not new MILP variables.

### H5) Explanation provenance for hotels (cash vs points, with reasons)

Add provenance for hotel decisions similar to flights:
- If points chosen: show CPP/value, fees due, and (if relevant) availability confidence.\n- If cash chosen: show why awards were rejected (low CPP, high fees/resort fees, low availability, policy constraints).

---

## Cross-Domain Coupling (Optional MVP+): Airports ↔ Hotels (Ground Transfer Cost)

If the solver can choose arrival airports (JFK vs EWR) and also choose hotels, users will feel “broken” results if the model ignores ground transfer time/cost.

**MVP approach (do not couple inside the MILP yet)**\n- Avoid introducing bilinear coupling terms like \(c[a,h] \\cdot x_a \\cdot y_h\) in MVP.\n- Instead use a staged approach that keeps the MILP clean:\n  - Step 1: solve flights (choose airport(s))\n  - Step 2: constrain hotel search/selection to the chosen metro area and apply an airport-specific location penalty post-selection\n  - Step 3 (optional): re-optimize hotels given the chosen airport (second-pass hotel solve)\n\n**Future (only if needed)**\n- If true coupling is required later, introduce linearization variables \(z_{a,h}\) with standard constraints.\n- Treat that as MVP+ due to model-size and debugging impact.

## Milestone 8: Cleanup / De-risking (Optional but recommended)

There appears to be a legacy ILP implementation path in `backend/src/services/itinerary_service.py` that references older ILP modules (`src.handlers.ilp_adapter`, `src.handlers.points_maximizer`). To avoid mismatched behavior and documentation drift:

### Change
- Introduce a feature flag (e.g., `USE_V3_OPTIMIZER`).\n- Route 100% of staging traffic through the V3 pipeline (`backend/src/optimization/adapter_v3.py` + `solver_v3.py`) first.\n- Then ramp in production.\n- Deprecate/remove older ILP entrypoints only after V3 is fully rolled out.

### Acceptance criteria
- One canonical optimization path for flights/hotels and points transfers.

---

## Rollout Strategy

### Phase 1 (safe)
- Add airport set fields + airport resolution + guard-rail filtering in solver.
### Phase 2 (functional)
- Enable airport-pair expansion in flight search for a small subset (e.g., only NYC/SEA nicknames first), log candidate growth and solver outcomes.
### Phase 3 (full)
- Expand to all cities using airport database / Amadeus results.

---

## Definition of Done

- Seattle↔NYC airport flexibility works end-to-end: the system searches across all NYC airports and the MILP can choose the best one.
- Connection safety policy is enforced (single-ticket only under MVP) and connection trade-offs match the described penalties.
- The user-facing itinerary explanation matches the solver’s actual decisions.
- **Hotels parity**:\n  - City-level hotel search area resolution works end-to-end.\n  - Cross-provider dedup merges properties via `property_fingerprint`.\n  - Consecutive-night availability is required for any awarded/cash quote used in optimization.\n  - Hotel fees are either included in “all-in” totals or explicitly marked unknown with warnings.\n- **Accounting truth**:\n  - UI cash/points/transfer numbers come from `SolutionAccounting` (no heuristic reconstruction).\n- **Contracts enforced**:\n  - Invalid candidate inputs fail fast with `OptimizationInputError` payloads (unit tests exist).\n  - Candidate Contract includes canonical `ticketing` evidence and is enforced under MVP policy.\n- Tests cover:\n  - airport expansion + allowed-airport enforcement\n  - hotel contract validation + dedup\n  - accounting ledger correctness (ratio/bonus/block-size cases)
