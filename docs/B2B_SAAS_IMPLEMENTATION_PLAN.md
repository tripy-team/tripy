# B2B SaaS Implementation Plan

## The Problem We Are Solving

Travel advisors and points consultants spend hours manually researching transfer routes, comparing cash vs. points options, and assembling booking instructions for each client. Most use spreadsheets, screenshots, and memory. The daily pain looks like:

- Manually checking transfer partners across 4-5 bank programs for every trip
- Rebuilding the same transfer logic from scratch for every client
- Copying screenshots and pasting them into emails as "recommendations"
- Trying to explain complex points decisions to clients who just want to know what to book

There is no purpose-built tool that stores a client's loyalty balances, generates optimized cash + points strategies, and produces client-ready deliverables.

**Tripy's B2B goal is not to become generic travel agency software. It is to become the loyalty optimization workspace travel advisors use to manage client points, generate better trip recommendations, and deliver polished booking guidance.**

---

## First Customer Workflow

This is the canonical loop the entire plan must support. Every phase exists to make this workflow faster, smarter, or more presentable.

1. Advisor signs up and creates a workspace
2. Advisor adds a client and enters their loyalty balances
3. Advisor creates a trip for that client
4. Tripy generates an optimized cash + points strategy with booking instructions
5. Advisor reviews the output, optionally adds a personal note, and shares a branded recommendation with the client
6. Client sees a polished, white-labeled page with exactly what to book and why
7. Advisor tracks savings generated across their client portfolio

If this loop does not work end to end, nothing else matters. If it works and advisors come back to it daily, everything else follows.

---

## Non-Goals

Tripy is not:

- **A full CRM** -- client records exist to support loyalty balances, preferences, and trip history, not deal stages, activity timelines, or tags
- **A TMC or corporate travel platform** -- we are not building expense management, policy enforcement, or approval workflows
- **A generic itinerary generator** -- the wedge is cash + points optimization intelligence, not "here are 10 flight options"
- **An API company** -- no public API until the product is validated with direct users
- **A booking engine** -- Tripy recommends what to book and how; actual booking happens on airline/bank sites

---

## ICP: Who We Are Building For First

**Independent points consultants and small leisure travel advisors with 1-5 agents serving premium clients.**

Why this segment:

- Shorter sales cycle (solo decision-maker or tiny team)
- Obvious pain (manually tracking client points across programs, rebuilding transfer strategies from scratch each trip)
- High willingness to pay for time savings + polished deliverables
- Less enterprise security/compliance overhead
- Already familiar with loyalty optimization -- Tripy's core intelligence is immediately valuable

We are explicitly **not** optimizing for:

- Large TMCs or Concur-style enterprises (too long a sales cycle, too much compliance)
- API-first platform customers (premature without proven product-market fit)
- General travel agencies that do not focus on points/loyalty (wrong wedge)

---

## The B2B Wedge

Tripy is not a full CRM. It is not an agency OS. It is a **client loyalty optimization workspace**.

The core value prop for advisors:

- Store client points balances once, reuse across trips
- Generate the best cash vs. points strategy in minutes, not hours
- Produce client-ready booking instructions that make the advisor look smart
- Track savings generated to justify fees and retain clients

Everything in this plan serves that wedge. If a feature does not make an advisor faster, smarter, or more presentable to their clients, it waits.

---

## Advisor-Facing vs. Client-Facing

The UI and data model must support two distinct modes. This distinction affects routes, permissions, components, and share pages throughout the plan.

### Advisor-facing (internal workspace)

- Editable and operational
- Shows all itinerary options, alternate strategies, internal notes
- Displays raw optimization data (CPP, transfer times, risk levels)
- Contains advisor notes and client context
- May be messy -- it is a working tool

### Client-facing (shared deliverables)

- Polished and branded with agency identity
- Shows only the final recommendation (or a curated shortlist)
- Simplified language -- no jargon, no internal metrics
- Includes clear step-by-step booking instructions
- No Tripy branding, no internal noise

Every feature that produces output should be designed with this split in mind: "What does the advisor see? What does the client see?"

---

## Metric Definitions

These terms are used throughout the plan and in dashboards, deliverables, and ROI language. They must be defined consistently.

### estimatedSavings

**Definition**: The cheapest comparable all-cash itinerary price minus the recommended itinerary's net out-of-pocket cost.

Example: If the best all-cash flight is $3,200 and Tripy's recommended points strategy costs $480 out-of-pocket, `estimatedSavings = $2,720`.

Points value is shown separately (e.g., "used 80,000 Amex points at 3.4 cpp") but is not included in the savings number. This keeps the metric concrete and defensible.

Stored as a first-class field on the trip record. Computed after optimization completes. Immutable once set (represents the recommendation at time of optimization).

### pointsStrategySummary

**Definition**: A deterministic, human-readable summary of the transfer strategy generated at optimization time.

Example: "Transfer 60,000 Chase UR to United MileagePlus for JFK-NRT business class. Pay $180 in taxes. Estimated transfer time: 1-2 days."

This is a stored snapshot -- it does not update if balances change. It is not model-generated prose; it is assembled from the ILP solver output using deterministic templates. Advisors cannot edit this field directly, but they can add their own note alongside it (see Phase B).

### Active client

A client with at least one trip in `optimized`, `selected`, or `booked` status within the current billing period.

### Optimization

One invocation of the optimization endpoint that produces ranked itinerary results. This is the unit tracked for internal usage metrics.

### Shared deliverable

A branded share link or PDF generated for a client. Tracked via share events to understand how often advisors actually deliver output to clients.

---

## Current State

Tripy is a consumer-facing (B2C) tool where individual travelers:

- Sign up with email/password (AWS Cognito)
- Enter their credit card points per trip
- Get AI-optimized flight recommendations (ILP solver + SerpAPI + AwardTool)
- Pay per-trip ($12 base + $4/extra stop) to unlock booking instructions
- Share results via email magic link

Key limitations for B2B:

- No organization or team concept -- single-user model only
- Points are stored per-trip, not per-person -- agents would re-enter balances every time
- Trip ownership is `createdBy == userId` -- no way to manage trips on behalf of someone else
- Consumer messaging everywhere ("Spend Less. Travel Smarter.")
- Anonymous sessions allowed -- no account required for core flow
- No branded output -- share links are generic Tripy pages

---

## Entity Model

```
Organization (Agency / Solo Consultant)
├── Members
│   ├── Owner (the advisor who signed up)
│   └── Member (additional agents, added later)
├── Clients (portfolio)
│   ├── "Myself" (auto-created self-client for testing)
│   ├── Client A (points: Amex 120k, Chase 80k)
│   └── Client B (points: Citi 45k)
└── Trips (scoped to org + client)
    ├── Trip for Client A (created by Owner)
    └── Trip for Client B (created by Member)
```

Roles are intentionally simple for MVP:

- **owner**: billing, org settings, team management, everything a member can do
- **member**: clients, trips, reports, deliverables

Admin and viewer roles can be added later when customers ask for them.

---

## Known Data Model Pressure Points

These are design decisions that will likely need revisiting. Flagging them now to avoid painting into corners.

### Client = booking unit, not individual

For MVP, each client record represents **one booking unit**. This might be an individual traveler, a couple, or a household. Household-level and member-level loyalty asset modeling (e.g., authorized user balances, spouse cards, pooled household points) can come later. The `notes` field on the client record is the escape valve for now -- advisors can document "John + Sarah, shared Amex Plat" in free text.

### One recommendation per trip (for now)

For MVP, the trip record stores the latest optimization output. `estimatedSavings` and `pointsStrategySummary` reflect the most recent optimization run. If advisors need multiple saved recommendations per trip (e.g., "Option A: all points" vs. "Option B: mixed cash + points"), add a `Recommendation` entity later with its own ID, parent `tripId`, and snapshot of the optimization result.

### Advisor notes on deliverables (for now, lightweight)

Advisors will want to annotate recommendations before sharing. For MVP, this is a single `advisorNote` text field on the trip record that appears on the branded share page. Full rich-text editing or per-section annotations can come later.

---

## Phase A: B2B Wedge (the MVP)

**Goal**: An advisor can sign up, add clients with stored loyalty balances, optimize trips on their behalf, and see a simple workspace dashboard.

This phase is the entire product bet. If advisors will not use this daily, nothing else matters.

### Phase A must-haves vs. nice-to-haves

To keep Phase A shippable, separate what must work for the first customer from what can be rough or deferred.

**Must-have for first customer use:**

- Organization record created on signup
- Org member record (owner)
- Client record with name, email, home airport, notes
- Client-level points storage
- Trip creation with `orgId` + `clientId`
- Client selector in trip setup (auto-populates points and origin)
- Client detail page (profile, points editor, trip history)
- Basic dashboard (client count, recent trips, total savings)
- Org-scoped auth middleware

**Nice-to-have before launch (but do not block on):**

- Client list search and advanced filters
- Polished navigation rewrite
- Rich client stats computations
- Client archive/delete flows
- Extensive Pydantic schema abstractions if they slow down iteration

Do not let architecture neatness delay the wedge.

### A1. Organizations Table

Add to `infra/lib/dbStack.ts`:

- **`tripy-organizations`** -- PK: `orgId`

```python
{
    "orgId": "org_xxx",
    "name": "Elite Points Consulting",
    "ownerId": "user_xxx",
    "plan": "trial",             # trial | active | cancelled
    "trialEndsAt": "...",        # ISO timestamp
    "stripeCustomerId": None,    # set when subscription created
    "stripeSubscriptionId": None,
    "branding": {
        "brandName": "Elite Points",
        "brandColor": "#1a56db",
        "logoUrl": None,         # S3 URL, added later
    },
    "createdAt": "...",
}
```

No slug, no limits object. Keep it minimal. Branding fields live here from the start because they power deliverables in Phase B. Subscription fields live here too (no separate subscriptions table).

### A2. Org Members Table

Add to `infra/lib/dbStack.ts`:

- **`tripy-org-members`** -- PK: `orgId`, SK: `userId`, GSI: `userId-index` (userId)

```python
{
    "orgId": "org_xxx",
    "userId": "user_xxx",
    "role": "owner",  # owner | member
    "createdAt": "...",
}
```

No invite lifecycle, no status field, no `invitedBy`. A member either exists or does not. Invitation flow comes in Phase D.

### A3. Clients Table

Add to `infra/lib/dbStack.ts`:

- **`tripy-clients`** -- PK: `orgId`, SK: `clientId`

```python
{
    "orgId": "org_xxx",
    "clientId": "client_xxx",
    "name": "John Smith",
    "email": "john@example.com",
    "homeAirport": "JFK",
    "notes": "Prefers business class, flexible dates. Books with spouse (shared Amex Plat).",
    "preferences": {
        "flightClass": "business",
    },
    "stats": {                    # computed, updated after each optimization
        "totalTrips": 0,
        "totalSavings": 0,
        "totalPointsOptimized": 0,
    },
    "isSelfClient": False,        # True for the auto-created "Myself" record
    "createdBy": "user_xxx",
    "createdAt": "...",
}
```

Keep client records focused on what powers optimization and deliverables: loyalty context, travel preferences, and computed savings stats. This is not a CRM -- no deal stages, no activity timelines, no tags.

**Self-client**: On org creation, auto-create a client record named "Myself" with `isSelfClient: True`, the advisor's own email and home airport. This serves as a test client and makes migration from B2C seamless.

### A4. Client-Level Points

Add to `infra/lib/dbStack.ts`:

- **`tripy-client-points`** -- PK: `orgId#clientId`, SK: `program`

```python
{
    "orgId#clientId": "org_xxx#client_xxx",
    "program": "amex_membership_rewards",
    "balance": 120000,
    "updatedAt": "...",
    "updatedBy": "user_xxx",
}
```

This is the single most important data model change. Currently points are per-trip (`tripy-points`, PK: `tripId`). For B2B, points must live at the client level so advisors enter them once and reuse across trips.

The optimization flow should:

1. Pull points from client record if `clientId` is provided on the trip
2. Allow per-trip overrides (client says "only use 50k of my Amex for this trip")
3. Offer "save to client profile" when new balances are entered during trip setup

### A5. Org-Scoped Trips

Modify existing trip records in `tripy-trips`:

- Add `orgId` field to every trip
- Add `clientId` field to every trip
- Add `assignedTo` field (the agent working this trip, defaults to `createdBy`)
- Add `estimatedSavings` as a first-class computed field (see Metric Definitions)
- Add `pointsStrategySummary` as a first-class text field (see Metric Definitions)
- Add `advisorNote` as an optional text field (advisor's personal annotation, shown on deliverables)
- Add GSI `orgId-index` on `tripy-trips` table

Modify access control in `backend/src/services/solo_trip_service.py`:

- Change from `createdBy == user_id` to "user is a member of the trip's org"
- Any member of the org can view/edit org trips

### A6. Org-Scoped Auth Middleware

Modify `backend/src/utils/jwt_auth.py`:

```python
@dataclass
class OrgContext:
    org_id: str
    user_id: str
    role: str  # "owner" | "member"

def get_org_context(user_id: str = Depends(get_current_user_id)) -> OrgContext:
    """Look up the user's org membership. Returns OrgContext. Raises 403 if no org."""
```

This is the single new FastAPI dependency that most B2B routes will use. No complex role hierarchy -- just pass `OrgContext` and check `role` where needed.

### A7. Backend: New Routes and Repos

New files:

| File | Purpose |
|------|---------|
| `backend/src/repos/org_repo.py` | CRUD for organizations |
| `backend/src/repos/org_member_repo.py` | CRUD for org members |
| `backend/src/repos/client_repo.py` | CRUD for clients |
| `backend/src/repos/client_points_repo.py` | CRUD for client-level points |
| `backend/src/routes/orgs.py` | Org creation (on signup), org settings |
| `backend/src/routes/clients.py` | Client CRUD + points management |
| `backend/src/schemas/org.py` | Pydantic models for org, member |
| `backend/src/schemas/client.py` | Pydantic models for client, client points |

Client API routes:

| Endpoint | Purpose |
|----------|---------|
| `POST /clients` | Create client |
| `GET /clients` | List org clients (paginated) |
| `GET /clients/{clientId}` | Get client detail with points and stats |
| `PATCH /clients/{clientId}` | Update client |
| `GET /clients/{clientId}/points` | Get client's points balances |
| `PUT /clients/{clientId}/points` | Upsert client's points |
| `GET /clients/{clientId}/trips` | List client's trips |

### A8. Frontend: Registration Creates an Org

Modify `frontend/src/app/register/page.tsx`:

- Add "Company / Practice Name" field
- On signup: Cognito user creation -> create org -> create org member (owner) -> create self-client
- Change CTA from "Create Account" to "Start Free Trial"
- Remove anonymous session support for B2B flows

Modify `backend/src/routes/solo.py` auth endpoints to support org auto-creation on signup.

### A9. Frontend: Client Management Pages

Create new pages:

| Page | Purpose |
|------|---------|
| `frontend/src/app/(app)/clients/page.tsx` | Client list: name, email, points summary, total savings, trip count |
| `frontend/src/app/(app)/clients/new/page.tsx` | Add client form: name, email, home airport, notes, initial points balances |
| `frontend/src/app/(app)/clients/[clientId]/page.tsx` | Client detail: profile, points editor, trip history, savings stats |

The client detail page should feel like a "client workspace" -- the advisor's home base for everything about this client.

### A10. Frontend: Trip Setup With Client Selector

Modify `frontend/src/app/(app)/solo/setup/`:

- Add client selector at the top: "Who is this trip for?" dropdown of org clients
- On client selection, auto-populate:
  - Origin from client's `homeAirport`
  - Points from client's stored balances (editable, with "save changes to profile" option)
- Pass `clientId` and `orgId` through trip creation API
- Show client name in trip header throughout the flow

Modify `frontend/src/app/(app)/solo/results/page.tsx`:

- Show "Optimization for [Client Name]" in header
- After optimization completes, write `estimatedSavings` and `pointsStrategySummary` back to the trip record

### A11. Frontend: Advisor Dashboard

Rewrite `frontend/src/app/(app)/dashboard/page.tsx`:

- **Summary cards**: Active Clients, Trips This Month, Total Savings Generated
- **Quick actions**: Add Client, New Trip
- **Recent trips table**: client name, destination, dates, status, estimated savings
- Keep it simple -- no activity feeds, no charts, no leaderboards yet

### A12. Frontend: Navigation

Modify `frontend/src/components/navigation.tsx`:

| Link | Route |
|------|-------|
| Dashboard | `/dashboard` |
| Clients | `/clients` |
| New Trip | `/solo/setup` |
| Settings | `/settings` |

Remove: "Group Planning", "My Points", "My Trips" as separate nav items. Trips are now accessed through clients or the dashboard.

### Phase A Success Criteria

- An advisor can create a workspace, add a client, store points, create a trip, and receive an optimized recommendation -- end to end, without help
- At least 3 pilot users complete this full workflow
- Advisors report that client-level points storage saves them meaningful re-entry time
- The self-client model works transparently for existing B2C users who migrate

---

## Phase B: Client-Facing Deliverables

**Goal**: Advisors can share polished, branded optimization results with clients. This is the feature that makes advisors look premium and justifies their fees.

This phase is more important than billing, analytics, or team management. Agencies buy tools that help them close clients and look professional.

### B1. Advisor Review Before Sharing

Before sharing, the advisor should be able to lightly customize the output. This is not a full document editor -- it is a review step.

Add to the results/booking pages:

- **Advisor note field**: free-text area where the advisor can add a personal message that appears on the shared deliverable ("Hi John, here's what I recommend for your Tokyo trip. The United transfer is the best value -- let me know if you'd like to proceed.")
- **Recommendation visibility**: advisor can toggle whether to show all ranked options or only the top recommendation on the shared page
- Stored as `advisorNote` and `shareSettings` on the trip record

This solves the real concern that advisors will hesitate to send auto-generated output directly to clients without any personal touch.

### B2. Branded Share Page

Modify the existing share flow in `backend/src/routes/solo.py`:

- Include `orgId` in the share token payload
- New endpoint or modified `GET /shared/{token}` loads org branding from the org record
- Create `frontend/src/app/shared/[token]/page.tsx` with branded layout:
  - Agency logo + brand name in header (from `org.branding`)
  - Agency brand color as accent
  - Advisor note (if provided) at the top
  - Client name + trip summary
  - Recommended itinerary with savings breakdown
  - Step-by-step transfer and booking instructions
  - "Questions? Contact [advisor name] at [agency]" footer
  - No Tripy branding in the main content area (white-label feel)

### B3. Share From Results Page

Modify `frontend/src/app/(app)/solo/results/page.tsx`:

- Add "Share with Client" button that:
  - Opens a review/preview modal showing advisor note field + what the client will see
  - Generates a branded share link
  - Optionally sends via email (reuse existing SES email service)

Modify `frontend/src/app/(app)/solo/booking/page.tsx`:

- Add "Send Instructions to Client" button
- Generates share link to the branded booking instructions page

### B4. Org Branding Settings

Add a minimal branding section to `frontend/src/app/(app)/settings/page.tsx`:

- Company name (text input)
- Brand color (color picker)
- Logo upload (S3, with presigned URL)
- Preview of how the branded share page will look

Backend: Add `PATCH /orgs/branding` endpoint in `backend/src/routes/orgs.py`.

### B5. PDF Export (Stretch)

If feasible within this phase, add PDF generation:

- New endpoint: `GET /trips/{tripId}/export/pdf`
- Use `weasyprint` or `reportlab` on the backend
- Include: trip summary, itinerary, transfer strategy, savings breakdown, advisor note, agency branding
- Advisors can download and email/print for clients who prefer that

If PDF is too heavy for this phase, defer it -- the branded share link already delivers most of the value.

### Phase B Success Criteria

- Advisors actively share branded outputs with real clients (not just test links)
- At least 50% of pilot optimizations result in a share event
- Advisors report that the branded output makes them look more professional
- At least one advisor uses the advisor note field before sharing

---

## Phase C: Monetization

**Goal**: Validate that advisors will pay. Start simple, learn what pricing metric works.

### C1. Remove Per-Trip Payment Gate

Modify `backend/src/routes/payment.py` and `frontend/src/app/(app)/solo/payment/page.tsx`:

- Remove the per-trip payment wall entirely
- Remove `instructions_unlocked` status gate -- replace with org subscription check
- Simplify trip status: `draft -> optimized -> selected -> booked -> completed`
- Remove `frontend/src/components/ui/ServiceFeePayment.tsx`

### C2. Simple Subscription

Do not build a multi-tier billing portal yet. Start with:

- **Trial**: 14 days, full access, no payment required
- **Paid**: one plan, one price
- Initial price hypothesis: low hundreds per month for a solo/small-team advisor workflow product. The exact number ($79, $149, $199) should be tested with early users, not locked in.
- Store subscription state on the org record: `plan`, `trialEndsAt`, `stripeCustomerId`, `stripeSubscriptionId`

Backend:

- `POST /billing/create-checkout` -- Stripe Checkout Session for the single paid plan
- `POST /billing/portal` -- Stripe Customer Portal for managing subscription
- `GET /billing/status` -- current plan, trial days remaining, subscription status
- `POST /billing/webhook` -- handle `customer.subscription.created`, `updated`, `deleted`

No `tripy-subscriptions` table needed yet -- store subscription state directly on the org record.

### C3. Usage Tracking (Internal Only)

Create `backend/src/services/usage_service.py`:

- Count optimizations per org per month (query `tripy-trips` by `orgId` and `createdAt`)
- Count active clients per org (clients with recent trips)
- Count shared deliverables per org
- Log these numbers but do not enforce hard limits yet -- use them to learn what pricing metric resonates

### C4. Trial Gating

- On trial expiration, restrict access to optimization (402 response)
- Show upgrade prompt in the frontend
- Allow read-only access to existing trips and clients even after trial expires

### C5. Billing UI

Add to `frontend/src/app/(app)/settings/page.tsx`:

- Current plan display (Trial / Active / Cancelled)
- Trial countdown ("5 days remaining")
- "Upgrade" button -> Stripe Checkout
- "Manage Subscription" button -> Stripe Customer Portal
- Do not build billing history, payment method UI, or usage dashboards yet -- Stripe Portal handles this

### C6. Pricing Page

Rewrite `frontend/src/app/pricing/page.tsx`:

- Single plan with price
- Feature list
- "Start Free Trial" CTA
- "Questions? Book a call" link
- Do not show fake tiers or "Enterprise: Contact Us" yet -- that comes after you know the market

### What to Learn Before Finalizing Pricing

The correct pricing metric may not be obvious. Track internally and ask early users:

- Do they think in clients under management?
- Number of trip optimizations per month?
- Number of client deliverables generated?
- Per advisor seat?
- White-label output as a premium feature?

The packaging should mirror how advisors perceive their own work -- client cases, monthly volume, or reports delivered. Finalize tiers and packaging after 5-10 paying customers.

### Phase C Success Criteria

- At least 3-5 pilot users convert from trial to paid
- Pricing objections are understood and documented
- Internal usage data reveals which metric correlates most with perceived value
- No pilot user churns because the product stopped being useful (churn should be price objections, not value objections)

---

## Phase D: Collaboration

**Goal**: An advisor can add a second agent to their org. Keep it minimal.

### D1. Simple Team Addition

Modify `backend/src/routes/orgs.py`:

- `POST /orgs/members` -- owner adds a member by email
- `GET /orgs/members` -- list org members
- `DELETE /orgs/members/{userId}` -- owner removes a member

No invite tokens, no SES emails, no status lifecycle. The owner enters an email, the system creates the org-member record. When that user next logs in (or signs up), they are in the org.

**Identity resolution**: Pending member additions should be keyed by **normalized email** (lowercase, trimmed) until linked to a Cognito `userId` on first login. The `get_org_context` middleware should check both `userId` match and pending-email match during login, and resolve the record by writing the `userId` once confirmed. This avoids flakiness from email casing or Cognito identity mismatches.

### D2. Team Visibility

- All org members see all org clients and trips
- Trips show `createdBy` and `assignedTo` so agents know who owns what
- No permission granularity beyond owner vs. member

### D3. Team UI

Add minimal team section to `frontend/src/app/(app)/settings/page.tsx`:

- List of members (name, email, role)
- "Add Member" form (email input)
- "Remove" button (owner only)
- No dedicated `/team` page yet -- keep it in settings

### Phase D Success Criteria

- At least one multi-agent org is using the product
- Both agents can see and work on each other's clients and trips
- No identity resolution bugs from email/Cognito mismatches

---

## Phase E: Polish (Post-Validation)

**Goal**: Add features that early customers request. Do not build these until you have paying users.

### E1. Analytics Dashboard

Derive from operational data -- do not create separate analytics tables.

Query `tripy-trips` (by `orgId`) and `tripy-clients` (by `orgId`) to compute:

- Total clients, trips, savings, points optimized
- Savings over time (group trips by month)
- Per-agent breakdown (group by `createdBy`)

Create `frontend/src/app/(app)/analytics/page.tsx` only when customers ask for it.

### E2. Richer Onboarding

Create `frontend/src/app/(app)/onboarding/page.tsx`:

1. Confirm agency name
2. Add first real client (name, email, points)
3. Create first trip for that client
4. See results

### E3. Advanced Roles

Add `admin` and `viewer` roles only if customers request them:

- **admin**: everything except billing
- **viewer**: read-only access to clients and trips

### E4. Invite Flow With Email

Replace Phase D's simple member addition with proper email invites:

- SES invite email with magic link
- Accept/decline flow
- Pending invites list

### E5. Client Portal

Lightweight read-only portal for end clients:

- Magic link access (no password)
- View their trips, booking instructions, savings
- Route: `/portal/[token]`

### E6. Audit Log

Add `tripy-audit-log` table only when enterprise customers require it.

### E7. Full PDF Export

If not done in Phase B, build branded PDF generation here.

### E8. Marketing Site Rewrite

Full rewrite of landing, about, FAQ, contact pages. Only after the product and positioning are validated.

### E9. Multiple Recommendations Per Trip

Add a `Recommendation` entity if advisors need to save and compare multiple optimization outputs for the same trip. Each recommendation would have its own `estimatedSavings`, `pointsStrategySummary`, and `advisorNote`.

### E10. Household/Member-Level Points

Expand the client model to support multiple loyalty-asset holders per client (e.g., spouse cards, authorized users, household pooling).

---

## B2C Migration Strategy

This is critical. Existing B2C users must not break.

### Every Existing User Becomes a Single-Member Org

On deployment (or lazily on next login):

1. Create an `Organization` record: `name = "[user's name]'s Workspace"`, `ownerId = userId`, `plan = "trial"`
2. Create an `OrgMember` record: `role = "owner"`
3. Create a self-client: `name = "Myself"`, `email = user's email`, `homeAirport = user's default_home_airport`, `isSelfClient = True`
4. Backfill `orgId` on all existing trips: `orgId = new org ID`
5. Backfill `clientId` on all existing trips: `clientId = self-client ID`
6. Existing per-trip points remain in `tripy-points` and continue to work -- client-level points are additive, not a replacement

### Migration Implementation

**Recommended: Lazy migration**

- On login, check if user has an org. If not, run the migration.
- Add `get_or_create_org_context()` dependency that handles this transparently.
- No big-bang migration script needed.
- Existing trips without `orgId` are treated as belonging to the user's personal org.

**Fallback: Batch migration**

- Script that iterates all users and creates orgs/members/self-clients.
- Backfills `orgId` on all trips.
- Safer for data consistency but requires downtime or careful rollout.

### B2C Flow Preservation

The B2C flow (individual user planning their own trip) still works -- it is just an advisor with one client (themselves). The "self-client" model means:

- Existing users log in and see their trips on the dashboard
- They can add real clients if they want to use B2B features
- The trip setup flow has a client selector, but it defaults to "Myself"
- No forced workflow change for existing users

### Anonymous Sessions

Anonymous session support is kept **only as a lightweight public demo or sandbox**. It is no longer a real product path.

- Anonymous users can explore the marketing site and see a demo optimization
- Anonymous users cannot create org-scoped trips, store client data, or access any B2B features
- Anonymous users who want to save work must register (which creates an org)
- Label anonymous flows clearly as "demo" or "try it" in the UI

---

## Landing Page Direction

Rewrite `frontend/src/app/page.tsx`.

**Lead with the pain:**

> **Stop rebuilding points strategies from scratch for every client.**

Subheadline options (test with early users):

- "Store your clients' loyalty balances, generate optimized booking recommendations, and share polished instructions -- all from one workspace."
- "The loyalty optimization workspace built for travel advisors."

Key sections:

- **Hero**: Pain-driven headline, subheadline, "Start Free Trial" CTA
- **The problem**: Manually checking transfer partners, rebuilding logic per trip, copying screenshots, explaining complex decisions
- **How It Works**: 1) Add your clients and their points 2) Generate optimized cash + points strategies 3) Share branded booking instructions
- **Value props**: Save hours per client, deliver premium-looking output, track savings to justify your fees
- **Pricing**: Single plan with "Start Free Trial"
- **Footer**: Product, Resources, Company, Legal

Do not include:

- Fake social proof numbers -- only add real numbers when you have them
- ROI calculators, case studies, testimonials -- those come after real traction
- Multi-tier pricing -- single plan until pricing is validated
- Abstract positioning language ("loyalty-aware planning workspace") -- lead with the concrete pain instead

---

## Files Summary

### New files (Phase A + B)

| File | Purpose |
|------|---------|
| `backend/src/repos/org_repo.py` | Org CRUD |
| `backend/src/repos/org_member_repo.py` | Org member CRUD |
| `backend/src/repos/client_repo.py` | Client CRUD |
| `backend/src/repos/client_points_repo.py` | Client-level points CRUD |
| `backend/src/routes/orgs.py` | Org creation, settings, branding, members |
| `backend/src/routes/clients.py` | Client CRUD + points |
| `backend/src/schemas/org.py` | Org and member Pydantic models |
| `backend/src/schemas/client.py` | Client and points Pydantic models |
| `frontend/src/app/(app)/clients/page.tsx` | Client list |
| `frontend/src/app/(app)/clients/new/page.tsx` | Add client |
| `frontend/src/app/(app)/clients/[clientId]/page.tsx` | Client detail |
| `frontend/src/app/shared/[token]/page.tsx` | Branded share page |

### Modified files (Phase A + B)

| File | Change |
|------|--------|
| `infra/lib/dbStack.ts` | Add 4 tables: organizations, org-members, clients, client-points |
| `backend/src/utils/jwt_auth.py` | Add `OrgContext` dependency |
| `backend/src/app.py` | Register new routers |
| `backend/src/routes/solo.py` | Org/client scoping on trip creation, share flow branding |
| `backend/src/services/solo_trip_service.py` | Org-scoped access control |
| `backend/src/routes/optimize.py` | Write `estimatedSavings` after optimization |
| `frontend/src/app/register/page.tsx` | Company name field, org auto-creation |
| `frontend/src/app/(app)/dashboard/page.tsx` | Advisor workspace |
| `frontend/src/components/navigation.tsx` | B2B nav links |
| `frontend/src/app/(app)/solo/setup/` | Client selector, auto-populate points |
| `frontend/src/app/(app)/solo/results/page.tsx` | Client context, advisor note, share with client |
| `frontend/src/app/(app)/settings/page.tsx` | Branding section |
| `frontend/src/lib/api.ts` | New API methods for clients, orgs, billing |
| `frontend/src/types/` | New types for org, client |

### Added in Phase C

| File | Change |
|------|--------|
| `backend/src/routes/billing.py` | Stripe subscription endpoints |
| `backend/src/services/usage_service.py` | Internal usage tracking |
| `frontend/src/app/pricing/page.tsx` | Single-plan pricing page |
| `frontend/src/app/(app)/solo/payment/page.tsx` | Remove or gut (no per-trip payment) |
| `backend/src/routes/payment.py` | Remove per-trip payment endpoints |

---

## Implementation Order

```
Phase A: B2B Wedge (MVP)
  A1-A6: Data model + auth (org, members, clients, points, trip scoping)
  A7: Backend routes + repos
  A8: Registration creates org
  A9: Client management pages
  A10: Trip setup with client selector
  A11: Advisor dashboard
  A12: Navigation rewrite

Phase B: Client-Facing Deliverables
  B1: Advisor review before sharing
  B2: Branded share page
  B3: Share from results/booking pages
  B4: Org branding settings
  B5: PDF export (stretch)

Phase C: Monetization
  C1: Remove per-trip payment gate
  C2: Simple Stripe subscription
  C3: Internal usage tracking
  C4: Trial gating
  C5: Billing UI in settings
  C6: Pricing page

Phase D: Collaboration (only after first paying customers)
  D1: Simple member addition (with normalized email identity resolution)
  D2: Team visibility
  D3: Team UI in settings

Phase E: Polish (only after validated demand)
  E1-E10: Analytics, onboarding, roles, invites, client portal, audit log,
          PDF, marketing, multiple recommendations, household points
```

Phase A is the product bet. Phase B makes advisors look premium. Phase C proves they will pay. Everything after that is earned by customer demand.
