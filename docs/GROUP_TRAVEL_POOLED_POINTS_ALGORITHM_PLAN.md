# Group Travel: Pooled Points Optimization & Settlement Algorithm

## Executive Summary

Design a **group travel optimization engine** that lets multiple travelers with **different departure cities and dates** share a trip, **pools their loyalty points** to minimize total out-of-pocket cost, and produces a **settlement ledger** that tells each traveler exactly how much to pay back the person whose points were used disproportionately.

**Example scenario:** Mom (Miami, April 1) and Son (Seattle, March 31) both want to go to Paris. Mom has 200K Chase UR and 80K United miles; Son has 50K Chase UR. The optimizer should figure out whether to:
- Book Mom's flight MIA→CDG with her United miles, and Son's SEA→CDG with Mom's Chase UR transferred to United
- Or pay cash for Son and use Mom's points only for herself
- Or any other combination that minimizes total group cost

Then at trip end, produce: "Son owes Mom $423 because Mom contributed 65K more UR points (worth ~$975) toward Son's flights."

---

## 1. Current State Analysis

### What exists today

| Component | Path | Status | Gap for Group Travel |
|-----------|------|--------|---------------------|
| `TripRequest` model | `frontend/prisma/schema.prisma:648` | **Implemented** | Single `departureDate`/`returnDate` — no per-traveler dates |
| `TripTraveler` model | `schema.prisma:705` | **Implemented** | Has per-traveler `originAirports`/`destinationAirports` but NO per-traveler dates |
| `ClientLoyaltyBalance` | `schema.prisma:475` | **Implemented** | Balances are per-client, no concept of "pooled" cross-client |
| `ProgramPoolingRule` | `schema.prisma:539` | **Implemented** | Has `PoolingScope` (none/household_only/authorized_user_like) — scaffolding only |
| `ProgramTransferRule` | `schema.prisma:517` | **Implemented** | Transfer ratios exist; used by recommendation engine |
| `TransferBonus` | `schema.prisma:552` | **Implemented** | Time-limited bonuses tracked |
| `searchFlightsForTravelers` | `frontend/src/lib/flight-search.ts:475` | **Implemented** | Deduplicates routes but uses single `departureDate` for ALL travelers |
| `runRecommendationEngine` | `frontend/src/lib/recommendation-engine.ts:82` | **Implemented** | Generates strategies per-traveler independently — no cross-traveler pooling |
| `GroupBookingPlan` / `Settlement` | `backend/src/agents/group_models.py:359` | **Partial** | Settlement model exists but says "Points are per-member, NOT poolable" |
| `MemberState` | `backend/src/agents/group_models.py:43` | **Partial** | Tracks per-member resources, `spend_points` etc — no cross-member spending |
| `SolutionAccounting` | `backend/src/optimization/types.py:227` | **Implemented** | `TravelerLedger` with bank transfers/loyalty spent — good foundation |
| Hotel scoring | `frontend/src/lib/hotel-scoring.ts` | **Implemented** | Per-traveler hotel groups, no cross-traveler hotel sharing |

### Key gaps

1. **No per-traveler departure/return dates** — the schema has a single `departureDate` on `TripRequest`
2. **No cross-traveler point pooling** — recommendation engine treats each traveler independently
3. **No settlement/payback logic** in the Next.js B2B flow (only skeleton in Python backend)
4. **Flight search assumes uniform dates** — `searchFlightsForTravelers` passes one `departureDate` to all
5. **No "point value accounting"** that tracks whose points were used for whose booking

---

## 2. Algorithm Design

### 2.1 Problem Formulation

**Inputs:**
- `T` travelers, each with:
  - Origin airport(s) and departure date
  - Return airport(s) and return date  
  - Loyalty balances: `{ programCode → balance }` per traveler
  - Cash budget constraint (optional)
- Shared destination(s)
- Transfer rules: `{ (fromProgram, toProgram) → ratio }` with optional active bonuses
- Pooling rules: which programs allow cross-person redemption (e.g., household pooling on Marriott, authorized user transfers on Chase)
- Flight/hotel inventory: cash prices and award availability for each route/stay

**Objective:** Minimize total group out-of-pocket cash cost, subject to:
- Each traveler gets booked on a flight from their origin to the destination (and back)
- Each traveler gets a hotel stay at the destination
- Point balances are not exceeded per-owner (even when "pooled," the points still debit from someone's account)
- Transfer ratios are respected
- Budget constraints per traveler (if set)

**Output:**
- Per-traveler booking assignments (which flight, which hotel, pay with cash or points)
- Per-traveler point expenditure ledger (whose points, which program, how many)
- Settlement instructions (who owes whom, how much)

### 2.2 The Pooling Model

"Pooling" doesn't mean points literally merge into one account. It means **Traveler A's points can pay for Traveler B's booking** when the loyalty program allows it. This happens through:

1. **Direct program pooling** — Some hotel programs (Marriott, Hyatt) allow household members to combine points for a single booking. Governed by `ProgramPoolingRule.poolingScope`.

2. **Transfer-then-book** — Traveler A transfers their Chase UR to United, then books a United award flight for Traveler B using those miles. The miles are in Traveler A's United account, but the ticket is for Traveler B.

3. **Book-for-another** — Most airline programs let you book award tickets for anyone. So if Mom has United miles, she can book Son's SEA→CDG flight using her miles from her account.

**Pooling eligibility matrix:**

| Mechanism | When allowed | Constraints |
|-----------|-------------|-------------|
| Book-for-another (airline awards) | Always for most programs | Booker must have the miles in their account |
| Household pooling (hotel points) | When `poolingScope = household_only` or `authorized_user_like` | Must be in same `Household` |
| Transfer from bank to airline | When `ProgramTransferRule` exists | Transfer ratio applies; points leave the bank account permanently |
| Cross-person bank transfer | Rarely (authorized users on credit cards) | `poolingScope = authorized_user_like` on the bank program |

### 2.3 Optimization Algorithm: Group Points Allocator

This is a **two-phase** approach: (1) enumerate candidate bookings per traveler per segment, then (2) solve a minimum-cost assignment.

#### Phase 1: Candidate Generation

For each traveler `t` and each segment `s` (outbound flight, return flight, hotel stay):

```
candidates[t][s] = []

# Cash option
candidates[t][s].append({
  type: "cash",
  cost_cash: cash_price,
  cost_points: 0,
  point_source: null,
  point_owner: null,
})

# Award options — using traveler's OWN points
for each (program, award_price) in award_availability[s]:
  if t.balances[program] >= award_price:
    candidates[t][s].append({
      type: "award_own",
      cost_cash: taxes_only,
      cost_points: award_price,
      point_source: program,
      point_owner: t,
    })

# Award options — using ANOTHER traveler's points (pooling)
for each other_traveler o in T where o ≠ t:
  for each (program, award_price) in award_availability[s]:
    if o.balances[program] >= award_price AND can_book_for_another(program):
      candidates[t][s].append({
        type: "award_pooled",
        cost_cash: taxes_only,
        cost_points: award_price,
        point_source: program,
        point_owner: o,
      })

# Transfer-then-award options — own bank points
for each bank in t.transferable_banks:
  for each (program, award_price) in award_availability[s]:
    transfer_rule = get_transfer_rule(bank, program)
    if transfer_rule:
      bank_points_needed = ceil(award_price / transfer_rule.ratio)
      if t.balances[bank] >= bank_points_needed:
        candidates[t][s].append({
          type: "transfer_own",
          cost_cash: taxes_only,
          cost_points: bank_points_needed,
          point_source: bank,
          transfer_target: program,
          point_owner: t,
        })

# Transfer-then-award options — ANOTHER traveler's bank points (pooling)
for each other_traveler o in T where o ≠ t:
  for each bank in o.transferable_banks:
    for each (program, award_price) in award_availability[s]:
      transfer_rule = get_transfer_rule(bank, program)
      if transfer_rule AND can_pool(bank, t, o):
        bank_points_needed = ceil(award_price / transfer_rule.ratio)
        if o.balances[bank] >= bank_points_needed:
          candidates[t][s].append({
            type: "transfer_pooled",
            cost_cash: taxes_only,
            cost_points: bank_points_needed,
            point_source: bank,
            transfer_target: program,
            point_owner: o,
          })
```

#### Phase 2: Minimum-Cost Assignment (Greedy with Backtracking)

A full ILP is ideal for large groups but overkill for 2-4 travelers. We use a **greedy assignment with constraint propagation**:

```
function solveGroupAllocation(candidates, traveler_balances):
  # Sort all candidates across all travelers/segments by "savings vs cash"
  # savings = cash_price - candidate.cost_cash
  # Higher savings = better use of points

  # For each candidate, compute:
  #   value = savings / point_value_in_cents(candidate.point_source)
  #   This gives us "cents saved per point spent" — we want to maximize this

  all_options = []
  for t in travelers:
    for s in segments[t]:
      cash_baseline = best_cash_price(candidates[t][s])
      for c in candidates[t][s]:
        if c.type != "cash":
          savings = cash_baseline - c.cost_cash
          cpp = savings / c.cost_points if c.cost_points > 0 else 0
          all_options.append((t, s, c, cpp, savings))

  # Sort by CPP descending (best value redemptions first)
  all_options.sort(by=cpp, descending)

  # Track remaining balances
  remaining = deep_copy(traveler_balances)
  assignments = {}  # (traveler, segment) → chosen candidate

  for (t, s, candidate, cpp, savings) in all_options:
    if (t, s) already assigned: continue
    if cpp < MIN_CPP_THRESHOLD (e.g., 0.8¢): continue  # not worth using points

    # Check if point_owner still has enough
    owner = candidate.point_owner
    source = candidate.point_source
    needed = candidate.cost_points

    if remaining[owner][source] >= needed:
      # Assign this candidate
      assignments[(t, s)] = candidate
      remaining[owner][source] -= needed

  # Fill unassigned segments with cash
  for t in travelers:
    for s in segments[t]:
      if (t, s) not in assignments:
        assignments[(t, s)] = best_cash_candidate(candidates[t][s])

  return assignments
```

#### Why not full ILP for v1?

- Typical group size is 2-4 travelers, 2-4 segments each → 4-16 decision variables
- The greedy approach with CPP sorting naturally picks the highest-value redemptions first
- Constraint propagation (checking remaining balances) handles the coupling between travelers
- We can upgrade to ILP later using the existing PuLP infrastructure in `backend/src/handlers/points_maximizer.py`

#### Phase 2 Alternative: ILP Formulation (for future/large groups)

For completeness, the ILP formulation:

```
Decision variables:
  x[t][s][c] ∈ {0, 1}  — 1 if traveler t's segment s uses candidate c

Objective: minimize Σ x[t][s][c] * candidate[c].cost_cash
           (minimize total cash)

Subject to:
  # Each traveler-segment gets exactly one booking
  Σ_c x[t][s][c] = 1  ∀ t, s

  # Point balance constraints (per owner, per program)
  Σ_{t,s,c where c.point_owner=o AND c.point_source=p} x[t][s][c] * c.cost_points
    ≤ balance[o][p]    ∀ owner o, program p

  # Budget constraints (per traveler)
  Σ_{s,c} x[t][s][c] * c.cost_cash ≤ budget[t]   ∀ t (if budget set)
```

### 2.4 Settlement / Payback Algorithm

After the optimizer assigns bookings, we need to determine who owes whom.

#### Step 1: Compute each traveler's "fair share"

The **fair share** is what each traveler *should* pay for their portion of the trip. Default is equal split of total trip value, but configurable:

```
total_trip_value = Σ (cash_price_equivalent for each traveler's segments)
  where cash_price_equivalent uses the best cash price for each segment

fair_share[t] = total_trip_value / num_travelers  # equal split
```

Alternatively, **proportional to segment cost** (if Mom's MIA→CDG costs $800 and Son's SEA→CDG costs $650):
```
fair_share[t] = Σ cash_price_of(segments booked for t)
```

#### Step 2: Compute each traveler's "actual contribution"

```
contribution[t] = cash_paid_by[t] + point_value_of(points_spent_by[t])

where:
  cash_paid_by[t] = Σ candidate.cost_cash for all segments where t paid cash
  
  point_value_of(points) = Σ points_used * cents_per_point(program) / 100
    for each program's points that traveler t spent from THEIR OWN balance
```

**Critical detail:** When Mom's Chase UR points are transferred to United to book Son's flight, that counts as **Mom's contribution**, not Son's.

#### Step 3: Compute settlement transfers

```
balance[t] = contribution[t] - fair_share[t]

# Positive balance = overpaid (owed money back)
# Negative balance = underpaid (owes money)

# Minimum number of transfers to settle:
creditors = [t for t in travelers if balance[t] > 0]  # sorted desc
debtors = [t for t in travelers if balance[t] < 0]     # sorted by |balance| desc

settlements = []
i, j = 0, 0
while i < len(creditors) and j < len(debtors):
  amount = min(balance[creditors[i]], -balance[debtors[j]])
  settlements.append({
    from: debtors[j],
    to: creditors[i],
    amount: amount,
    reason: f"{debtors[j].name} owes {creditors[i].name} "
            f"because {creditors[i].name} contributed "
            f"{describe_contribution(creditors[i])}"
  })
  balance[creditors[i]] -= amount
  balance[debtors[j]] += amount
  if balance[creditors[i]] == 0: i += 1
  if balance[debtors[j]] == 0: j += 1
```

#### Step 4: Generate human-readable settlement memo

```
Example output for the Mom/Son Paris trip:

┌─────────────────────────────────────────────────────────────┐
│                    SETTLEMENT SUMMARY                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Trip: Paris (Mar 31 – Apr 7, 2026)                         │
│                                                              │
│  BOOKINGS:                                                   │
│  ├─ Mom (MIA→CDG Apr 1): United award, 60K United miles      │
│  │   Points owner: Mom | Cash: $112 taxes                    │
│  ├─ Son (SEA→CDG Mar 31): United award, 60K United miles     │
│  │   Points owner: Mom (transferred 60K Chase UR → United)   │
│  │   Cash: $112 taxes                                        │
│  ├─ Hotel (Hyatt Paris, 6 nights): 150K Hyatt points         │
│  │   Points owner: Mom (household pool)                      │
│  │   Cash: $0                                                │
│  ├─ Mom return (CDG→MIA Apr 7): Cash $680                    │
│  └─ Son return (CDG→SEA Apr 7): Cash $720                    │
│                                                              │
│  CONTRIBUTION LEDGER:                                        │
│  ┌────────┬──────────┬──────────────┬──────────┐             │
│  │ Person │ Cash     │ Points Value │ Total    │             │
│  ├────────┼──────────┼──────────────┼──────────┤             │
│  │ Mom    │ $792     │ $2,700       │ $3,492   │             │
│  │ Son    │ $832     │ $0           │ $832     │             │
│  └────────┴──────────┴──────────────┴──────────┘             │
│                                                              │
│  FAIR SHARE (proportional to segment cost):                  │
│  ├─ Mom:  $2,052 (her flights + half hotel)                  │
│  └─ Son:  $2,272 (his flights + half hotel)                  │
│                                                              │
│  SETTLEMENT:                                                 │
│  ╔═══════════════════════════════════════════════╗            │
│  ║  Son owes Mom: $1,440.00                      ║            │
│  ║                                               ║            │
│  ║  Breakdown:                                   ║            │
│  ║  • Mom's points covered Son's outbound flight ║            │
│  ║    (60K Chase UR → United, worth ~$900)       ║            │
│  ║  • Mom's Hyatt points covered half of Son's   ║            │
│  ║    hotel (75K points, worth ~$540)            ║            │
│  ╚═══════════════════════════════════════════════╝            │
└─────────────────────────────────────────────────────────────┘
```

### 2.5 Point Valuation for Settlement

The settlement algorithm needs a fair "dollar value" for points. We use a **tiered valuation**:

1. **Actual redemption CPP** (best): If we know the cash price of the flight/hotel that was booked with points, use `(cash_price - taxes) / points_used`. This is the most accurate because it reflects what the points *actually* saved.

2. **Program benchmark CPP** (fallback): From `backend/src/services/points_optimizer.py` `CPP_BENCHMARKS` or `LoyaltyProgram.defaultPointValueCents`. Used when cash price for the same itinerary isn't available.

3. **TPG market valuation** (last resort): From `backend/src/handlers/tpg_valuations.py` scraper.

Priority: Actual > Benchmark > TPG.

The settlement should always show which valuation method was used, so travelers can see the math is fair.

---

## 3. Schema Changes

### 3.1 Per-Traveler Dates on `TripTraveler`

```prisma
model TripTraveler {
  // ... existing fields ...
  
  // NEW: Per-traveler travel dates (override trip-level dates)
  departureDate       DateTime?  @map("departure_date")
  returnDate          DateTime?  @map("return_date")
  
  // NEW: Per-traveler cabin preference (override trip-level)
  cabinPreference     CabinPreference? @map("cabin_preference")
}
```

**Migration:** Add nullable columns. When null, fall back to `TripRequest.departureDate`/`returnDate`.

### 3.2 Group Settlement Model

```prisma
model GroupSettlement {
  id                String   @id @default(cuid())
  tripRequestId     String   @map("trip_request_id")
  
  // Settlement configuration
  splitMethod       SettlementSplitMethod @default(proportional_to_cost) @map("split_method")
  pointValuationMethod PointValuationMethod @default(actual_redemption) @map("point_valuation_method")
  
  // Computed results (JSON for flexibility)
  contributionLedger  Json   @map("contribution_ledger")
  fairShares          Json   @map("fair_shares")
  transfers           Json   @map("transfers")
  memo                String?
  
  // Metadata
  generatedAt       DateTime @default(now()) @map("generated_at")
  engineVersion     String   @default("v1") @map("engine_version")
  
  tripRequest       TripRequest @relation(fields: [tripRequestId], references: [id], onDelete: Cascade)
  
  @@map("group_settlements")
}

enum SettlementSplitMethod {
  equal
  proportional_to_cost
  custom
}

enum PointValuationMethod {
  actual_redemption
  benchmark_cpp
  tpg_market
}
```

### 3.3 Extend `PoolingScope` Enum

```prisma
enum PoolingScope {
  none
  household_only
  authorized_user_like
  book_for_another        // NEW: airline "book for anyone" capability
}
```

### 3.4 Extend `RecommendationTravelerAllocation`

```prisma
model RecommendationTravelerAllocation {
  // ... existing fields ...
  
  // NEW: Track whose points were actually used (for pooled bookings)
  pointSourceClientId  String?  @map("point_source_client_id")
  pointValueCents      Float?   @map("point_value_cents")  // CPP at time of recommendation
  
  pointSourceClient    Client?  @relation("PointSource", fields: [pointSourceClientId], references: [id])
}
```

---

## 4. Implementation Plan

### Phase 1: Schema + Per-Traveler Dates (Foundation)

**Files to change:**

| File | Change |
|------|--------|
| `frontend/prisma/schema.prisma` | Add `departureDate`, `returnDate`, `cabinPreference` to `TripTraveler`; add `GroupSettlement` model; extend enums |
| `frontend/prisma/migrations/` | New migration SQL |
| `frontend/src/app/api/trip-requests/[id]/travelers/route.ts` | Accept per-traveler dates in POST |
| `frontend/src/lib/api-client.ts` | Update `TripTraveler` type with optional date fields |
| `frontend/src/lib/flight-search.ts` | Refactor `searchFlightsForTravelers` to accept per-traveler dates |

**Key change in `flight-search.ts`:**

```typescript
export interface TravelerSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  originAirports: string[];
  destinationAirports: string[];
  departureDate?: string;   // NEW: per-traveler override
  returnDate?: string;      // NEW: per-traveler override
  cabinPreference?: string; // NEW: per-traveler override
}

export async function searchFlightsForTravelers(
  travelers: TravelerSearchInput[],
  tripDepartureDate: string,       // trip-level default
  tripReturnDate: string | undefined,
  tripCabinClass: string,          // trip-level default
): Promise<TravelerFlightGroup[]> {
  // For each traveler, use their date if set, else trip-level
  // Route dedup key now includes the actual date for that traveler
}
```

### Phase 2: Pooled Points Optimizer (Core Algorithm)

**New files:**

| File | Purpose |
|------|---------|
| `frontend/src/lib/group-optimizer.ts` | Core pooling optimizer — candidate generation + greedy solver |
| `frontend/src/lib/group-optimizer-types.ts` | TypeScript types for the optimizer |
| `frontend/src/lib/settlement.ts` | Settlement calculator — fair share, contribution ledger, transfers |

**`group-optimizer.ts` — Core function signatures:**

```typescript
interface GroupOptimizerInput {
  travelers: GroupTraveler[];
  segments: GroupSegment[];
  transferRules: TransferRule[];
  activeBonuses: ActiveBonus[];
  poolingRules: PoolingRule[];
  pointValuations: Record<string, number>; // programCode → cents per point
}

interface GroupTraveler {
  id: string;
  clientId: string;
  name: string;
  balances: { programCode: string; balance: number; category: string }[];
  cashBudget?: number;
}

interface GroupSegment {
  id: string;               // e.g., "outbound_traveler_1"
  travelerId: string;       // who this segment is FOR
  segmentType: "flight" | "hotel";
  cashPrice: number;        // best cash price found
  awardOptions: {
    program: string;
    pointsRequired: number;
    taxes: number;
    cppValue: number;
  }[];
}

interface GroupAllocation {
  assignments: SegmentAssignment[];
  totalCashCost: number;
  totalPointsValueCents: number;
  cashSavedVsAllCash: number;
  settlement: SettlementResult;
}

interface SegmentAssignment {
  segmentId: string;
  travelerId: string;       // who the booking is FOR
  paymentType: "cash" | "points" | "mixed";
  cashAmount: number;
  pointsUsed: number;
  pointsProgram: string | null;
  pointsOwnerId: string;    // whose points are being used
  pointsOwnerName: string;
  transferFrom?: string;     // bank program if transfer needed
  transferPointsNeeded?: number;
  cppAchieved: number;
}

export async function optimizeGroupTravel(
  input: GroupOptimizerInput
): Promise<GroupAllocation>;
```

**`settlement.ts` — Core function signatures:**

```typescript
interface SettlementInput {
  assignments: SegmentAssignment[];
  travelers: GroupTraveler[];
  splitMethod: "equal" | "proportional_to_cost" | "custom";
  customSplits?: Record<string, number>; // travelerId → percentage
  pointValuations: Record<string, number>;
}

interface SettlementResult {
  contributions: TravelerContribution[];
  fairShares: TravelerFairShare[];
  transfers: SettlementTransfer[];
  memo: string; // human-readable summary
}

interface TravelerContribution {
  travelerId: string;
  travelerName: string;
  cashPaid: number;
  pointsContributed: {
    program: string;
    points: number;
    valueCents: number;
    usedForTravelerId: string;   // who benefited
    usedForSegmentId: string;    // which booking
  }[];
  totalContributionCents: number;
}

interface TravelerFairShare {
  travelerId: string;
  travelerName: string;
  fairShareCents: number;
  segmentBreakdown: { segmentId: string; cashEquivalent: number }[];
}

interface SettlementTransfer {
  fromTravelerId: string;
  fromName: string;
  toTravelerId: string;
  toName: string;
  amountCents: number;
  reason: string;
  breakdown: string[];  // itemized reasons
}

export function computeSettlement(input: SettlementInput): SettlementResult;
```

### Phase 3: Integration with Existing Flows

**Files to change:**

| File | Change |
|------|--------|
| `frontend/src/lib/recommendation-engine.ts` | Add new strategy: `"group_pooled"` that calls `optimizeGroupTravel` |
| `frontend/src/app/api/trip-requests/[id]/generate-itinerary/route.ts` | Pass per-traveler dates to flight search; attach settlement to result |
| `frontend/src/app/api/trip-requests/[id]/settlement/route.ts` | **NEW**: GET/POST for settlement configuration and results |
| `frontend/src/lib/api-client.ts` | Add settlement types and API functions |

**New strategy in `recommendation-engine.ts`:**

```typescript
function generateGroupPooledStrategy(
  travelers: TravelerWithBalances[],
  transferPaths: TransferPath[],
  activeBonuses: ActiveBonus[],
  poolingRules: PoolingRule[],
  flightInventory: Map<string, FlightSegment>,
  hotelInventory: Map<string, HotelStayGroup>,
): StrategyCandidate {
  // 1. Build GroupSegment[] from real inventory
  // 2. Call optimizeGroupTravel()
  // 3. Convert GroupAllocation → StrategyCandidate format
  // 4. Attach settlement as insight
}
```

### Phase 4: UI (Scope for separate plan)

- Traveler form: per-traveler departure city + date picker
- Recommendation card: show "Group Pooled" strategy with cross-traveler point flows
- Settlement tab: contribution pie chart, transfer arrows, "Pay Now" integration (Venmo/Zelle link generation)
- Memo view: printable settlement summary

---

## 5. Detailed Algorithm Walkthrough: Mom & Son Paris Example

### Input

```
Travelers:
  Mom: origin=MIA, depart=Apr 1, return=Apr 7
    Balances: Chase UR=200,000 | United=80,000 | Hyatt=120,000
  
  Son: origin=SEA, depart=Mar 31, return=Apr 7
    Balances: Chase UR=50,000

Transfer Rules:
  Chase UR → United: 1:1 ratio
  Chase UR → Hyatt: 1:1 ratio

Pooling Rules:
  United: book_for_another (any award ticket can be for anyone)
  Hyatt: household_only (Mom & Son are in same household)

Destination: Paris (CDG)
```

### Phase 1 Output: Candidate Generation

**Son's outbound (SEA→CDG, Mar 31):**

| # | Type | Cash | Points | Program | Owner | CPP |
|---|------|------|--------|---------|-------|-----|
| 1 | Cash | $950 | 0 | — | — | — |
| 2 | Award (pooled) | $112 | 60,000 | United | Mom | 1.40¢ |
| 3 | Transfer+Award (pooled) | $112 | 60,000 | Chase UR→United | Mom | 1.40¢ |
| 4 | Transfer+Award (own) | $112 | 60,000 | Chase UR→United | Son | 1.40¢ |

**Mom's outbound (MIA→CDG, Apr 1):**

| # | Type | Cash | Points | Program | Owner | CPP |
|---|------|------|--------|---------|-------|-----|
| 1 | Cash | $820 | 0 | — | — | — |
| 2 | Award (own) | $112 | 60,000 | United | Mom | 1.18¢ |
| 3 | Transfer+Award (own) | $112 | 60,000 | Chase UR→United | Mom | 1.18¢ |

**Hotel (Hyatt Paris, 6 nights):**

| # | Type | Cash | Points | Program | Owner | CPP |
|---|------|------|--------|---------|-------|-----|
| 1 | Cash | $1,800 | 0 | — | — | — |
| 2 | Award (own) | $0 | 150,000 | Hyatt | Mom | 1.20¢ |
| 3 | Transfer+Award (own) | $0 | 150,000 | Chase UR→Hyatt | Mom | 1.20¢ |

**Return flights (CDG→MIA, CDG→SEA, Apr 7):**

| Segment | Cash | Best Award | CPP |
|---------|------|-----------|-----|
| Mom CDG→MIA | $680 | 55K United, $112 taxes | 1.03¢ |
| Son CDG→SEA | $720 | 55K United, $112 taxes | 1.11¢ |

### Phase 2 Output: Greedy Assignment

Sort all candidates by CPP descending:

1. **Son outbound (pooled, Mom's United)** — CPP 1.40¢ → ASSIGN. Mom's United: 80K → 20K
2. **Mom outbound (own United)** — CPP 1.18¢ → NOT ENOUGH (need 60K, have 20K). Try transfer: Mom Chase UR→United. Need 40K UR + 20K United. → ASSIGN MIXED. Mom's UR: 200K → 160K, Mom's United: 20K → 0
3. **Hotel (Mom's Hyatt)** — CPP 1.20¢ → NOT ENOUGH (need 150K, have 120K). Try transfer: Mom Chase UR→Hyatt 30K. → ASSIGN MIXED. Mom's UR: 160K → 130K, Mom's Hyatt: 120K → 0 + 30K transferred = 150K → 0
4. **Son return (Mom's UR→United)** — CPP 1.11¢ → ASSIGN. Transfer 55K Chase UR → United. Mom's UR: 130K → 75K
5. **Mom return (Mom's UR→United)** — CPP 1.03¢ → ASSIGN. Transfer 55K Chase UR → United. Mom's UR: 75K → 20K

### Final Assignment

| Segment | For | Paid By | Method | Cash | Points |
|---------|-----|---------|--------|------|--------|
| SEA→CDG Mar 31 | Son | Mom | United award (book-for-another) | $112 | 60K United |
| MIA→CDG Apr 1 | Mom | Mom | United award + Chase UR transfer | $112 | 20K United + 40K UR→United |
| Hyatt 6N | Both | Mom | Hyatt award + Chase UR transfer | $0 | 120K Hyatt + 30K UR→Hyatt |
| CDG→SEA Apr 7 | Son | Mom | Chase UR→United transfer | $112 | 55K UR→United |
| CDG→MIA Apr 7 | Mom | Mom | Chase UR→United transfer | $112 | 55K UR→United |

**Total cash: $448** (vs $4,970 all-cash = **91% savings**)

**Mom's final balances:** Chase UR: 20K (spent 180K) | United: 0 (spent 80K) | Hyatt: 0 (spent 120K + 30K transferred)

**Son's final balances:** Chase UR: 50K (untouched!)

### Settlement Calculation

**Contribution ledger:**

| Person | Cash Paid | Points Value | Total |
|--------|-----------|-------------|-------|
| Mom | $448 | $4,522 (280K points @ various CPPs) | $4,970 |
| Son | $0 | $0 | $0 |

**Fair share (proportional to segment cost):**

| Person | Segments | Cash Equivalent | Fair Share |
|--------|----------|----------------|------------|
| Mom | MIA→CDG ($820) + half hotel ($900) + CDG→MIA ($680) | $2,400 | $2,400 |
| Son | SEA→CDG ($950) + half hotel ($900) + CDG→SEA ($720) | $2,570 | $2,570 |

**Settlement:**

```
Son owes Mom: $2,570.00

Breakdown:
• Mom's United miles paid for Son's SEA→CDG flight (60K miles, valued at $838)
• Mom's Chase UR paid for Son's CDG→SEA return (55K points, valued at $608)
• Mom's Hyatt+Chase UR paid for Son's half of hotel (75K points, valued at $900)
• Mom paid $112 cash in taxes for Son's outbound
• Mom paid $112 cash in taxes for Son's return

Son's share of the trip was $2,570 in value.
Son paid $0 cash and used 0 points.
Son should pay Mom $2,570.00 to settle.

(Mom keeps her remaining 20K Chase UR + Son keeps his 50K Chase UR)
```

---

## 6. Edge Cases & Rules

### 6.1 What if pooling saves LESS than independent booking?

Always compare:
- **Option A (pooled):** Optimizer runs with cross-traveler pooling enabled
- **Option B (independent):** Each traveler optimized separately

Present both to the advisor. Sometimes independent is better (e.g., Son's 50K Chase UR could get him a Hyatt Free Night, but pooling had Mom cover everything).

### 6.2 What if a traveler has no points?

They're a "cash-only" traveler. The optimizer assigns them cash bookings. If another traveler's points can cover their segments at good CPP, the pooling kicks in and the settlement reflects it.

### 6.3 Transfer timing risk

If Mom needs to transfer Chase UR → United, and the transfer takes 1-2 business days, but Son's flight departs tomorrow — flag this as a **warning** in the recommendation. The optimizer should prefer:
1. Direct program awards (instant) over transfers
2. Instant transfers (Chase→United) over slow ones (Amex→airline)

### 6.4 Award availability for 2+ passengers

Seats.aero `seatsRemaining` field: if only 1 award seat remains on a flight, don't assign both travelers to it. The optimizer should track consumed award seats.

### 6.5 One-way vs round-trip asymmetry

Travelers may arrive on different days but depart on the same day (or vice versa). The optimizer handles each segment independently, so this works naturally.

### 6.6 Hotel room sharing

If Mom and Son share a hotel room, the hotel segment is ONE booking for both. The settlement splits hotel cost equally (or custom). If they want separate rooms, create two hotel segments.

### 6.7 Existing `ProgramPoolingRule` integration

The `poolingScope` field drives whether cross-person spending is allowed:
- `none`: No pooling — traveler can only use their own points
- `household_only`: Only within the same `Household` in Prisma
- `authorized_user_like`: Broader — any traveler on the trip (e.g., authorized users on a credit card)
- `book_for_another`: Airline-style — anyone can book for anyone using their own miles

---

## 7. Settlement Options & Configurability

### Split Methods

| Method | Description | When to use |
|--------|-------------|-------------|
| `equal` | Total ÷ number of travelers | Friends splitting evenly |
| `proportional_to_cost` | Based on each traveler's segment costs | Different origins = different flight prices |
| `custom` | User-defined percentages | Parent paying for child, etc. |

### What counts as "value" in settlement?

The advisor can choose:

1. **Cash-equivalent value** (default): What the booking would have cost in cash. Fair because it's what the traveler would have paid without points.

2. **Points acquisition cost**: What it cost to earn those points (e.g., Chase UR from credit card spend). Harder to calculate, not recommended for v1.

3. **Program benchmark value**: Fixed cents-per-point from industry benchmarks. Simple, but may not reflect the actual redemption value.

### Edge case: "I don't want to be paid back for my points"

Allow a `waiveSettlement` flag per traveler. Mom might say "I'm happy to use my points for my son, no payback needed." The settlement memo notes this.

---

## 8. API Design

### POST `/api/trip-requests/:id/group-optimize`

Runs the pooled points optimizer for a group trip.

**Request:**
```json
{
  "splitMethod": "proportional_to_cost",
  "pointValuationMethod": "actual_redemption",
  "waiveSettlement": { "traveler_mom_id": true }
}
```

**Response:**
```json
{
  "runId": "...",
  "strategies": [
    {
      "title": "Maximize Group Points Savings",
      "totalCash": 448,
      "totalCashSavings": 4522,
      "savingsPercent": 91,
      "assignments": [...],
      "settlement": {
        "contributions": [...],
        "fairShares": [...],
        "transfers": [
          {
            "from": "son_id",
            "fromName": "Son",
            "to": "mom_id", 
            "toName": "Mom",
            "amount": 2570,
            "breakdown": [...]
          }
        ],
        "memo": "Son owes Mom $2,570.00..."
      }
    },
    {
      "title": "Independent Optimization (No Pooling)",
      "totalCash": 1680,
      ...
    },
    {
      "title": "All Cash",
      "totalCash": 4970,
      ...
    }
  ]
}
```

### GET `/api/trip-requests/:id/settlement`

Returns the settlement for a completed trip recommendation.

### PATCH `/api/trip-requests/:id/settlement`

Update settlement configuration (split method, waivers, custom splits).

---

## 9. Testing Strategy

### Unit Tests

| Test | What it validates |
|------|-------------------|
| `test_two_travelers_no_overlap` | Two travelers, no shared programs — no pooling benefit |
| `test_two_travelers_one_has_all_points` | One traveler has points, other has none — full pooling |
| `test_transfer_ratio_respected` | Chase UR → Hilton at 1:2 ratio correctly doubles points |
| `test_budget_constraint` | Traveler with $500 budget isn't assigned $600 cash booking |
| `test_seat_availability_limit` | Only 1 award seat — only 1 traveler gets it |
| `test_settlement_equal_split` | Equal split with 2 travelers, symmetric trips |
| `test_settlement_proportional` | Different origin cities, different costs |
| `test_settlement_with_waiver` | Mom waives settlement → Son owes $0 |
| `test_settlement_three_travelers` | Minimum transfers for 3-person settlement |
| `test_pooling_scope_none` | Points NOT shared when `poolingScope = none` |
| `test_pooling_scope_household` | Points shared only within household |
| `test_per_traveler_dates` | Different departure dates generate different flight searches |

### Integration Tests

- Full flow: Create trip → Add travelers with different cities/dates → Run group optimize → Verify settlement
- Compare: Group pooled result vs individual optimization — pooled should be ≤ individual total cash

---

## 10. Rollout Plan

### Stage 1: Schema Migration (Week 1)
- Add per-traveler date fields
- Add `GroupSettlement` model
- Extend enums
- Update traveler API to accept dates

### Stage 2: Core Algorithm (Week 2-3)
- Implement `group-optimizer.ts` (candidate generation + greedy solver)
- Implement `settlement.ts` (fair share + transfers + memo)
- Unit tests for all edge cases

### Stage 3: Integration (Week 3-4)
- Wire into recommendation engine as new strategy type
- Update flight search for per-traveler dates
- New API routes for group-optimize and settlement
- Update `generate-itinerary` to pass per-traveler dates

### Stage 4: UI (Week 4-5)
- Per-traveler date picker in trip creation flow
- Group strategy recommendation card
- Settlement summary view
- Settlement memo (printable)

---

## 11. Open Questions

1. **Should Son's untouched 50K Chase UR be factored into settlement?** Current design says no — settlement only considers what was *used*. But an alternative is "opportunity cost" — Son *could have* used his points but chose not to.

2. **Multi-currency settlement**: If Mom used United miles (valued at 1.4¢) and Chase UR (valued at 2.0¢), should the settlement use a blended rate or per-program rates? Current design uses per-program rates for accuracy.

3. **Partial pooling**: What if the optimizer finds it's optimal to use *some* of Son's Chase UR and *some* of Mom's? The greedy algorithm handles this naturally, but the settlement explanation becomes more complex.

4. **Real-time award pricing**: The optimizer uses award availability at search time. Prices may change before booking. Should we lock in prices, or re-optimize at booking time?

5. **Group size limit**: The greedy algorithm is O(T² × S × A) where T=travelers, S=segments, A=award options. For 2-4 travelers this is trivial. At what group size should we switch to ILP?
