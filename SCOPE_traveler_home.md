# Scope — Real Traveler Home (B2C dashboard)

**Status:** Scoping doc (not yet implemented). Follows the B2C pivot of `/profile`,
the dashboard de-B2B'ing, and the move of the post-login landing to `/plan`.

**Goal:** Turn the demoted B2B `/dashboard` into a genuine B2C "home" — the first
screen that makes an everyday traveler feel oriented: what they've saved, trips in
flight, points they can use, profile gaps to fill, and timely points opportunities.
Per `context.md`: reinforce "better travel planning starts with better understanding
of the traveler" and surface value (savings, points) without advisor/CRM framing.

---

## 1. The central constraint: a two-store data split

The single most important design fact. The app reads from **two backends**, and a
traveler home needs data from **both**:

| Layer | Reaches | Used by | How |
|---|---|---|---|
| **Postgres (Prisma)** | Next.js server/`/api` routes | `dashboard-data.ts` (server component), `api-client.ts` (`apiFetch`) | direct `prisma.*` or Next `/api/*` |
| **DynamoDB (FastAPI)** | the Python backend | `api.ts` (`apiRequest` → `NEXT_PUBLIC_BACKEND_URL`) | bearer-token HTTP from the browser |

The current `/dashboard` is a **server component** that calls `getDashboardData()` and
reads **Postgres only** ([dashboard-data.ts](frontend/src/lib/dashboard-data.ts)). The
two highest-value B2C metrics — **trips** and **total savings** — live in **DynamoDB
behind FastAPI**, which the server component cannot reach today (no token forwarding).
This split drives the architecture decision in §3.

---

## 2. Data inventory — what a home would show, and where each lives

Corrected from research (the savings row in particular — it **does** exist):

| Widget | Exists? | Store | Fetch | Ref |
|---|---|---|---|---|
| **Total saved** ($) | ✅ | DynamoDB/FastAPI | `users.getProfile().total_savings`; recompute `users.calculateSavings()` | [api.ts:2343-2382](frontend/src/lib/api.ts#L2343-L2382) |
| **Trips (list + count)** | ✅ | DynamoDB/FastAPI | `trips.list({ limit, includeDetails })` | [api.ts](frontend/src/lib/api.ts); used in [my-trips/page.tsx](frontend/src/app/(app)/my-trips/page.tsx) |
| **Points / loyalty balances** | ✅ | Postgres | `getClientBalances(selfClientId)` (needs `getMyClient()` first) | [api-client.ts:733](frontend/src/lib/api-client.ts#L733) |
| **Profile completeness** | ✅ | Postgres | `ProfileCompletenessScore` (prefs + balances + family) | [ProfileCompletenessScore.tsx](frontend/src/components/ProfileCompletenessScore.tsx) |
| **Active transfer bonuses** | ✅ | Postgres | already in `getDashboardData()` | [dashboard-data.ts:24-32](frontend/src/lib/dashboard-data.ts#L24-L32) |
| **Recent alerts** | ✅ (B2B-shaped) | Postgres | `getDashboardData().recentAlerts` (alert subscriptions) | [dashboard-data.ts:43-54](frontend/src/lib/dashboard-data.ts#L43-L54) |
| **Saved / favorite destinations** | ❌ | — | `/explore` is a **hardcoded 4-item stub**, no per-user saves | [explore/page.tsx:21-27](frontend/src/app/(app)/explore/page.tsx#L21-L27) |
| **Expiring points** | ⚠️ partial | Postgres | balance rows carry `expirationDate`; no aggregate endpoint | `ClientLoyaltyBalance` in [schema.prisma](frontend/prisma/schema.prisma) |

Legend: ✅ ready to use · ⚠️ derivable but needs glue · ❌ does not exist.

---

## 3. Architecture decision — hybrid fetch (recommended)

**Recommendation: keep the server component for the Postgres half, and add a small
client-side layer for the DynamoDB half.** I.e. SSR the data we already have
(transfer bonuses, and optionally the Postgres pieces), then `useEffect`-fetch the
FastAPI pieces (savings, trips) on mount — exactly the pattern `/profile` already uses
(`users.getProfile()` + `getMyClient()` client-side). Each widget renders a skeleton
until its source resolves.

Why not the alternatives:
- **(B) Make the server component call FastAPI too.** Requires forwarding the user's
  bearer token from the Next server to FastAPI and handling its cold-start latency on
  every home render. More moving parts, slower first paint, and the token plumbing
  doesn't exist server-side today. Defer.
- **(C) Backfill savings/trips into Postgres.** A real data migration + dual-write to
  keep DynamoDB and Postgres in sync. Out of proportion for a dashboard. Reject.

**Net:** the home is a **client component** that (a) consumes the existing SSR
`initialData` for the Postgres bits and (b) fires 2–3 parallel client fetches for the
DynamoDB bits. No backend changes required for the MVP.

---

## 4. Proposed layout (MVP)

```
Welcome back, {firstName}                          ← displayName (already wired)
────────────────────────────────────────────────
[ Total saved $X ]  [ Trips planned N ]  [ Points across M programs ]   ← stat row
────────────────────────────────────────────────
Continue planning                 Your points
- recent/active trips (top 3)     - top loyalty balances + transfer-bonus nudges
  → /my-trips, /plan              → /profile (Travel preferences)
────────────────────────────────────────────────
Finish your profile  (ProfileCompletenessScore, only if < 100%)  → /profile
────────────────────────────────────────────────
Current transfer bonuses   (existing table, read-only reference)
```

Widget-by-widget:
1. **Stat row** — Total saved (`calculateSavings`), Trips planned (`trips.list` length),
   Points across N programs (`getClientBalances` → distinct programs / summed balance).
2. **Continue planning** — top 3 trips from `trips.list({ includeDetails: true })`,
   each linking to its trip; primary CTA "Plan a new trip" → `/plan`.
3. **Your points** — top balances from `getClientBalances`, cross-referenced with the
   already-loaded transfer bonuses to nudge ("Chase→United +30% this week").
4. **Finish your profile** — reuse `ProfileCompletenessScore` (resolve `getMyClient()`
   for `clientId`; pass balances + family members it needs). Hide at 100%.
5. **Current transfer bonuses** — keep the existing table as read-only reference.

---

## 5. File / component plan

- [dashboard-data.ts](frontend/src/lib/dashboard-data.ts) — keep as the Postgres SSR
  source; optionally extend to also return self-client loyalty balances so the "Your
  points" widget is SSR'd instead of client-fetched (nice-to-have).
- [DashboardClient.tsx](frontend/src/app/(app)/dashboard/DashboardClient.tsx) — becomes
  the home shell. Add client fetches: `users.calculateSavings()`, `trips.list()`,
  `getMyClient()` → `getClientBalances()`. Extract each widget into a small component
  with its own loading/empty/error state so one slow source never blanks the page.
- New small components (suggested): `StatRow`, `ContinuePlanning`, `YourPoints`,
  reuse `ProfileCompletenessScore`. Keep `TransferBonusCard`/table as-is.
- Restore the post-login landing to the home **only after** it's worth landing on —
  currently it points to `/plan` ([app/page.tsx:147](frontend/src/app/page.tsx#L147),
  [login/page.tsx:94](frontend/src/app/(auth)/login/page.tsx#L94),
  [clients/page.tsx:22](frontend/src/app/(app)/clients/page.tsx#L22)). Flip these back
  to `/dashboard` (or `/home`) as the final step of the build. Consider renaming the
  route `/dashboard` → `/home` to shed the B2B word (optional; adds redirect churn).
- Add a nav entry — today nav is Plan / My Trips / Explore with no "Home"; add one if
  the home becomes the landing.

---

## 6. Gaps requiring net-new work (not just wiring)

These are the only items that need real build, and all are **optional / post-MVP**:
- **Saved destinations** — no per-user save model exists; `/explore` is static. A real
  "Saved destinations" widget needs: a store (cleanest: a Postgres `SavedDestination`
  model + `/api` route, or a DynamoDB field on the user), a save action on `/explore`,
  and the home widget. Treat as its own feature, not part of the home MVP.
- **Expiring-points callout** — derivable from balance `expirationDate`, but there's no
  aggregate; needs a small client-side reduce over `getClientBalances`, or a new
  endpoint if we want it cross-program/perf-friendly.
- **Alerts → B2C** — `recentAlerts` is built on advisor `alertSubscription`s. Either
  reframe as traveler-facing ("price/award alerts you set") or omit from the home MVP.

---

## 7. Phasing

- **Phase 1 (MVP, ~no backend changes):** stat row (saved / trips / points), Continue
  planning, Finish your profile, keep transfer-bonus table. All via existing
  fetches + hybrid client loading. Flip the landing back to the home at the end.
- **Phase 2:** SSR the Postgres "Your points" via `dashboard-data.ts`; expiring-points
  callout; rename `/dashboard` → `/home` + nav entry.
- **Phase 3 (feature):** Saved destinations (needs new store + `/explore` save action);
  traveler-facing alerts.

---

## 8. Assumptions & open questions

1. **Hybrid client-fetch is acceptable** for first paint (skeletons while FastAPI
   resolves). If a fully-SSR'd, instant home is a hard requirement, that pushes us to
   architecture (B) — server-side token forwarding — and a bigger lift. *Assumed: OK.*
2. **`calculateSavings()` on every home load is fine.** It recomputes from all trips
   (a `POST`); if that's heavy, use the cached `getProfile().total_savings` on load and
   only recompute opportunistically. *Assumed: use cached value on load, recompute in
   background — same pattern as `/profile`.*
3. **One self-client per user** (the established model) — `getMyClient()` resolves it
   for balances/completeness, as on `/profile`.
4. **Keep route name `/dashboard`** unless we decide the B2B word is worth a rename;
   `/home` is cleaner but adds redirect churn. *Assumed: keep `/dashboard` for MVP.*
5. **Saved destinations is out of scope for the home MVP** — it's a new feature with
   its own store, not dashboard wiring.
6. **No backend (FastAPI/Prisma) changes for Phase 1** — everything needed already has
   an endpoint. New work begins only in Phase 2/3.

---

## 9. Effort & risk (rough)

- **Phase 1:** frontend-only, moderate — mostly composing existing fetches + widgets
  with good loading states. Low risk (no schema/backend change, reversible).
- **Phase 2:** small-moderate; touches `dashboard-data.ts` (Postgres) + a route rename.
- **Phase 3:** larger; new persistence model + UI for saved destinations/alerts.

**Recommended first step:** build Phase 1 behind the existing `/dashboard` route while
the landing still points at `/plan`, verify it, then flip the landing — so the home is
proven valuable before it becomes the front door.
