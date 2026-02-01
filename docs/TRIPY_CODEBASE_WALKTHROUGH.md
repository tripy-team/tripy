## Tripy codebase walkthrough (frontend → backend)

This document explains **how Tripy works end-to-end**, from the Next.js frontend through the FastAPI backend and into the “points arbitrage engine” that searches flights/hotels, chooses cash vs points, and produces **transfer + booking instructions**.

It is written to align with the product definition in `docs/TRIPY_SOURCE_OF_TRUTH.md`: **Tripy is a points arbitrage engine** that finds the gap between “official” points value and “strategic redemption” value, while keeping the UX simple and transparent.

> Note on scope: “the code in its entirety” is a large surface area. This doc focuses on the **core user journeys and the core execution paths** (the functions that actually create trips, store points, run optimization, evaluate policy, and render/lock booking instructions). For supporting subsystems (images, airports/cities autocomplete, dashboards, etc.) this doc explains how they connect to the main flow and points you to the key modules.

---

## What Tripy does (as implemented)

- **Collect inputs**: trip parameters (origin, destinations, dates/flexibility, preferences), and point balances across banks + programs.
- **Search inventory**:
  - **Cash options** (Google Flights via SerpAPI).
  - **Award options** (AwardTool award search for points + surcharges).
  - **Hotels** (AwardTool hotel API; optionally SerpAPI hotels).
- **Optimize**:
  - Choose **which flights/hotels to pay with points vs cash**.
  - Choose **which transferable bank points (Chase/Amex/Citi/…) to transfer to which airline/hotel program**.
  - Produce a ranked list of itineraries by the selected objective (primarily **minimize out-of-pocket**, but also supports **maximize CPP** and **balanced**).
- **Apply “policy” safety rules**:
  - **Flag** risky options (unprotected/unknown connections, basic economy restrictions, irreversibility of transfers, etc.).
  - **Sometimes disable** options in backend results (depends on which API surface you’re using and whether the policy fields are preserved to the UI; see “Policy: current coverage vs aspirational”).
- **Present results + booking guidance**:
  - Results page shows ranked itineraries with OOP/cash/points metrics.
  - User selects an itinerary; backend stores a **snapshot** to keep the booking page stable even if inventory changes.
  - Booking page has a **UI lock** for step-by-step transfer instructions (currently demo / not enforced server-side; see “Payment & unlock: what is actually enforced”).

---

## Truth table: what’s real vs aspirational (so engineers don’t get misled)

Tripy is evolving quickly; a lot of “product intent” exists in code but is not fully wired end-to-end. Use this as a quick honesty map.

Legend:

- ✅ **Implemented + used in the main solo flow**
- 🟡 **Implemented but partially wired / best-effort / only on one API surface**
- ❌ **Not implemented or not reliably derivable from provider data**

| Capability | Status | Notes / where |
|---|---:|---|
| Solo trip create → points upsert → optimize → select snapshot → transfer strategy | ✅ | `/solo/*` (`backend/src/routes/solo.py`, `backend/src/services/solo_trip_service.py`, `frontend/src/app/(app)/solo/*`) |
| Out-of-pocket-first optimization | ✅ | Orchestrator + V3 solver (`backend/src/agents/orchestrator.py`, `backend/src/optimization/*`) |
| CPP / Balanced optimization modes | 🟡 | Modes exist in V3; UI stores `optimizationMode`, but verify which mode is actually passed through in each endpoint path |
| Policy evaluation attached to itineraries | 🟡 | Attached in V3 adapter (`backend/src/optimization/adapter_v3.py`); **solo API currently does not surface policy fields in its response schema** |
| “Safe / balanced / aggressive” risk mode end-to-end | 🟡 | UI components exist (`frontend/src/components/policy/*`), backend can evaluate, but enforcement/ack gating is not consistently wired |
| “Single ticket / PNR guaranteed” | ❌ | Can be inferred best-effort from provider structure; cannot be guaranteed from scraped data (see “Ticketing / PNR certainty”) |
| Secure paywall for instructions | ❌ | Current lock is frontend-only; backend still returns `transfer-strategy` payload if you call it (see “Payment & unlock”) |
| No sentinel pricing values (`-1`) ever leak | 🟡 | There are multiple sanitization layers, but leaks can still happen via legacy paths or snapshot persistence (see “No-sentinel contract”) |

---

## Architecture at a glance

### Frontend

- **Framework**: Next.js App Router (`frontend/package.json`).
- **Primary screens (solo)**:
  - `frontend/src/app/(app)/solo/setup/page.tsx`: collect trip inputs and points.
  - `frontend/src/app/(app)/solo/results/page.tsx`: run optimization and render itineraries.
  - `frontend/src/app/(app)/solo/booking/page.tsx`: show locked booking/transfer steps, unlock on “payment”.
- **API client**:
  - `frontend/src/lib/api.ts`: typed API client, auth token management, offline mode.
  - `frontend/src/lib/serializers.ts`: camelCase ↔ snake_case converters for API boundaries.
- **Policy UI**:
  - `frontend/src/lib/policyConfig.ts`: frontend mirror of backend reason codes/modes.
  - `frontend/src/components/policy/PolicyWarnings.tsx`: renders blocks/warnings + acknowledgments.

### Backend

- **Framework**: FastAPI (`backend/src/app.py`).
- **Major routers**:
  - “Solo booking” router: `backend/src/routes/solo.py` (prefix `/solo`).
  - “Agentic optimization” router: `backend/src/routes/optimize.py` (prefix `/optimize`).
- **Core engine**:
  - `backend/src/agents/orchestrator.py`: coordinates searches + V3 optimization + ranking.
  - `backend/src/agents/flight_agent.py`: chooses award programs and queries AwardTool + SerpAPI.
  - `backend/src/optimization/adapter_v3.py`: converts agent data into V3 solver input, runs ILP, converts back.
- **Policy**:
  - `backend/src/policy/engine.py`: evaluates flights/hotels/transfers and attaches warnings/blocks.
- **Storage**:
  - Solo trip CRUD + caching + selection snapshot: `backend/src/services/solo_trip_service.py` (DynamoDB tables behind `src.repos.ddb`).
  - Legacy trip endpoints: `backend/src/app.py` + `backend/src/services/*` (also DynamoDB).

---

## End-to-end journey: Solo Trip (the main “points arbitrage” flow)

### High-level sequence

1. **User configures trip** in `SoloTripSetup` (frontend).
2. Frontend calls backend:
   - `POST /solo/trips` (create trip with preferences)
   - `POST /solo/trips/{trip_id}/points` (upsert points balances)
3. Frontend navigates to results and calls:
   - `POST /solo/optimize` (run optimization, caching results)
4. User selects an itinerary:
   - `POST /solo/trips/{trip_id}/select` (store snapshot)
5. Booking page calls:
   - `POST /solo/transfer-strategy` (derive transfers + booking steps from snapshot)
6. Booking page “unlocks” instructions (currently demo payment):
   - `POST /solo/trips/{trip_id}/status` → `instructions_unlocked`

### Frontend: `SoloTripSetup` (trip creation + points upsert)

File: `frontend/src/app/(app)/solo/setup/page.tsx`

Key function: **`handleGenerate`**

- **What it does**:
  - Validates required inputs (origin, end, destinations, date rules).
  - Calls `solo.createTrip(...)` to create the canonical solo trip record on the backend.
  - Calls `solo.upsertPoints(tripId, pointsBalances)` to store the points balances that will be used.
  - Navigates to `solo/results?trip_id=...`.
- **How it ties to the product**:
  - This is where the user expresses “constraints” and “preferences” (budget, class, hotels, bags) while keeping the experience simple.
  - The backend becomes the **source of truth** for these preferences (important later).

API wrapper functions used:

- `solo.createTrip` in `frontend/src/lib/api.ts`
  - Builds a snake_case request payload and calls `POST /solo/trips`.
  - Converts snake_case response → camelCase for UI.
- `solo.upsertPoints`
  - Calls `POST /solo/trips/{tripId}/points` with `points: [{ program, balance }]`.

### Backend: `/solo/trips` and points storage

File: `backend/src/routes/solo.py`

Endpoint: **`create_solo_trip`** (`POST /solo/trips`)

- **Calls**: `solo_trip_service.create_solo_trip(user_id, request)`
- **Returns**: `TripResponse` created from DynamoDB record via `trip_storage_to_response`.

Service function: **`solo_trip_service.create_solo_trip`**

- **Creates** a DynamoDB item (camelCase keys) containing:
  - Route inputs: `origin`, `destinations[]`, `finalDestination`.
  - Date model: `dateMode`, `startDate`, `endDate`, `durationDays`.
  - Preferences: `flightClass`, `hotelClass`, `optimizationMode`, time preferences, party size, etc.
  - Lifecycle fields: `status="draft"`, timestamps, inviteCode.

Points endpoints:

- `GET /solo/trips/{trip_id}/points` → `solo_trip_service.get_points`
  - Queries the points table by `tripId`.
  - Returns `PointsSummaryResponse` with items and total.
- `POST /solo/trips/{trip_id}/points` → `solo_trip_service.upsert_points`
  - Writes items keyed by `tripId` + `userProgram = "{userId}#{program}"`.
  - Stores “manual” balances that the optimizer will treat as available.

### Frontend: Results page (run optimization + select itinerary)

File: `frontend/src/app/(app)/solo/results/page.tsx`

Core behavior:

- On mount, it reads `trip_id` from query string.
- It tries the **new solo optimizer** first:
  - Fetches trip info and points via `solo.getTrip` and `solo.getPoints`.
  - Builds a `pointsMap` and calls `solo.optimize({ tripId, points: pointsMap })`.
  - Displays “solo itineraries” (the new engine output) when available.
- If that fails, it falls back to the **legacy itinerary API** (`/trips/get`, `/itinerary/generate`, `/itinerary/get`) and renders legacy-style itineraries.
  - **Important safety note**: legacy results are not guaranteed to be compatible with the `/solo/*` snapshot + `/solo/transfer-strategy` flow. Treat the legacy fallback as **display-only unless explicitly snapshotted in the solo snapshot schema**.

Key function: **`handleSelectSoloItinerary`**

- **What it does**:
  - Updates selected itinerary in UI.
  - Calls `solo.selectItinerary(tripId, { itineraryId, itinerarySnapshot, cashPriceAtSelection, outOfPocketAtSelection })`.
- **Why snapshot matters**:
  - Award inventory changes quickly; the booking experience must be reproducible and stable.
  - This snapshot is later used to generate booking steps even if optimization cache expires.

### Backend: `/solo/optimize` (run orchestrator, cache results)

File: `backend/src/routes/solo.py`

Endpoint: **`optimize_solo`** (`POST /solo/optimize`)

This is the “solo points arbitrage engine” API used by the solo flow.

Steps inside `optimize_solo`:

1. **Load trip preferences**:
   - `solo_trip_service.get_solo_trip(request.trip_id, user_id)`
   - This makes backend preferences the **source of truth**.
2. **Resolve optimization mode**:
   - `mode = request.optimization_mode_override or trip.get("optimizationMode", "balanced")`
3. **Cache lookup**:
   - Builds a deterministic key with `solo_trip_service.compute_cache_key(...)`.
   - Reads from trip record’s `optimizationCache`.
4. **Build agent request**:
   - Maps UI preferences to agent inputs:
     - `_map_flight_class` → cabin class list (Economy/Business/First…).
     - `_map_hotel_class` → desired star ratings.
   - Constructs `AgentOptimizeSoloRequest` for the orchestrator.
5. **Call orchestrator**:
   - `agent_response = await orchestrator.optimize_solo(agent_request)`
6. **Transform + cache**:
   - `_transform_itineraries(...)` converts agent model objects into the solo API schema for frontend.
   - Stores cache back into the trip record with `solo_trip_service.cache_optimization(...)`.
   - Updates trip status to `"optimized"`.

### Backend engine: `OrchestratorAgent.optimize_solo`

File: `backend/src/agents/orchestrator.py`

Core responsibilities:

- Pull canonical trip data (`_get_trip_data`).
- Build flight/hotel segments (`_build_trip_segments`).
- Search inventory in parallel (`_search_all_segments`).
- Run the optimization solver (V3 primary, greedy fallback) (`_run_oop_optimization`).
- Sort and rank itineraries by **out-of-pocket**.
- Cache each itinerary individually for the `/optimize/breakdown/{itinerary_id}` endpoint (agentic router path).

Key functions and how they work:

- **`_get_trip_data(trip_id)`**
  - Tries the new solo trip storage (`services/solo_trip_service.get_solo_trip`) first.
  - If found, it parses:
    - `origin`
    - `destinations` (strings like `"Paris (CDG,ORY,BVA)"` → chooses first airport code)
    - `finalDestination`
  - Produces a normalized structure with `destinations` annotated as start/intermediate/end for downstream segment building.
  - Falls back to legacy trip storage if solo trip not found.

- **`_build_trip_segments(trip_data)`**
  - Produces an ordered list of segments of the form:
    - `{"type": "flight", "origin": ..., "destination": ..., "date": ...}`
    - Optionally `{"type": "hotel", "city": ..., "check_in": ..., "check_out": ...}`
  - Handles round-trip vs one-way and computes approximate per-city durations.
  - This “segment list” is the bridge between “trip intent” and “inventory search”.

- **`_search_all_segments(segments, ...)`**
  - Creates async tasks for each segment:
    - Flight segments → `FlightAgent.execute(FlightSearchRequest(...))`
    - Hotel segments → `HotelAgent.execute(HotelSearchRequest(...))` (if enabled)
  - Uses `asyncio.gather(..., return_exceptions=True)` and returns a dict keyed by `flight_{i}` / `hotel_{i}`.

#### Partial failure semantics (important “gotchas”)

Because `_search_all_segments` uses `return_exceptions=True`, failures can be silently captured and propagated as “missing/exceptional” segment results rather than crashing the entire request.

Engineers should assume:

- **One segment can fail while others succeed** (network/provider/API-key issues).
- Downstream layers must decide:
  - drop that segment’s options,
  - return fewer/no itineraries,
  - or fall back to a simpler heuristic path.

Where pricing bugs are born:

- Partial provider failures often yield “unknown cash price” or “unknown taxes/fees”.
- If any layer converts “unknown” into a numeric sentinel (e.g. `-1`) instead of `None`, that value can leak into totals, ranking, caching, and snapshots.

Doc contract:

- Segment search failures must produce either:
  - an empty option list, or
  - an explicit error surfaced to the caller,
- but **must not** produce numeric sentinels that look like real prices.

- **`_run_oop_optimization(...)`**
  - Primary path calls V3 solver via `optimization.adapter_v3.run_v3_optimization(...)`.
  - If V3 fails, falls back to `_run_greedy_optimization`.

### Search layer: `FlightAgent.execute`

File: `backend/src/agents/flight_agent.py`

What it does:

1. **Select award programs** (`_select_programs`):
   - Uses `request.user_points` to determine what programs are relevant:
     - Direct airline miles (if present)
     - Transfer partners reachable from bank points (via `TRANSFER_GRAPH`)
   - Optionally asks an LLM to pick top programs when many are available.
2. **Create parallel tasks**:
   - Award searches: `_search_award_flights(...)` per program (AwardTool).
   - Cash searches: `_search_cash_flights(...)` per cabin class (SerpAPI / Google Flights).
3. **Merge and normalize**:
   - Flattens results into a unified `FlightOption` list.
4. **Compute CPP and OOP**:
   - For award options: CPP \(\approx \frac{\text{cash saved}}{\text{points}}\times 100\).
5. **Sort**:
   - Sorts options by the OOP cost (award surcharge when award is used, else cash price).

Important behavioral detail:

- AwardTool can return “no award availability” and that is a valid outcome.
- “Dummy / placeholder” data can still appear in practice under **provider failures**, **missing keys**, or **legacy fallback** paths. Do not assume “no dummy results” globally; treat it as **best-effort** and rely on the “no-sentinel contract” below.

### Optimization layer: V3 adapter and solver

File: `backend/src/optimization/adapter_v3.py`

This module is the glue between:

- **Agent world**: segments + `FlightSearchResult`/`HotelSearchResult` objects.
- **Solver world**: `TripPlanSpec`, `FlightItineraryEdge`, `HotelOption`, `TransferPath`, ILP decision variables.

Main entry point: **`run_v3_optimization(...)`**

High-level algorithm inside `run_v3_optimization`:

1. **Convert trip intent**:
   - `convert_trip_to_spec(trip_data, segments, user_points)` → `TripPlanSpec`
   - Separates:
     - bank balances (transferable)
     - program balances (airline/hotel)
2. **Convert search results**:
   - `convert_search_results_to_flights(search_results, segments)` → list of `FlightItineraryEdge`
   - `convert_search_results_to_hotels(...)` → list of `HotelOption`
   - `build_transfer_paths(user_points)` → list of transfer paths (bank → program)
3. **Sanitize pricing**:
   - Award/cash providers sometimes use sentinel values (e.g. `-1` for “unknown”).
   - The adapter uses `utils.pricing` sanitizers to prevent corrupt totals.
   - When cash price is unknown, it applies an **explicit penalty** so “unknown cash” is not treated as “free”.
4. **(Optional) cross-validate flights**:
   - Uses fresh SerpAPI Google Flights to mark which flight numbers exist.
   - Filters out unverified AwardTool flights in some cases to avoid hallucinated segments.
5. **Run ILP solver**:
   - `optimize_trip(spec, flights, hotels, transfers, mode=...)`
6. **Convert solution back to agent output**:
   - `convert_result_to_itineraries(...)` produces `agents.models.RankedItinerary` objects:
     - Builds per-segment `CashPayment` / `PointsPayment`
     - Builds transfer instructions (when funding source indicates bank transfer)
     - Enriches award flights with real SerpAPI flight details when safe to do so
     - Adjusts hotel check-in based on actual flight arrival
7. **Apply policy** (if enabled):
   - Calls `policy.engine.evaluate_itinerary(...)` and attaches:
     - `policy_evaluation`
     - `disabled` + `disable_reason` when blocked.

### Policy layer (risk modes, warnings, acknowledgments)

Backend: `backend/src/policy/engine.py`

Frontend mirror: `frontend/src/lib/policyConfig.ts`

Core backend functions:

- **`evaluate_itinerary(itinerary, mode, context)`**
  - Delegates:
    - flights → `evaluate_flight_itinerary`
    - hotels → `evaluate_hotel_option`
    - transfers → `_evaluate_transfers`
  - Computes a risk score from reason-code penalties.
- **`apply_policy_to_results(results, mode, context, item_type)`**
  - Runs evaluation per item and attaches a `policy_evaluation` dict.
  - In “safe” mode, can hide blocked options; in other modes, keeps options but marks them disabled.

Key frontend component:

- **`PolicyWarnings`** in `frontend/src/components/policy/PolicyWarnings.tsx`
  - Renders blocks/warnings/info, severity styling, and optional acknowledgment checkboxes.
  - Exposes an “ack modal” (`AcknowledgmentModal`) for workflows that require acknowledgment before proceeding.

This policy layer is how Tripy “hides complexity but preserves trust”: users see the best options, but also get explicit warnings for risky trade-offs.

#### Policy: current coverage vs aspirational

**What exists in code today**

- Backend policy evaluation entry point: `backend/src/policy/engine.py`
- Frontend reason-code mirror and UI components:
  - `frontend/src/lib/policyConfig.ts`
  - `frontend/src/components/policy/PolicyWarnings.tsx`
  - `frontend/src/components/policy/RiskModeSelector.tsx`
- V3 optimization path attaches policy evaluation fields in `backend/src/optimization/adapter_v3.py` (it sets `policy_evaluation`, `disabled`, `disable_reason` on the returned itinerary objects).

**Key gotcha (high impact)**

- The **solo booking API response** (`POST /solo/optimize` in `backend/src/routes/solo.py`) currently transforms itineraries into a solo-specific schema via `_transform_itineraries(...)`.
- That transform path **does not currently include policy fields**, so the solo results UI **cannot reliably render or enforce policy** even if V3 computed it.

**Practical implication**

- If you need “policy is visible and enforceable”, you either:
  - Use `/optimize/solo` (engine surface) which includes policy summary fields, or
  - Extend the solo response schema + `_transform_itineraries` to include `policyEvaluation`, `disabled`, and acknowledgment requirements.

### Selection snapshot + booking guide (transfer strategy)

Frontend selection:

- `SoloResults.handleSelectSoloItinerary` calls `solo.selectItinerary(...)`.

Backend selection storage:

- `solo_trip_service.select_itinerary` stores:
  - `selectedItineraryId`
  - `itinerarySnapshot`
  - `cashPriceAtSelection`
  - `outOfPocketAtSelection`
  - `selectedAt`
  - and transitions `status` to `"selected"`.

Booking guide derivation:

- Endpoint: `POST /solo/transfer-strategy` in `backend/src/routes/solo.py` (`get_transfer_strategy`)
- **Inputs**: `trip_id`, `itinerary_id`
- **Reads**: `solo_trip_service.get_selection` to get the snapshot
- **Outputs**:
  - `transfers`: consolidated transfer instructions (validated against transfer graph when possible)
  - `bookings`: per-segment booking steps (flight + hotel), including booking URLs and payment method
  - timing estimate + warnings

Important helper: **`_is_valid_transfer(bank, program)`**

- Normalizes bank identifiers and program identifiers and checks whether `EXTENDED_TRANSFER_GRAPH` permits the transfer.
- Used to warn users when a transfer instruction seems inconsistent (common in codeshare scenarios where marketing vs operating carrier differ).

### Frontend: booking page and “unlocking”

File: `frontend/src/app/(app)/solo/booking/page.tsx`

Core flow:

- Reads `trip_id`.
- Loads selection + transfer strategy via:
  - `solo.getSelection(tripId)`
  - `solo.getTransferStrategy(tripId, itineraryId)`
- Renders:
  - Savings summary
  - Transfer steps + booking steps
  - A “locked overlay” until payment is simulated
- On “payment”:
  - Calls `solo.updateStatus(tripId, 'instructions_unlocked', paymentProof)` (best-effort).
  - Sets local UI state `isPaid=true` to reveal instructions.

This reflects the product principle “booking gap”: Tripy guides users, but does not directly book on their behalf.

---

## Payment & unlock: what is actually enforced (security note)

The booking page currently implements a **frontend UI lock**, not a backend-enforced paywall.

What the code does today:

- Frontend calls `POST /solo/transfer-strategy` to fetch transfers + booking steps.
- UI overlays/blurs this content until “payment” is simulated.
- On “payment”, frontend *best-effort* calls `POST /solo/trips/{trip_id}/status` to mark `instructions_unlocked`, but the UI unlock is driven by local state.

What is NOT enforced today:

- `POST /solo/transfer-strategy` does **not** check trip status (it does not require `instructions_unlocked`). If a user can call the endpoint, they can receive the full payload.

If you intend to monetize:

- Enforce unlock server-side by either:
  - returning a redacted payload while locked (e.g., omit `portalUrl`, `bookingUrl`, flight numbers), or
  - returning 402/403 until payment is verified.

---

## Ticketing / PNR certainty (do not over-claim)

Tripy uses concepts like “single ticket”, “protected connection”, and “self-transfer risk” in the policy layer and V3 adapter.

**Reality check**:

- Tripy generally does **not** have an authoritative “PNR/ticketing cohesion” signal for most provider data. For scraped cash results (SerpAPI Google Flights) and many award search responses, we can often infer structure, but we cannot guarantee “single reservation” the way an airline ticketing API could.

How to describe this accurately in code/docs:

- Prefer language like:
  - “Tripy treats ticketing as `known_single_ticket` when the source strongly implies it; otherwise it is `unknown_ticketing` and we warn.”
- In `backend/src/optimization/adapter_v3.py`, SerpAPI-derived cash itineraries are treated as “airline protected” because they come from a single priced Google Flights itinerary structure, but that still should be treated as **best-effort**, not a legal guarantee of a single PNR.

---

## Agentic optimization API (`/optimize/*`) vs solo booking API (`/solo/*`)

Tripy currently has **two optimization-facing API surfaces**:

### `/solo/*` (solo booking product flow)

Files:

- Router: `backend/src/routes/solo.py`
- Storage: `backend/src/services/solo_trip_service.py`

Characteristics:

- Opinionated for the solo booking UX:
  - create trip → store points → optimize → select → transfer-strategy
- Caches optimization results **inside the trip record** (4 hour TTL stored as `expires_at`), so it survives restarts without Redis.
- Returns a purpose-built response schema for the solo results and booking pages.

### `/optimize/*` (agentic “engine” surface)

File: `backend/src/routes/optimize.py`

Key endpoints:

- `POST /optimize/solo`
  - Runs the orchestrator and returns itineraries ranked by OOP.
  - Adds policy summary fields like `policySummary` and `riskMode`.
  - Uses `utils/cache_layer` for a short-lived cache keyed by request + user (default 10 minutes).
- `GET /optimize/breakdown/{itinerary_id}`
  - Reads the cached itinerary snapshot (stored as `itinerary:{id}`) and asks the `CostBreakdownAgent` to generate a narrative breakdown.
- `POST /optimize/group` and `POST /optimize/group/allocate`
  - Group optimization paths (the allocation endpoint is the “correct” per-member approach).
- `POST /optimize/dynamic-route`
  - Multi-city route ordering optimizer (permutes intermediate cities and compares results).

The solo booking UI primarily uses `/solo/*`, but the codebase also exposes `/optimize/*` for engine-level access and experimentation.

---

## Group trips (current state)

Tripy has two group-related stacks:

1. **Legacy group endpoints** in `backend/src/app.py` (prefix `/group/{trip_id}/...`)
   - `GET /group/{trip_id}/points-pool`
   - `POST /group/{trip_id}/optimize-oop`
   - `POST /group/{trip_id}/simulate-allocation`
   - settlement endpoints (currently TODO/placeholder storage)
2. **Agentic group optimization endpoints** in `backend/src/routes/optimize.py`
   - `POST /optimize/group`
   - `POST /optimize/group/allocate`

Important distinction (called out in code comments):

- **Points are not truly poolable across people** in real life. Each member can only redeem from their own accounts.
- The correct approach is implemented in **`OrchestratorAgent.optimize_group_with_allocation`**, which uses `GroupBookingAllocator` to assign segments to members and then computes settlements.
- `OrchestratorAgent.optimize_group` explicitly warns it uses a temporary pooled approach.

If you’re working on group travel, anchor on:

- `backend/src/agents/orchestrator.py` → `optimize_group_with_allocation`
- `backend/src/routes/optimize.py` → `/optimize/group/allocate`
- `frontend/src/components/group/*` and `frontend/src/app/(app)/group/*`

---

## Authentication + API boundary conventions

### Auth in the frontend

Files:

- `frontend/src/lib/api.ts`: stores tokens from `/auth/login` and refreshes via `/auth/refresh`.
- `frontend/src/app/(app)/layout.tsx`: redirects unauthenticated users to `/login` (unless offline mode is enabled).
- `frontend/src/components/navigation.tsx`: reads tokens + stored user to conditionally show authenticated navigation.

Key behaviors:

- Tokens are stored in both `sessionStorage` and `localStorage`.
- `apiRequest(...)` auto-attaches `Authorization: Bearer <token>` and attempts refresh on expiry/401.
- Offline mode (`NEXT_PUBLIC_ENABLE_OFFLINE_MODE=true`) disables auth and serves mock data in the API client.

### Snake case vs camel case

This codebase has **three casing layers**, and it’s easy to accidentally mix them.

#### Canonical casing per layer

- **DynamoDB storage (solo trips)**: primarily **camelCase** (e.g., `tripType`, `dateMode`, `finalDestination`, `optimizationMode`) as written by `backend/src/services/solo_trip_service.py`.
- **Backend API surfaces**:
  - `/solo/*` endpoints explicitly document “responses use snake_case” and convert storage → API via `backend/src/mappers/trip_mapper.py` (see `backend/src/routes/solo.py` module docstring).
  - `/optimize/*` endpoints often return camelCase directly for some payloads (serialization helpers in `backend/src/routes/optimize.py` convert snake_case model fields → camelCase keys).
- **Frontend**: **camelCase** in components and hooks.

Conversions:

- `frontend/src/lib/serializers.ts`
  - `toSnakeCase(obj)` for request bodies.
  - `toCamelCase(obj)` for responses.
- `frontend/src/lib/api.ts` also includes a recursive transformer (`transformKeys`) used in some solo APIs.

Rule of thumb:

- When adding new endpoints: be explicit about casing and use serializers at the boundary to avoid “half camel / half snake” data.
- **Avoid double-transform**: because `api.ts` has both `transformKeys` and `serializers.ts` functions, it’s easy to camelize twice (or camelize something already camelCase). Prefer a single conversion strategy per endpoint family.

---

## Caching (why results feel fast)

Tripy uses caching at multiple layers to reduce repeated expensive calls to external providers.

### Backend cache helper (`utils/cache_layer.py`)

File: `backend/src/utils/cache_layer.py`

Public API:

- **`get_json(key)`**
  - Namespaces keys as `tripy:<key>`.
  - Uses Redis if `REDIS_URL` is configured; otherwise uses an in-memory dict with TTL.
  - Returns `None` on any cache miss/error (intentionally “fail open”).
- **`set_json(key, value, ttl=DEFAULT_TTL)`**
  - Stores a JSON-serializable value with a TTL.
  - Uses Redis if available; otherwise uses in-memory fallback.

Where it’s used:

- Optimization router caching in `backend/src/routes/optimize.py` (10 minute TTL).
- SerpAPI flight/crawl caching in `backend/src/handlers/serp_client.py` (flights ~15 min, organic search ~6 hours).

### Solo optimization caching (stored inside the trip record)

File: `backend/src/services/solo_trip_service.py`

Key functions:

- **`compute_cache_key(trip_id, trip_prefs, points, mode)`**
  - Builds a stable hash over the inputs that matter (origin/destinations/dates/preferences/points/mode).
- **`cache_optimization(...)`**
  - Stores the result under `trip["optimizationCache"][cache_key]`.
- **`get_cached_optimization(...)` / `is_cache_expired(...)`**
  - Reads cache and checks `expires_at`.

This cache makes the solo results page resilient and fast across reloads, and supports the booking page’s “auto-select best itinerary from cache” flow.

---

## Snapshotting: stability, idempotency, and versioning (current gaps)

Snapshotting is the correct product mechanism (awards change), but the current implementation is missing explicit schema/version guards.

### What is stored today

File: `backend/src/services/solo_trip_service.py`

Function: **`select_itinerary(trip_id, user_id, request)`**

- Stores, inside the trip record:
  - `selectedItineraryId`
  - `itinerarySnapshot` (opaque dict)
  - `cashPriceAtSelection`, `outOfPocketAtSelection`
  - `selectedAt`
  - sets `status="selected"`

### What is missing (and will bite you)

- **No explicit `snapshot_version` field**: as schemas evolve, older snapshots can become unreadable by `/solo/transfer-strategy`.
- **No backend validation contract** for minimum snapshot fields before persisting.
- **Idempotency semantics**: selecting twice overwrites fields (which is fine), but the doc should treat selection as “last write wins”.

Recommended doc-level contract (should become code-level validation):

- Every stored snapshot should include:
  - `snapshot_version: number`
  - `created_at` (ISO)
  - `itinerary_id` (string)
  - `segments[]` with stable keys used by booking guide
  - `transfers[]` (possibly empty)
- If snapshot is missing required fields, backend should refuse to store it (400) rather than persisting a broken future booking state.

---

## Legacy itinerary pipeline (still used as fallback)

The codebase retains an older itinerary pipeline used by some pages as a fallback.

Key files:

- `backend/src/services/itinerary_service.py`
  - Pulls flights via `src.handlers.flights` helpers.
  - Runs ILP via `src.handlers.ilp_adapter.run_ilp_from_edges`.
  - Optionally uses `src.handlers.points_maximizer.plan_maximize_points_value` (requires `pulp`).
- `backend/src/app.py`
  - `POST /itinerary/generate` calls `itinerary_service.generate_optimized_itinerary(...)` and returns items/warnings.

How it differs from the solo agentic engine:

- Legacy results are shaped as a list of heterogeneous `items` with `type` markers (`path`, `payments`, `totals`, warnings, etc.).
- The new solo engine returns a purpose-built structure: itineraries → segments → payments → transfers, plus global insights.
- The solo results page can render both, but prefers the solo engine.

### Legacy fallback restrictions (critical)

The frontend can fall back to legacy itinerary results when the solo optimizer fails. This is useful for “show something” UX, but it is **dangerous** to treat as equivalent.

Concrete risks:

- The legacy itinerary shapes (`items` with `type="path"/"payments"/"totals"`) do not match the solo snapshot schema used by `/solo/transfer-strategy`.
- Selecting/booking legacy results can produce mismatched booking guides (or no guide).

Doc contract:

- Legacy fallback should be treated as:
  - **view-only** unless it is explicitly transformed into the solo snapshot schema and persisted through `POST /solo/trips/{trip_id}/select`.
- If you want “book from legacy fallback”, you must implement a reliable mapping from legacy `items` → solo snapshot (`segments`, `transfers`, `oopMetrics`) and add snapshot versioning.

---

## External providers (what we call, and where)

### SerpAPI (Google Flights + organic search)

Key module: `backend/src/handlers/serp_client.py`

Important functions:

- **`get_flights_between_airports(origin, destination, date, ...)`**
  - Calls SerpAPI “google_flights” engine.
  - Returns a list of flight option dicts (best_flights + other_flights).
  - Caches results (default ~15 minutes) using `utils/cache_layer`.
- **`organic_search(q, num=8)`**
  - Used for “organic web snippets” that can be fed into OpenAI extraction (e.g., credit card benefits).
  - Cached for ~6 hours.

How it relates to points arbitrage:

- These cash prices are the baseline for “cash vs points” comparisons and CPP computation.

### AwardTool (award flights + award hotels)

Used via handlers/agents:

- `backend/src/agents/flight_agent.py` calls `backend/src/handlers/flights.py` for award search.
- Hotels are handled via the hotel agent and AwardTool hotel API.

Important implementation detail:

- AwardTool and other providers may emit sentinel values such as `-1` for “unknown”. The backend adds **sanitization** layers (see below) to ensure those do not leak into optimization totals or UI.

### OpenAI (trip extraction + autocomplete fallbacks)

Backend endpoints in `backend/src/app.py` use:

- `handlers/openAI.py` for:
  - `POST /extract-trip-info` (chat → structured trip fields)
  - some location/airport search fallbacks

Frontend uses this via:

- `tripExtraction.extract(text)` in `frontend/src/lib/api.ts`
- integrated into the solo setup chatbot flow.

### AWS Cognito (authentication)

Backend auth endpoints in `backend/src/app.py`:

- `POST /auth/login`
- `POST /auth/signup`
- `POST /auth/confirm`
- `POST /auth/refresh`
- password reset endpoints

Frontend calls these via `auth.*` in `frontend/src/lib/api.ts`, and stores tokens locally for subsequent API calls.

---

## Data integrity: price sanitization (preventing “-1” and “free flights” bugs)

Tripy has multiple defensive layers to prevent invalid pricing values from contaminating optimization:

- Legacy flight handler sanitizers:
  - `backend/src/handlers/flights.py` has helpers like `sanitize_flight_cash_price(...)` that treat negative/zero prices as unknown.
- V3 adapter sanitizers:
  - `backend/src/optimization/adapter_v3.py` uses shared sanitizers from `backend/src/utils/pricing.py`.
  - When cash price is unknown (`None`), it applies a **large penalty** for optimization so the solver does not interpret “unknown price” as “$0”.

This matters because the solver’s job is to minimize cash paid; if unknown cash is treated as zero, the solver will “prefer” those options incorrectly.

---

## No-sentinel contract (what must be true for correctness)

This section is intentionally written as a **hard contract** even if the code does not yet enforce it everywhere. If this contract is violated, Tripy will show nonsense results (like `-1` prices) and the optimizer may pick “free” options.

### Contract: sentinel values must not cross boundaries

- **Provider boundary (raw)**: providers may return sentinel values (`-1`, empty strings, missing fields).
- **Normalization boundary (backend internal)**:
  - After normalization/sanitization, numeric fields must be either:
    - `None` (unknown), or
    - a valid non-negative value (strictly \(> 0\) for cash prices).
- **Persistence boundary (DynamoDB snapshots + caches)**:
  - Never store `-1` in:
    - `itinerarySnapshot`
    - solo `optimizationCache`
    - itinerary breakdown cache (`itinerary:{id}`)
- **Frontend render boundary**:
  - `None`/unknown should display as `TBD` / “Unknown” rather than `0` or `-1`.

### Where leaks can happen today (high-probability)

- **Legacy pipeline** may bypass newer sanitizers and then serialize values into the `items` list.
- **Snapshotting** can persist whatever the frontend sends (the backend stores `itinerarySnapshot` as-is). If the frontend snapshot contains `-1`, it becomes “sticky” and will keep showing up in booking instructions.

Practical engineering rule:

- Add a validation step in `solo_trip_service.select_itinerary` to reject snapshots containing negative numeric values (or scrub them) before writing to DynamoDB.

---

## Policy UX: risk mode selection + warnings

Frontend components:

- `frontend/src/components/policy/RiskModeSelector.tsx`
  - Renders “safe / balanced / aggressive” as buttons or dropdown.
- `frontend/src/components/policy/PolicyWarnings.tsx`
  - Displays blocks/warnings/info and handles acknowledgments.

Backend attachment points:

- V3 optimization attaches `policy_evaluation`, `disabled`, and `disable_reason` to each itinerary when policy evaluation runs (`backend/src/optimization/adapter_v3.py`).
- The agentic optimization router (`/optimize/solo`) also computes a `policySummary` and returns `riskMode` to the frontend (`backend/src/routes/optimize.py`).

---

## Booking guide hook (frontend) vs transfer strategy endpoint (backend)

Frontend hook:

- `frontend/src/lib/hooks/useSoloTransferStrategy.ts`
  - Fetches `POST /solo/transfer-strategy` and converts the response to UI-friendly `BookingGuideStep[]`.
  - Uses `getProgramLabel(...)` to display user-friendly program names rather than raw IDs.

Backend endpoint:

- `backend/src/routes/solo.py` → `get_transfer_strategy`
  - Turns the stored itinerary snapshot into:
    - normalized transfer steps
    - per-segment booking steps with booking URLs

Together, these implement the “booking gap” principle: Tripy doesn’t book for you, but it tells you exactly what to transfer and where to book.

---

## Transfer instructions: constraints that are not modeled yet (be explicit)

Tripy’s transfer strategy is built around the static partner graph in `backend/src/handlers/transfer_strategy.py` (`EXTENDED_TRANSFER_GRAPH`, `BANK_METADATA`, `PROGRAM_METADATA`) and produces `TransferInstruction` objects.

However, several real-world constraints are not reliably modeled end-to-end today:

- **Transfer time**: instant vs 24–72h vs “unknown” is not consistently carried through in instructions.
- **Minimum increments**: many programs require minimum transfer increments (often 1,000). The graph metadata may contain hints, but the booking flow does not strictly enforce them.
- **Irreversibility**: transfers are effectively irreversible; this should be surfaced as a warning and (in a future policy-gated flow) require acknowledgment.
- **Bonuses/promotions**: transfer bonuses are dynamic; if Tripy uses organic search snippets for this in the future, the doc/code must clearly mark it as best-effort and time-bounded.

Doc implication:

- Treat transfer steps as “action guidance”, not guaranteed executable instructions, unless and until these constraints are explicitly validated per partner.

---

## Where the “points arbitrage” concept lives in code

Tripy’s “arbitrage engine” is not one function; it is the composition of:

- **Inventory search**:
  - cash prices via SerpAPI (Google Flights)
  - award prices + surcharges via AwardTool
- **Transfer graph**:
  - what bank points can transfer to which programs and at which ratios
  - `backend/src/handlers/transfer_strategy.py` (`EXTENDED_TRANSFER_GRAPH`, `BANK_METADATA`, `PROGRAM_METADATA`)
- **Optimization objective**:
  - minimize out-of-pocket (default), maximize CPP, or balanced
  - implemented in the V3 solver, invoked via `optimization/adapter_v3.py`
- **Policy/trust layer**:
  - warn/block risky booking structures and irreversible actions
  - `backend/src/policy/*` + frontend policy components
- **UX**:
  - display out-of-pocket and points side-by-side
  - provide step-by-step transfer and booking instructions
  - keep booking stable with snapshotting

This composition is exactly how the product goal is achieved: *hide the complexity, surface the value, keep trust through transparency*.

---

## Practical “where do I change X?” map

- **Change solo trip input fields / defaults**: `frontend/src/app/(app)/solo/setup/page.tsx`
- **Change which backend fields are stored for solo trip**: `backend/src/services/solo_trip_service.py` (`create_solo_trip`)
- **Change optimization request/response shape for solo**: `backend/src/routes/solo.py` (`OptimizeSoloRequest/Response` schemas + `_transform_itineraries`)
- **Change search behavior**:
  - award flights: `backend/src/agents/flight_agent.py` → `_search_award_flights`
  - cash flights: `backend/src/agents/flight_agent.py` → `_search_cash_flights`
- **Change ranking/solver behavior**: `backend/src/optimization/solver_v3.py` (invoked via `adapter_v3.py`)
- **Change transfer partners/ratios/portal links**: `backend/src/handlers/transfer_strategy.py`
- **Change risk warnings/blocks**:
  - backend: `backend/src/policy/*`
  - frontend rendering: `frontend/src/components/policy/*` + `frontend/src/lib/policyConfig.ts`
- **Change booking instructions rendering**: `frontend/src/app/(app)/solo/booking/page.tsx`

