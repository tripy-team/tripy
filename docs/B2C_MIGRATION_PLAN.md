# Tripy B2C Migration Plan — Advisor → Consumer

Implementation plan for restructuring Tripy from a B2B advisor↔client workspace into a fully
self-serve consumer ("trip hacker") product, where **the traveler is the logged-in user**.

This is a structural plan, not a copy change. The earlier text rebrand (travel advisor → trip
hacker) is already done; this document covers the data model, auth, navigation, and feature
surface.

---

## 1. Guiding strategy: the "self-traveler" invariant, not a big-bang collapse

The instinctive plan is "rename `Client` → `User`, repoint all `clientId` foreign keys to
`userId`." **Do not start there.** `clientId` appears in ~1,500 frontend references, 18+ Prisma
models, and the entire backend data layer. A literal collapse is a multi-month, high-risk rewrite
that touches every feature at once.

Instead, exploit a pattern the codebase **already has**: when a user is bootstrapped, the backend
creates a personal "self client" record (`isSelfClient: True`, name "Myself") —
`backend/src/utils/jwt_auth.py:383-395`. Two app surfaces already lean consumer:
`/solo/setup` and the "My Trips" nav (`frontend/src/app/(app)/layout.tsx:24-30`).

**Recommended approach:** make "every user has exactly one Client, which is themselves" a hard
**invariant** rather than restructuring the schema. The `Client` table stays and keeps acting as
"the traveler profile," but the product stops exposing a *portfolio of other people's* clients.
All existing client-scoped code (preferences, loyalty balances, intake, recommendations) keeps
working untouched — it just always operates on the caller's own self-Client.

This converts a schema rewrite into a much smaller surface: **identity/onboarding, navigation, the
public share flows, and removing advisor-only features.** A true `Client`→`User` schema merge
becomes an *optional* later cleanup (Phase 6), de-risked because the invariant already holds.

> Trade-off: keeping `Client` as a thin self-record carries some "Client" terminology in the code
> indefinitely (until Phase 6). That's an acceptable price for shipping incrementally without a
> freeze. If leadership wants the pure model first, Phase 6 can be pulled forward, but expect a
> code-freeze-sized effort.

---

## 2. Current architecture (what we're migrating from)

- **Tenancy:** `Organization` (tenant) → `User` (role defaults to `advisor`,
  `schema.prisma:34`) → `Client[]` owned by a user and scoped to the org. Almost every query is
  filtered by `organizationId`. Auth auto-provisions an Org per signup
  (`frontend/src/lib/auth.ts:85-140`).
- **Two datastores (important):** the Next.js API routes use **Prisma/Postgres**
  (`frontend/prisma/schema.prisma`), while the Python backend uses **DynamoDB** repos with
  composite `org_id + client_id` keys (`backend/src/repos/client_repo.py`,
  `backend/src/utils/jwt_auth.py` `OrgContext`). Proposals live in a DynamoDB table, not Prisma
  (`backend/src/services/proposal_service.py`). Any identity change must be made in **both**.
- **The traveler today is data, not a user:** travelers exist only as `Client` rows that an
  advisor manages; they never log in. The "client-facing" experiences are anonymous,
  token-gated links (intake forms, meeting invites, proposals).
- **Advisor-only scaffolding:** team/seat management (`backend/src/routes/orgs.py:87-144`),
  vendor sourcing workflow (`/operations`, `VendorRequest*` models, `lib/vendor-operations.ts`),
  portfolio analytics (`trips_per_advisor`, `clients_per_advisor` in
  `backend/src/services/analytics_service.py:88-89`), agency white-label branding, and the
  internal-vs-client-facing "advisor note" split (`proposal_service._strip_to_client_safe`).

### What maps cleanly vs. what's advisor-only

| Reusable as-is (traveler's own data) | Reframe | Remove / park |
|---|---|---|
| `ClientPreference`, `ClientLoyaltyBalance`, wallet sync | Discovery meeting copilot → "trip setup assistant" | Vendor requests & `/operations` workflow |
| `TripRequest`, `RecommendationRun/Option`, `TripBrief` | Proposals (drop advisor note / client-safe stripping) | Team/seat management, RBAC roles |
| Intake questions & preference inference | Intake forms → in-app onboarding (no token) | Portfolio analytics (`*_per_advisor`) |
| Group/household travel (`GroupProfile`, `Household`) | Live call (advisor↔client) → optional concierge/AI only | Agency white-label branding |

---

## 3. Target model

- **Identity:** `User` is the traveler. Role enum collapses (default `traveler`; drop
  advisor/admin/viewer distinctions or keep a single `traveler`). `Organization` becomes a
  vestigial single-user container (Phase 1) and is deleted in Phase 6.
- **Profile:** each `User` has exactly one `Client` = themselves, auto-created and never listed in
  a roster. UI talks about "your profile," not "a client."
- **Co-travelers:** family/group members remain as related records on the user's own trips, not as
  separately-managed client identities.
- **Self-serve flows:** intake/discovery happens in-app while logged in (no emailed token);
  proposals/recommendations are the user's own saved trips; emails become "your plan is ready,"
  not "your advisor sent you…".

---

## 4. Phased implementation

### Phase 0 — Decisions & guardrails (do first)
- **Resolve the two-datastore question.** Confirm whether Postgres/Prisma or DynamoDB is the
  system of record going forward, or whether both stay. This gates every later phase. (Needs a
  human decision — see Open Questions.)
- Decide the fate of the **live-call / discovery-meeting** feature in B2C (keep as AI-only setup,
  keep as optional human concierge, or remove). This is the single biggest scope lever.
- Decide whether **group/household travel** stays in v1.
- Add an end-to-end smoke test of the current "solo" path (`/solo/setup` → recommendation) to
  serve as the regression baseline before touching identity.

### Phase 1 — Identity & onboarding (foundation)
Goal: a person who signs up gets a logged-in traveler account wired to exactly one self-Client, in
both datastores.
- Change `UserRole` default and seeding from `advisor` → `traveler`
  (`schema.prisma:34`, plus backend role logic in `jwt_auth.py`).
- Make the self-Client the canonical profile: on first auth, ensure the `isSelfClient` record
  exists (already partially implemented at `jwt_auth.py:383-395`) and expose a
  `GET /me/profile` that resolves "my client" so the frontend never needs a `clientId` from a
  list. Mirror in the Prisma path (`frontend/src/lib/auth.ts:85-140`).
- Neutralize org scoping without ripping it out: keep `organizationId` columns (avoid a migration
  now) but auto-create a private org of one per user and stop treating it as a shared tenant.
  Remove team endpoints from the surface (`orgs.py:101-144` add/remove member).
- Update signup/login copy and routing (`/register`, `/login`) to a consumer onboarding flow that
  lands in the planning experience, not a "workspace."
- Keep `DEV_AUTH_BYPASS` working (`frontend/src/lib/dev-auth.ts`).

### Phase 2 — Navigation & app shell (make self-serve the default)
Goal: the logged-in experience is "plan my trips," with no portfolio.
- Update `frontend/src/app/(app)/layout.tsx` nav to the consumer set: Plan a Trip, My Trips,
  Profile/Preferences, Loyalty/Wallet, (optional) Group Trip, Explore.
- Replace the client roster: `/clients` and `/clients/new` are removed; the client **detail** hub
  (`/clients/[clientId]/page.tsx`, ~152KB) is repurposed into a self-routing
  `/profile` (or `/me`) that always loads the user's self-Client. This is the largest single
  frontend file and the bulk of Phase 2 effort — plan to lift its panels (preferences, balances,
  intakes) into a "my profile" shell rather than rewrite them.
- Route deep links that took a `clientId` param to the self-Client implicitly.

### Phase 3 — Reframe the public/token share flows
The intake / meeting / proposal links exist because the traveler wasn't a user. Now they are.
- **Intake (`/intake/[token]`, `/intake-fill/[token]`, `IntakeFormToken`):** convert the
  individual-variant intake into an in-app, authenticated onboarding/preference wizard reusing the
  existing `IntakeForm` component and preference-merge logic
  (`api/intake/form/[token]/route.ts:385-450`). Keep a token path only if "invite a friend to fill
  their preferences for a group trip" survives Phase 0; otherwise retire it.
- **Proposals (`/proposals/[token]`, `proposal_service.py`):** the user views recommendations in
  their own account. Drop `advisor_id`, `advisor_note`, and `_strip_to_client_safe` (no
  internal-vs-external split when there's no advisor). Keep a public share token only as an
  optional "share my trip with a non-user" nicety.
- **Meeting/live call (`/meeting/[token]`, `/join/[roomId]`, LiveKit signing):** per Phase 0
  decision — either remove, or recast the "advisor" room role as an AI/concierge participant.
- **Email (`frontend/src/lib/email.ts`, `backend/.../email_service.py`):** rewrite templates from
  third-party voice ("your trip hacker sent you…") to first-person product voice ("your plan is
  ready"). Sender stays `noreply@tripy.app`.

### Phase 4 — Remove / park advisor-only features
- **Vendor sourcing:** remove `/operations`, `/vendor-requests`, `lib/vendor-operations.ts`, the
  `VendorRequest*` models and `needs_advisor_review`/approval states. (Largest clean deletion.)
- **Portfolio analytics:** delete `trips_per_advisor`/`clients_per_advisor`
  (`analytics_service.py:88-89`) and the `/analytics` page; replace with a personal "your savings /
  your trips" dashboard if desired.
- **Team & white-label:** remove member management and agency branding settings; replace branding
  with (at most) per-user theme preference.
- **Advisor notes:** drop the internal-note field from proposals/clients UI; keep a user's own
  private trip notes.

### Phase 5 — Terminology pass (code-level)
- Now that features are gone/reframed, do a focused rename of remaining **internal** advisor
  identifiers where cheap and safe: `advisorUserId`, `advisorName`, `advisorEmail`,
  comments/docstrings, `role: 'advisor'` literals in live-call code. Defer DB-column renames to
  Phase 6 to avoid an extra migration.

### Phase 6 — Optional schema collapse (`Client` → `User`) + data migration
Only once the invariant from Phase 1 has held in production.
- Write a migration that, for each `Client`, folds its profile fields onto the owning `User` (or
  introduces a `TravelerProfile` 1:1) and repoints the 18 `clientId` FKs to `userId`. Do it model
  cluster by cluster (preferences → loyalty → intake → recommendations), each behind a
  compatibility shim, never big-bang.
- Drop `Organization`, `UserRole`, and org indexes.
- Mirror the equivalent key change in the DynamoDB layer (composite `org_id+client_id` → `user_id`).
- Migrate existing rows: real advisor-managed clients become either (a) archived, or (b) converted
  to invited consumer accounts — a product/legal decision, not just technical.

---

## 5. Sequencing, risk, and effort

```
Phase 0 (decisions)        ──┐  small, blocking
Phase 1 (identity)           ├─ foundation; everything depends on it     ~ high
Phase 2 (nav/shell)          │  big frontend lift (152KB client hub)     ~ high
Phase 3 (share flows)        │  medium; per-feature                      ~ med
Phase 4 (remove advisor)   ──┘  mostly deletion, low risk                ~ med
Phase 5 (rename)               cosmetic, safe                            ~ low
Phase 6 (schema collapse)      optional, highest risk, needs migration   ~ high
```

- **Highest risk:** Phase 1 (identity in two datastores) and Phase 6 (FK repointing + data
  migration). Gate both behind the Phase 0 datastore decision.
- **Biggest single chunk of work:** repurposing the ~152KB client-detail page into the personal
  profile (Phase 2).
- **Safest early wins:** Phase 4 deletions and Phase 5 renames — visible progress, low blast
  radius — but they should follow Phase 1 so you're not deleting things the advisor flows still
  depend on.
- **Ship-incrementally property:** because of the self-traveler invariant, the app stays
  functional after every phase; there is no required freeze until (optional) Phase 6.

---

## 6. Open questions for product/eng (block Phase 0)

1. **System of record:** is it Postgres/Prisma, DynamoDB, or both? Identity changes must land in
   whichever survive.
2. **Live discovery calls:** keep (AI-only? human concierge?) or remove for B2C?
3. **Group/household travel:** in scope for v1, or defer?
4. **Existing advisor accounts & their client data:** archive, or convert clients into invited
   consumer accounts? (Affects Phase 6 data migration and likely legal/privacy.)
5. **Do we ever want the pure `User`-only schema (Phase 6),** or is the self-Client invariant an
   acceptable permanent end state?
