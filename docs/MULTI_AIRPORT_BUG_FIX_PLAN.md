# Multi-Airport Bug: Diagnosis & Implementation Plan

## Diagnosis Summary

The system has an airport expansion pipeline (`_expand_to_metro`) that correctly maps cities to all their airports (e.g., Tokyo → HND + NRT). However, **five distinct bugs plus one suspected risk** cause this multi-airport data to be lost or mishandled downstream, resulting in the optimizer only seeing flights to a single airport per city.

---

## Bug 1 (CRITICAL): `_build_segments_for_route` Drops Multi-Airport Data

### Location
`backend/src/agents/orchestrator.py:1676-1732`

### Root Cause
For multi-city trips (2+ intermediate destinations), the orchestrator generates route permutations and builds segments for each variant via `_build_segments_for_route`. This function creates **bare-bones segments** with only single `origin` and `destination` airport codes:

```python
# _build_segments_for_route — line 1721
segments.append({
    "type": "flight",
    "origin": origin,          # Just "CDG" — single airport
    "destination": destination, # Just "SEA" — single airport
    "date": flight_date,
})
```

Compare with the correct `_build_trip_segments` (line 1429), which includes:
```python
segment = {
    "type": "flight",
    "origin": origin_airports[0],
    "destination": dest_airports[0],
    "date": flight_date,
    "origin_city": origin_city,
    "dest_city": dest_city,
    "allowed_origin_airports": origin_airports,      # ["CDG", "ORY"]
    "allowed_destination_airports": dest_airports,    # ["SEA"]
    "airport_search_pairs": airport_search_pairs,     # [("CDG","SEA"), ("ORY","SEA")]
}
```

### Impact
- **Who's affected**: Multi-city trips with 2+ intermediate destinations (route permutations)
- The V3 adapter receives legs with `allowed_origin_airports = None` and `allowed_destination_airports = None`
- The greedy fallback maps flight results by segment index, which doesn't match between variant and original segments
- The optimizer has no airport constraint info, so airport continuity constraints may malfunction
- Missing `origin_city`/`dest_city` causes display issues

### Trigger Condition
```
len(intermediate_destinations) > 1
```
When this is true, `num_variants > 1`, and `_build_segments_for_route` is called for each route variant (orchestrator.py:380).

---

## Bug 2 (CRITICAL): Search Results Index Mismatch for Route Variants

### Location
`backend/src/agents/orchestrator.py:384-386` + `backend/src/optimization/adapter_v3.py:637-647`

### Root Cause
`search_results` is a dict keyed by `f"flight_{i}"` where `i` is the enumerate index from the **original** deduplicated segments created by `_build_trip_segments`. When variant segments from `_build_segments_for_route` are passed to the optimizer, `convert_search_results_to_flights` uses the **variant** segment indices to look up results:

```python
# adapter_v3.py:641
key = f"flight_{i}"  # 'i' based on variant_segments enumerate
result = search_results.get(key)  # search_results keyed by original segments
```

For a trip SEA → Paris → Rome → SEA, the original segments (after dedup across both permutations) might be:
```
flight_0: SEA → Paris
flight_1: Paris → Rome
flight_2: Rome → SEA
flight_3: SEA → Rome
flight_4: Rome → Paris
flight_5: Paris → SEA
```

Route variant 2 (SEA → Rome → Paris → SEA) has 3 legs that map to `flight_0`, `flight_1`, `flight_2`. But `flight_0` is SEA→Paris (not SEA→Rome), `flight_1` is Paris→Rome (not Rome→Paris), etc. **Completely wrong flight options are assigned to each leg.**

### Impact
- **Who's affected**: Same as Bug 1 — multi-city trips with 2+ intermediates
- Route variants 2+ get flight data from the wrong city pairs
- The optimizer picks "optimal" flights that go to the wrong cities
- Results appear as expensive/wrong because the solver is working with mismatched data

---

## Bug 3 (MEDIUM): Cross-Validation Fetches SerpAPI for Single Airport Pair Per Leg

### Location
`backend/src/optimization/adapter_v3.py:1995-2016`

### Root Cause
The cross-validation step extracts origin/destination from the **first** flight in each leg and fetches fresh SerpAPI data for only that airport pair:

```python
# adapter_v3.py:1996-1998
first_flight = leg_flights[0]
origin = first_flight.segments[0].origin      # e.g., "SEA"
dest = first_flight.segments[-1].destination   # e.g., "HND" (just ONE Tokyo airport)
# ...
serp_flights = get_google_flights(origin=origin, destination=dest, ...)
```

For a leg covering SEA → Tokyo (HND + NRT), if the first flight goes to HND, only SEA→HND is validated. Flights to NRT:
- From SerpAPI: included as "unverified" (survives)
- From AwardTool with real flight numbers: included as "unverified_awardtool" (survives)
- **From AwardTool with placeholder numbers: EXCLUDED** — award options collected for later attachment

The award options from NRT placeholder flights are then attached via `(leg_id, airline_code)` matching, which ignores the actual airport. This means NRT award pricing may get incorrectly attached to HND flights.

### Impact
- **Who's affected**: ALL trips to multi-airport cities
- Award availability for alternate airports (e.g., NRT when HND is first) may be lost or mis-attached
- The optimizer may miss genuinely better award options at the alternate airport
- Results are suboptimal (overly expensive) because not all award paths are correctly available

---

## Bug 4 (LOW): Duplicate METRO_AIRPORTS Mapping

### Location
`backend/src/optimization/adapter_v3.py:183-198` vs `backend/src/agents/orchestrator.py:60-93`

### Root Cause
`adapter_v3.py` has its own hardcoded `_get_metro_airports` function with a separate metro mapping that only covers a subset of cities (Paris, London, Tokyo, NYC, LA, SF, DC, Milan). The orchestrator's `METRO_AIRPORTS` is more comprehensive and includes additional cities (Chicago, Miami, Dallas, Houston, Seoul, Shanghai, Beijing, Dubai, etc.).

### Impact
- The adapter's metro mapping is only used for error diagnostics (`_suggest_alternate_airports`), not core logic
- If it were ever used for actual airport decisions, results would be incomplete for cities like Chicago, Seoul, etc.

---

## Bug 5 (MEDIUM): Upstream Baselines Computed from Single Airport Pair

### Location
`backend/src/agents/orchestrator.py` — `_estimate_best_cash_price` and any per-leg "best cash" baseline helpers

### Root Cause
Even after Bugs 1-3 are fixed and multi-airport flights survive into the solver, any `dict` keyed by `(leg_id, date)` or `(origin_city, dest_city)` that stores a **single** "best cash flight" or "lowest cash price" per leg could collapse the multi-airport dimension upstream of the solver.

The budget tier system computes a tightness ratio:
```
r = budget / best_cash_price
```
If `best_cash_price` is derived from only one airport pair's flights, the tier could be wrong, which changes CPP guardrail relaxation. The user could end up in `normal` tier (full guardrails, no award usage) when the cheapest cash fare is actually at the alternate airport and would put them in `tight` tier (points preferred).

### Impact
- **Who's affected**: ALL trips to multi-airport cities
- Budget tier can be wrong → CPP guardrails applied incorrectly
- "Best cash" baseline used for tie-breaking or comparison may be biased toward one airport
- Any "min cash per leg" helper that iterates only over one airport's candidates

### Places to audit
- `_estimate_best_cash_price` in orchestrator.py
- Any per-leg `min()` over cash prices that pre-filters by a single airport
- The greedy fallback's `_pick_best_flight_option` if it uses a leg-level baseline
- Pruning functions that use a "best cash" reference price

---

## Implementation Plan

### Execution Sequence

Based on dependency analysis and risk:

1. **Phase 1** — Bug 1+2+6: Data-driven metro normalization + dual UIDs (`search_uid`/`segment_uid`) + explicit preference fields + `_build_segments_for_route` fix + UID consumer audit + search dispatcher unit test (core fix)
2. **Phase 1b** — Invariant logging: per-leg airport count (intent + reality) at each pipeline stage
3. **Phase 2** — Bug 4: Single-source `METROS` dict + `expand_to_metro` + `normalize_to_metro_key` + delete all duplicate mappings
4. **Phase 3** — Bug 3: Cross-validation with type-aware pair selection + award cascade with mandatory `(origin, dest, normalized_date)` keys
5. **Phase 4** — Bug 5: Expanded baseline audit (all per-leg baselines incl. CPP, award value, budget feasibility)

This order is chosen because Phase 1 is the root cause, the invariant logs (1b) let us verify Phase 1 in production before touching the adapter's SerpAPI flow, and the METRO_AIRPORTS consolidation (Phase 2) is cheap and eliminates a coupling code smell before the solver/adapter changes in Phase 3. Bug 6 is verified/fixed as part of Phase 1 because it's a potential blocker — if the search dispatcher doesn't use `airport_search_pairs`, all other fixes are moot.

**Note on Phase 1 ↔ Phase 2 dependency**: Phase 1's `_normalize_dest_key` delegates to `normalize_to_metro_key` from the shared module (Phase 2). In practice, implement the `METROS` data structure first (it's trivial and self-contained), then build Phase 1 on top of it. The phases are numbered by *risk priority*, not strict implementation order.

---

### Phase 1: Fix `_build_segments_for_route` + Introduce `segment_uid` (Bug 1 + Bug 2)

**Priority**: CRITICAL — Fixes the root cause for multi-city trips

#### Step 1.0: Normalize route node tokens (with user-preference preservation)

**Problem with the naive approach**: `_build_segments_for_route` receives `route` as a list of strings like `["SEA", "CDG", "FCO", "SEA"]`. Doing `dest_to_airports.get(origin, [origin])` works only if `origin` is the exact key used in `dest_to_airports`. But route nodes can be mixed formats:
- Airport code: `"CDG"`
- City name: `"Paris"`
- Parenthesized: `"Tokyo (HND)"`
- Primary airport extracted from expansion: `"CDG"` (when original input was `"Paris (CDG,ORY)"`)

If even one node format doesn't match a `dest_to_airports` key, the fallback `[origin]` silently re-introduces the single-airport bug.

**Why the naive `_normalize_dest_key` is dangerous**: A function that blindly returns the first airport from `_get_all_airports_for_location(location, expand_metro=True)` will convert `"EWR"` into `"JFK"` (because `_expand_to_metro(["EWR"])` returns `["JFK", "EWR", "LGA"]` with JFK first from the `METRO_AIRPORTS["new york"]` list). This:
- Breaks user preference semantics (user typed EWR, we store JFK)
- Produces surprising tie-break behavior in the solver
- Makes canonical keys unstable (dependent on list ordering in METRO_AIRPORTS)

**Fix**: Use a **stable city key** as the canonical identifier, not an airport code. The city key is format-independent and doesn't conflate "user's preferred airport" with "lookup key."

**File**: `backend/src/agents/orchestrator.py`

The normalization logic itself lives in `metro_airports.py` as `normalize_to_metro_key()` (see Phase 2). The orchestrator's `_normalize_dest_key` is a thin wrapper:

```python
from ..config.metro_airports import normalize_to_metro_key

def _normalize_dest_key(location: str) -> str:
    """
    Return a stable canonical key for dest_to_airports lookup.
    Delegates to the shared normalize_to_metro_key(); falls back to
    uppercased string for unknown locations.
    """
    key = normalize_to_metro_key(location)
    if key is not None:
        return key
    return location.strip().upper()[:10]
```

No `_METRO_CITY_KEYS` dict in orchestrator. No `_airport_to_city_key` helper. All normalization data is derived from the single `METROS` dict in `metro_airports.py` (Phase 2), so there is zero drift risk.

This means:
- `"EWR"` → `"NYC"` (not `"JFK"`)
- `"JFK"` → `"NYC"` (same key — correct)
- `"Paris (CDG,ORY)"` → `"PAR"`
- `"CDG"` → `"PAR"` (same key — correct)
- `"HND"` → `"TYO"`
- `"BOS"` → `"BOS"` (standalone single-airport metro — clean key, no `_METRO` suffix)
- `"san francisco"` → `"BAY"`

**User preference preservation**: The canonical key is only for `dest_to_airports` lookup. The user's *preferred airport* is preserved explicitly on the segment via two new fields:

```python
segment = {
    # ... existing fields ...
    "preferred_origin_airport": user_typed_origin_code,       # e.g. "EWR" (optional)
    "preferred_destination_airport": user_typed_dest_code,     # e.g. "HND" (optional)
}
```

These fields are populated when the user typed a specific airport code (not a city name). When present, the solver uses them for tie-breaking when two airports produce equal-ish objective value. This replaces the implicit "first in list" convention, which is how `[0]` bugs come back.

**How preference is detected**: If the user's input resolves to a single airport code (3-letter, in the airports DB) rather than a city name, that code is the `preferred_*_airport`. If input is a city name or parenthesized multi-airport string, `preferred_*_airport` is `None` (no preference — all airports are equally viable).

**How expansion respects preference**: `allowed_*_airports` always contains the full metro expansion. The preferred airport (if any) is placed first in the list as a soft signal, but more importantly, it's stored in its own field so no consumer has to guess from list ordering.

Then in `_build_trip_segments`, when populating `dest_to_airports`:

```python
canonical = _normalize_dest_key(name)
dest_to_airports[canonical] = all_airports
```

And route nodes in `route_variants` always use `canonical` keys. This guarantees every route node exists in `dest_to_airports`, and no two formats for the same city produce different keys.

**Route node assertion (non-negotiable)**:

```python
for node in route:
    if node not in dest_to_airports:
        if num_variants > 1:
            # Multi-city variant path: wrong flights are worse than no result.
            # Hard fail. Tripy trust > returning "something".
            raise ValueError(
                f"Route node '{node}' not in dest_to_airports. "
                f"Keys: {list(dest_to_airports.keys())}. "
                f"This would assign wrong city-pair flights to legs."
            )
        else:
            # Single-city: warn and fall back (user can still get a result)
            logger.error(
                f"[Orchestrator] Route node '{node}' not in dest_to_airports. "
                f"Falling back to [{node}]. Multi-airport support degraded."
            )
```

**Segment-level assertion**: At segment build time, if a destination is known to be multi-airport (exists in METRO_AIRPORTS with 2+ airports) but `allowed_destination_airports` would end up as a single-element list or `None`, emit a hard warning:

```python
if len(dest_airports) == 1 and _AIRPORT_TO_METRO.get(dest_airports[0]) and \
   len(_AIRPORT_TO_METRO[dest_airports[0]]) > 1:
    logger.error(
        f"[Orchestrator] MULTI-AIRPORT COLLAPSE: {dest_city} resolved to "
        f"single airport {dest_airports} but metro has "
        f"{_AIRPORT_TO_METRO[dest_airports[0]]}. Check normalization."
    )
```

#### Step 1.1: Introduce dual UIDs — `search_uid` + `segment_uid`

**Problem**: `flight_{i}` index keys are positional and fragile. Any consumer that enumerates a different segment list gets wrong mappings. Re-keying dicts per variant is a band-aid that's easy to regress on.

**Why a single UID isn't enough**: A naive `segment_uid` based on `(city_pair, date)` merges "same pair same date" legs. This is usually correct for search dedup, but breaks if the same city-pair+date appears twice in a trip (loops, open-jaw, "return to same place then go again"). Sharing search results is fine; conflating segment identity is not.

**Fix**: Two distinct identifiers:

| ID | Purpose | Dedup-able? | Key components |
|----|---------|-------------|----------------|
| `search_uid` | Look up search results | **Yes** — same city-pair+date reuses cached results | `(origin_city_key, dest_city_key, date)` |
| `segment_uid` | Unique identity per leg instance | **No** — always unique | `(origin_city_key, dest_city_key, date, leg_index)` |

Search results are stored under `search_uid`. Segment identity, logging, rejection tracking, and all per-leg state use `segment_uid`.

**File**: `backend/src/agents/orchestrator.py`

```python
import hashlib

def _make_search_uid(origin_key: str, dest_key: str, date: str) -> str:
    """
    Deterministic search ID from city-pair + date.
    
    Two segments for the same city-pair on the same date share search results.
    This is the key for search_results dict.
    """
    raw = f"{origin_key}|{dest_key}|{date}"
    return f"search_{hashlib.sha256(raw.encode()).hexdigest()[:12]}"

def _make_segment_uid(origin_key: str, dest_key: str, date: str, leg_index: int) -> str:
    """
    Unique segment identity per leg instance.
    
    Even if two legs share a city-pair+date, they have different leg_index
    values and thus different segment_uids.
    """
    raw = f"{origin_key}|{dest_key}|{date}|{leg_index}"
    return f"seg_{hashlib.sha256(raw.encode()).hexdigest()[:12]}"
```

Changes in `_build_trip_segments`:
```python
segment = {
    "type": "flight",
    "search_uid": _make_search_uid(origin_key, dest_key, flight_date),
    "segment_uid": _make_segment_uid(origin_key, dest_key, flight_date, leg_index=i),
    "origin": origin_airports[0],
    "destination": dest_airports[0],
    # ... rest unchanged
}
```

Changes in `_search_all_segments` — key results by `search_uid`:
```python
# Currently:  key = f"flight_{i}"
# Change to:  key = segment.get("search_uid", f"flight_{i}")
search_results[key] = FlightSearchResult(...)
```

Changes in `_build_segments_for_route` — emit the same `search_uid`, distinct `segment_uid`:
```python
search_uid = _make_search_uid(origin_key, dest_key, flight_date)
segment_uid = _make_segment_uid(origin_key, dest_key, flight_date, leg_index=i)
segments.append({
    "type": "flight",
    "search_uid": search_uid,
    "segment_uid": segment_uid,
    # ... full multi-airport fields from Step 1.0
})
```

Changes in `convert_search_results_to_flights` (adapter_v3.py):
```python
# Currently:  key = f"flight_{i}"
# Change to:  key = seg.get("search_uid", f"flight_{i}")
result = search_results.get(key)
```

The same `_make_search_uid("PAR", "SEA", "2026-03-05")` produces the same search UID whether called from `_build_trip_segments` or `_build_segments_for_route`. No re-keying needed. No index alignment needed. Bug 2 is eliminated structurally. And two legs that happen to share a city-pair+date correctly share search results without losing their individual identity.

**Backwards compatibility**: The fallback `f"flight_{i}"` in `convert_search_results_to_flights` keeps the greedy path and any legacy callers working during rollout. Once all callers emit `search_uid`, remove the fallback.

#### Step 1.1b: Audit and propagate UIDs through ALL consumers

**Rule**: If any `dict` in the codebase is still keyed by `flight_{i}`, it's a latent Bug 2 reintroduction. Every such dict must migrate to `search_uid` or `segment_uid`.

**Audit targets** (grep for `flight_{i}` or `f"flight_{` across the backend):

| Location | Current key | Migrate to | Rationale |
|----------|-------------|------------|-----------|
| `_search_all_segments` result storage | `f"flight_{i}"` | `search_uid` | Core search results |
| `convert_search_results_to_flights` lookup | `f"flight_{i}"` | `search_uid` | Adapter reads search results |
| Greedy fallback (`_run_greedy_optimization`) | `f"flight_{i}"` | `search_uid` | Same search results lookup |
| SERP-only fallback path | `f"flight_{i}"` (verify) | `search_uid` | May have separate result dict |
| Award attachment join maps | `(leg_id, airline)` | `(leg_id, airline, dest_airport)` | Phase 3 fix, but verify no `flight_{i}` keys |
| Rejection explanations storage | `flight_{i}` (verify) | `segment_uid` | Per-leg identity, not search identity |
| Any caching layer (optimization cache) | varies | `search_uid` for results | Cache keys must be content-addressed |

**Implementation**: After migrating all consumers, add a **conditional guard** at the end of `_search_all_segments`. A hard `assert` is too strict during rollout — older paths, test harnesses, or internal tools may still produce `flight_{i}` keys before all callers are migrated:

```python
# Only enforce when all segments in this run carry search_uid
all_have_uid = all(seg.get("search_uid") for seg in segments)
if all_have_uid:
    for key in search_results:
        if key.startswith("flight_"):
            if settings.STRICT_UID_KEYS:  # True in dev/staging
                raise AssertionError(
                    f"Legacy flight_{{i}} key '{key}' in search_results. "
                    f"All keys must use search_uid."
                )
            else:  # prod: log error + metric, don't crash
                logger.error(
                    f"[Orchestrator] Legacy flight_{{i}} key '{key}' found "
                    f"in search_results. Migrate to search_uid."
                )
                metrics.increment("legacy_flight_key_found")
```

This ensures we don't blow up in prod if a legacy path fires, but we get hard failures in dev/staging and metrics visibility in prod to track convergence.

**Adapter-side UID presence assertion**: In `convert_search_results_to_flights` and `_build_legs_and_segments`, assert that every incoming segment has both UIDs and that search results are available:

```python
for i, seg in enumerate(segments):
    if seg.get("type") != "flight":
        continue
    seg_uid = seg.get("segment_uid")
    search_uid = seg.get("search_uid")
    if not seg_uid or not search_uid:
        logger.error(
            f"[Adapter] Segment {i} missing UIDs: "
            f"segment_uid={seg_uid}, search_uid={search_uid}"
        )
    if search_uid and search_uid not in search_results:
        logger.error(
            f"[Adapter] Segment {i} search_uid={search_uid} "
            f"not found in search_results keys"
        )
```

This catches "segment built without UID" early, before it silently falls through to the `f"flight_{i}"` fallback.

#### Step 1.2: Update `_build_segments_for_route` with full multi-airport data

With `dest_to_airports` (keyed by canonical city tokens), dual UIDs, and preference fields in place:

**File**: `backend/src/agents/orchestrator.py`

**Complete segment schema** (all fields a flight segment should carry after this fix):

```python
segment = {
    # --- identity ---
    "type": "flight",
    "search_uid": str,           # dedup-able, keyed on (city_pair, date)
    "segment_uid": str,          # unique per leg instance
    
    # --- primary airports (first in list, used for display) ---
    "origin": str,               # e.g. "CDG"
    "destination": str,          # e.g. "SEA"
    "date": str,                 # "YYYY-MM-DD"
    
    # --- city context ---
    "origin_city": str,          # metro key, e.g. "PAR"
    "dest_city": str,            # metro key, e.g. "SEA"
    
    # --- multi-airport expansion ---
    "allowed_origin_airports": list[str],       # ["CDG", "ORY"]
    "allowed_destination_airports": list[str],  # ["SEA"]
    "airport_search_pairs": list[tuple[str,str]], # [("CDG","SEA"), ("ORY","SEA")]
    
    # --- user preference (NEW) ---
    "preferred_origin_airport": str | None,      # set when user typed a specific code
    "preferred_destination_airport": str | None,  # set when user typed a specific code
}
```

**Implementation**:

```python
def _build_segments_for_route(self, route: list[str], trip_data: dict) -> list[dict]:
    dest_to_airports = trip_data.get("dest_to_airports", {})
    dest_preferences = trip_data.get("dest_preferences", {})  # metro_key → preferred airport code
    # ... date setup unchanged ...
    for i in range(len(route) - 1):
        origin = route[i]       # canonical metro key, e.g. "TYO"
        destination = route[i + 1]

        origin_airports = dest_to_airports.get(origin, [origin])
        dest_airports = dest_to_airports.get(destination, [destination])

        airport_search_pairs = [
            (orig_apt, dest_apt)
            for orig_apt in origin_airports
            for dest_apt in dest_airports
        ]

        segments.append({
            "type": "flight",
            "search_uid": _make_search_uid(origin, destination, flight_date),
            "segment_uid": _make_segment_uid(origin, destination, flight_date, leg_index=i),
            "origin": origin_airports[0],
            "destination": dest_airports[0],
            "date": flight_date,
            "origin_city": origin,
            "dest_city": destination,
            "allowed_origin_airports": origin_airports,
            "allowed_destination_airports": dest_airports,
            "airport_search_pairs": airport_search_pairs,
            "preferred_origin_airport": dest_preferences.get(origin),
            "preferred_destination_airport": dest_preferences.get(destination),
        })
```

The same changes apply to `_build_trip_segments`. The `dest_preferences` dict is populated during `_get_trip_data` when parsing user input — if the user typed `"EWR"`, `dest_preferences["NYC"] = "EWR"`. If they typed `"New York"`, no entry is added.

#### Step 1.3: Add unit tests

**File**: `backend/test_multi_airport_segments.py` (new)

Test cases:

1. **`_build_segments_for_route` emits full segment schema**: Given `dest_to_airports = {"PAR": ["CDG","ORY"], "ROM": ["FCO","CIA"], "SEA": ["SEA"]}` and route `["SEA","PAR","ROM","SEA"]`, assert every segment has `allowed_origin_airports`, `allowed_destination_airports`, `airport_search_pairs`, `origin_city`, `dest_city`, `search_uid`, `segment_uid`, `preferred_origin_airport`, and `preferred_destination_airport`.

2. **Index-mismatch regression (MUST fail without the fix)**: Build original deduplicated segments for SEA→Paris→Rome→SEA (both permutations). Build variant segments for permutation 2 (SEA→Rome→Paris→SEA). Look up each variant's `search_uid` in `search_results`. Assert leg 0's results contain flights with `destination ∈ {FCO, CIA}` (Rome), NOT `{CDG, ORY}` (Paris). This test catches any future regression that re-introduces positional indexing.

3. **Round-trip through a multi-airport city**: SEA → Tokyo → SEA. Assert outbound leg has `allowed_destination_airports = ["HND", "NRT"]` (or the expanded set), return leg has `allowed_origin_airports = ["HND", "NRT"]`.

4. **Canonical key normalization (via `normalize_to_metro_key`)**:
   - `normalize_to_metro_key("EWR")` and `normalize_to_metro_key("JFK")` both return `"NYC"` — they resolve to the same city, NOT `"JFK"` eating `"EWR"`.
   - `normalize_to_metro_key("Paris (CDG,ORY)")`, `normalize_to_metro_key("CDG")`, and `normalize_to_metro_key("Paris")` all return `"PAR"`.
   - `normalize_to_metro_key("HND")` and `normalize_to_metro_key("Tokyo")` both return `"TYO"`.
   - `normalize_to_metro_key("BOS")` returns `"BOS"` (standalone, clean metro key — no `_METRO` suffix).
   - `normalize_to_metro_key("san francisco")` returns `"BAY"` (not `"SFO_METRO"`).
   - Verify `dest_to_airports` lookup succeeds for each.

5. **Route node assertion**: Build a route with a node that's NOT in `dest_to_airports`. For multi-city variant path (num_variants > 1), assert `ValueError` is raised. For single-city path, assert a warning is logged and `[node]` fallback is used.

6. **`search_uid` dedup vs `segment_uid` uniqueness**: Create two legs with the same city-pair+date but different `leg_index` (e.g., a loop trip that visits Paris twice). Assert `search_uid` is identical (they share search results), but `segment_uid` is different (they are distinct legs).

7. **Segment-level collapse detection**: Create a segment where `dest_airports = ["CDG"]` but `AIRPORT_TO_METRO["CDG"]` has `["CDG", "ORY"]`. Assert the multi-airport collapse warning is logged.

8. **User preference fields**: Build segments where user typed `"EWR"` for origin. Assert `preferred_origin_airport = "EWR"`, `allowed_origin_airports = ["JFK", "EWR", "LGA"]`, and canonical key is `"NYC"`. Build segments where user typed `"New York"`. Assert `preferred_origin_airport = None`.

9. **Search dispatcher uses `airport_search_pairs` (Bug 6 regression)**: Create a segment with `allowed_destination_airports = ["HND", "NRT"]` and `airport_search_pairs = [("SEA","HND"), ("SEA","NRT")]`. Mock the search call and assert it was called **twice** (once per pair), not once with just `segment["destination"]`. This prevents "someone refactors and accidentally uses only `segment['destination']`."

10. **`METROS` data integrity**: Assert every airport in every `METROS[key]["airports"]` maps back to the correct metro key via `AIRPORT_TO_METRO_KEY`. Assert every name in every `METROS[key]["names"]` maps back via `NAME_TO_METRO_KEY`. Assert no metro key collides with an airport code that belongs to a different metro group.

---

### Phase 1b: Invariant Logging — Per-Leg Airport Count at Each Pipeline Stage

**Priority**: HIGH — Validates Phase 1 in production, catches future regressions

Add a structured log line at each stage that reports, per leg, **both** the intended airports (from segment config) and the actually observed airports (from candidate data). This distinction matters: the allowed list may be correct but search could return 0 results for one airport, which is a data issue, not a bug.

**Log points (4 total)**:

| Stage | Location | Log format |
|-------|----------|------------|
| After segment build | `_build_trip_segments` / `_build_segments_for_route` | `[INVARIANT] seg={search_uid} stage=segment_build allowed_dest=["HND","NRT"] allowed_count=2` |
| After search | `_search_all_segments` | `[INVARIANT] seg={search_uid} stage=search allowed_dest=["HND","NRT"] actual_dest=["HND","NRT"] flight_count=42` |
| After pipeline/prune | `process_candidates_pipeline` | `[INVARIANT] leg=0 stage=post_prune allowed_dest=["HND","NRT"] actual_dest=["HND","NRT"] candidate_count=18` |
| Before ILP | `solver_v3.py` model build | `[INVARIANT] leg=0 stage=pre_ilp allowed_dest=["HND","NRT"] actual_dest=["HND"] edge_count=15` |

**Reading the logs**:
- `allowed_count=2, actual_count=2` → multi-airport working correctly
- `allowed_count=2, actual_count=1` → search or pruning dropped an airport's flights (data issue, not necessarily a bug — that airport may have had 0 results)
- `allowed_count=1` when metro has 2+ → **multi-airport collapse** (bug in segment build or normalization)

The `actual_dest` field is computed by scanning the actual flight candidates/edges at that stage:
```python
actual_dests = sorted(set(
    f.segments[-1].destination
    for f in leg_flights
    if f.segments
))
```

---

### Phase 2: Consolidate METRO_AIRPORTS (Bug 4)

**Priority**: MEDIUM — Cheap refactor, eliminates solver→orchestrator import coupling

Moved up in sequence because:
- It's 30 minutes of work
- The solver currently imports `METRO_AIRPORTS` from `orchestrator.py` (line 1002), which is a layer violation (optimization shouldn't depend on orchestration)
- Doing this before Phase 3 means the adapter and solver both use the canonical source before we touch cross-validation logic

#### Step 2.1: Create shared module — single source of truth with derived lookups

**File**: `backend/src/config/metro_airports.py` (new)

**Key design**: Define metro groups **once** and generate all derivative mappings from them. This eliminates the drift risk of maintaining separate dicts for city keys, airport lists, and name aliases.

```python
METROS: dict[str, dict] = {
    "NYC": {"names": ["new york", "nyc"], "airports": ["JFK", "EWR", "LGA"]},
    "TYO": {"names": ["tokyo"], "airports": ["HND", "NRT"]},
    "PAR": {"names": ["paris"], "airports": ["CDG", "ORY"]},
    "LON": {"names": ["london"], "airports": ["LHR", "LGW", "STN", "LTN"]},
    "LAX": {"names": ["los angeles", "la"], "airports": ["LAX"]},
    "BAY": {"names": ["san francisco", "sf", "bay area"], "airports": ["SFO", "OAK", "SJC"]},
    "CHI": {"names": ["chicago"], "airports": ["ORD", "MDW"]},
    "WAS": {"names": ["washington", "washington dc", "dc"], "airports": ["DCA", "IAD", "BWI"]},
    "MIA": {"names": ["miami"], "airports": ["MIA", "FLL"]},
    "DFW": {"names": ["dallas"], "airports": ["DFW", "DAL"]},
    "IAH": {"names": ["houston"], "airports": ["IAH", "HOU"]},
    "BOS": {"names": ["boston"], "airports": ["BOS"]},
    "MIL": {"names": ["milan"], "airports": ["MXP", "LIN"]},
    "ROM": {"names": ["rome"], "airports": ["FCO", "CIA"]},
    "FRA": {"names": ["frankfurt"], "airports": ["FRA"]},
    "AMS": {"names": ["amsterdam"], "airports": ["AMS"]},
    "SEL": {"names": ["seoul"], "airports": ["ICN", "GMP"]},
    "SHA": {"names": ["shanghai"], "airports": ["PVG", "SHA"]},
    "BJS": {"names": ["beijing"], "airports": ["PEK", "PKX"]},
    "HKG": {"names": ["hong kong"], "airports": ["HKG"]},
    "SIN": {"names": ["singapore"], "airports": ["SIN"]},
    "DXB": {"names": ["dubai"], "airports": ["DXB", "DWC"]},
    "SEA": {"names": ["seattle"], "airports": ["SEA"]},
    # ... add new metros here — all lookups auto-generate
}

# --- Generated lookups (never manually curate these) ---

# metro_key → airport list (backward compat with existing METRO_AIRPORTS consumers)
METRO_AIRPORTS: dict[str, list[str]] = {}
for _key, _meta in METROS.items():
    for _name in _meta["names"]:
        METRO_AIRPORTS[_name] = _meta["airports"]

# airport code → metro key
AIRPORT_TO_METRO_KEY: dict[str, str] = {}
for _key, _meta in METROS.items():
    for _code in _meta["airports"]:
        AIRPORT_TO_METRO_KEY[_code] = _key

# airport code → all airports in same metro (backward compat)
AIRPORT_TO_METRO: dict[str, list[str]] = {}
for _key, _meta in METROS.items():
    for _code in _meta["airports"]:
        AIRPORT_TO_METRO[_code] = _meta["airports"]

# city name/alias → metro key
NAME_TO_METRO_KEY: dict[str, str] = {}
for _key, _meta in METROS.items():
    for _name in _meta["names"]:
        NAME_TO_METRO_KEY[_name] = _key

def expand_to_metro(airport_or_city: str) -> list[str]:
    """
    Single entry point for metro expansion. Works for both airport codes
    and city names. Never rebuild reverse lookups in consuming modules.
    
    Examples:
      expand_to_metro("JFK")       → ["JFK", "EWR", "LGA"]
      expand_to_metro("new york")  → ["JFK", "EWR", "LGA"]
      expand_to_metro("BOS")       → ["BOS"]  (standalone)
      expand_to_metro("unknown")   → []
    """
    code_upper = airport_or_city.strip().upper()
    if code_upper in AIRPORT_TO_METRO:
        return list(AIRPORT_TO_METRO[code_upper])
    
    city_lower = airport_or_city.strip().lower()
    if city_lower in NAME_TO_METRO_KEY:
        return list(METROS[NAME_TO_METRO_KEY[city_lower]]["airports"])
    
    for city_name in NAME_TO_METRO_KEY:
        if city_lower in city_name or city_name in city_lower:
            return list(METROS[NAME_TO_METRO_KEY[city_name]]["airports"])
    
    return []

def normalize_to_metro_key(location: str) -> str | None:
    """
    Map any location string to its metro key, or None if unknown.
    
    This is the canonical normalization used by _normalize_dest_key.
    
    Examples:
      normalize_to_metro_key("JFK") → "NYC"
      normalize_to_metro_key("EWR") → "NYC"
      normalize_to_metro_key("tokyo") → "TYO"
      normalize_to_metro_key("Paris (CDG,ORY)") → "PAR"
      normalize_to_metro_key("unknown") → None
    """
    # 1. Airport code
    code_upper = location.strip().upper()
    if code_upper in AIRPORT_TO_METRO_KEY:
        return AIRPORT_TO_METRO_KEY[code_upper]
    
    # 2. City name
    city_lower = location.strip().lower()
    if city_lower in NAME_TO_METRO_KEY:
        return NAME_TO_METRO_KEY[city_lower]
    
    # 3. Parenthesized: "Tokyo (HND)" or "Paris (CDG,ORY)"
    if "(" in location and ")" in location:
        city_part = location[:location.index("(")].strip().lower()
        if city_part in NAME_TO_METRO_KEY:
            return NAME_TO_METRO_KEY[city_part]
        codes_part = location[location.index("(")+1:location.index(")")]
        first_code = codes_part.split(",")[0].strip().upper()
        if first_code in AIRPORT_TO_METRO_KEY:
            return AIRPORT_TO_METRO_KEY[first_code]
    
    # 4. Partial match
    for city_name in NAME_TO_METRO_KEY:
        if city_lower in city_name or city_name in city_lower:
            return NAME_TO_METRO_KEY[city_name]
    
    return None
```

**Why this design**:
- **One source of truth**: `METROS` dict is the only thing you manually edit. All other lookups are generated.
- **No drift**: Adding a city means adding one entry to `METROS`. All lookups (`AIRPORT_TO_METRO_KEY`, `NAME_TO_METRO_KEY`, etc.) auto-update.
- **Clean metro keys**: `"NYC"`, `"BAY"`, `"WAS"`, `"TYO"` — proper metro/city codes, not awkward `"SFO_METRO"` or `"DCA_METRO"` suffixes.
- **`normalize_to_metro_key`**: The canonical normalization function lives next to the data it depends on, not in orchestrator.

#### Step 2.2: Update consumers

| File | Change |
|------|--------|
| `orchestrator.py` | `from ..config.metro_airports import METRO_AIRPORTS, AIRPORT_TO_METRO, expand_to_metro, normalize_to_metro_key, AIRPORT_TO_METRO_KEY` — delete local `METRO_AIRPORTS`, `_AIRPORT_TO_METRO`, `_expand_to_metro()`, and `_normalize_dest_key()` implementation (it now delegates to `normalize_to_metro_key`) |
| `adapter_v3.py` | `from ..config.metro_airports import METRO_AIRPORTS, expand_to_metro` — delete `_get_metro_airports()` |
| `solver_v3.py` | `from src.config.metro_airports import METRO_AIRPORTS` — no longer imports from orchestrator |

---

### Phase 3: Fix Cross-Validation for Multi-Airport Legs (Bug 3)

**Priority**: MEDIUM — Affects all multi-airport trips, not just multi-city

#### Step 3.1: Fetch SerpAPI data for strategically selected airport pairs

**File**: `backend/src/optimization/adapter_v3.py`

**Strategy**: Don't blindly fetch every O-D pair, but pure density ranking can miss the best pair (an airport with fewer candidates may have the cheapest/best-award flights). Use a **hybrid heuristic** that guarantees important pairs are always validated.

**Important**: Cash flights and award flights may be separate object types in the codebase. Cash candidates may have `price` but no `award_options`; award candidates may have `surcharge` but no `price`. The heuristic must handle both cleanly instead of silently degrading to "density only" when `hasattr` checks fail.

```python
for leg_id, leg_flights in flights_by_leg.items():
    # Collect unique O-D pairs with metadata
    # Robust: inspect actual flight data structure, not assumed attributes
    od_pair_stats: dict[tuple[str,str,str], dict] = {}
    for f in leg_flights:
        if not f.segments:
            continue
        key = (f.segments[0].origin,
               f.segments[-1].destination,
               f.segments[0].departure.strftime("%Y-%m-%d"))
        if key not in od_pair_stats:
            od_pair_stats[key] = {
                "count": 0,
                "min_cash": float("inf"),
                "min_award_surcharge": float("inf"),
                "has_cash": False,
                "has_award": False,
            }
        stats = od_pair_stats[key]
        stats["count"] += 1
        
        # Cash price: check both FlightItineraryEdge.price and .cash_price
        cash = getattr(f, "price", None) or getattr(f, "cash_price", None)
        if cash and cash > 0:
            stats["min_cash"] = min(stats["min_cash"], cash)
            stats["has_cash"] = True
        
        # Award: check for award_options list OR award-specific attributes
        award_opts = getattr(f, "award_options", None)
        surcharge = getattr(f, "surcharge", None) or getattr(f, "taxes_and_fees", None)
        if award_opts:
            stats["has_award"] = True
            if surcharge and surcharge > 0:
                stats["min_award_surcharge"] = min(stats["min_award_surcharge"], surcharge)

    # --- Priority selection (cap at 3 total) ---
    must_include = set()
    
    # 1. Always include the pair with the cheapest cash flight (if any cash exists)
    cash_pairs = {p: s for p, s in od_pair_stats.items() if s["has_cash"]}
    if cash_pairs:
        cheapest_cash_pair = min(cash_pairs, key=lambda k: cash_pairs[k]["min_cash"])
        must_include.add(cheapest_cash_pair)
    
    # 2. Always include the pair with lowest-surcharge award (if any awards exist)
    award_pairs = {p: s for p, s in od_pair_stats.items() if s["has_award"]}
    if award_pairs:
        best_award_pair = min(award_pairs, key=lambda k: award_pairs[k]["min_award_surcharge"])
        must_include.add(best_award_pair)
    
    # 3. Fill remaining slots by candidate density
    remaining = 3 - len(must_include)
    if remaining > 0:
        density_ranked = sorted(
            [p for p in od_pair_stats if p not in must_include],
            key=lambda k: -od_pair_stats[k]["count"],
        )
        must_include.update(density_ranked[:remaining])
    
    pairs_to_validate = list(must_include)

    logger.info(
        f"[V3 Adapter] Leg {leg_id}: {len(od_pair_stats)} unique O-D pairs, "
        f"validating {len(pairs_to_validate)} "
        f"(cash_pairs={len(cash_pairs)}, award_pairs={len(award_pairs)})"
    )

    # Fetch SerpAPI for each selected pair
    combined_serp_lookup = {}
    for origin, dest, dep_date in pairs_to_validate:
        try:
            serp = get_google_flights(
                origin=origin, destination=dest, outbound_date=dep_date
            )
            if serp:
                pair_lookup = extract_flight_numbers_from_serpapi(serp)
                combined_serp_lookup.update(pair_lookup)
                logger.info(
                    f"[V3 Adapter] Leg {leg_id}: SerpAPI {origin}->{dest}: "
                    f"{len(pair_lookup)} flight numbers"
                )
        except Exception as e:
            logger.warning(f"[V3 Adapter] Leg {leg_id}: SerpAPI {origin}->{dest} failed: {e}")

    # Validate each flight against the combined lookup
    for flight in leg_flights:
        # ... validate using combined_serp_lookup (same logic as today)
```

**Alternative for future optimization**: Validate only the final chosen itinerary + near-optimal alternatives (post-solve). This removes cross-validation from the critical path entirely and eliminates the SerpAPI cost scaling problem. This is the clean long-term solution — noted as a future improvement, not done now.

#### Step 3.2: Airport-aware AND flight-number-aware award option attachment

The current attachment key `(leg_id, airline_code)` is too coarse. A match cascade with decreasing specificity:

```python
# Preference order for attaching award options to SerpAPI flights:
#
# 1. EXACT: (leg_id, carrier, flight_number, origin, destination, date)
#    → Only possible when AwardTool returned real flight numbers
#
# 2. ROUTE+CARRIER: (leg_id, carrier, origin, destination, date)
#    → Correct airport pair, correct airline, same day
#
# 3. AIRPORT+ALLIANCE: (leg_id, destination_airport, alliance_carrier, date)
#    → Right airport, alliance partner (e.g., NH award on UA metal to NRT)
#    → NOTE: (origin, dest, date) is MANDATORY for any fallback beyond exact match.
#      Without it, the same carrier to different airports will collide.
#
# 4. ALLIANCE FALLBACK: (leg_id, alliance_carrier, date)
#    → Last resort. May cross airports. Use only if levels 1-3 all fail.
#    → Log a warning when this fires — indicates award data quality issue.
```

**Critical constraint**: `(origin, dest, date)` must be part of the key at levels 1-3. Without it, UA award options for NRT will match UA flights to HND (same carrier, same leg, different airport). This is the most common mis-attachment scenario in multi-airport cities with alliance hub overlap (e.g., Tokyo: ANA hub at HND, but NH* partner awards often route through NRT).

**Date normalization requirement**: "date" must be a consistent representation in both sources (award collection and cash flight validation). Pitfalls:
- Local date vs UTC date can differ for overnight/international flights
- Departure date vs segment date vs itinerary date can differ across time zones
- AwardTool may return dates in the origin airport's local time; SerpAPI returns in its own format

**Fix**: Normalize all dates to **departure date in the origin airport's local time**, formatted as `YYYY-MM-DD`. Add a single normalization function:

```python
def _normalize_flight_date(flight_or_segment) -> str:
    """
    Return departure date as YYYY-MM-DD in origin airport local time.
    All award/cash matching uses this as the canonical date.
    """
    # Use whatever date representation is already standard in the codebase
    # (likely departure datetime → .date().isoformat())
    # The key is: ONE function, used everywhere, so sources agree.
    dep = flight_or_segment.segments[0].departure
    return dep.strftime("%Y-%m-%d")
```

If the codebase already has a standard date convention, use it — the point is to ensure both sides of every match key call the same function.

Implementation: When collecting award options from placeholder flights, store them with full route context and normalized date:

```python
award_option_entry = {
    "option": opt,
    "origin": flight.segments[0].origin if flight.segments else "",
    "destination": flight.segments[-1].destination if flight.segments else "",
    "carrier": airline_code,
    "flight_number": flight_nums[0] if flight_nums else None,
    "date": _normalize_flight_date(flight),  # normalized, not raw
}
```

When attaching, attempt matches in cascade order. Log which level matched so we can track attachment quality:

```python
logger.info(
    f"[V3] flight={flight.edge_id} award_attached via={match_level} "
    f"program={opt.program} miles={opt.miles_required}"
)
```

If Level 4 (alliance fallback) fires, also log a warning — it means the mandatory `(origin, dest, date)` didn't match at any higher level, which suggests a date normalization mismatch or a data quality issue worth investigating.

---

### Phase 4: Audit Upstream Baselines (Bug 5)

**Priority**: MEDIUM — Prevents guardrail mis-calibration after multi-airport is fixed

#### Step 4.1: Fix `_estimate_best_cash_price`

**File**: `backend/src/agents/orchestrator.py`

Audit this function to ensure it computes `min(cash_price)` across ALL flights for the leg, not just flights to one airport. If it iterates `search_results[f"flight_{i}"]`, the `search_uid` change from Phase 1 already fixes the lookup correctness. But verify the min is across all options in the consolidated result (which includes flights to all metro airports).

#### Step 4.2: Audit ALL per-leg baselines (not just `_estimate_best_cash_price`)

These baselines often live outside `_estimate_best_cash_price` and quietly bias tiers:

Search for patterns in orchestrator.py, adapter_v3.py, and any pricing helpers:

```
# Grep targets:
"best_cash"
"min_cash"
"cheapest"
"baseline"
"reference_price"
"best_price"
"cash_baseline"
"cheapest_alternative"
"budget_feasibility"
"best_for_trip"
```

**Specific baselines to verify**:

| Baseline | Where it likely lives | What to check |
|----------|----------------------|---------------|
| `best_cash_price` per leg (budget tier `r = budget / best_cash`) | orchestrator or adapter | Must be `min()` across ALL airport variants, not just primary |
| "best cash for entire trip" (sum of per-leg minima) | orchestrator | Each per-leg minimum must already span all airports |
| "cheapest alternative shown to user" | response formatting / solo_trip_service | Must not re-query with single airport |
| "budget feasibility" pre-check | orchestrator / trip setup | If it estimates whether trip is affordable before searching, it may use a single O-D pair |
| Per-leg `min()` used for CPP guardrail calibration | adapter_v3 | Must span all metro airports |
| **"best CPP option"** per leg | adapter_v3 or solver output | If this picks first airport pair's best, it anchors the "value" comparison wrong |
| **"best award option"** per leg | adapter_v3 or orchestrator | If this selects the best award from only one airport, the user sees misleading "best value" |
| **"best value per point"** (miles/$ ratio) | adapter_v3 or response formatting | Often computed as `cash_price / miles_required` — both numerator and denominator must span all airports |

These "best X" baselines are often used in the UI as "alternatives" or "comparison anchors." If they're anchored to one airport's data, the user sees misleading comparisons even when the solver itself handles multi-airport correctly.

For each hit, verify the computation iterates over all airport variants for the city, not just the primary airport's flights.

#### Step 4.3: Audit pruning group keys

In `pruning.py`, verify that the grouping key `(leg_id, origin_airport, destination_airport, date)` groups per-airport-pair (correct — each pair gets independent quota). Also verify that any city-level cap (if added later per improvement 7.4 in the research doc) doesn't accidentally drop all candidates for an airport with fewer flights.

---

## Bug 6 (RISK): Search Dispatcher May Ignore `airport_search_pairs`

### Location
`backend/src/agents/orchestrator.py` — `_search_all_segments` and any SERP-only fallback paths

### Root Cause (suspected, needs verification)
Even after Bugs 1-4 are fixed and segments carry correct `airport_search_pairs`, multi-airport will still collapse if the search dispatcher doesn't actually loop over those pairs.

Two failure modes:
1. `_search_all_segments` ignores `airport_search_pairs` and instead calls the search API once with `segment["origin"]` and `segment["destination"]` (single airport pair).
2. A SERP-only fallback path (used when AwardTool is unavailable or for specific routes) constructs its own single-airport query from `segment["origin"]` / `segment["destination"]`.

### Verification (Phase 1, during implementation)

Before writing any fix code, verify:

```python
# In _search_all_segments, look for:
# GOOD: loops over segment["airport_search_pairs"]
for orig_apt, dest_apt in segment.get("airport_search_pairs", [(segment["origin"], segment["destination"])]):
    results.extend(search(origin=orig_apt, destination=dest_apt, ...))

# BAD: single call with segment["origin"]
results = search(origin=segment["origin"], destination=segment["destination"], ...)
```

If it's the "BAD" pattern anywhere, fix it as part of Phase 1 — otherwise Phase 1 is incomplete.

The invariant logs at "search stage" (Phase 1b) will catch this immediately: if `actual_dest` after search shows only one airport while `allowed_dest` shows two, the search dispatcher is the culprit.

### Required unit test (not just manual audit)

This is exactly the kind of thing that regresses when someone refactors the search layer. Add a test that prevents it permanently (included as test case 9 in Step 1.3):

```python
def test_search_dispatcher_uses_airport_search_pairs():
    """
    Verify _search_all_segments calls search for EACH pair in
    airport_search_pairs, not just segment["origin"]/segment["destination"].
    """
    segment = {
        "type": "flight",
        "search_uid": "search_abc",
        "segment_uid": "seg_abc",
        "origin": "SEA",
        "destination": "HND",
        "date": "2026-04-01",
        "allowed_destination_airports": ["HND", "NRT"],
        "airport_search_pairs": [("SEA", "HND"), ("SEA", "NRT")],
    }
    
    with mock.patch("...search_function") as mock_search:
        mock_search.return_value = FlightSearchResult(options=[])
        _search_all_segments([segment], ...)
        
        # Must be called for BOTH pairs
        call_args = [call.kwargs for call in mock_search.call_args_list]
        searched_dests = {args["destination"] for args in call_args}
        assert searched_dests == {"HND", "NRT"}, (
            f"Search only called for {searched_dests}, "
            f"expected both HND and NRT from airport_search_pairs"
        )
```

### Impact
- **Who's affected**: ALL trips to multi-airport cities (even simple round-trips)
- Would make ALL other fixes moot — segments would carry correct multi-airport data but search would still only query one pair

---

## Verification Plan

### Manual Testing

1. **Simple round-trip to multi-airport city**: SEA → Tokyo (HND) → SEA
   - Verify invariant logs show `allowed_count=2` dest airports at every stage
   - Verify `actual_dest` at search stage includes both HND and NRT
   - Verify optimizer sees flights to both HND and NRT
   - Verify result picks the cheapest option across both airports

2. **Multi-city trip**: SEA → Paris → Rome → SEA
   - Verify both route permutations get correct flight data (check `search_uid` in logs)
   - Verify each variant's legs map to the right city pairs
   - Verify airports: Paris legs include CDG+ORY, Rome legs include FCO+CIA

3. **City name input**: User types "New York" (not "JFK")
   - Verify expansion to JFK, EWR, LGA
   - Verify all three airports are searched and available to optimizer
   - Verify budget tier computation uses best cash across all 3 airports

4. **Mixed format input**: User types "HND" for Tokyo, another types "Tokyo"
   - Verify `_normalize_dest_key` produces same canonical key (`"TYO"`) for both
   - Verify `dest_to_airports` lookup succeeds in both cases

5. **User-typed specific airport**: User types "EWR" (not "New York")
   - Verify canonical key is `"NYC"` (not `"JFK"`)
   - Verify `dest_to_airports["NYC"]` includes all three airports
   - Verify `preferred_destination_airport = "EWR"` on the segment
   - Verify user preference is not silently converted to JFK

6. **Search dispatcher verification**: For a multi-airport leg, confirm `_search_all_segments` actually makes search calls for each airport pair (not just the primary)

### Automated Testing (10 test cases — see Step 1.3 for full specs)

- `_build_segments_for_route` emits full segment schema including dual UIDs and preference fields
- **Index-mismatch regression**: variant 2 of a multi-city trip gets correct city-pair results (fails without fix)
- Canonical key normalization via `normalize_to_metro_key`: `"EWR"` → `"NYC"`, `"JFK"` → `"NYC"`, `"BOS"` → `"BOS"`, `"san francisco"` → `"BAY"`
- `search_uid` dedup: same city-pair+date → same `search_uid`; different `segment_uid` per leg instance
- Route node assertion catches missing `dest_to_airports` entries (hard fail for multi-city, warn for single-city)
- Segment-level collapse detection logs warning when a known multi-airport city resolves to single airport
- User preference fields: explicit airport code → `preferred_*_airport` set; city name → `None`
- **Search dispatcher mock test (Bug 6)**: `_search_all_segments` calls search for each pair in `airport_search_pairs`, not just `segment["destination"]`
- `METROS` data integrity: every airport round-trips through `AIRPORT_TO_METRO_KEY`, every name through `NAME_TO_METRO_KEY`
- Cross-validation with type-aware pair selection: cheapest-cash and lowest-surcharge-award pairs always included
- Award attachment cascade: exact match preferred over alliance fallback; `(origin, dest, normalized_date)` mandatory for levels 1-3
- Budget tier: `best_cash_price` is min across all metro airports, not just primary
- No `flight_{i}` keys remaining in `search_results` (conditional assertion, strict in dev)

### Invariant Log Verification

After deployment, for a SEA → Tokyo trip:
```
[INVARIANT] seg=search_abc123 stage=segment_build allowed_dest=["HND","NRT"] allowed_count=2
[INVARIANT] seg=search_abc123 stage=search allowed_dest=["HND","NRT"] actual_dest=["HND","NRT"] flight_count=42
[INVARIANT] leg=0 stage=post_prune allowed_dest=["HND","NRT"] actual_dest=["HND","NRT"] candidate_count=18
[INVARIANT] leg=0 stage=pre_ilp allowed_dest=["HND","NRT"] actual_dest=["HND"] edge_count=15
```

Reading the logs:
- `allowed_count=2, actual_count=2` → multi-airport working correctly
- `allowed_count=2, actual_count=1` → search or pruning dropped an airport (data issue — may have 0 flights for that airport)
- `allowed_count=1` when metro has 2+ → **collapse bug** — regression in normalization or segment build

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Phase 1 (data-driven normalization via `METROS`) | LOW — all keys derived from single dict, no manual curation drift | `METROS` data integrity test (test 10); `normalize_to_metro_key` has full unit coverage |
| Phase 1 (dual `search_uid` + `segment_uid`) | LOW-MEDIUM — new identifiers, but `f"flight_{i}"` fallback preserves backward compat | Fallback keeps legacy callers working; conditional assertion (strict in dev, metric in prod); adapter-side UID presence check |
| Phase 1 (explicit preference fields) | LOW — additive, no behavior change unless solver consumes them | Fields are optional/nullable; existing "first in list" behavior continues until solver tie-break is wired |
| Phase 1 (`_build_segments_for_route`) | LOW — additive change, single-route path unchanged | Assertion on route nodes catches missing keys; hard fail for multi-city variant path |
| Phase 1 (UID consumer audit) | LOW — mechanical migration | Grep-driven `flight_{i}` → `search_uid`/`segment_uid`; conditional assertion prevents re-introduction |
| Phase 1b (invariant logs) | ZERO — read-only logging | No behavior change; gives free regression detection; logs both intent and reality |
| Phase 2 (`METROS` single-source consolidation) | LOW — pure refactor, data structure is self-verifying | Import-level change; data integrity test catches any METROS entry that doesn't round-trip through lookups |
| Phase 3 (cross-validation multi-airport) | MEDIUM — increases SerpAPI calls, touches award attachment | Type-aware heuristic handles separate cash/award objects; cascade matching logged; `(origin,dest,normalized_date)` mandatory for levels 1-3 |
| Phase 3 (date normalization) | LOW-MEDIUM — date representation change could reduce matching if done wrong | Single normalization function, tested against both data sources; Level 4 fallback warning catches normalization mismatches |
| Phase 4 (baseline audit) | LOW — read-and-fix pattern | Grep-driven; each fix is local; expanded scope (CPP, award value, budget feasibility) reduces missed baselines |
| Bug 6 (search dispatcher) | DEPENDS — if dispatcher already uses pairs, risk is ZERO; if not, it's a Phase 1 blocker | **Unit test with mocked search** prevents regression; invariant logs at search stage catch it in prod |

---

## Definition of Done

- [ ] For a multi-airport destination, the ILP input for that leg contains edges whose dest airports include **all metro airports** (not just the primary).
- [ ] For multi-city with permutations, each variant leg pulls search results for its **actual city-pair** (no index leakage). Verified by regression test that fails without fix.
- [ ] No `flight_{i}` keys remain in any dict that stores or looks up search results. Verified by conditional assertion (hard fail in dev/staging, metric + log in prod).
- [ ] `normalize_to_metro_key("EWR")` and `normalize_to_metro_key("JFK")` both produce `"NYC"` — all normalization is derived from the single `METROS` dict, no manually curated secondary mapping.
- [ ] User-typed airport preference is preserved in explicit `preferred_destination_airport` field on segments — not overloaded via list ordering.
- [ ] Cross-validation does **not** misattach NRT awards to HND flights (or JFK/EWR mixups). Verified by cascade match logging with mandatory `(origin, dest, normalized_date)` at levels 1-3. Level 4 fallback logs a warning.
- [ ] Date normalization function used consistently by both award collection and cash flight validation. No local-vs-UTC mismatch in match keys.
- [ ] Invariant logs show both `allowed_dest` (intent) and `actual_dest` (reality) at every pipeline stage for a known multi-airport trip.
- [ ] `best_cash_price` baseline for budget tiers is computed across all metro airport variants, not just the primary. "Best CPP", "best award", and "best value per point" baselines also audited.
- [ ] `METROS` dict is the single source of truth in `backend/src/config/metro_airports.py`; all lookups (`AIRPORT_TO_METRO_KEY`, `NAME_TO_METRO_KEY`, `METRO_AIRPORTS`) are generated from it; solver does not import from orchestrator; `expand_to_metro()` and `normalize_to_metro_key()` helpers exposed.
- [ ] Search dispatcher (`_search_all_segments`) loops over `airport_search_pairs`, not just `segment["origin"]`/`segment["destination"]`. Verified by **unit test with mocked search call** (not just manual audit) and by invariant logs at search stage.
- [ ] Multi-city variant path hard-fails if a route node is not in `dest_to_airports` (wrong flights are worse than no result).
- [ ] Adapter asserts that every incoming segment has both `search_uid` and `segment_uid`, and that `search_uid` exists in `search_results`.

---

## Estimated Effort

| Phase | Effort | Files Changed |
|-------|--------|---------------|
| Phase 2 (implement first: `METROS` dict + generated lookups + `normalize_to_metro_key` + `expand_to_metro`) | 1 hour | new `metro_airports.py`, `orchestrator.py`, `adapter_v3.py`, `solver_v3.py` |
| Phase 1 (normalization delegation + dual UIDs + preference fields + segment builder + UID consumer audit + Bug 6 unit test) | 4-5 hours | `orchestrator.py`, `adapter_v3.py`, new test file |
| Phase 1b (invariant logs with intent+reality) | 45 min | `orchestrator.py`, `pipeline.py`, `solver_v3.py` |
| Phase 3 (type-aware cross-validation heuristic + award cascade with date normalization) | 2-3 hours | `adapter_v3.py` |
| Phase 4 (expanded baseline audit incl. CPP, award value, budget feasibility) | 1-2 hours | `orchestrator.py`, `adapter_v3.py`, `pruning.py`, possibly `solo_trip_service.py` |
| **Total** | **9-12 hours** | |

**Note**: Phase 2 is listed first in the effort table because it should be *implemented* first (it's the data foundation), even though it's numbered "Phase 2" by risk priority. The numbering reflects priority of the *bug* it fixes, not implementation order.
