# Implementation Plan: Combine "Group Trip" + "Plan a Trip" into one "Plan a Trip" tab

## Goal
One tab, one flow. It scales from a single traveler (today's "solo") to many
travelers (today's "group") with no mode switch. It supports:
- Adding 1..N travelers
- Each traveler's own starting origin (airport/city)
- Shared destinations everyone visits together
- **Coordinated arrival**: when travelers must meet at a shared destination, the
  optimizer makes each person depart at the right time given their flight
  duration + timezones, so they arrive together (e.g. NYC departs before Seattle
  for a shared Singapore arrival).

---

## Current state (what exists today)

### Frontend
- Tabs registered in `tripy/frontend/src/app/(app)/AppShell.tsx:26-31`
  (`/solo/setup` = "Plan a Trip", `/group-planning/new` = "Group Trip").
  Active-route logic at `:107-113`.
- Solo form: `tripy/frontend/src/app/(app)/solo/setup/page.tsx` (~2,266 lines).
  Single origin (or several origins for one party), party size adults/children,
  multi-city timeline, dates (fixed/flexible), budget, pooled points/cards,
  global flight prefs. Calls `/solo/trips*`.
- Group form: `tripy/frontend/src/app/(app)/group-planning/new/page.tsx`
  (~1,864 lines). Shared destinations, **per-traveler origin + return airport**,
  per-traveler points (NOT pooled), per-traveler preferences, hotel room
  assignments, settlement. Calls `/group-trips*`.
- Types: `tripy/frontend/src/types/trip.ts` (solo), `types/group-booking.ts` (group).
- API client: `tripy/frontend/src/lib/api.ts` (`/solo/*` ~2800-3560, `/group-trips/*` ~3856-4032).

### Backend
- Solo: `routes/solo.py` → `agents/orchestrator.py` (OrchestratorAgent). Single origin.
- Group: `routes/group_planning.py` → `services/group_optimization_service.py`.
  Already does **Stage A: per-traveler flight search (different origins → same
  destination)**, Stage B: `handlers/group_oop_optimizer.py` (per-traveler OOP/points).
- **Coordinated-arrival machinery already written but UNUSED in live flows:**
  `handlers/planTrip.py:329-333` — `meetup_cities` adds `arr[p][c] == arr[ref][c]`;
  `arr[p][j]` accumulates per-edge `time_cost` (flight duration), so equalizing
  arrival times implicitly forces correct staggered departures.
  `optimization/models.py:291` carries `meetup_cities` + per-edge `departure_time`/`arrival_time`.
  `optimization/datetime_utils.py` already does tz-aware parsing/`datetime_to_utc`.
- **Gap:** `group_oop_optimizer.py` has NO arrival/time-sync constraint (grep: only
  static `departure_airport`/`arrival_airport` fields). The live group flow never
  coordinates arrival times.

### Decision
**Group is the general case; Solo is "group with 1 traveler."** Merge ONTO the group
data model + group backend, and make the UI degrade gracefully to a clean
single-traveler experience. Do NOT try to bolt group features onto the solo backend.

---

## Phase 0 — Decisions to lock before coding
1. **Canonical backend = group** (`/group-trips*` + `group_optimization_service`).
   Solo `/solo/*` endpoints stay only for back-compat/redirects, not new work.
2. **Points pooling default**: single traveler → trivially "their own points."
   Multi-traveler → keep per-traveler (existing group contract). Pooling stays an
   opt-in (existing `PoolingScope`), not the default.
3. **Coordinated arrival is a per-destination toggle** ("everyone arrives
   together" on/off per shared destination), default ON for multi-traveler trips
   with 2+ distinct origins, hidden/no-op for single-traveler trips.
4. **URL**: new unified flow lives at `/plan` (or reuse `/solo/setup` route but
   rename). Old `/group-planning/new` 301-redirects to it.

---

## Phase 1 — Backend: wire coordinated arrival into the live group optimizer
This is the substantive new capability; do it first so the UI has something real.

1. **Add timezone-aware arrival sync to the live path.** In
   `services/group_optimization_service.py` Stage A, the per-traveler flight
   search already yields candidate flights with departure/arrival datetimes.
   Ensure each candidate carries tz-aware `departure_time`/`arrival_time` (UTC via
   `optimization/datetime_utils.datetime_to_utc`) and a duration.
2. **Add an arrival-coordination constraint to `handlers/group_oop_optimizer.py`**
   (or route the group solve through the `planTrip.py` ILP which already has it):
   - Per shared "meetup" destination `c` with coordination ON: constrain selected
     flights so all travelers' arrival datetimes at `c` fall within a window
     (`|arr[p][c] - arr[ref][c]| <= Δ`, Δ e.g. 0–3h configurable; exact-equal is
     the `planTrip.py` form). Because arrival = departure + duration in UTC, the
     solver naturally picks earlier departures for longer-flight origins.
   - Preserve existing OOP/points objective; add a small penalty term for arrival
     spread so ties break toward tighter sync.
3. **Surface the math in results**: return per-traveler departure time, arrival
   time, flight duration, and the synchronized arrival window so the UI can show
   "NYC departs 9:15am, Seattle departs 12:40pm, both land Singapore 6:05am+1".
4. **Tests**: golden test with the two-origin Singapore example asserting NYC
   departs before Seattle and arrivals land within Δ. Reuse `datetime_utils`.

> If routing through `planTrip.py` is cleaner than extending `group_oop_optimizer`,
> prefer that — it already has `meetup_cities` + per-traveler `start_city`/`end_city`
> and avoids duplicating the constraint. Spike both, pick one in Phase 1.

## Phase 2 — Backend: make the group flow handle the single-traveler case cleanly
1. Confirm `group_optimization_service` runs correctly with `len(travelers) == 1`
   (no settlement, no room-sharing, points trivially "own"). Add guards so
   settlement/split endpoints no-op or 200-empty for 1 traveler.
2. Map solo-only fields that group lacks (e.g. flexible dates / date wiggle,
   round-trip toggle, global flight class) onto per-traveler or trip-level group
   fields. Extend the group trip + traveler models where a solo capability has no
   group equivalent (date flexibility, bags, cabin default).
3. Keep `/solo/*` endpoints functional (existing saved trips) but stop pointing new
   UI at them.

## Phase 3 — Frontend: unified data model + API
1. Introduce one form state type `PlanTripDraft` (in `types/`) that supersedes the
   solo `CreateTripRequest` and the group `TravelerDraft[]`/`RoomDraft[]`. Shape:
   ```
   PlanTripDraft {
     title; sharedDestinations[]; dates(fixed|flexible, legDates[]);
     travelers: TravelerDraft[]   // each: name, origin, return, cabin, budget, points[]
     coordination: { arriveTogether: boolean; windowMinutes }    // per shared dest
     hotels?: RoomDraft[];        // only when travelers.length > 1
     pooling: PoolingScope;       // default individual
   }
   ```
2. Point the form at `/group-trips*` exclusively (create trip → add travelers →
   add balances → preferences → optimize). Delete solo-specific API calls from the
   new page.

## Phase 4 — Frontend: the unified `/plan` page (the big build)
Build a new page (start from `group-planning/new/page.tsx` since it's the superset)
that progressively discloses complexity:

1. **Travelers section** — "Add traveler" button; first traveler exists by default.
   Each traveler row: display name + **origin airport** (+ optional separate return
   airport) + cabin + budget + their points/cards. Single traveler => collapsed,
   minimal chrome (feels like today's solo form).
2. **Shared destinations section** — the timeline UI from both flows (multi-city,
   leg dates, fixed/flexible). Everyone visits these.
3. **Coordinated arrival** — per shared destination, "Everyone arrives together"
   toggle (default ON when ≥2 origins). When on, after optimize, show the
   staggered departure/arrival table (Phase 1.3 data). Hidden for 1 traveler.
4. **Conditional sections** — hotel rooms + settlement preview ONLY render when
   `travelers.length > 1`. Pooling control under an "advanced" disclosure.
5. **Reuse existing components**: `AirportAutocomplete`, `DestinationAutocomplete`,
   `SingleDatePicker`, the timeline visual.
6. **sessionStorage persistence** like both current pages.

## Phase 5 — Navigation + routing cleanup
1. `AppShell.tsx:26-31`: collapse NAV to a single `{ href: '/plan', label: 'Plan a
   Trip' }` (drop the Group Trip entry). Update `isActive` (`:107-113`) accordingly.
2. Redirect `/group-planning/new` and `/solo/setup` → `/plan` (Next.js redirect or
   a thin client redirect page) so bookmarks/My-Trips deep links survive.
3. `My Trips` + `Explore` tabs unchanged. Ensure My-Trips can open both legacy solo
   and group trips (results pages stay where they are for now).

## Phase 6 — Results pages
1. Solo results (`/solo/...`) and group results (`/group-planning/{id}/results`)
   can stay separate initially. New flow always produces a group trip → always
   lands on group results. Confirm group results renders sensibly for 1 traveler
   (no settlement card, no room card) — likely needs the same `length>1` guards.
2. Add the coordinated-arrival departure/arrival timeline to group results.

## Phase 7 — Migration, cleanup, tests
1. Leave legacy solo trips readable; no data migration required (new trips are
   group trips).
2. Delete `group-planning/new/page.tsx` once `/plan` replaces it; keep solo page
   only if still serving legacy edit, else redirect.
3. Tests: (a) backend coordinated-arrival golden test (Phase 1.4); (b) backend
   1-traveler group optimize smoke test; (c) frontend: add/remove travelers,
   conditional sections appear at N≥2, single-traveler happy path.
4. Manual QA: the Seattle+NYC→Singapore scenario end to end.

---

## Risk / sequencing notes
- **Biggest unknown = Phase 1** (arrival coordination in the live optimizer).
  De-risk first with a spike: does extending `group_oop_optimizer` or rerouting to
  `planTrip.py` give correct staggered departures on the Singapore example?
- The frontend merge is mostly *deleting a mode* and conditionally rendering group
  sections — lower risk, but the group page is the source of truth to fork from.
- Keep `/solo/*` + `/group-trips/*` backends alive throughout; only the **UI** and
  **nav** consolidate first. Backend consolidation (Phase 2) can lag.

## Suggested order of execution
1. Phase 1 spike (arrival coordination) → 2. Phase 1 full + tests →
3. Phase 3 types/API → 4. Phase 4 `/plan` page (single-traveler path first, then
N-traveler) → 5. Phase 5 nav/redirects → 6. Phase 6 results guards →
7. Phase 2 backend single-traveler hardening → 8. Phase 7 cleanup.
