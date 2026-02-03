# Group Trip Workflow: Pooling Points Across Travelers

This document defines the **product and system workflow** for Tripy group trips when the core value prop is: **pool points across multiple travelers to produce the best combined itinerary + booking plan.**

It covers: what users see, what the backend does, what data is needed, and where hard constraints live.

---

## Product scope: flight-only Tripy

Tripy is a **points-first, seat-allocation, ticketing optimizer** for **flights only**: airfare, seats, taxes/fees, and point transfers. Lodging is out of scope.

**What flight-only simplifies:**

- No long-stay coupling, room-night allocation, or cash-heavy lodging fallback.
- “Group arrival together” is the dominant constraint; seat availability and ticketing are the main levers.
- Ledger is clear: per ticket, base fare (points from wallet X) + taxes/fees (card Y) + passenger Z.
- Failure and rollback are easier to reason about and re-optimize.

**What remains in scope:** Seat allocation, transfer timing, taxes/fees payer, risk of stranded points, group arrival preferences, PNR/ticketing semantics.

This doc is written for **flight-only**; all optimization, data models, and constraints below assume flights only unless otherwise noted.

---

## 1) Core idea: “Pooling” without breaking loyalty-program rules

Tripy treats **“pooling points” as a planning abstraction**. In reality, points can be combined only via a few mechanisms:

| Mechanism | Description |
|-----------|-------------|
| **True pooling programs** | Some programs let families/households pool points officially (or have shared balances). |
| **Transfers between people** | Many programs do *not* allow free person-to-person transfers, or they charge fees / restrict it. |
| **Book from one account for someone else** | Most common “effective pooling”: one person uses their points to book air travel for another traveler (e.g., award flights can often be booked for others). |
| **Credit card → loyalty transfers** | Card points are often transferable to partners, usually tied to the cardholder (and sometimes restricted to their own loyalty account or authorized users). |
| **Cash as a fallback** | When points can’t be used efficiently or legally, the optimizer should mix in cash. |

**Implication:** The system must model **who can pay with what** and **who can book for whom**, then optimize.

### Non-goals (explicit boundaries)

Tripy does **not**:

- Circumvent loyalty program rules
- Automate credentialed bookings without user action
- Perform transfers or bookings without explicit user approval

These boundaries protect users and the product legally, set clear expectations, and prevent future implementations from optimizing into unsafe territory.

---

## 2) Group Trip objects and roles

### User roles (minimum)

| Role | Capabilities |
|------|--------------|
| **Trip Owner** | Creates trip, controls permissions, invites others, can lock itinerary. |
| **Traveler / Contributor** | Can add preferences, connect accounts, and approve use of their points (if applicable). |
| **Viewer** | Can see plan but cannot change settings or connect accounts. |
| **Sponsor / Payer-only** | Pays (points or cash) for others; may have minimal travel preferences. One person pays, others are travelers. Model as a role or flag: `can_pay_for_others = true`. Simplifies approval logic, UI (“who’s paying”), and ledger reconciliation. |

*Note:* Sponsor can be a fourth role or a capability flag on Contributor/Owner. Either way, it should be explicit so approval and ledger logic stay clear.

### Households / family units

For spouses and families, model **households** so pooling and delegation are explicit:

- **`household_id`** — optional; members with the same id are treated as one unit for pooling and visibility.
- **Delegation:** optional **`can_book_for_me`** (or **`delegated_booking_authority`**) — e.g. “my spouse can approve and book using my points”; “treat our points as pooled for planning.” This avoids double approvals and friction.

Two spouses with different point types (e.g. Chase UR vs Amex MR) can each have their own wallet; with household_id and delegation, Tripy can use one spouse’s points to book seats for the other and surface a single group itinerary timeline even if PNRs differ.

### Pooling scope (trip-level)

Control **which wallets** the optimizer can draw from and **who can pay for whose seats**. Add a trip-level setting:

| Value | Meaning |
|-------|--------|
| **`individual_only`** | No cross-person pooling; each pays for their own seats. |
| **`household_only`** | Pool only within each household_id; no cross-family pooling. |
| **`full_group`** | Optimizer can use any willing member’s points for any traveler. |
| **`sponsors_only`** | Only members with `can_pay_for_others` (or Sponsor role) can pay for others’ seats. |

This is critical for multi-family trips: families often want to pool within family, not across families.

### Group Trip entity (conceptual fields)

- **Trip basics:** origin(s), destinations, date window, flexibility, cabin, max stops, etc.
- **Pooling scope:** `individual_only` \| `household_only` \| `full_group` \| `sponsors_only`.
- **Group:** list of travelers, optional `household_id`, relationship tags (friends/family/coworkers), policy constraints.
- **Preferences per traveler:** seat/cabin constraints, departure time windows, airline preferences, red-eyes yes/no, accessibility needs, etc.
- **Budget + points policy:** “minimize out-of-pocket” vs “maximize value” vs “balanced”, plus any personal caps.

---

## 3) Invite + onboarding workflow

### 3.1 Trip creation

1. Owner sets:
   - destination(s), dates (fixed or flexible), departure city/airport(s), number of travelers
   - **“Group trip mode” toggle:** Pool points across group
2. Tripy generates a share link: `trip_id`, `invite_token`, role = contributor/viewer.

### 3.2 Contributor acceptance

When someone joins, Tripy asks for **two parallel inputs**:

**A) Travel preferences**

- Home airport (or city), date constraints, cabin, baggage preferences, etc.

**B) Points & accounts connection**

- Credit card ecosystems (Amex / Chase / Capital One / etc.)
- Loyalty programs (airlines) and transferable card points relevant to the trip
- **“Willingness to use points”** (trust layer):
  - *Use my points freely for group bookings*
  - *Ask me before using my points*
  - *Do not use my points (view only)*

**Important:** Every traveler must have **clear controls** over what Tripy is allowed to plan with and what requires approval.

### 3.3 Member lifecycle & blocking behavior

Members move through explicit states. Define which states block optimization and which allow best-effort planning to avoid deadlocks.

**Example member states:**

| State | Description |
|-------|-------------|
| `invited` | Invite sent; not yet accepted. |
| `joined_no_wallet` | Joined trip but has not linked wallets / balances. |
| `wallet_connected` | Balances (or ranges) provided; not yet approved for planning. |
| `approved_for_planning` | OK for Tripy to use in optimized plan (within their willingness). |
| `approved_for_booking` | Approved their allocation; ready for checklist. |
| `inactive` | Dropped or paused; exclude from optimization. |

**Blocking behavior:**

- Optimization over the **full group** should require at least `wallet_connected` (or explicit “no points”) for all contributors who are expected to participate.
- **Best-effort planning** can run with `joined_no_wallet` members treated as “preferences only, no points”; optimizer excludes their balances and may split or use cash for their share.
- Booking checklist and lock should require `approved_for_booking` (or equivalent) for every payer in the plan.

---

## 4) Account linking + permissions (trust layer)

### 4.1 Data minimization

**Store:**

- Program identifiers, masked account id, point balances, expiration windows (if available), status tier
- Transfer eligibility signals (e.g., “card points transferable to X partner”)

**Do not store:**

- Passwords
- Raw session cookies (unless user-controlled vault; minimize retention)

### 4.2 Consent-driven “wallet”

Each traveler has a **Points Wallet** object with:

- Balances per currency (card points + loyalty points)
- **Allowed uses:**
  - Can Tripy recommend using these points?
  - Can Tripy allocate them in an optimized plan?
  - Does Tripy need explicit approval before finalizing?

### 4.3 Group visibility

Users can choose:

- **Exact balances visible** to group
- **Range only** (“10k–25k”, “25k–50k”)
- **Hidden** but usable by optimizer if they approve usage

### 4.4 Expiration pressure modeling

Expiration windows are stored; they must also **influence** the plan.

- Treat expiration as a **soft constraint with increasing penalty** as the date approaches (e.g., prefer using points that expire soon; penalize plans that leave expiring balances unused).
- **Explainability layer** should surface this: e.g., “We used Alex’s points because they expire in 3 months.”

This differentiates Tripy and aligns with the explainability phase.

---

## 5) Group pooling logic: optimization model

### 5.0 Optimization guarantee (what Tripy promises)

Tripy produces a **locally optimal, constraint-satisfying plan** over a pruned candidate set. It prioritizes **safety and explainability** over theoretical global optimality. Concretely:

- **Not guaranteed:** Global optimum over all possible itineraries and allocations.
- **Guaranteed (within scope):** Best-of-pruned-candidates subject to hard constraints; ordering and risk are modeled; the plan is explainable and auditable.

This sets the right expectation for users and investors (e.g. YC) and protects the product from overclaiming.

### 5.1 Funding graph (flight-only)

**Nodes:**

- Travelers (people)
- Currencies (Amex MR, Chase UR, airline miles, cash)
- Redemption options (flight itinerary A, seat product B)

**Edges:**

- Traveler owns currency
- Currency can transfer to partner program (with conversion rate / bonus / constraints)
- Traveler can book for traveler (allowed beneficiary)
- Redemption consumes currency (seats / tickets)

### 5.2 Hard constraints (non-negotiables, flight-only)

- **Seat availability is atomic:** Award seats must exist for *each* passenger; partial availability → split group (with penalty) or fallback to cash. Keep this strict.
- **Single-ticket rule for connections:** If an itinerary is connecting, it must be ticketed as one reservation. Non-negotiable for group flights.
- **Party consistency:** If the group wants to arrive together, enforce same flight; or allow split flights with penalty.
- **Transfer rules:** Bonuses apply only in certain windows; min transfer increments; irreversible transfers are “high risk” until itinerary is locked.
- **Booking constraints:** Some programs can book for others; some require matching names; some allow only household pooling—model as boolean feasibility constraints.
- **Booking order dependency (inside the optimizer):** Model order so the solver never proposes an invalid sequence. E.g. transfer X only after hold Y; no transfer before hold. Model at least as flags: `requires_hold_before_transfer`, `requires_booking_before_transfer`.

### 5.3 Soft constraints (scored penalties)

- Too many stops, long layovers
- Bad departure time for a specific traveler
- Splitting the group (if undesirable)
- Mixing too many currencies (complexity cost)
- High-risk transfers before confirmation

---

## 6) Search phase: candidate “trip ingredients”

### 6.1 Candidate generation (flight-only)

For each trip leg (or full route), generate candidates:

- Cash flight options (via cash flight provider)
- Award flight options for a curated set of transferable partners

Store as “edges” with: price (cash), points required (per program), fees + taxes, cancellation flexibility, rules flags, **seat counts** (if available).

**Cross-leg coupling:** Some candidates are **multi-leg atomic units** and must be generated and evaluated as a bundle (e.g. round-trip award pricing, stopover rules such as Aeroplan). Do not treat all candidates as independent per-leg edges or future refactors may break complex programs.

### 6.2 Group-aware pruning

Before optimization:

- Drop options that can’t satisfy **party size (seats)** (unless splitting is allowed)
- Prune dominated options (worse in both cost and time)
- Keep a diverse set: cheap, fast, high-value, flexible

---

## 7) Optimization phase: allocate seats + who pays

### 7.1 Outputs (flight-only)

1. **Final itinerary (flights)** for the group (or subgroup splits if necessary)
2. **Payment allocation plan**, e.g.:
   - “Eric uses 120k UR → transfer to United for 3 seats”
   - “Davie uses 80k Aeroplan for 2 seats”
   - “Luke pays cash for remaining 1 seat because award space is limited”
3. **Step-by-step booking checklist** in the correct order (transfers, then bookings, then taxes/fees)

### 7.2 Ordering logic

- Hold / lock availability first if possible
- Only then irreversible transfers
- Only then execute final bookings

Optimize for both **money** and **operational safety**: prefer bookings that can be held or canceled; penalize transfers that can strand points if availability disappears.

### 7.3 Split planning

If 6 seats aren’t available on the same award: produce a plan (e.g., 4 on flight A with points, 2 on flight B cash) transparently with group approval.

### 7.4 PNR grouping (flight-only)

Travelers may be on:

- The **same flight but different PNRs** (e.g. different payers or programs)
- **Different flights** (if split planning is allowed)

Tripy should surface clearly:

- “Same flight, different tickets” vs “Different flights”

This matters for families with kids, immigration, and rebooking risk.

---

## 8) Collaboration layer: proposal → approvals → lock

### 8.1 Proposal

Tripy generates a **Plan Draft**:

- Itinerary timeline (who is on what flight)
- Points usage summary by person
- Out-of-pocket summary by person (and total)
- **Risk rating** (low / med / high), defined as a composite of:
  - Transfer irreversibility
  - Availability volatility
  - Cancellation flexibility
  - Time-to-expiration (of points used)
  Defined clearly internally so UI (“⚠️ High-risk plan”) and user trust stay consistent.

### 8.2 Comment + edit loop

Contributors can:

- Suggest alternatives (“I refuse red-eyes”)
- Cap their points contribution
- Swap preferences (“I’ll pay cash but want premium economy”)

Each change triggers re-run optimization or local adjustments.

### 8.3 Approvals

Before any money/points move:

- Each traveler approves their allocation (or owner can approve if they’re paying)
- Granular: approve *this* points contribution, *this* cash amount, *these* transfer action(s)

**Veto handling:** If someone vetoes (rejects their allocation or the plan):

- **Veto → constraint tightening → re-run:** Add the veto as a hard or soft constraint (e.g. “do not use my points for X”) and re-optimize.
- **Option:** Mark the member as “non-participating payer” so the rest of the group can proceed without blocking the whole trip. Avoid hostage scenarios.

### 8.4 Lock

When enough approvals are collected:

- Tripy locks the plan: freezes candidate set, reserves selected options in a “booking session”, starts the booking checklist workflow.

---

## 9) Booking execution workflow (human-in-the-loop)

### 9.1 Booking checklist per payer

For each person who must take action:

- “Transfer 60k points from X → Y”
- “Book flight on program site for these passengers”
- “Pay taxes with this card (to earn travel protections)”
- “Screenshot confirmation / paste locator code”

Tripy provides: deep links when possible, exact passenger name formatting, warnings about common failure points.

### 9.2 Confirmations ingestion

Each booking produces: confirmation numbers, tickets, PNRs. Tripy stores them and updates the itinerary.

### 9.3 Post-booking reconciliation (flight-only)

- Validate everyone has a ticket (every seat accounted for)
- Detect missing legs, unassigned travelers
- Compute final **“who paid what” ledger** (useful for Venmo/settling)

**Ledger grouping:** Ledger can be grouped by **traveler**, **household**, or **sponsor** so families can settle internally (e.g. by household) or per payer. For each ticket: base fare (points from wallet X), taxes/fees (card Y), passenger Z. Keep tax/fee separation explicit.

### 9.4 Failure & rollback handling

Real usage will hit failures; the system must handle them explicitly.

- **Detect failure:** e.g. user reports “transfer failed” or “award space gone”; or timeout / error on a checklist step.
- **Freeze remaining steps:** Do not prompt further irreversible actions until the failure is resolved or the plan is updated.
- **Propose recovery paths:** e.g. “Retry transfer,” “Choose alternate flight from remaining candidates,” “Switch this leg to cash and re-run allocation.”
- **Partial success:** Some legs booked, others failed — support “partial plan” state: show what’s confirmed, what’s still open, and what needs rebooking or re-optimization.

---

## 10) User-facing “pooling” experience

To users, this should feel like:

1. “We’re going to Japan, here’s the trip.”
2. “Everyone connect your points (or just put your balances).”
3. “Tripy found a plan that uses our combined points.”
4. “Approve what you’re willing to contribute.”
5. “Follow the checklist; Tripy keeps everyone coordinated.”
6. “Done—group trip booked.”

Points are not literally pooled in one account; **planning and allocation** are pooled, which is what people actually want.

---

## 11) Key edge cases

| Case | Behavior |
|------|----------|
| **Someone won’t share balances** | Allow “private wallet”: optimizer can use it; group sees only totals or ranges. |
| **Someone joins late** | Re-run optimization with penalty for changing already-booked items. |
| **Mixed origins** | Model separate flight legs per traveler; optimize so everyone meets (e.g. same destination/date); joint optimize with weights. |
| **Partial points only** | Combine points + cash seamlessly; show who pays cash and why. |
| **Program restrictions** | If a program can’t book for others or requires household: mark option infeasible or require “household verification” toggle. |
| **Availability volatility** | Add “time-to-book” urgency indicator; prefer options with holds/cancellation when approvals are pending. |
| **Tax / fee payment separation** | In practice, points often pay base fare while someone else pays taxes/fees; different cards may be used for protections. Model and display clearly: who pays taxes, who pays points, who pays which card. Affects ledger, approvals, and UX. |

---

## 12) Backend pipeline (concrete phases)

A clean internal pipeline for group trips:

1. **Input normalization** — traveler profiles + preferences + wallets *(stateful: reads DB)*
2. **Candidate generation** — flights cash + points candidates *(pure or cacheable with TTL)*
3. **Feasibility filtering** — party size, single-ticket connections, basic rules *(pure)*
4. **Scoring + pruning** — keep top-K diverse candidates per leg *(pure)*
5. **Optimization** — decide itinerary + allocations + transfers *(pure over inputs)*
6. **Explainability layer** — “why this plan” + “what changed” summaries *(pure over plan)*
7. **Approval workflow** — per-traveler approval objects + locking *(stateful)*
8. **Booking checklist generation** — per payer, in safe order *(pure over plan + approvals)*
9. **Confirmation ingestion** — reconcile, finalize ledger *(stateful)*

*Labeling pure vs stateful* clarifies where retries, caching, and idempotency apply.

---

## Data models (reference, flight-only)

| Entity | Purpose |
|--------|---------|
| **Trip** | Basics, invite code, status, createdBy (owner), **pooling_scope** (individual_only \| household_only \| full_group \| sponsors_only). |
| **Traveler / Member** | userId, role, optional **household_id**, optional **can_book_for_me** / **delegated_booking_authority**, status, **lifecycle state**, preferences (airport, cabin, dates), points_usage, willing_to_share_points. |
| **Wallet** | Balances per program (card + airline), allowed_uses, visibility (exact/range/hidden). |
| **Passenger** | Traveler (or dependent) on a specific flight; links to Ticket/SeatAllocation. |
| **SeatAllocation** | Which passenger gets which seat(s) on which flight; payer and points source. |
| **Ticket** | Per passenger (or PNR); base fare (points/cash), taxes/fees payer; **payer_user_id**, **points_source_wallet_id**. |
| **PNR** | Booking reference; may group multiple passengers (same flight, same or different tickets). |
| **Approval** | Per traveler, per allocation item; approved boolean, timestamp. |
| **PlanDraft** | Itinerary (flights) + allocation + risk rating; version for comment/edit. |
| **BookingSession** | Locked plan, reserved options, checklist steps. |

Remove hotel-specific fields and lodging allocation logic. Emphasize Passenger, SeatAllocation, Ticket, PNR, payer_user_id, points_source_wallet_id; optional but recommended: household_id, delegated_booking_authority.

---

## Mapping to current codebase

What **exists** today vs **intentional gaps** (so future engineers don’t assume correctness):

| Area | Current state | Gap / intent |
|------|----------------|---------------|
| **Scope** | Backend has both flight and hotel paths in places. | **Flight-only** is the product spec; remove or isolate hotel logic; doc is flight-only. |
| **Roles** | `trip_member_service` stores `role` (owner/member); `group_oop_optimizer` has `MemberRole` (organizer/member/viewer). Frontend: owner/member. | **Sponsor / can_pay_for_others** not yet modeled. **Viewer** exists in optimizer but may not be enforced in join/UI. |
| **Households** | Not modeled. | **household_id**, **can_book_for_me** / **delegated_booking_authority** for spouse/family pooling and delegation. |
| **Pooling scope** | Not modeled. | Trip-level **pooling_scope**: individual_only, household_only, full_group, sponsors_only. |
| **Willingness** | `GroupMember.willing_to_share_points`; join flow persists `points_usage` and `willing_to_share_points`. | **Member lifecycle states** (invited, joined_no_wallet, etc.) not yet in DB or optimizer. |
| **Join flow** | `POST /trips/join` accepts `invite_code`, `willing_to_share_points`, `points_usage`. | Travel preferences (airport, cabin, dates) on join not yet persisted to member. |
| **Optimization** | `group_oop_optimizer`, `group_points_pooling`, `group_api` model multi-member, cross-member sharing, settlements. | **Optimization guarantee** (locally optimal, pruned set) not in code. **Booking order dependency** not yet in solver. **Risk score**, **expiration pressure** not formalized. **Flight-only**: seat atomicity, PNR grouping semantics. |
| **Ledger** | Settlements and breakdowns exist. | **Ledger grouping** by traveler / household / sponsor; explicit tax/fee separation per ticket. |
| **Approvals / veto** | Approval workflow and lock are product-described; backend may have partial support. | **Veto → re-run** and **non-participating payer** path not yet implemented. |
| **Failure handling** | Checklist and confirmations exist. | **Failure detection, freeze steps, recovery paths, partial success** not yet specified or built. |

This doc is the **source of truth** for evolving the group trip workflow; implementation should align with it over time. Treat “Mapping” as the single place to update when code catches up or intentionally diverges.

---

## Flight-only Tripy: summary

### Two spouses with different point types?

**Yes — fully supported.** Separate wallets per person, separate transfer paths; one can use UR for 2 seats, the other MR for 2 seats; combine into a single group itinerary timeline even if PNRs differ. Add **household_id** + **delegated_booking_authority** (e.g. “my spouse can approve and book using my points”) for best UX and to avoid double approvals.

### Multiple families traveling together?

**Yes — well supported.** Many travelers, many wallets, many payers; mixed points + cash; split seat allocation when award space is limited. Add **pooling_scope** (e.g. `household_only` so families pool within family, not across) and relationship-aware visibility so multi-family trips stay clear and auditable.

### Minimal implementation changes

No redesign needed. Tighten:

1. **Household / family units** — `household_id`, optional `can_book_for_me` / `delegated_booking_authority`.
2. **Pooling scope** — trip-level `pooling_scope`: individual_only, household_only, full_group, sponsors_only.
3. **Flight-only semantics** — seats (atomic availability), single-ticket rule, PNR grouping (same flight different PNRs vs different flights), ledger by traveler/household/sponsor with explicit tax/fee separation.

This yields a clean, defensible product spec for a **group-flight points optimizer**.
