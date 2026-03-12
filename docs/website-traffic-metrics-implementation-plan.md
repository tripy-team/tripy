# Website Traffic Metrics Implementation Plan

## Why this plan exists

Tripy currently has no production-grade website traffic reporting. There is an in-repo `frontend/src/lib/analytics.ts` helper, but it only buffers events in memory for debugging and does not send data anywhere.

This plan describes how to implement baseline traffic analytics so we can get:

- Directional daily/weekly/monthly visitor trends
- Estimated unique visitor counts (not exact human counts — see caveats below)
- Which pages and flows get the most traffic
- Attributed traffic source breakdown based on referrer and captured UTM data
- Trend changes after product or marketing changes

### A note on analytics accuracy

All client-side analytics produce **estimated** metrics, not ground truth. Cookie/device identity is not the same as real unique humans. Sessions depend on timeout definitions. Ad blockers, privacy tools, and cross-device behavior will cause undercounting and identity fragmentation. This plan treats analytics numbers as **directional trend indicators**, not finance-grade counts.

---

## Decisions we are making now

These are explicit choices locked in for v1. They can be revisited later but should not be left ambiguous during implementation.

| Decision | Choice |
|---|---|
| Analytics provider | AWS CloudWatch RUM (stays within existing AWS account) |
| Tracking method | Manual pageviews + manual custom events via `aws-rum-web` SDK |
| Autocapture | Not applicable (RUM does not have autocapture; all events are manual or built-in telemetry) |
| Session replay | Not available in CloudWatch RUM |
| Identity key | Stable internal user UUID only (never email, never Cognito sub directly); attached via session attributes |
| Identity merge (anonymous → authenticated) | Not built-in. User ID attached as a session attribute after login; pre-login and post-login events are not automatically stitched into one profile. |
| PII in event payloads | Strictly prohibited |
| Event property shape | Flat primitive key-value pairs only; objects and arrays rejected by wrapper |
| Environments | Separate RUM App Monitors for prod and non-prod |
| Persistence | CloudWatch RUM uses cookies (`allowCookies: true`) for session tracking |
| Attribution persistence | `sessionStorage`-based; captured on landing, attached to all events in session |
| Query-param-only URL changes | Do **not** count as pageviews unless explicitly opted in per route |
| Hash changes | Do not count as pageviews |
| Modal/parallel routes | Do not count as pageviews. Tripy does not use intercepting routes; no special handling required. |
| In-flow step changes | Tracked as product events (`step_viewed`), not pageviews |
| Session duration / time-on-page | **Not** a v1 KPI; best-effort only |
| Server-side event tracking | Deferred to v1.1/v2, noted as a planned addition |

---

## Scope and goals

### Primary goal (v1)

Implement baseline traffic analytics with these directional KPIs:

- **Pageviews** — most reliable top-line metric; counts each page load/navigation
- **Sessions** — good directional metric; CloudWatch RUM tracks sessions automatically
- **Estimated unique visitors** — approximate, based on cookie identity; treat as trend indicator
- **Top pages** — ranked by pageview volume, visible in RUM console
- **Attributed traffic sources** — based on referrer and captured UTM parameters at session start (via custom events)

**Not a v1 KPI:** session duration and time-on-page.

### Secondary goal (v1.1)

- Connect existing Tripy product events to the same analytics provider so traffic can be correlated with core actions (trip generation, results views, booking flow progress)
- Add selected server-side events for operational funnels that client-side tracking cannot reliably capture (generation success/failure, background jobs)

### Out of scope (for now)

- Multi-touch attribution modeling
- Ad network conversion APIs
- Real-time anomaly detection
- Data warehouse ETL
- Session replay
- Funnel analysis (requires piping RUM data to Athena if needed later)

---

## Non-goals for instrumentation

To prevent schema drift and privacy risk, the following are explicitly prohibited:

- Do not track raw user text inputs or search queries as analytics properties
- Do not track full itinerary details, flight data, or pricing as analytics payloads
- Do not track emails, full names, payment info, passport info, or traveler details
- Do not create one-off ad hoc event names from individual components
- Do not pass entire API response bodies as event properties
- Do not pass objects or arrays as event property values (wrapper enforces flat primitives)
- All event names and property keys must come from the shared tracking contract (see Phase 0)

---

## Provider and architecture

### Provider: AWS CloudWatch RUM

Use CloudWatch RUM as the analytics provider for v1 because:

- Tripy already runs on AWS (DynamoDB, App Runner) — no new vendor required
- Captures pageviews, sessions, browser/device data, performance, and JS errors out of the box
- Supports custom events for product analytics (e.g. `trip_generated`)
- All data stays within the AWS account (data ownership)
- Costs ~$1 per 100,000 events (negligible at Tripy's scale)
- Built-in dashboard in the CloudWatch console

### High-level architecture

1. Frontend initializes CloudWatch RUM in production environments with `disableAutoPageView: true` (we fire pageviews manually).
2. Route changes in Next.js App Router emit manual pageview events via a dedicated tracker component.
3. Existing custom events in `frontend/src/lib/analytics.ts` send via `rum.recordEvent()` instead of in-memory only.
4. UTM and referrer data are captured at session start into `sessionStorage` and attached to all downstream events.
5. Traffic KPIs are viewed in the CloudWatch RUM console dashboard.
6. Prod and non-prod analytics go to separate RUM App Monitors.

---

## CloudWatch RUM initialization contract

This is the exact initialization that the analytics wrapper uses. Every option is verified against the `aws-rum-web` SDK types.

```typescript
import { AwsRum } from 'aws-rum-web';

const RUM_APP_MONITOR_ID = process.env.NEXT_PUBLIC_RUM_APP_MONITOR_ID;
const RUM_IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_RUM_IDENTITY_POOL_ID;
const RUM_REGION = process.env.NEXT_PUBLIC_RUM_REGION || 'us-east-1';
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';

const dnt = typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
if (ANALYTICS_ENABLED && RUM_APP_MONITOR_ID && RUM_IDENTITY_POOL_ID && !dnt) {
  const rum = new AwsRum(
    RUM_APP_MONITOR_ID,
    process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    RUM_REGION,
    {
      sessionSampleRate: 1,
      identityPoolId: RUM_IDENTITY_POOL_ID,
      endpoint: `https://dataplane.rum.${RUM_REGION}.amazonaws.com`,
      telemetries: ['performance', 'errors', 'http'],
      allowCookies: true,
      enableXRay: false,
      pageIdFormat: 'PATH',
      disableAutoPageView: true,
    },
  );
} else if (typeof window !== 'undefined') {
  if (!RUM_APP_MONITOR_ID) console.warn('[Analytics] NEXT_PUBLIC_RUM_APP_MONITOR_ID missing — tracking disabled');
  if (!RUM_IDENTITY_POOL_ID) console.warn('[Analytics] NEXT_PUBLIC_RUM_IDENTITY_POOL_ID missing — tracking disabled');
  if (dnt) console.warn('[Analytics] Do Not Track enabled — tracking disabled');
}
```

### Key configuration choices

| Option | Value | Rationale |
|---|---|---|
| `sessionSampleRate` | `1` (100%) | Capture all sessions for v1; adjust later if cost matters |
| `identityPoolId` | Cognito identity pool (created by RUM) | Provides anonymous session credentials without requiring user login |
| `telemetries` | `['performance', 'errors', 'http']` | Built-in performance monitoring, JS error tracking, and HTTP call monitoring |
| `allowCookies` | `true` | Required for session persistence across page loads |
| `enableXRay` | `false` | X-Ray tracing not needed for v1 analytics |
| `pageIdFormat` | `'PATH'` | Uses `pathname` only — matches our URL canonicalization rules |
| `disableAutoPageView` | `true` | We fire manual pageviews via `PageViewTracker` for precise control |

---

## URL canonicalization rules

Every analytics call needs a consistent definition of "URL" and "path". These rules prevent confusion between what triggers a pageview and what gets stored as properties.

| Property | Value | Example |
|---|---|---|
| `path` | `window.location.pathname` | `/solo/results` |
| `url` | `window.location.origin + window.location.pathname` | `https://tripy.app/solo/results` |
| `query_string` | `window.location.search` (stored separately, only when non-empty) | `?trip_id=abc123` |

**Why `url` excludes query and hash:** The pageview boundary is defined by path changes. If `url` included `?trip_id=abc` on one load and `?trip_id=def` on the next, it would appear as different URLs for the same page, making top-pages analysis noisy. Query params that matter (like `trip_id`) are captured as explicit event properties instead.

---

## Event schema and property contract

All events share a base set of properties that are attached automatically by the analytics wrapper. Individual event types add only their own specific properties on top.

### Global base properties (attached to every event automatically)

| Property | Value | Description |
|---|---|---|
| `environment` | `process.env.NODE_ENV` mapped to `dev`/`staging`/`prod` | Deployment environment |
| `app_version` | Build-time constant (git SHA or build ID) | Regression detection across deploys |
| `path` | `window.location.pathname` | Route path without query/hash |
| `url` | `origin + pathname` (see canonicalization rules) | Canonical page URL |
| `query_string` | `window.location.search` or omitted if empty | Preserved separately from `url` |
| `referrer` | `document.referrer` | Referring page (first-party or external) |
| `hostname` | `window.location.hostname` | Deployment hostname |
| `timestamp` | — | Handled by CloudWatch RUM automatically; do not set manually |

No component should manually construct these. The analytics wrapper injects them.

### Traffic / attribution properties (captured once per session via `sessionStorage`)

On the first page load of each browser session, the wrapper reads UTM params and referrer from the URL and writes them to `sessionStorage`. On every subsequent event in the session, the wrapper reads from `sessionStorage` and attaches them.

| Property | Captured from | Persistence | Description |
|---|---|---|---|
| `landing_page` | First `pathname` in session | `sessionStorage` | Entry page for the session |
| `initial_referrer` | `document.referrer` on first load | `sessionStorage` | External referrer at session start |
| `initial_utm_source` | `?utm_source=` on first load | `sessionStorage` | Campaign source at session start |
| `initial_utm_medium` | `?utm_medium=` on first load | `sessionStorage` | Campaign medium at session start |
| `initial_utm_campaign` | `?utm_campaign=` on first load | `sessionStorage` | Campaign name at session start |
| `initial_utm_term` | `?utm_term=` on first load | `sessionStorage` | Campaign keyword at session start |
| `initial_utm_content` | `?utm_content=` on first load | `sessionStorage` | Campaign content variant at session start |

**Why `sessionStorage`:** For session-level attribution (e.g. "which campaign drove this specific visit?"), we need session-scoped storage. `sessionStorage` gives us:

- Automatic clearing on tab close (one session = one tab lifecycle)
- Survives in-page navigation and refresh within the same tab
- No cross-tab leakage (each tab gets its own session attribution)
- Simple to verify in devtools

### Product event properties (per-event, added by calling code)

All values must be **flat primitives** (string, number, boolean). The wrapper rejects objects and arrays.

| Property | Type | Allowed values | Used by |
|---|---|---|---|
| `trip_id` | `string` | UUID | Trip events |
| `group_trip_id` | `string` | UUID | Group trip events |
| `search_type` | `string` | `"solo"` \| `"group"` | Generation events |
| `result_count` | `number` | `>= 0` | Result events |
| `step_name` | `string` | `"destinations"` \| `"dates"` \| `"points"` \| `"flights"` \| `"review"` \| `"booking"` | Booking/setup flow events |
| `error_code` | `string` | Machine-readable identifier (e.g. `"timeout"`, `"no_flights"`) | Error events |
| `auth_method` | `string` | `"email"` \| `"google"` \| `"apple"` | Auth events |
| `auth_source` | `string` | `"prompt"` \| `"direct"` \| `"register"` | Auth events |
| `page` | `string` | Value of `path` at time of click (e.g. `"/solo/results"`) | CTA click events |
| `vote_value` | `number` | `1` through `5` | Calmness vote |

### Event table

This table is the source of truth. New events must be added here before being instrumented in code.

| Event | Trigger | Required props (beyond base + attribution) | Prop types |
|---|---|---|---|
| `page_viewed` | Canonical path change (actual route navigation) | — (base + attribution cover it) | — |
| `trip_generated` | Trip generation succeeds | `trip_id`, `search_type`, `result_count` | string, enum, number |
| `trip_result_viewed` | Results page loaded | `trip_id`, `result_count` | string, number |
| `lock_plan_clicked` | Lock plan CTA click | `trip_id`, `page` | string, string |
| `booking_step_completed` | Booking flow step completed | `trip_id`, `step_name` | string, enum |
| `booking_step_viewed` | Booking flow step rendered | `trip_id`, `step_name` | string, enum |
| `email_plan_requested` | Email plan modal submitted | `trip_id` | string |
| `sign_in_completed` | Auth completed | `auth_method`, `auth_source` | enum, enum |
| `calmness_vote` | Calmness rating submitted | `trip_id`, `vote_value` | string, number (1–5) |

---

## Identity lifecycle

### Canonical identity

The analytics user ID is the **stable internal user UUID** stored in `localStorage` as `user.userId` after login. Never use email, Cognito sub, or any other identifier.

### How identity works in CloudWatch RUM

CloudWatch RUM does not have PostHog-style `identify()` / `reset()` with automatic anonymous-to-authenticated merge. Instead:

- **Anonymous phase:** RUM assigns a random session ID via its Cognito identity pool. All pre-auth events are recorded against this session.
- **After login:** The wrapper calls `rum.addSessionAttributes({ user_id: internalUserId })`. All subsequent events in the session carry this attribute.
- **After logout:** The wrapper clears the `user_id` session attribute by setting it to `''`.

**Limitation:** Pre-login and post-login events within the same session are not automatically stitched into one user profile like they would be in PostHog. The `user_id` only appears on events fired after `identifyUser()` is called. For v1, this is acceptable — traffic metrics (pageviews, sessions, top pages) do not require identity merge.

### Exact call sequences

After login succeeds:

```typescript
import { identifyUser } from '@/lib/analytics';
identifyUser(response.user.userId);
```

On logout:

```typescript
import { resetUser } from '@/lib/analytics';
resetUser();
```

### Account switching

If the app supports multiple accounts, always call `resetUser()` before the new `identifyUser()`.

---

## Persistence, cookies, and unique visitor accuracy

CloudWatch RUM uses cookies (`allowCookies: true`) for session tracking.

| Mechanism | Role |
|---|---|
| RUM cookie | Session identification; set by the SDK |
| Cognito identity pool | Provides temporary AWS credentials for anonymous event submission |

### Caveats for "unique visitor" accuracy

- **Incognito / private browsing**: Each session starts fresh. Repeat visitors in private mode are counted as new.
- **Cross-device**: A user visiting from phone and laptop is counted as two visitors.
- **Ad blockers**: Some may block the RUM SDK or its endpoint. These users are invisible. Expect 10–30% undercounting depending on audience.
- **Cookie clearing**: Users who clear browser data between visits are counted as new visitors.

These are inherent to all client-side analytics. Treat unique visitor counts as trend indicators, not census data.

---

## Implementation phases

### Phase 0 — Tracking contract and governance (0.5 day)

Finalize the event schema, property contract, and identity rules documented above. Specifically:

- Confirm event naming convention: lowercase `snake_case` (already consistent in existing `EVENTS` map)
- Confirm property tiers: base (auto-injected), attribution (session-persisted), product (per-event manual, flat primitives only)
- Confirm identity lifecycle: anonymous sessions → `addSessionAttributes({ user_id })` on auth → clear on logout
- Confirm privacy rules: no PII in payloads
- Confirm environment separation: separate RUM App Monitors for prod vs non-prod

Deliverable: this document finalized and reviewed.

### Phase 1 — Frontend SDK integration for traffic (1 day)

#### 1.1 Add dependency

- Add `aws-rum-web` to `frontend/package.json`

#### 1.2 Add environment configuration

Define environment variables:

- `NEXT_PUBLIC_RUM_APP_MONITOR_ID` — App Monitor ID (different per environment)
- `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID` — Cognito identity pool ID (created by RUM setup)
- `NEXT_PUBLIC_RUM_REGION` — AWS region (e.g. `us-east-1`)
- `NEXT_PUBLIC_ANALYTICS_ENABLED` — master kill switch; `true` in prod, `true` in staging (pointed at non-prod monitor), `false` in local dev by default

Prod and staging use **separate App Monitor IDs and identity pool IDs** to keep data isolated.

#### 1.3 Create analytics client wrapper

Rewrite `frontend/src/lib/analytics.ts` with the exact initialization from the CloudWatch RUM initialization contract section above. The wrapper exports exactly four functions:

- `trackPageView()` — calls `rum.recordPageView()` + `rum.recordEvent('page_viewed', ...)` with base + session attribution props
- `trackEvent(name, properties?)` — calls `rum.recordEvent()` with base props auto-injected
- `identifyUser(internalUserId: string)` — calls `rum.addSessionAttributes({ user_id })` with stable UUID only
- `resetUser()` — calls `rum.addSessionAttributes({ user_id: '' })` to clear identity

Behavior:

- Gate all calls behind `NEXT_PUBLIC_ANALYTICS_ENABLED` and DNT check
- Before initializing RUM, check `navigator.doNotTrack === '1'`; if true, skip init entirely
- If `NEXT_PUBLIC_RUM_APP_MONITOR_ID` or `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID` is missing, log a warning and disable all tracking (no crash)
- Keep `console.log('[Analytics]', ...)` debug output when `NODE_ENV === 'development'`
- **Property sanitizer** (runs on every `trackEvent` / `trackPageView` call):
  - Reject any property value that is not a flat primitive (`string`, `number`, `boolean`). If an object or array is passed, drop that key and log a warning in dev.
  - Strip `null` / `undefined` values.
  - Block known PII keys via denylist: `email`, `name`, `first_name`, `last_name`, `phone`, `password`, `card_number`, `ssn`, `passport`. If a blocked key is detected, drop it and warn in dev.

#### 1.4 Session attribution capture

On first page load (when no `sessionStorage` attribution keys exist yet), the wrapper:

1. Reads `document.referrer` → stores as `tripy_initial_referrer`
2. Reads `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` from `window.location.search` → stores as `tripy_initial_utm_*`
3. Reads `window.location.pathname` → stores as `tripy_landing_page`

All keys are prefixed with `tripy_` in `sessionStorage` to avoid collisions.

On every subsequent `trackEvent()` and `trackPageView()` call, the wrapper reads these values from `sessionStorage` and attaches them as `initial_referrer`, `initial_utm_source`, etc.

**Lifecycle:** `sessionStorage` clears automatically when the tab closes, giving us one set of attribution values per tab session. Refresh within the same tab preserves the values. New tabs get their own attribution from their own landing URL.

#### 1.5 Track pageviews in App Router

Create `frontend/src/components/analytics/PageViewTracker.tsx`:

```typescript
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { trackPageView } from '@/lib/analytics';

export function PageViewTracker() {
  const pathname = usePathname();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (pathname === prevPathRef.current) return;
    prevPathRef.current = pathname;
    trackPageView();
  }, [pathname]);

  return null;
}
```

Only `usePathname()` is used. `useSearchParams()` is intentionally excluded because query-only changes do not count as pageviews.

Mount this once in `frontend/src/app/layout.tsx`:

```typescript
import { PageViewTracker } from '@/components/analytics/PageViewTracker';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PageViewTracker />
        {children}
      </body>
    </html>
  );
}
```

#### Pageview boundary rules

| What changes | Fires pageview? | Rationale |
|---|---|---|
| `pathname` changes (e.g. `/solo/setup` → `/solo/results`) | Yes | Core route navigation |
| `search` params change only (e.g. `?tab=1` → `?tab=2`) | No | Not a new page; track as product event if needed |
| `hash` changes (e.g. `#section-2`) | No | Scroll target, not navigation |
| Parallel route segment change | No | Does not change primary pathname |
| Multi-step wizard step change (e.g. booking flow) | No | Track as `booking_step_viewed` product event instead |
| Browser back/forward | Yes | Pathname changed |
| Full-page refresh | Yes | Fresh mount; `prevPathRef` resets |
| Redirect (e.g. auth guard → `/login`) | Yes (final destination only) | Redirect changes pathname; tracker fires on settled pathname |
| React strict mode double-invoke (dev only) | No (second call) | `prevPathRef` guard prevents duplicate |
| Hydration on initial SSR→client transition | Yes (once) | First `useEffect` run after hydration; `prevPathRef` is `null` |

#### Modals and intercepting routes

Tripy does not use Next.js intercepting routes (`(.)`, `(..)`, `(...)` folder conventions) for modals. Modals in Tripy are rendered as overlays via component state without changing `pathname`. Therefore no special modal exclusion logic is needed in the `PageViewTracker`.

#### Anonymous tracking behavior

Analytics tracking is active for all visitors, including logged-out anonymous users, unless DNT is enabled or analytics is disabled via env var. This is intentional — anonymous pageviews and session attribution are the foundation of traffic metrics.

### Phase 2 — Connect existing product events (0.5–1 day)

Replace in-memory-only event buffering with RUM-backed sends for all existing event calls:

- `TRIP_GENERATED`
- `TRIP_RESULT_VIEWED`
- `LOCK_PLAN_CLICKED`
- `BOOKING_STEP_COMPLETED`
- `CALMNESS_VOTE`
- `EMAIL_PLAN_REQUESTED`
- `SIGN_IN_COMPLETED` (add `auth_method` + `auth_source` props)
- etc.

Each event call should pass only its event-specific properties. The analytics wrapper auto-injects base properties and session attribution.

### Phase 3 — Dashboard and KPI setup (0.5 day)

View traffic in the **CloudWatch RUM console** (CloudWatch → RUM → select App Monitor). The built-in dashboard shows:

- **Page loads** over time (pageviews)
- **Sessions** over time
- **Top pages** by load count
- **Browsers and devices**
- **Performance** (web vitals, load times)
- **JavaScript errors**

For custom events (like `trip_generated`), use the **Custom events** tab in the RUM console or query via **CloudWatch Logs Insights** if log export is enabled.

Weekly reporting KPI set:

| Metric | Definition | Caveat |
|---|---|---|
| WAU | Estimated weekly unique visitors | Approximate; cookie-based; expect undercounting from ad blockers |
| Sessions | Total sessions in period | RUM session timeout based |
| Pageviews / session | Average pages per session | Directional |
| Top 5 pages | By page load count | — |
| Top traffic sources | By `initial_utm_source` / `initial_referrer` on custom events | Only captures tagged/referrer traffic |

**Not included in v1 dashboards:** funnel analysis, identity-stitched user journeys (require Athena if needed later).

### Phase 4 — Privacy and consent hardening (0.5 day)

Specific privacy decisions for v1:

| Area | Decision |
|---|---|
| Session replay | Not available in CloudWatch RUM. |
| Autocapture | Not applicable. All custom tracking is manual and governed by the event table. |
| Form capture | Not applicable. |
| Cookie behavior | RUM sets a session cookie for device identity. Documented on privacy page. |
| Do Not Track | Respected: if `navigator.doNotTrack === '1'`, the wrapper skips RUM init entirely. |
| Consent by geography | For v1, analytics loads by default (opt-out model). If EU traffic exceeds 10% of total, implement consent banner gating analytics init (opt-in model). |

Implementation:

- Update `frontend/src/app/privacy/page.tsx` to disclose: analytics provider (AWS CloudWatch RUM), data categories collected (pageviews, session data, device type, referrer, UTMs, performance metrics), cookie usage, and opt-out mechanism
- Add DNT check in analytics init wrapper (before RUM init)
- Keep privacy page update in the same PR as analytics rollout

### Phase 5 — Validation, rollout, and monitoring (0.5 day)

#### Rollout stages

1. **Staging rollout** — validate event ingestion against non-prod RUM App Monitor
2. **Production rollout to internal team** — verify RUM console shows real data
3. **Full production rollout** — flip `NEXT_PUBLIC_ANALYTICS_ENABLED` to `true` in prod deployment

#### QA test matrix

Every scenario below should be manually verified before full production rollout:

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Anonymous first landing with UTM params | Pageview fires; `initial_utm_*` stored in sessionStorage; attribution attached to event |
| 2 | Anonymous internal navigation across 3+ pages | One pageview per route change; no duplicates; `initial_utm_*` carried forward on all events |
| 3 | Login after anonymous browsing | `rum.addSessionAttributes({ user_id })` called; subsequent events carry `user_id` |
| 4 | Logout | `user_id` session attribute cleared; subsequent events have no `user_id` |
| 5 | Logout and login as different user | `user_id` cleared then set to new ID; previous user's events not attributed to new user |
| 6 | Booking flow with query param changes | Pageview on initial route load only; step changes fire `booking_step_viewed` with `step_name` |
| 7 | Direct entry on deep-linked results page | Pageview fires; referrer captured; `initial_referrer` stored |
| 8 | Browser refresh on same route | One pageview (not zero, not two) |
| 9 | Browser back/forward navigation | Pageview fires for each path change |
| 10 | Dev environment with analytics disabled | No RUM init; console debug output only |
| 11 | Staging with analytics enabled | Events appear in non-prod RUM App Monitor, not prod |
| 12 | Ad blocker active | App functions normally; analytics calls fail silently; no console errors |
| 13 | No `NEXT_PUBLIC_RUM_APP_MONITOR_ID` env var | Analytics disabled gracefully; startup warning logged; app works |
| 14 | DNT header enabled (`navigator.doNotTrack === '1'`) | RUM never initialized; no events sent; no cookies set |
| 15 | Modal overlay opened (state-based, no pathname change) | No pageview fired |
| 16 | UTM params on landing → trip generated 3 pages later | `trip_generated` event carries `initial_utm_*` from sessionStorage |
| 17 | Pass object as event property (dev mistake) | Wrapper drops the key, logs warning in dev; event still sends without the bad property |
| 18 | Pass `email` as event property key (dev mistake) | Wrapper drops the key, logs warning in dev |

---

## Server-side event tracking (v1.1 / v2)

v1 traffic analytics is client-side only. This is appropriate for traffic metrics but insufficient for operational funnels where client-side tracking can miss failures, retries, ad-blocked sessions, and background operations.

For product correctness and funnel reliability, the following backend-originated events should be added in v1.1 or v2:

| Event | Backend source | Why server-side |
|---|---|---|
| `itinerary_generation_requested` | `POST /itinerary/generate` handler | Captures all requests including those from ad-blocked clients |
| `itinerary_generation_succeeded` | Generation pipeline completion | Client may not receive result (timeout, disconnect) |
| `itinerary_generation_failed` | Generation pipeline error path | Client-side never sees the event if the request fails |
| `price_refresh_completed` | Monitoring cron job | No client present |
| `booking_poll_started` | Background booking status check | No client present |

Server-side events would use the CloudWatch RUM `PutRumEvents` API or CloudWatch custom metrics, keyed by the same internal user UUID used on the frontend.

---

## File-level implementation map

| File | Action | Description |
|---|---|---|
| `frontend/package.json` | Update | Add `aws-rum-web` dependency |
| `frontend/src/lib/analytics.ts` | Rewrite | Replace in-memory buffer with CloudWatch RUM wrapper; export `trackPageView`, `trackEvent`, `identifyUser`, `resetUser`; include property sanitizer and sessionStorage attribution |
| `frontend/src/components/analytics/PageViewTracker.tsx` | New | Client component watching `usePathname()` with ref-based dedupe |
| `frontend/src/app/layout.tsx` | Update | Mount `PageViewTracker` |
| `frontend/src/app/(auth)/login/page.tsx` | Update | Call `identifyUser(response.user.userId)` after successful login |
| `frontend/src/app/(auth)/register/page.tsx` | Update | Call `identifyUser(userId)` after successful registration |
| Logout handler (wherever token clearing happens) | Update | Call `resetUser()` before or after clearing tokens |
| `frontend/src/app/privacy/page.tsx` | Update | Disclose analytics provider, data categories, cookies, opt-out |
| `.env.local` / `.env.staging` / `.env.production` | Update | Add `NEXT_PUBLIC_RUM_APP_MONITOR_ID`, `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID`, `NEXT_PUBLIC_RUM_REGION`, `NEXT_PUBLIC_ANALYTICS_ENABLED` |
| AWS Console (prod) | Configure | Create RUM App Monitor `tripy-prod` |
| AWS Console (non-prod) | Configure | Create RUM App Monitor `tripy-dev` |

---

## Data quality and guardrails

- **Dedupe guard**: `PageViewTracker` uses a `useRef` to store previous path; only fires when `pathname` actually differs
- **Strict mode protection**: Ref-based guard prevents double-fire in React strict mode development
- **Single property injection point**: Base properties and session attribution are injected by the analytics wrapper, never by individual components
- **Flat primitive enforcement**: Wrapper rejects objects and arrays in event properties; drops the key and warns in dev
- **Runtime PII sanitizer**: Blocks a denylist of PII keys (`email`, `name`, `first_name`, `last_name`, `phone`, `password`, `card_number`, `ssn`, `passport`); runs client-side before events reach the network
- **App version tag**: Every event includes `app_version` (build ID / git SHA) to detect instrumentation regressions after deploys
- **No ad hoc events**: All event names must exist in the event table before instrumentation; the wrapper can optionally warn on unknown event names in dev

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Missing env vars in deployment | Analytics wrapper checks for `NEXT_PUBLIC_RUM_APP_MONITOR_ID` and `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID` before init; logs warning and disables gracefully if missing |
| Duplicate pageviews in App Router | Ref-based dedupe on pathname change; strict mode guard; QA scenarios #2, #8 |
| Privacy/compliance drift | Privacy page update ships in same PR as analytics rollout |
| Developer confusion from mixed tracking APIs | Single public API (`trackEvent`, `trackPageView`, `identifyUser`, `resetUser`); old in-memory-only API removed |
| Staging data polluting prod dashboards | Separate RUM App Monitors with separate config per environment |
| Ad blockers breaking app | All RUM calls wrapped in try/catch; analytics failure never blocks UI; QA scenario #12 |
| UTM attribution lost after internal navigation | Session attribution captured on landing into `sessionStorage`; attached to all events in session; QA scenario #16 |
| PII leaking via nested objects | Wrapper enforces flat primitives; drops objects/arrays; QA scenarios #17, #18 |
| Session duration treated as reliable | Explicitly excluded from v1 KPIs |
| No identity merge across anonymous/authenticated | Documented as a known limitation; acceptable for v1 traffic metrics; revisit if funnel analysis needed |

---

## Rollout milestones and estimates

| Milestone | Scope | Estimate |
|---|---|---|
| 1 | SDK integrated + pageviews live in staging (non-prod App Monitor) | 1 day |
| 2 | Existing product events connected to RUM | 0.5–1 day |
| 3 | RUM console dashboard verified with real data | 0.5 day |
| 4 | Privacy page updated and shipped | 0.5 day |
| **Total** | | **~2.5 to 3 days** |

---

## Success criteria

This work is complete when:

- We can read directional daily and weekly visitor trends from the CloudWatch RUM console
- We can see top pages by load count in the RUM dashboard
- Traffic trends are visible in the AWS Console (accessible to team members with AWS access)
- Existing key product events are visible as custom events in RUM and carry session attribution (`initial_utm_*`)
- Privacy disclosure on the website accurately reflects actual analytics behavior in production
- Prod and non-prod analytics data are fully separated (different App Monitors)
- All 18 QA scenarios pass before full production rollout
