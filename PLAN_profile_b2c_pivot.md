# Implementation Plan — Profile & Settings: B2B → B2C Pivot

**Goal:** The Profile and Settings pages still read like a B2B tool for travel firms
(organization, workspace, team, agency, clients, proposals, branding/white-label).
`context.md` is explicit: TripsHacker is a **B2C, direct-to-consumer** product with
**exactly one type of user — the traveler planning their own trips**. There are no
advisors, no managed client portfolios, no agency/workspace/team concept that the
user should ever see.

This plan makes the Profile page (and the settings that hang off it) speak to the
everyday traveler, on both frontend and backend.

---

## 0. Scope & Key Architectural Finding

**In scope:** `/profile` page, the `/settings → /profile` redirect, and the
`/settings/agency` page (reachable via the settings tree). Backend endpoints these
pages call (`/users/*`, `/orgs/*`).

**Out of scope (note as follow-up):** B2B language elsewhere in the app — nav is
already clean ("Plan a Trip", "My Trips", "Explore"), but `register`, `login`,
`dashboard` ("your practice", "Total Clients", "advisorName"), `trip-requests`,
and `households` still carry B2B copy. Flagged at the end; not changed here.

**Critical finding — `org` is load-bearing, not just cosmetic.**
Every authenticated user is auto-assigned exactly one organization via
`_bootstrap_org_for_user()` in [backend/src/utils/jwt_auth.py:361-450](backend/src/utils/jwt_auth.py#L361-L450).
That bootstrap also creates the user's **self-client** ("Myself", `isSelfClient=true`)
and scopes **all clients and trips by `orgId`** (DynamoDB PK is `orgId`). The real
traveler profile data (preferences, points, family) lives on that self-client at
`/clients/[selfClientId]`, surfaced by [PreferenceProfile.tsx](frontend/src/components/PreferenceProfile.tsx)
(30 preference fields per `frontend/src/lib/profile-commit.ts`).

**Decision:** Do **not** rip `org` out of the backend in this change. Keep it as an
invisible, one-per-user scoping mechanism. The work here is to **stop surfacing
org/team/agency/branding concepts in the UI** and repoint the few legitimately-personal
settings to user-scoped storage. A full `org` removal/data migration is a separate,
larger effort (see Assumptions).

---

## 1. Frontend — `/profile` page
File: [frontend/src/app/(app)/profile/page.tsx](frontend/src/app/(app)/profile/page.tsx)

### 1.1 Header copy (lines 157-164)
- Subtitle `"Manage your trip hacker account, organization, and workspace settings."`
  → `"Manage your account, travel preferences, and points."`
- Keep H1 "Profile" (or "Your Profile").

### 1.2 Profile card (lines 175-231)
- **Badge + icon (lines 181-189):** Keep the "Trip Hacker" label (it's the B2C
  persona per `context.md` line 1), but replace the business `Briefcase` icon with a
  traveler icon (`Plane` / `Compass` / `Sparkles` from lucide). Remove the
  `Briefcase` import.
- **Stat: "Client savings" (line 214)** → `"Your savings"` (or "Total saved").
  This is `total_savings` from `/users/me/savings` — already user-scoped, only the
  label is B2B. Keep the value wiring.
- Home airport + Timezone stats are fine as-is.

### 1.3 Quick actions (lines 234-269)
- **"My travel profile" → `/clients` (lines 239-248):** keep the destination (it
  resolves to the user's own self-client via `getMyClient()`), but it's the most
  important B2C surface — keep the label "My travel profile" / "Travel preferences".
- **"New trip request" → `/trip-requests/new` (lines 259-268):** B2B
  (request/response advisor workflow). **Replace** with a B2C action: "My Trips"
  → `/trips` (or "Explore" → `/explore`). Remove the `FileText` import if unused.
- "Plan a trip" → `/plan` stays.

### 1.4 Workspace section (lines 272-521) — the bulk of the change
Replace the entire "Workspace" block with personal sections.

- **Heading "Workspace" (line 275)** → remove, or rename to "Account".
- **Organization card (lines 299-338):** **Remove.** Org name/slug must never be
  user-facing. (Backend org still exists invisibly; we just stop editing it here.)
- **Team card (lines 341-383):** **Remove.** No team/invite/roles in a solo B2C
  product. (`Travel-party context for family/partners is supported, but that lives on
  the trip / self-client, not as a "team".`)
- **Transfer Bonuses (lines 387-518):** **Remove from the profile page.** This is an
  org-admin tool for editing org-wide transfer-bonus data. Per `context.md`, transfer
  bonuses are *commodity reference data* the optimization engine consumes — not
  something an everyday traveler curates. (The data/endpoint can remain for the
  optimizer; just unmount the editor UI.)
- **Replace with** an "Account" card holding the genuinely-personal, editable fields:
  **Name, Home airport, Timezone** — wired to `PUT /users/profile`
  (`users.updateProfile`), which already supports `name`, `default_home_airport`,
  `timezone`. This finally makes the profile card's displayed fields editable.

### 1.6 Consolidate the preference editor onto `/profile` (decided)
Embed the full preference editor directly on the profile page instead of linking out.

- The existing [PreferenceProfile.tsx](frontend/src/components/PreferenceProfile.tsx)
  is a **self-contained editor** (`clientId` prop; handles its own load / view / edit /
  save / change-history / intake-merge against `/api/clients/[id]/preferences`). It is
  the canonical 30-field traveler preference UI (flight, hotel, budget & points,
  destinations & travel style, accessibility, food & activities, family, occasions,
  dealbreakers).
- **Resolve the self-client id** on `/profile` via `getMyClient()`
  (`GET /clients/me`, returns `{ id, isSelfClient, ... }`) — same call the `/clients`
  landing page already uses. Store it in state; render
  `<PreferenceProfile clientId={myClient.id} />` as a new section under the Account
  card. Handle the loading/error state (spinner while resolving, graceful message on
  failure) so the page doesn't render the editor with an empty id.
- **Add a "Travel preferences" section header** ("How you like to travel — used to
  personalize every trip") above the embedded component so it reads as part of the
  profile, not a bolted-on widget.
- **Optionally surface completeness:** also resolve and render
  [ProfileCompletenessScore.tsx](frontend/src/components/ProfileCompletenessScore.tsx)
  at the top of the section to nudge the traveler to fill critical fields
  (`preferredCabin`, `budgetSensitivity`, `dealbreakers`). Nice-to-have; include if low cost.
- **"My travel profile" quick action (lines 239-248):** since preferences now live on
  `/profile`, drop or repurpose this tile. The `/clients/[selfClient]` detail page can
  remain for the richer profile (points, trips, family, intake) — relabel the tile
  "Points & trips" if we keep pointing there, or remove it.
- **B2C-polish the embedded editor copy (optional, low priority):** the
  "Import from Intake" button opens a raw-JSON paste modal (advisor-flavored, lines
  463-469 / 630-727 of PreferenceProfile.tsx). Consider hiding it for the B2C profile
  via a prop (e.g. `showIntakeImport={false}`) — defer unless quick. The component is
  otherwise already traveler-appropriate.

### 1.5 Imports / dead code
Remove now-unused imports and handlers: `getOrganization`, `updateOrganization`,
`createTransferBonus`, `Organization`/`OrgUser`/`TransferBonus` types, `SingleDatePicker`,
`Building2`, `Users`, `ArrowRightLeft`, `Briefcase`, and the org/bonus state +
`handleSaveOrg`/`handleAddBonus`/`loadOrg`. Add `users.updateProfile` save handler.

---

## 2. Frontend — Settings pages

### 2.1 `/settings` redirect
File: [frontend/src/app/(app)/settings/page.tsx](frontend/src/app/(app)/settings/page.tsx)
- Already redirects to `/profile`. **No change** (keep, or later make `/settings` the
  canonical account page). Confirm no nav links point at `/settings/agency`.

### 2.2 `/settings/agency` page — fully B2B
File: [frontend/src/app/(app)/settings/agency/page.tsx](frontend/src/app/(app)/settings/agency/page.tsx)
This page is end-to-end B2B: "Agency Settings", "your practice", Branding /
white-label (`Hide "Powered by TripsHacker" on client-facing pages`), Proposal
defaults (greeting, booking disclaimer), Operational defaults.

**Decision: delete the page** (and its nav/link references), because:
- Branding / white-label / "powered by" / proposals are explicitly *not* part of the
  B2C product (`context.md`: "not a generic CRM", "not for agencies/advisors").
- The only B2C-relevant items here are the **operational travel defaults** (default
  cabin, max stops, min connection time, min-savings-to-recommend-points). Those are
  now covered by the preference profile consolidated onto `/profile` (§1.6:
  `preferredCabin`, `maxLayoverMinutes`, `budgetSensitivity`, etc.), so the agency page
  is fully redundant for B2C and can go.
- Grep for any link/route to `/settings/agency` before deleting; remove those too.

---

## 3. Backend

The backend is mostly already user-scoped for the in-scope surfaces; changes are
small and mostly about *not relying on org* for personal settings.

### 3.1 User profile endpoints — keep, lightly extend
Files: [backend/src/app.py:3230-3311](backend/src/app.py#L3230-L3311),
`UpdateProfileRequest` at [backend/src/app.py:527-531](backend/src/app.py#L527-L531),
`user_service` / `user_repo`.
- `GET /users/me`, `GET/POST /users/me/savings`, `PUT /users/profile` are all
  user-scoped already — **keep**.
- If we want personal travel defaults stored on the user (the "alternative" in §2.2),
  extend `UpdateProfileRequest` and `user_service.update_profile` with optional fields:
  `default_cabin_preference`, `max_stops`, `acceptable_connection_mins`,
  `min_savings_to_recommend_points` (mirrors the legit B2C subset of
  `AgencyPreferences`). `user_repo.update_user` already does dynamic attribute
  updates, so no schema migration needed (DynamoDB). **Skip this if** travel defaults
  stay in the preference profile (recommended).

### 3.2 Org / agency endpoints — leave intact, stop calling from UI
File: [backend/src/routes/orgs.py](backend/src/routes/orgs.py) (`/orgs/me`,
`/orgs/branding`, `/orgs/members`, `/orgs/preferences`, `/orgs/activity`).
- **Do not delete** — `get_org_context` auto-bootstrap and `orgId` scoping of
  clients/trips depend on the org existing. Deleting endpoints risks breaking trip /
  client access control.
- **Action:** remove the **frontend** calls (`orgs.*`, `getOrganization`,
  `updateOrganization`, `createTransferBonus`) from the profile/settings UI so these
  endpoints are simply no longer hit by user-facing pages. Mark `/orgs/branding`,
  `/orgs/members`, `/orgs/preferences` as deprecated in code comments.
- The `orgs` frontend client in [frontend/src/lib/api.ts:4103](frontend/src/lib/api.ts#L4103)
  and `frontend/src/types/org.ts` can stay (used elsewhere) but get a `@deprecated`
  note; remove only the now-dead profile-page imports.

### 3.3 No data migration in this change
Self-client + org bootstrap stays. Trips/clients remain `orgId`-scoped under the
hood. This keeps the change low-risk and reversible.

---

## 4. Suggested order of work
1. Backend (optional, only if doing §2.2 alternative): extend `UpdateProfileRequest` +
   `update_profile`. *(Skip if travel defaults stay in preference profile.)*
2. Frontend profile page: rewrite copy (§1.1–1.2), quick actions (§1.3), replace
   Workspace block with Account card wired to `users.updateProfile` (§1.4), prune
   imports (§1.5).
3. Consolidate preferences (§1.6): resolve `getMyClient()` on `/profile`, embed
   `<PreferenceProfile clientId={...} />` (+ optional `ProfileCompletenessScore`),
   drop/repurpose the "My travel profile" tile.
4. Settings: delete `/settings/agency` (§2.2); verify no dangling nav links.
5. `grep` for residual user-facing "organization/workspace/agency/practice/client
   savings/transfer bonus/proposal" strings on these pages; confirm clean.
6. Manual verify: load `/profile`, edit name/home airport/timezone → persists via
   `PUT /users/profile`; confirm savings still shows; confirm no org/team/agency UI;
   confirm the preference editor loads the self-client, saves, and shows history.

---

## 5. Assumptions
1. **Org stays as invisible per-user scoping.** Fully removing `org` (re-keying
   clients/trips off `userId`, dropping `_bootstrap_org_for_user`, Prisma
   `Organization`/`OrgUser`/`TransferBonus`/`BusinessProfile`/`GroupProfile`) is a
   large, risky data migration and is **deliberately out of scope**. This plan only
   removes org from the *UI*. If you want the backend genuinely org-free, that's a
   separate follow-up plan.
2. **One org == one user already holds in practice** (bootstrap creates a personal
   org named "{user}'s Workspace"), so hiding the org UI loses no real multi-tenant
   functionality for current B2C users.
3. **Transfer bonuses are global optimizer input**, not user-curated; safe to drop
   the editor from the profile page without affecting optimization.
4. **Travel preferences are consolidated onto `/profile`** (per your decision). The
   existing `PreferenceProfile` component is reused in place (no rewrite) and bound to
   the self-client resolved via `getMyClient()`. The underlying storage is unchanged —
   it still reads/writes `ClientPreference` for the self-client via
   `/api/clients/[id]/preferences`; we're only relocating where the editor is mounted.
   The `/clients/[selfClient]` detail page may keep its own copy for the richer profile
   (points/trips/family) or be slimmed later; not required for this change.
5. **Deleting `/settings/agency` is acceptable** — its only B2C-relevant content
   (travel defaults) is redundant with the preference profile, and the rest
   (branding, white-label, proposals) is explicitly non-B2C.
6. **"Trip Hacker" is kept** as the persona label (matches `context.md`); only the
   business *iconography* and org/agency framing are removed.
7. Out-of-scope B2B copy in `register`/`login`/`dashboard`/`trip-requests`/
   `households` is **flagged but not changed** here; recommend a follow-up sweep.
