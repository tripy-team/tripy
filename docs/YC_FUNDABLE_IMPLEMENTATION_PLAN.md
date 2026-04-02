# YC-Fundable Implementation Plan

**Tripy: AI analyst for travel advisors and concierge teams.**

Advisors paste in a messy client request, and Tripy turns it into optimized flight and points recommendations, polished client proposals, and live rebooking intelligence.

This document maps the 17 YC-fundable features onto the existing Tripy codebase. For each feature it describes what already exists, what must change, why it matters, and how it impacts the system. It then sequences everything into a phased roadmap that keeps the MVP razor-sharp.

---

## Current Architecture Summary

| Layer | Stack |
|-------|-------|
| **Backend** | FastAPI, DynamoDB (boto3), PuLP ILP solver, OpenAI (gpt-4o-mini), SerpAPI, AwardTool v2, Stripe, AWS Cognito, Mangum (Lambda) |
| **Frontend** | Next.js 15 (App Router + Turbopack), React 19, Tailwind CSS v4, Radix UI, Lucide icons, Leaflet maps, Stripe.js |
| **Infra** | AWS CDK (DynamoDB, Lambda, API Gateway, S3, App Runner, Amplify, SES, Cognito, Secrets Manager) |

Key existing subsystems:
- **Solo trip flow**: setup form -> optimization (ILP + SerpAPI + AwardTool) -> ranked results -> booking instructions -> payment gate -> share
- **Group planning**: multi-traveler, pooled points, settlement, booking workflows
- **B2B scaffolding**: `organizations`, `org-members`, `clients`, `client-points` tables and routes already exist; `get_org_context` middleware exists
- **AI**: `POST /extract-trip-info` with OpenAI structured extraction; `trip-chatbot-inline.tsx` for natural-language prefill
- **Monitoring**: domain layer with alerts, cron checks, price tracking
- **Optimization**: ILP solver (`solver_v3.py`), transfer strategy engine, cost breakdown agent, policy engine

---

## Feature-by-Feature Implementation

### Feature 1: AI Trip Intake Parser

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Backend extraction | `backend/src/handlers/openAI.py` → `extract_trip_info_with_openai` | Extracts cities, dates, budget, card programs via `gpt-4o-mini` JSON mode |
| Frontend chat | `frontend/src/components/trip-chatbot-inline.tsx` | Sends text to `POST /extract-trip-info`, receives `ExtractedTripInfo`, fills solo setup form |
| Setup form | `frontend/src/app/(app)/solo/setup/page.tsx` | Accepts extracted fields but only covers basic solo inputs |

**What changes**

*Backend — `backend/src/handlers/openAI.py`*

Rework the `extract_trip_info_with_openai` function and its OpenAI prompt:

| Current extraction | New extraction |
|--------------------|----------------|
| Cities (origin/destination) | **Multiple origins** per traveler (NYC, LA) |
| Date range | Date range + **flexibility window** (±3 days) |
| Budget (number) | Budget + **budget type** (total, per-person, flexible) |
| Card programs (list) | Card programs + **per-traveler balances** + **preference** (points-first, cash-first, mixed) |
| — | **Travelers** (count, names if given, relationships) |
| — | **Cabin preferences** (per traveler or group-wide, with "if reasonable" qualifier) |
| — | **Special constraints** (free-text: avoid tight layovers, luxury over savings, etc.) |

New Pydantic response model — `backend/src/schemas/intake.py` (new file):

```python
class TravelerExtraction(BaseModel):
    name: Optional[str]
    origin: Optional[str]
    loyalty_programs: list[LoyaltyBalance]

class TripIntakeResult(BaseModel):
    travelers: list[TravelerExtraction]
    destinations: list[str]
    date_range: DateRange
    date_flexibility_days: int
    cabin_preference: str          # economy | premium_economy | business | first | flexible
    cabin_qualifier: Optional[str] # "if reasonable", "must be", etc.
    budget: BudgetExtraction
    points_preference: str         # points_first | cash_first | mixed
    special_constraints: list[str]
    raw_input: str
```

Modify the OpenAI prompt to be a multi-shot extraction prompt with examples matching the spec ("Family of 4 from NYC and LA to Rome..."). Use `response_format={"type": "json_object"}` with the schema embedded in the system prompt.

Add a new route `POST /intake/parse` in `backend/src/routes/intake.py` (new file) that:
1. Calls the enhanced extraction
2. If a `clientId` is provided, merges client profile data (home airport, loyalty balances, preferences) as context
3. Returns `TripIntakeResult` plus a confidence score per field

*Frontend — `frontend/src/components/trip-chatbot-inline.tsx`*

Rework the chat component:
- Support multi-turn clarification ("You mentioned 4 travelers — are all from NYC, or different cities?")
- Display extracted fields as editable chips/tags inline in the chat
- Add a "Looks good, plan this trip" confirmation step that maps extraction to the setup form fields
- Show a structured preview card before committing

*Frontend — `frontend/src/app/(app)/solo/setup/page.tsx`*

- Accept the richer `TripIntakeResult` shape and populate multi-traveler fields
- Add a prominent "Paste a client request" entry point at the top of the form (textarea + "Parse with AI" button) as an alternative to the chatbot
- When intake is parsed, pre-fill the entire form and highlight AI-filled fields with a subtle indicator

**Why it matters**

This is the first-touch experience. An advisor who pastes a client email and sees Tripy instantly structure it into travelers, origins, budgets, and constraints will immediately understand this is not a form builder. It is the hook that converts trial signups to active users.

**Impact on the app**

- New backend route (`/intake/parse`) and schema file
- Modified OpenAI handler with richer prompt and response model
- Modified chatbot component (multi-turn, editable extraction)
- Modified setup page (paste-to-parse entry, multi-traveler pre-fill)
- Increased OpenAI token usage per extraction (budget accordingly)

---

### Feature 2: Client Profile Memory

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Client table | `infra/lib/dbStack.ts` → `tripy-clients` | PK `orgId`, SK `clientId`; has name, email, homeAirport, notes, preferences, stats |
| Client points table | `infra/lib/dbStack.ts` → `tripy-client-points` | PK `orgId#clientId`, SK `program`; stores balance per program |
| Client CRUD routes | `backend/src/routes/clients.py` | Create, list, get, update, points CRUD |
| Client pages | `frontend/src/app/(app)/clients/` | List, new, detail pages |
| Trip ↔ Client linking | `backend/src/schemas/trip.py` | Trip records carry `orgId`, `clientId`, `advisor_note` |

**What changes**

*Backend — `backend/src/schemas/client.py`*

Extend the client schema to store reusable context that powers smarter recommendations:

```python
class ClientPreferences(BaseModel):
    preferred_airlines: list[str]
    preferred_airports: list[str]    # not just home — also acceptable alternates
    cabin_default: str               # economy | business | first | flexible
    budget_style: str                # budget | moderate | premium | ultra-premium
    avoid_constraints: list[str]     # "tight layovers", "red-eyes", "self-transfers"
    positive_constraints: list[str]  # "direct flights preferred", "lounge access important"

class FamilyMember(BaseModel):
    name: str
    relationship: str                # spouse, child, parent, etc.
    age: Optional[int]
    loyalty_programs: list[str]      # programs this member has access to
    notes: Optional[str]

# Add to existing client record
class ClientRecord:
    ...existing fields...
    preferences: ClientPreferences   # replaces simple {"flightClass": "business"}
    family_members: list[FamilyMember]
    travel_history_summary: Optional[str]  # AI-generated summary updated after each trip
```

*Backend — `backend/src/repos/client_repo.py`*

- Add `update_preferences`, `add_family_member`, `remove_family_member` methods
- Add `get_client_with_context` that returns client + points + family + recent trip history in one call (used by the intake parser and optimizer)

*Backend — Optimization integration*

Modify `backend/src/agents/orchestrator.py` and the ILP pipeline:
- Before optimization, fetch client context via `get_client_with_context`
- Feed preferences (avoid constraints, cabin default, airline preferences) into the policy engine (`backend/src/policy/`) as soft constraints
- Feed family members into the multi-traveler planner so the optimizer knows the group composition

*Frontend — `frontend/src/app/(app)/clients/[clientId]/page.tsx`*

Rework the client detail page into a rich profile:
- **Loyalty section**: Current points balances with program logos, last-updated timestamps, quick-edit inline
- **Preferences section**: Airline preferences, cabin default, budget style, avoid/prefer constraints as tag inputs
- **Family section**: List of family members with relationship, add/edit/remove
- **Notes section**: Free-text advisor notes (existing)
- **Trip history**: Timeline of past trips with savings, status, and quick-open links
- **AI summary**: Auto-generated one-liner about this client's travel style (e.g., "Premium leisure traveler, prefers direct business class, Amex-heavy portfolio")

*Frontend — `frontend/src/app/(app)/solo/setup/page.tsx`*

When a client is selected:
- Auto-populate all preferences, not just home airport and points
- Show family members as selectable travelers ("Who's traveling this time?")
- Pre-fill cabin preference, budget style, and constraints from client profile

**Why it matters**

Advisors serve repeat clients. Every trip starts with the same context: who they are, what points they have, how they like to travel. Storing this once and reusing it across trips makes the workflow compounding. The more trips an advisor runs through Tripy for a client, the smarter Tripy gets about that client. This is what makes the product sticky — switching to a competitor means losing all accumulated client intelligence.

**Impact on the app**

- Extended client schema (preferences, family members, travel history summary)
- New repo methods for preferences and family CRUD
- Modified optimizer to consume client context as soft constraints
- Reworked client detail page (rich profile instead of basic form)
- Modified trip setup to pre-fill from full client context
- Foundation for Feature 13 (Preference Graph) — every preference stored here becomes training data later

---

### Feature 3: Cash vs Points Recommendation Engine

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| ILP solver | `backend/src/optimization/solver_v3.py` | Optimizes out-of-pocket cost across cash + points options using PuLP |
| Transfer strategy | `backend/src/handlers/transfer_strategy.py` | Computes optimal transfer paths between bank programs and airlines |
| AwardTool integration | `backend/src/handlers/awardtool_v2.py` | Fetches award availability (prime + poll pattern) |
| SerpAPI flights | `backend/src/handlers/serp_client.py` | Fetches cash fares from Google Flights |
| Cost breakdown agent | `backend/src/agents/cost_breakdown_agent.py` | LLM-enhanced breakdown of segment costs |
| Transfer bonus scraper | `backend/src/services/transfer_bonus_scraper.py` | Scrapes current transfer bonus promotions |
| Programs config | `backend/src/config/programs.py` / `programs.yml` | Loyalty program metadata, transfer partners, valuations |
| TPG valuations | Referenced in handlers | Points valuation benchmarks (cents per point) |

The engine already computes transfer paths and feeds them into the ILP solver, but the output is presented as a single optimized itinerary rather than a clear cash-vs-points comparison with reasoning.

**What changes**

*Backend — `backend/src/services/points_optimizer.py` (new file)*

Create a dedicated points optimization service that sits between the raw solver output and the recommendation layer:

```python
class PointsRecommendation(BaseModel):
    strategy: str                      # "all_cash" | "all_points" | "mixed" | "split_by_traveler"
    total_cash_cost: float
    total_points_used: dict[str, int]  # program -> points
    estimated_cpp: dict[str, float]    # program -> cents-per-point achieved
    benchmark_cpp: dict[str, float]    # program -> TPG/market benchmark
    value_rating: str                  # "excellent" | "good" | "fair" | "poor"
    transfers_required: list[TransferStep]
    transfer_bonuses_applied: list[TransferBonus]
    savings_vs_all_cash: float
    reasoning: str                     # deterministic, not LLM-generated

class CashVsPointsComparison(BaseModel):
    all_cash_option: CashOption
    all_points_option: Optional[PointsOption]
    mixed_option: Optional[MixedOption]
    recommended: str                   # which option and why
    comparison_summary: str
```

This service:
1. Takes the ILP solver output and the raw fare/award data
2. Constructs three explicit strategies: all-cash, all-points, optimal-mix
3. For each, calculates CPP achieved vs benchmark, total cost, transfers needed
4. Compares strategies head-to-head and picks the best based on client preferences (budget_style from client profile)
5. Factors in active transfer bonuses from `transfer_bonus_scraper`
6. Generates deterministic reasoning strings (templates, not LLM) explaining why each strategy is or is not recommended

*Backend — `backend/src/handlers/transfer_strategy.py`*

Extend to:
- Return all viable transfer paths ranked, not just the optimal one
- Include transfer time estimates per partner
- Flag "risky" transfers (long transfer times, partners with inconsistent availability)
- Include active transfer bonuses with expiration dates

*Backend — `backend/src/optimization/solver_v3.py`*

Modify the ILP to:
- Run in three modes: minimize cash, minimize points, minimize blended cost
- Return all three solutions (not just the single optimal)
- Support per-traveler point constraints ("only use 50k of John's Amex, save the rest")

*Frontend — `frontend/src/app/(app)/solo/results/page.tsx`*

Add a **Cash vs Points Comparison Panel** above the itinerary cards:
- Side-by-side comparison: All Cash | Best Points | Recommended Mix
- Per-strategy: total cost, points used, CPP achieved, value rating badge
- Transfer bonus callout ("20% Amex → ANA bonus active through April — this saves 16,000 points")
- Clear "Why this is the best strategy" summary
- Expandable "Why not the other strategies" section

**Why it matters**

This is the **strongest technical wedge**. No consumer tool does this well. The points ecosystem is complex (50+ transfer partners, variable valuations, time-limited bonuses, multi-program strategies), and advisors currently do this analysis manually with spreadsheets and mental math. Tripy doing this in seconds, with clear reasoning, is the core "10x better" moment that makes the product fundable.

**Impact on the app**

- New service file (`points_optimizer.py`) — the intellectual core of the product
- Extended ILP solver to produce three solution variants
- Extended transfer strategy handler for richer output
- New frontend comparison panel on results page
- This is the feature investors will demo. It must be polished.

---

### Feature 4: Multi-Traveler and Multi-Origin Planning

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Group planning | `backend/src/routes/group_planning.py` | Full group CRUD: travelers, loyalty balances, optimization, split, settlement |
| Group models | `backend/src/models/group_planning.py`, `group_trip.py` | Rich group data model with passengers, pooling, delegation |
| Multi-airport input | `frontend/src/components/ui/multi-airport-autocomplete.tsx` | Supports selecting multiple departure airports |
| Metro airports | `backend/src/config/metro_airports.py` | Maps metro areas to all commercial airports |
| Solo orchestrator | `backend/src/agents/orchestrator.py` | Currently single-origin focused |
| Group optimization | `backend/src/routes/optimize.py` → `/optimize/group` | Group optimization exists but is a separate flow from solo |

The group planning system is heavy (settlement, ledger, booking workflows) and designed for self-serve group trips, not advisor-managed family/couple planning.

**What changes**

*Backend — `backend/src/services/multi_traveler_service.py` (new file)*

Create a lightweight multi-traveler planning service that is simpler than the full group system but supports the advisor use case:

```python
class TravelerInput(BaseModel):
    name: str
    origin: str                        # can differ per traveler
    loyalty_programs: list[LoyaltyBalance]
    cabin_preference: Optional[str]    # override group default
    constraints: list[str]

class MultiTravelerPlan(BaseModel):
    travelers: list[TravelerInput]
    shared_destination: str
    shared_dates: DateRange
    group_constraints: list[str]       # "keep everyone on same flights", "minimize total cost"
    budget: BudgetConstraint
    points_strategy: str               # "pool" | "per_traveler" | "mixed"
```

This service:
1. Accepts multiple travelers with different origins
2. Finds routing options that can converge at the destination
3. Supports partial points usage across the group ("Use all of Mom's Amex, save Dad's Chase")
4. Optimizes either per-traveler or pooled, based on advisor choice
5. Handles mixed-cabin scenarios ("Parents in business, kids in economy")

*Backend — `backend/src/optimization/solver_v3.py`*

Extend the ILP solver to:
- Accept multi-origin input as separate routing constraints
- Solve for group convergence (all travelers arrive within a time window)
- Support per-traveler cabin and points constraints
- Produce per-traveler breakdowns in the output

*Backend — `backend/src/agents/orchestrator.py`*

Modify the orchestration flow:
- If travelers have different origins, run parallel flight searches per origin
- Merge results and feed into the multi-origin-aware ILP
- Handle "family on same flights" constraint (when origins match)

*Frontend — `frontend/src/app/(app)/solo/setup/page.tsx`*

Rename the flow from "solo" to just "trip" internally (the URL can stay for now). Modify the setup form:
- **Traveler builder**: Add/remove travelers, each with name, origin airport, loyalty programs
- When a client is selected, auto-populate travelers from client's family members
- Per-traveler cabin preference toggle
- Group-level constraint selector: "Keep on same flights" / "Optimize independently" / "Converge at destination"
- Points strategy selector: "Pool all points" / "Use per-traveler" / "Let Tripy decide"

*Frontend — Results display*

Modify results to show per-traveler routing when origins differ:
- Visual: converging route lines on a map
- Per-traveler itinerary cards that merge at the destination
- Per-traveler cost/points breakdown with group total

**Why it matters**

Family and group travel is where manual planning breaks down completely. An advisor managing a family of 4 from two cities with three loyalty programs is currently juggling 6+ browser tabs and a spreadsheet. Making this a one-click experience is a dramatic time savings and a strong demo moment. It also naturally expands the TAM — every multi-traveler trip is more complex, more valuable, and harder to replace with a generic tool.

**Impact on the app**

- New service file for multi-traveler logic
- Extended ILP solver for multi-origin constraints
- Modified orchestrator for parallel search
- Significantly reworked setup form (traveler builder)
- Extended results display for per-traveler breakdowns
- Reuses existing group planning infrastructure where applicable, but avoids the heavy settlement/ledger layer

---

### Feature 5: Top 3 Recommendation Generator

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Ranked itineraries | `backend/src/optimization/pipeline.py` | Produces ranked options sorted by ILP objective |
| Results display | `frontend/src/app/(app)/solo/results/page.tsx` | Shows ranked `ItineraryCard` components |
| Decision header | `frontend/src/components/DecisionHeader.tsx` | Shows top recommendation context |
| "Why not others" | `frontend/src/components/WhyNotOthers.tsx` | Explains why alternatives rank lower |

The optimizer already produces multiple ranked options, but they are sorted by a single objective (minimize out-of-pocket). There is no explicit "best overall / cheapest / most luxurious" categorization.

**What changes**

*Backend — `backend/src/services/recommendation_engine.py` (new file)*

Create a recommendation categorization service that runs after optimization:

```python
class RecommendationCategory(str, Enum):
    BEST_OVERALL = "best_overall"
    LOWEST_COST = "lowest_cost"
    BEST_EXPERIENCE = "best_experience"

class CategorizedRecommendation(BaseModel):
    category: RecommendationCategory
    label: str                          # "Best Overall" | "Lowest Out-of-Pocket" | "Best Comfort & Convenience"
    itinerary: ItineraryResult
    cash_vs_points: CashVsPointsComparison  # from Feature 3
    route_summary: str                  # "JFK → FCO, nonstop, Delta One, 9h 15m"
    price_summary: str                  # "$480 + 80,000 Amex MR"
    tradeoffs: list[str]               # "Costs $420 more but avoids self-transfer"
    risks: list[str]                   # "Requires 2-day transfer lead time"
    booking_steps: list[BookingStep]   # ordered steps to execute this option
    why_this_option: str               # one-sentence rationale
```

The categorization logic:
1. **Best Overall**: Highest composite score (ILP objective weighted by client preferences — luxury clients weight comfort higher, budget clients weight cost)
2. **Lowest Cost**: Minimize `total_cash_outlay + (points_used * benchmark_cpp)` — the cheapest in absolute terms
3. **Best Experience**: Maximize cabin class, minimize layovers, prefer nonstop, prefer preferred airlines — comfort-optimized regardless of price

Each recommendation includes full context: route, pricing, tradeoffs, risks, and actionable booking steps.

*Backend — `backend/src/routes/solo.py`*

Modify the optimization response to return `top_3: list[CategorizedRecommendation]` in addition to the full ranked list.

*Frontend — `frontend/src/app/(app)/solo/results/page.tsx`*

Redesign the results page around the Top 3:
- **Hero section**: Three recommendation cards side by side, each with category badge, one-liner, price, and "Select" button
- **Comparison table**: Below the cards, a structured comparison (price, points, duration, stops, cabin, risks)
- **Full list**: Expandable section below with all other options for advisors who want to dig deeper
- **"Why this option" tooltip**: On hover/click, shows the rationale for each category assignment

**Why it matters**

Advisors do not want 50 search results. They want a decision-ready shortlist that they can present to a client in a meeting. The Top 3 format maps directly to how advisors already communicate: "Here are your options — the best deal, the most comfortable, and my recommendation." This structure also makes the client proposal (Feature 7) trivially easy to generate.

**Impact on the app**

- New service file for recommendation categorization
- Modified optimization response schema
- Redesigned results page (hero section + comparison table)
- Foundation for Feature 7 (proposals built from the Top 3 output)

---

### Feature 6: Explainability Layer

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Cost breakdown agent | `backend/src/agents/cost_breakdown_agent.py` | LLM-enhanced reasoning for per-segment cost breakdown |
| WhyNotOthers component | `frontend/src/components/WhyNotOthers.tsx` | Explains why alternatives were not chosen |
| Policy engine | `backend/src/policy/` | Penalties, itinerary math, risk modes |
| Risk badges | `frontend/src/components/RiskBadge.tsx` | Visual risk indicators |
| Evidence chips | `frontend/src/components/EvidenceChips.tsx` | Shows evidence for decisions |

The building blocks exist, but explanations are fragmented across components and not structured for client consumption.

**What changes**

*Backend — `backend/src/services/explainability_service.py` (new file)*

Create a centralized explainability service that generates structured reasoning for every recommendation:

```python
class ExplanationBlock(BaseModel):
    type: str                          # "why_best" | "tradeoff" | "risk" | "alternative_rejected" | "points_strategy"
    headline: str                      # "This option costs $420 more but avoids a self-transfer"
    detail: str                        # Longer explanation
    confidence: str                    # "high" | "medium" | "low"
    data_sources: list[str]           # "Google Flights (cached 2h ago)", "AwardTool (live)"

class RecommendationExplanation(BaseModel):
    why_recommended: ExplanationBlock
    tradeoffs: list[ExplanationBlock]
    risks: list[ExplanationBlock]
    alternatives_rejected: list[ExplanationBlock]
    points_reasoning: ExplanationBlock  # why cash/points/mixed strategy was chosen
```

Generation is **deterministic, not LLM-based**:
1. Compare the recommended option against each alternative on key dimensions (price, duration, stops, cabin, risk)
2. For each dimension where the recommended option is worse, generate a tradeoff explanation
3. Pull risk flags from the policy engine (self-transfers, tight connections, separate tickets)
4. For each rejected alternative, generate a one-line reason ("Option B saves $200 but adds a 14-hour layover in IST")
5. For the points strategy, compare CPP achieved vs benchmark and explain value

*Frontend — Results and Proposal Pages*

Add explainability throughout:
- Each Top 3 card has an expandable "Why this option" section with `ExplanationBlock` rendering
- A "Compare in detail" view that shows tradeoff columns side by side
- Tooltip-style explanations on price and points figures ("80,000 MR at 3.4 cpp — excellent value vs 2.0 cpp benchmark")
- Risk callouts styled as amber/red alerts with clear language ("This itinerary involves a self-transfer at LHR with a 2h window — luggage must be rechecked")

*Frontend — New component: `frontend/src/components/ExplanationPanel.tsx`*

Reusable component that renders `RecommendationExplanation` in advisor-mode (full detail, CPP numbers, data sources) and client-mode (simplified language, no jargon).

**Why it matters**

AI that cannot explain its reasoning is not trustworthy enough for professional use. An advisor will not send a recommendation to a high-value client without understanding why Tripy chose it. The explainability layer is what makes Tripy client-safe — the advisor can verify the logic and confidently stand behind the recommendation. It also differentiates from generic search tools that just list flights.

**Impact on the app**

- New explainability service generating structured reasoning
- New reusable frontend component for explanation rendering
- Modified results page with integrated explanations
- Dual-mode rendering (advisor vs client) prepares for Feature 11

---

### Feature 7: Client-Ready Proposal Generator

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Share flow | `backend/src/routes/solo.py` | Share/claim via token, email magic link |
| EmailPlanModal | `frontend/src/components/EmailPlanModal.tsx` | Modal to email share link |
| LockPlanCTA | `frontend/src/components/LockPlanCTA.tsx` | Prompts user to save/lock a plan |
| Booking guide | `frontend/src/components/ui/BookingGuide.tsx` | Step-by-step booking instructions |
| B2B plan: branded share | `docs/B2B_SAAS_IMPLEMENTATION_PLAN.md` Phase B2 | Designed but not implemented |

No proposal generation exists. The share page is a raw results dump, not a polished deliverable.

**What changes**

*Backend — `backend/src/services/proposal_service.py` (new file)*

```python
class ProposalConfig(BaseModel):
    trip_id: str
    org_id: str
    client_id: str
    selected_recommendations: list[str]  # which of the top 3 to include
    advisor_note: str
    show_alternatives: bool
    show_booking_steps: bool
    show_points_breakdown: bool

class Proposal(BaseModel):
    proposal_id: str
    share_token: str
    share_url: str
    branding: OrgBranding
    client_name: str
    trip_summary: str
    recommendations: list[ClientFacingRecommendation]
    advisor_note: str
    booking_instructions: Optional[list[BookingStep]]
    created_at: str
    expires_at: Optional[str]
```

New routes in `backend/src/routes/proposals.py` (new file):
- `POST /proposals` — Create a proposal from trip results
- `GET /proposals/{proposal_id}` — Get proposal (advisor view)
- `GET /shared/proposals/{share_token}` — Public proposal page (client view, no auth)
- `POST /proposals/{proposal_id}/send` — Email proposal link to client via SES

The proposal service:
1. Takes the Top 3 recommendations and strips them to client-safe output (no CPP figures, no internal metrics)
2. Applies org branding (logo, colors, agency name)
3. Generates a share token and URL
4. Stores the proposal in a new `tripy-proposals` DynamoDB table
5. Tracks share events for analytics

*Infra — `infra/lib/dbStack.ts`*

Add `tripy-proposals` table: PK `orgId`, SK `proposalId`, GSI on `shareToken`.

*Frontend — `frontend/src/app/(app)/solo/results/page.tsx`*

Add "Create Proposal" button that opens a proposal builder:
- Select which recommendations to include (default: all Top 3)
- Write or edit advisor note
- Toggle sections (booking steps, points breakdown, alternatives)
- Live preview of what the client will see
- "Share" button generates link + optional email send

*Frontend — `frontend/src/app/proposals/[token]/page.tsx` (new file)*

Public-facing proposal page:
- Agency logo and brand color header
- Advisor note at top
- Recommendation cards in client-friendly language
- Price and points summary (simplified)
- Recommended choice highlighted
- Booking instructions (if included)
- "Questions? Contact [advisor] at [agency]" footer
- No Tripy branding (white-label)
- Mobile-responsive

*Frontend — PDF generation (stretch)*

- "Download PDF" button on proposal page
- Use `html2pdf.js` or similar client-side library for MVP
- Backend `weasyprint` generation for higher quality in later iteration

**Why it matters**

This is the feature that makes Tripy visible to the client, not just the advisor. A polished proposal that an advisor can send in 30 seconds replaces the hours spent assembling screenshots, spreadsheet snippets, and email paragraphs. It also creates a feedback loop — if clients receive proposals that look premium, they value the advisor more, which justifies the advisor's fee, which justifies paying for Tripy. This is the "close the loop" feature.

**Impact on the app**

- New DynamoDB table (`tripy-proposals`)
- New backend routes and service for proposal CRUD
- New public-facing proposal page (white-label)
- Modified results page with proposal builder
- Foundation for Feature 16 (white-label) — branding system built here is reused

---

### Feature 8: Booking Instruction Generator

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Booking checklist | `frontend/src/components/BookingChecklist.tsx` | Checklist-style booking steps |
| Booking guide | `frontend/src/components/ui/BookingGuide.tsx` | Step-by-step guide component |
| Transfer instructions | `frontend/src/components/ui/transfer-instructions-card.tsx` | Transfer execution steps |
| Transfer strategy handler | `backend/src/handlers/transfer_strategy.py` | Computes transfer paths with timing |
| Booking instructions handler | `backend/src/handlers/booking_instructions.py` | Generates booking instruction data |

Basic instruction generation exists but is not sequenced, does not warn about risks, and does not account for multi-traveler coordination.

**What changes**

*Backend — `backend/src/handlers/booking_instructions.py`*

Enhance to produce ordered, risk-aware instructions:

```python
class BookingStep(BaseModel):
    step_number: int
    actor: str                         # "John", "Sarah", or "Advisor"
    action: str                        # "Transfer 60,000 Amex MR to ANA Mileage Club"
    platform: str                      # "amextravel.com", "united.com"
    timing: str                        # "Do this first — transfers take 1-2 business days"
    is_irreversible: bool              # True for point transfers
    warning: Optional[str]             # "Once transferred, points cannot be returned to Amex"
    depends_on: Optional[int]          # step_number that must complete first
    estimated_duration: str            # "Instant" | "1-2 business days" | "Up to 7 days"

class BookingInstructions(BaseModel):
    steps: list[BookingStep]
    critical_warnings: list[str]       # top-level warnings shown prominently
    separate_ticket_risks: list[str]   # baggage, connection, cancellation risks
    total_estimated_time: str          # "3-5 business days from start to finish"
    recommended_start_date: str        # based on travel date minus buffer
```

Ordering logic:
1. Irreversible actions (point transfers) come last, after all flights are confirmed available
2. Award bookings before cash bookings (awards can disappear)
3. Per-traveler sequencing when travelers book separately
4. Dependency chain enforcement (cannot book award until transfer completes)

*Frontend — `frontend/src/components/BookingInstructionFlow.tsx` (new component)*

Replace existing checklist with a richer step-by-step UI:
- Numbered steps with actor badges ("John books", "Sarah transfers")
- Dependency arrows between steps
- Warning badges (amber for timing risks, red for irreversible actions)
- Collapsible detail per step
- "Copy instructions" button for pasting into messages
- Printable format

**Why it matters**

The gap between "here's your recommendation" and "the trip is booked" is where mistakes happen. An advisor who sends a client detailed, ordered, risk-aware instructions is providing genuine value. Incorrect transfer orders, surprise separate tickets, and missed booking windows are real pain points. This feature reduces advisory risk and increases client trust.

**Impact on the app**

- Enhanced booking instructions handler with sequencing and risk logic
- New frontend component replacing existing checklist
- Integrated into proposals (Feature 7)
- Per-traveler instructions leverage multi-traveler data (Feature 4)

---

### Feature 9: Monitoring and Re-Optimization

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Monitoring domain | `backend/src/domain/monitoring/` | Full monitoring stack: models, repo, alerts, search, tokens, utils |
| Monitoring routes | `backend/src/routes/monitoring.py` | Start/stop monitoring, status, verify, cron check |
| Monitoring config | `backend/src/config/monitoring.py` | Tiers, check intervals |
| Email alerts | `backend/src/services/email_service.py` | SES-based notifications |
| Price tracking | Monitoring search + alerts | Tracks price changes on monitored trips |

A monitoring system exists and is relatively mature. The main gaps are: no premium cabin upgrade detection, no transfer bonus opportunity alerts, and no proactive re-optimization.

**What changes**

*Backend — `backend/src/domain/monitoring/search.py`*

Extend monitored dimensions:
- **Premium cabin availability**: Check for business/first class award seats that were not available at optimization time
- **Transfer bonus opportunities**: Cross-reference `transfer_bonus_scraper` output with the trip's points strategy — alert if a new bonus makes a different strategy better
- **Schedule changes**: Detect airline schedule changes that create better or worse connection options
- **Price threshold alerts**: Configurable per-trip thresholds ("alert me if cash price drops below $X" or "if award availability opens in business")

*Backend — `backend/src/services/reoptimization_service.py` (new file)*

```python
class ReoptimizationTrigger(BaseModel):
    trip_id: str
    trigger_type: str       # "price_drop" | "award_availability" | "transfer_bonus" | "schedule_change"
    original_value: str
    new_value: str
    potential_savings: float
    recommendation: str     # "Re-optimize to save $340" | "Business class now available via United"

class ReoptimizationResult(BaseModel):
    trip_id: str
    original_recommendation: CategorizedRecommendation
    new_recommendation: CategorizedRecommendation
    improvement_summary: str
    advisor_action_needed: bool
```

When a monitoring check finds a significant improvement:
1. Run a lightweight re-optimization (reuse cached data where possible)
2. Compare new result to original recommendation
3. If improvement exceeds threshold, create a `ReoptimizationTrigger` and notify the advisor
4. Store the new recommendation alongside the original (do not overwrite)

*Backend — `backend/src/routes/monitoring.py`*

Add:
- `GET /monitoring/{trip_id}/opportunities` — List active improvement opportunities
- `POST /monitoring/{trip_id}/reoptimize` — Trigger re-optimization based on an opportunity
- `PATCH /monitoring/{trip_id}/preferences` — Set monitoring preferences (which dimensions to watch, alert thresholds)

*Frontend — `frontend/src/app/(app)/solo/results/page.tsx`*

Add a "Monitor this trip" toggle after optimization:
- Select what to monitor (price, awards, bonuses)
- Set alert preferences (email, in-app, both)
- Show monitoring status badge on the trip card

*Frontend — `frontend/src/app/(app)/dashboard/page.tsx`*

Add a **Monitoring Alerts** section:
- Active alerts across all monitored trips
- Each alert shows the opportunity, potential savings, and "Re-optimize" action button
- Badge count in navigation for unread alerts

**Why it matters**

This transforms Tripy from a one-time search tool into ongoing workflow software. An advisor who monitors 20 active client trips and gets alerts about better options is providing continuous value. It also creates daily engagement — advisors come back to check alerts, not just when a new trip request arrives. For YC, this is the difference between a tool and a platform: recurring usage, compounding value, and a reason to stay subscribed.

**Impact on the app**

- Extended monitoring search with new dimensions
- New re-optimization service
- New monitoring routes and preferences
- Dashboard alerts section (drives daily engagement)
- Increased background compute (monitoring checks run on cron)

---

### Feature 10: AI Copilot for Advisors

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Trip chatbot | `frontend/src/components/trip-chatbot-inline.tsx` | Single-purpose: parse natural language into form fields via `POST /extract-trip-info` |
| OpenAI integration | `backend/src/handlers/openAI.py` | Extraction and search functions |
| BaseAgent | `backend/src/agents/base.py` | Agent framework with `_call_llm` / `_call_llm_json` |

The current AI integration is extraction-only. There is no conversational interface for iterating on results.

**What changes**

*Backend — `backend/src/agents/advisor_copilot.py` (new file)*

Build a stateful copilot agent that understands the current trip context and can execute optimization modifications:

```python
class CopilotAction(BaseModel):
    action_type: str    # "modify_constraint" | "reoptimize" | "explain" | "compare"
    parameters: dict
    description: str    # human-readable description of what changed

class CopilotAgent(BaseAgent):
    """
    Conversational agent for advisors to iterate on trip recommendations.

    Available commands:
    - "Make this cheaper" → adds cost minimization weight, re-runs optimizer
    - "Keep everyone on one routing" → adds same-flight constraint
    - "Only use Chase points" → restricts loyalty programs
    - "Show me better business class options" → re-searches with cabin filter
    - "Remove self-transfers" → adds policy constraint
    - "Optimize for lowest stress for elderly travelers" → adjusts policy weights
    """
```

The copilot:
1. Receives the current trip context (travelers, constraints, current recommendations)
2. Parses the advisor's natural-language instruction into a structured `CopilotAction`
3. Modifies the optimization parameters accordingly
4. Triggers a targeted re-optimization (not full re-search if possible)
5. Returns updated recommendations with an explanation of what changed

*Backend — `backend/src/routes/copilot.py` (new file)*

- `POST /copilot/message` — Send a message with trip context, receive action + updated results
- Uses streaming (SSE) for long-running re-optimizations

*Frontend — `frontend/src/components/AdvisorCopilot.tsx` (new file)*

A chat panel that lives alongside the results page:
- Persistent side panel (collapsible) on the results page
- Shows conversation history for this trip
- Supports quick-action buttons: "Make cheaper", "More comfort", "Fewer stops", "Change points strategy"
- Streaming responses with progress indicators during re-optimization
- Each response shows what changed and updated recommendation cards

*Frontend — `frontend/src/app/(app)/solo/results/page.tsx`*

Integrate the copilot panel:
- Toggle button in the results header: "Ask Tripy"
- Copilot panel slides in from the right
- Results update in real-time as the copilot modifies constraints

**Why it matters**

This makes Tripy feel like a **thinking partner**, not a static dashboard. The difference between "generate results, manually tweak parameters, regenerate" and "tell Tripy what you want in plain English" is the difference between software and an AI product. For YC, this is the feature that justifies the AI narrative — it is not just using LLMs for extraction, it is using them for ongoing workflow assistance.

**Impact on the app**

- New copilot agent with action parsing and targeted re-optimization
- New backend route with SSE streaming
- New frontend chat panel component
- Modified results page layout (side panel integration)
- Increased OpenAI usage (each copilot message = 1 LLM call)

---

### Feature 11: Internal Notes + Client-Safe Output Separation

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Advisor note field | Trip schema `advisor_note` | Single text field on trip record |
| B2B plan reference | Phase B1 | Describes advisor note + share settings |

Only a single `advisorNote` text field exists. There is no systematic separation between advisor-facing and client-facing content.

**What changes**

*Backend — Trip and Recommendation schemas*

Add two content layers throughout:

```python
class AdvisorAnnotation(BaseModel):
    recommendation_id: str
    internal_notes: str           # "Client has a 10-year anniversary — push for luxury"
    pricing_notes: str            # "This is a weak redemption but client insisted on ANA"
    client_visible_note: str      # "I recommend Option A for the best combination of comfort and value"
    hidden_from_client: list[str] # specific data points to suppress (e.g., "CPP analysis")

class TripAnnotations(BaseModel):
    trip_id: str
    advisor_internal_note: str    # general trip-level private note
    client_greeting: str          # "Hi John, here are your options for Tokyo"
    annotations: list[AdvisorAnnotation]  # per-recommendation notes
```

*Backend — `backend/src/routes/proposals.py`*

When generating a proposal (Feature 7), strip all `internal_notes` and `hidden_from_client` items. Only include `client_visible_note` and `client_greeting`.

*Frontend — Results page*

Add a **dual-view toggle**:
- **Advisor View** (default): Shows all data, internal notes, CPP figures, risk details, data source timestamps
- **Client Preview**: Shows exactly what the client will see — simplified language, no internal metrics, only client-visible notes

Per-recommendation annotation:
- Expandable "Advisor Notes" section on each recommendation card (only visible in advisor view)
- "Client Note" field that appears on the proposal

**Why it matters**

Advisors need to think privately before presenting to clients. Seeing raw optimization data (CPP, transfer risk percentages, solver confidence scores) is useful for the advisor but confusing or alarming for the client. The separation lets advisors use Tripy as a full analytical tool while presenting clean, confident recommendations. This is a fundamental requirement for professional use.

**Impact on the app**

- New annotation schema on trips and recommendations
- Modified proposal generation to enforce content separation
- Dual-view toggle on results page
- Per-recommendation note fields in the UI

---

### Feature 12: Team Workspace

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Org table | `tripy-organizations` | Exists with owner, plan, branding |
| Org members table | `tripy-org-members` | PK orgId, SK userId, role (owner/member) |
| Org routes | `backend/src/routes/orgs.py` | GET /orgs/me, branding, members |
| Org context middleware | `backend/src/utils/jwt_auth.py` → `get_org_context` | Returns org_id, user_id, role |
| B2B plan Phase D | Docs | Simple member addition designed |

Basic org/member infrastructure exists. Missing: trip assignment/handoff, activity history, permissions granularity.

**What changes**

*Backend — `backend/src/schemas/org.py`*

Extend org member model:

```python
class OrgMember(BaseModel):
    org_id: str
    user_id: str
    role: str                      # "owner" | "admin" | "member"
    display_name: str
    email: str
    active_client_count: int       # computed
    active_trip_count: int         # computed

class TripAssignment(BaseModel):
    trip_id: str
    assigned_to: str               # user_id of the responsible advisor
    assigned_by: str
    assigned_at: str
    note: Optional[str]            # "Taking over while Sarah is on vacation"
```

*Backend — Activity tracking*

Add lightweight activity logging to trip operations (no separate table for MVP — store as a list on the trip record):

```python
class ActivityEntry(BaseModel):
    timestamp: str
    user_id: str
    action: str          # "created" | "optimized" | "shared" | "reassigned" | "annotated"
    detail: Optional[str]
```

*Backend — `backend/src/routes/orgs.py`*

Add:
- `POST /orgs/members` — Add member by email (Phase D from B2B plan)
- `DELETE /orgs/members/{userId}` — Remove member
- `PATCH /trips/{tripId}/assign` — Reassign trip to different advisor
- `GET /orgs/activity` — Recent activity across the org (last 50 events)

*Frontend — `frontend/src/app/(app)/settings/page.tsx`*

Add team management section:
- Member list with name, email, role, active clients/trips
- "Add Member" form
- "Remove" (owner only)

*Frontend — `frontend/src/app/(app)/dashboard/page.tsx`*

Add team context:
- "My Trips" vs "All Team Trips" toggle
- Trip cards show assigned advisor avatar/name
- Quick "Reassign" action on trip cards
- Activity feed sidebar (optional, show last 10 events)

**Why it matters**

Agencies are the expansion path from individual advisors to multi-seat SaaS revenue. A team workspace with trip handoff and visibility is the minimum feature set that makes a 3-5 person agency willing to pay per-seat pricing. For YC, this is the difference between "tool for freelancers" and "B2B SaaS with expansion revenue."

**Impact on the app**

- Extended org member schema
- Trip assignment/handoff logic
- Activity tracking on trip records
- Team management UI in settings
- Dashboard team view toggle

---

### Feature 13: Proprietary Preference Graph

**What exists today**

Nothing. No learning from advisor behavior.

**What changes**

*Backend — `backend/src/services/preference_graph.py` (new file)*

Build a preference learning system that observes advisor behavior over time:

```python
class PreferenceSignal(BaseModel):
    org_id: str
    advisor_id: str
    client_id: Optional[str]
    signal_type: str           # "selected_option" | "rejected_option" | "modified_constraint" | "copilot_instruction"
    context: dict              # trip parameters at the time
    signal_data: dict          # what was chosen/rejected/modified

class PreferenceProfile(BaseModel):
    entity_id: str             # advisor_id or client_id
    entity_type: str           # "advisor" | "client"
    preferences: dict          # learned weights
    confidence: float          # how much data backs this
    last_updated: str
```

Signals captured:
- Which of the Top 3 options was selected (luxury vs budget pattern)
- What the advisor edited before sharing (indicates dissatisfaction with AI output)
- Copilot instructions (e.g., frequent "remove self-transfers" → learn to deprioritize self-transfers)
- Per-client patterns (Client A always picks business, Client B always picks cheapest)

For MVP, this is a **logging and simple heuristic system**, not ML:
1. Store all preference signals in a `tripy-preference-signals` DynamoDB table
2. Compute simple frequency-based weights: "Advisor X selects nonstop 80% of the time → weight nonstop routes higher for this advisor"
3. Feed learned weights into the optimizer as soft constraints (adjusting the ILP objective coefficients)

ML-based learning comes later when there is enough data.

*Infra — `infra/lib/dbStack.ts`*

Add `tripy-preference-signals` table: PK `orgId`, SK `timestamp#signalId`.

*Backend — Integration points*

Instrument signal capture at:
- `backend/src/routes/solo.py` — when a recommendation is selected
- `backend/src/routes/proposals.py` — when a proposal is created (which options included)
- `backend/src/routes/copilot.py` — copilot instructions as signals
- `backend/src/routes/clients.py` — preference changes as signals

Before optimization, query the preference profile and inject learned weights into the optimizer.

**Why it matters**

This is the **data moat**. Every optimization run, every advisor choice, every copilot instruction feeds the preference graph. Over 6 months, Tripy knows how each advisor thinks for each client type. This makes the product harder to replace — a competitor starting from zero has no preference data. For YC, this is the defensibility story: "Our product gets smarter with every use, and that intelligence is specific to each advisor's practice."

**Impact on the app**

- New DynamoDB table for preference signals
- Signal capture instrumented across multiple routes
- Preference profile computation (simple heuristics for MVP)
- Optimizer modified to accept learned weight overrides
- Foundation for ML-based personalization later

---

### Feature 14: Recommendation Feedback Loop

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Feedback route | `backend/src/routes/solo.py` | Basic feedback endpoint exists |
| Frontend feedback | Referenced in solo routes | Minimal feedback collection |

**What changes**

*Backend — `backend/src/services/feedback_service.py` (new file)*

Structured feedback capture at every decision point:

```python
class FeedbackEvent(BaseModel):
    trip_id: str
    org_id: str
    event_type: str
    timestamp: str
    data: dict

# Event types:
# "recommendation_selected" — which of the Top 3 was chosen
# "recommendation_edited" — what the advisor changed before sharing
# "recommendation_rejected" — advisor dismissed an option (capture reason if given)
# "proposal_sent" — proposal shared with client
# "client_responded" — client accepted/rejected/asked questions
# "booking_completed" — trip was actually booked
# "booking_failed" — booking attempt failed (capture reason)
# "plan_changed" — client changed plans after booking
# "reoptimization_accepted" — monitoring alert led to rebooking
```

*Backend — `backend/src/routes/feedback.py` (new file)*

- `POST /feedback/event` — Record a feedback event
- `GET /feedback/trip/{trip_id}` — Get feedback timeline for a trip
- `GET /feedback/stats` — Org-level feedback aggregates

*Frontend — Throughout the flow*

Instrument feedback capture:
- Results page: Track which option is selected, time spent viewing each
- Proposal builder: Track edits made before sharing
- Post-share: Simple "Did the client approve?" prompt after 48 hours
- Booking page: "Was booking successful?" confirmation
- Dashboard: Aggregate feedback stats (selection rate, edit rate, client approval rate)

*Integration with Feature 13*

Every feedback event is also a preference signal. Feed feedback events into the preference graph for learning.

**Why it matters**

This creates **training data** for improving the recommendation engine. If advisors consistently edit the same type of recommendation before sharing, that signals a systematic gap in the AI output. If clients consistently reject certain options, that signals a mismatch between the AI's and the client's preferences. For YC, this is the story of improving unit economics over time: "Every recommendation makes the next one better."

**Impact on the app**

- New feedback service and routes
- Feedback instrumentation throughout the frontend flow
- Integration with preference graph (Feature 13)
- Dashboard feedback analytics

---

### Feature 15: Agency-Level Memory

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Org record | `tripy-organizations` | Has branding but no operational preferences |
| Client preferences | Feature 2 (this plan) | Per-client preferences |

**What changes**

*Backend — `backend/src/schemas/org.py`*

Extend the organization record with operational preferences:

```python
class AgencyPreferences(BaseModel):
    # House style
    default_cabin_preference: str          # "business" — this agency always starts with business
    acceptable_connection_mins: int        # 90 — minimum connection time the agency considers safe
    max_stops: int                         # 1 — never recommend 2-stop itineraries
    self_transfer_policy: str              # "never" | "warn" | "allow"
    separate_ticket_policy: str            # "never" | "warn" | "allow"

    # Preferred vendors
    preferred_airlines: list[str]          # ["United", "Delta"] — weight these higher
    blocked_airlines: list[str]            # ["Spirit"] — never recommend
    preferred_alliances: list[str]         # ["Star Alliance"]

    # Pricing norms
    max_cpp_threshold: float               # 2.5 — don't use points below this value
    min_savings_to_recommend_points: float  # 200 — don't bother with points for <$200 savings

    # Communication
    default_proposal_greeting: str         # "Thank you for choosing [agency]. Here are your options:"
    default_booking_disclaimer: str        # "Prices and availability subject to change..."
```

*Backend — Optimizer integration*

Load `AgencyPreferences` before every optimization and apply as constraints:
- `acceptable_connection_mins` → minimum connection time in policy engine
- `blocked_airlines` → filter from search results
- `max_cpp_threshold` → override points strategy when redemption value is poor
- These are **defaults** that can be overridden per-client or per-trip

*Frontend — `frontend/src/app/(app)/settings/page.tsx`*

Add "Agency Defaults" section:
- Connection time minimum (slider)
- Self-transfer policy (dropdown)
- Preferred/blocked airlines (tag input)
- Points value threshold (number input)
- Default proposal text (textarea)
- Each setting shows "This will apply to all new trips unless overridden"

**Why it matters**

Agencies have a house style. A luxury agency never recommends Spirit Airlines. A points-focused agency never uses points at less than 2 CPP. Encoding this once means every advisor in the firm gets consistent, on-brand output without manual configuration per trip. This also increases switching costs — all those agency-specific rules would need to be rebuilt in a competitor.

**Impact on the app**

- Extended org schema with agency preferences
- Optimizer consumes agency defaults as base constraints
- Settings page gains agency defaults section
- Per-trip/per-client overrides layer on top of agency defaults

---

### Feature 16: White-Label Client Experience

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Org branding | `tripy-organizations` `branding` field | `brandName`, `brandColor`, `logoUrl` |
| B2B plan Phase B | Designed | Branded share page with agency identity |

Basic branding fields exist on the org record. No white-label rendering exists.

**What changes**

This feature is largely delivered by Feature 7 (Proposal Generator). The additional work:

*Backend — `backend/src/routes/orgs.py`*

Extend branding to include:
- `logoUrl` (S3 presigned upload)
- `brandColor` (primary)
- `accentColor` (secondary)
- `fontFamily` (from a curated list)
- `customDomain` (future: agency.tripy.ai or their own domain)
- `emailFromName` (how emails appear: "From: Elite Points Consulting")
- `hideTripy` (boolean: completely remove "Powered by Tripy" footer)

*Frontend — `frontend/src/app/proposals/[token]/page.tsx`*

Apply full branding:
- Logo in header
- Brand color as primary button/accent color
- Agency name in all text
- Custom footer text
- No Tripy branding when `hideTripy` is true
- Responsive email-preview layout

*Frontend — Monitoring update emails*

When monitoring alerts trigger client-facing emails (Feature 9), those emails should also be white-labeled with agency branding.

**Why it matters**

Agencies want better tools without giving up client ownership. If the deliverable says "Powered by Tripy," the advisor's value looks diminished. White-label lets the advisor take full credit while Tripy does the work. This is standard B2B SaaS — the agency is the customer, the traveler is the end user, and the end user should see the agency's brand.

**Impact on the app**

- Extended branding schema
- Branding applied to proposals, emails, and monitoring notifications
- Logo upload flow (S3 presigned URL)
- `hideTripy` toggle for premium plans (potential upsell lever)

---

### Feature 17: ROI Dashboard

**What exists today**

| Component | Path | State |
|-----------|------|-------|
| Trip stats | Client `stats` field | `totalTrips`, `totalSavings`, `totalPointsOptimized` per client |
| B2B plan Phase E1 | Designed | Analytics from operational data |

Basic per-client stats exist but are not aggregated or visualized.

**What changes**

*Backend — `backend/src/services/analytics_service.py` (new file)*

Compute ROI metrics from operational data (no separate analytics tables):

```python
class ROIMetrics(BaseModel):
    # Time savings
    avg_optimization_time_seconds: float      # how long each optimization takes
    estimated_hours_saved: float              # trips × estimated_manual_hours - trips × optimization_time
    trips_handled: int
    trips_per_advisor: dict[str, int]

    # Value metrics
    total_savings_generated: float            # sum of estimatedSavings across all trips
    total_points_optimized: int               # sum of points used across all trips
    avg_savings_per_trip: float
    avg_cpp_achieved: float                   # weighted average CPP across all point redemptions

    # Engagement metrics
    proposals_sent: int
    proposals_per_trip: float                 # how often advisors share output
    monitoring_alerts_generated: int
    rebooking_wins: int                       # monitoring alerts that led to better bookings
    rebooking_savings: float

    # Efficiency
    active_clients: int
    clients_per_advisor: dict[str, int]
    avg_response_time_hours: float            # time from trip creation to first optimization
```

*Backend — `backend/src/routes/analytics.py` (new file)*

- `GET /analytics/roi` — Full ROI dashboard data
- `GET /analytics/roi/export` — CSV export for reporting

*Frontend — `frontend/src/app/(app)/analytics/page.tsx` (new file)*

ROI Dashboard:
- **Hero metrics**: Total Savings, Hours Saved, Trips Handled, Active Clients
- **Trend charts**: Savings over time, trips per month, proposals sent
- **Per-advisor breakdown**: Table showing each team member's metrics
- **Rebooking wins**: Monitoring-driven savings (Feature 9)
- **Export button**: Download CSV for client reporting or internal reviews

Design the dashboard to be **screenshot-worthy** — advisors should want to share it with clients ("Look how much I've saved you this year") and agency owners should want to show it to justify the Tripy subscription.

**Why it matters**

B2B budgets get approved on ROI, not novelty. An agency owner who can see "Tripy saved our clients $47,000 this quarter and freed up 120 advisor hours" will renew without hesitation. The ROI dashboard is the retention feature — it makes the value of the subscription concrete and defensible. It is also a sales tool: "Here's what our pilot agency achieved in 90 days."

**Impact on the app**

- New analytics service computing metrics from trip/proposal/monitoring data
- New analytics route
- New dashboard page
- No additional DynamoDB tables (all derived from existing data)

---

## Phased Roadmap

### MVP (Weeks 1-8): The YC Demo

The tightest set of features that tells a fundable story.

```
Week 1-2: Foundation
├── Feature 1: AI Trip Intake Parser (enhanced extraction + chat)
├── Feature 2: Client Profile Memory (extended client schema + preferences)
└── B2B Wedge: Org/client infrastructure (from existing B2B plan Phase A)

Week 3-4: Core Intelligence
├── Feature 3: Cash vs Points Recommendation Engine
├── Feature 4: Multi-Traveler / Multi-Origin Planning
└── Feature 5: Top 3 Recommendation Generator

Week 5-6: Trust & Delivery
├── Feature 6: Explainability Layer
├── Feature 7: Client-Ready Proposal Generator
└── Feature 8: Booking Instruction Generator

Week 7-8: Stickiness
├── Feature 9: Monitoring & Re-Optimization (extend existing)
└── Feature 11: Internal Notes + Client-Safe Output
```

**MVP demo script for YC:**
1. Advisor pastes a messy client email → Tripy structures it instantly (Feature 1)
2. Client's loyalty balances and preferences are already stored (Feature 2)
3. Tripy compares cash vs points strategies and recommends the best mix (Feature 3)
4. Family of 4 from two cities — all planned together (Feature 4)
5. Three options presented: best deal, best comfort, best overall (Feature 5)
6. Clear explanations for every recommendation (Feature 6)
7. One click generates a branded proposal for the client (Feature 7)
8. Step-by-step booking instructions with risk warnings (Feature 8)
9. Tripy keeps watching and alerts when a better deal appears (Feature 9)

---

### V2 (Weeks 9-14): Defensibility + Revenue

```
Week 9-10: AI Copilot
├── Feature 10: AI Copilot for Advisors
└── Feature 14: Recommendation Feedback Loop

Week 11-12: Team & Scale
├── Feature 12: Team Workspace
├── Feature 15: Agency-Level Memory
└── Feature 16: White-Label Client Experience

Week 13-14: Revenue & Proof
├── Feature 17: ROI Dashboard
├── Feature 13: Proprietary Preference Graph (logging + simple heuristics)
└── Monetization: Stripe subscription (from B2B plan Phase C)
```

---

### Enterprise (Post-funding): Expansion

```
- ML-powered preference graph (upgrade Feature 13 from heuristics to models)
- Custom domain white-label (agency.tripy.ai)
- API access for agency CRM integration
- Advanced role-based permissions
- Client self-service portal
- Hotel and ground transport expansion (beyond flights)
- Audit log and compliance features
- Multi-currency and international support
```

---

## Files Impact Summary

### New Backend Files

| File | Feature | Purpose |
|------|---------|---------|
| `backend/src/schemas/intake.py` | 1 | Enhanced trip intake response model |
| `backend/src/routes/intake.py` | 1 | AI intake parsing route |
| `backend/src/services/points_optimizer.py` | 3 | Cash vs points comparison engine |
| `backend/src/services/multi_traveler_service.py` | 4 | Multi-traveler/multi-origin planning |
| `backend/src/services/recommendation_engine.py` | 5 | Top 3 categorization logic |
| `backend/src/services/explainability_service.py` | 6 | Structured reasoning generation |
| `backend/src/services/proposal_service.py` | 7 | Proposal CRUD and generation |
| `backend/src/routes/proposals.py` | 7 | Proposal API routes |
| `backend/src/services/reoptimization_service.py` | 9 | Re-optimization triggers and execution |
| `backend/src/agents/advisor_copilot.py` | 10 | Copilot agent with action parsing |
| `backend/src/routes/copilot.py` | 10 | Copilot chat route (SSE) |
| `backend/src/services/preference_graph.py` | 13 | Preference signal logging and learning |
| `backend/src/services/feedback_service.py` | 14 | Feedback event capture |
| `backend/src/routes/feedback.py` | 14 | Feedback API routes |
| `backend/src/services/analytics_service.py` | 17 | ROI metric computation |
| `backend/src/routes/analytics.py` | 17 | Analytics API routes |

### Modified Backend Files

| File | Features | Changes |
|------|----------|---------|
| `backend/src/handlers/openAI.py` | 1 | Enhanced extraction prompt, multi-traveler parsing |
| `backend/src/schemas/client.py` | 2, 15 | Extended preferences, family members |
| `backend/src/repos/client_repo.py` | 2 | New methods for preferences, family, context |
| `backend/src/agents/orchestrator.py` | 3, 4 | Multi-origin search, client context injection |
| `backend/src/optimization/solver_v3.py` | 3, 4 | Three-mode solving, multi-origin constraints |
| `backend/src/handlers/transfer_strategy.py` | 3 | Richer transfer path output, bonus integration |
| `backend/src/handlers/booking_instructions.py` | 8 | Ordered steps, risk warnings, dependencies |
| `backend/src/domain/monitoring/search.py` | 9 | Premium cabin, transfer bonus, schedule monitoring |
| `backend/src/routes/monitoring.py` | 9 | Opportunity listing, re-optimization trigger |
| `backend/src/routes/solo.py` | 5, 11, 13 | Top 3 response, annotations, signal capture |
| `backend/src/schemas/org.py` | 12, 15, 16 | Agency preferences, extended branding |
| `backend/src/routes/orgs.py` | 12, 15, 16 | Team management, preferences, branding |
| `backend/src/policy/engine.py` | 2, 15 | Client + agency preferences as soft constraints |
| `backend/src/app.py` | All | Register new routers |

### New Frontend Files

| File | Feature | Purpose |
|------|---------|---------|
| `frontend/src/components/ExplanationPanel.tsx` | 6 | Reusable explanation rendering (dual-mode) |
| `frontend/src/app/proposals/[token]/page.tsx` | 7, 16 | Public white-label proposal page |
| `frontend/src/components/BookingInstructionFlow.tsx` | 8 | Enhanced step-by-step booking UI |
| `frontend/src/components/AdvisorCopilot.tsx` | 10 | Chat panel for iterating on results |
| `frontend/src/app/(app)/analytics/page.tsx` | 17 | ROI dashboard |

### Modified Frontend Files

| File | Features | Changes |
|------|----------|---------|
| `frontend/src/components/trip-chatbot-inline.tsx` | 1 | Multi-turn, editable extraction, confirmation step |
| `frontend/src/app/(app)/solo/setup/page.tsx` | 1, 2, 4 | Paste-to-parse, traveler builder, client auto-populate |
| `frontend/src/app/(app)/solo/results/page.tsx` | 3, 5, 6, 10, 11 | Cash vs points panel, Top 3 hero, explanations, copilot, dual-view |
| `frontend/src/app/(app)/clients/[clientId]/page.tsx` | 2 | Rich client profile (preferences, family, history) |
| `frontend/src/app/(app)/dashboard/page.tsx` | 9, 12, 17 | Monitoring alerts, team view, ROI summary |
| `frontend/src/app/(app)/settings/page.tsx` | 12, 15, 16 | Team management, agency defaults, branding |
| `frontend/src/components/navigation.tsx` | 9 | Alert badge for monitoring notifications |
| `frontend/src/lib/api.ts` | All | New API methods for proposals, copilot, analytics, feedback |
| `frontend/src/types/` | All | New types across features |

### New Infrastructure

| Resource | Feature | Details |
|----------|---------|---------|
| `tripy-proposals` DynamoDB table | 7 | PK `orgId`, SK `proposalId`, GSI `shareToken` |
| `tripy-preference-signals` DynamoDB table | 13 | PK `orgId`, SK `timestamp#signalId` |

---

## Technical Risks and Mitigations

### Risk: OpenAI latency on intake parsing
**Mitigation**: Use `gpt-4o-mini` for speed. Cache extraction results by input hash. Show progressive UI (extraction happening → fields appearing one by one).

### Risk: AwardTool availability data staleness
**Mitigation**: Show data freshness timestamps on every result. Monitoring (Feature 9) catches stale data. Booking instructions include "verify availability before transferring points" warnings.

### Risk: ILP solver performance with multi-origin + three-mode solving
**Mitigation**: Profile solver with existing benchmarks (existing test suite). Set hard timeout (30s) per solve. Parallelize three-mode solving. Cache intermediate results.

### Risk: Preference graph overfitting to small sample sizes
**Mitigation**: Require minimum signal count before applying learned weights. Show confidence levels. Advisor can override or reset preferences.

### Risk: White-label proposal pages indexed by search engines
**Mitigation**: Add `noindex` meta tag. Use short-lived share tokens (expire after 30 days). Require token for access.

---

## The Fundable Narrative

This feature set supports exactly one story:

> **Tripy is an AI analyst for travel advisors and concierge teams. Advisors paste in a messy client request, and Tripy turns it into optimized flight and points recommendations, polished client proposals, and live rebooking intelligence — in minutes instead of hours.**

The MVP (Features 1-9, 11) proves the workflow works.
V2 (Features 10, 12-17) proves it scales and compounds.
Enterprise expansion proves the market is large.

The data flywheel (Features 13-14) creates defensibility.
The white-label proposals (Features 7, 16) create distribution.
The ROI dashboard (Feature 17) creates retention.

Every feature maps to a specific moment in the advisor workflow. Nothing is speculative. Nothing is a "nice to have." Every feature either makes the advisor faster, makes the output better, or makes the product harder to replace.
