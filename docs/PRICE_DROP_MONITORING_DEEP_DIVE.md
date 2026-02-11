# Price Drop Monitoring — Deep Dive

A comprehensive technical walkthrough of the price drop monitoring feature as it exists in the codebase today: architecture, data flow, what works, what's stubbed, and what's needed to complete it.

---

## Table of Contents

**Part 1 — Current System (What Exists Today)**

1. [Feature Overview](#1-feature-overview)
2. [Architecture & File Map](#2-architecture--file-map)
3. [Data Model (DynamoDB)](#3-data-model-dynamodb)
4. [User-Facing Flow: Opt-In](#4-user-facing-flow-opt-in)
5. [Backend: Subscription Lifecycle](#5-backend-subscription-lifecycle)
6. [Backend: Cron Job (The Monitoring Loop)](#6-backend-cron-job-the-monitoring-loop)
7. [Scoring Engine](#7-scoring-engine)
8. [Fingerprinting & Debounce](#8-fingerprinting--debounce)
9. [Cooldown Logic](#9-cooldown-logic)
10. [Alert Sending (Two-Step Pattern)](#10-alert-sending-two-step-pattern)
11. [Frontend: Update Click-Through Page](#11-frontend-update-click-through-page)
12. [Email Verification Flow](#12-email-verification-flow)
13. [Unsubscribe Flow](#13-unsubscribe-flow)
14. [Configuration & Feature Flags](#14-configuration--feature-flags)
15. [Rate Limiting](#15-rate-limiting)
16. [Admin Tooling (Replay)](#16-admin-tooling-replay)
17. [What's Implemented vs. Stubbed](#17-whats-implemented-vs-stubbed)

**Part 2 — Gaps & Completion Plan**

18. [Critical Gap: Search Integration](#18-critical-gap-search-integration)
19. [Critical Gap: Baseline Missing Funding Provenance](#19-critical-gap-baseline-missing-funding-provenance)
20. [Critical Gap: Points Drops Are Not Price Drops](#20-critical-gap-points-drops-are-not-price-drops)

**Part 3 — Award Repricing v1 Spec**

21. [Points Irreversibility Invariant (Non-Negotiable)](#21-points-irreversibility-invariant-non-negotiable)
22. [Repricing Product Contract (Hard Rules)](#22-repricing-product-contract-hard-rules)
23. [Repricing Data Model & Schema](#23-repricing-data-model--schema)
24. [Monitoring → Repricing Bridge](#24-monitoring--repricing-bridge)
25. [Implementation Sequence](#25-implementation-sequence)
26. [Security & Threat Model](#26-security--threat-model)

---

## 1. Feature Overview

The "Keep Watching" feature monitors a user's selected trip itinerary after they book. It periodically checks for price drops, schedule improvements, and other changes, then emails the user when something meaningful is detected.

**Tiers:**
- **Free email** (`free_email`): checks every 6 hours, runs up to 14 days or 24h before departure
- **Paid** (`paid`): checks every 2 hours, runs up to 30 days (gated off — `MONITORING_PAID_ENABLED=false`)

**Change types tracked:**
- `price_drop` — cash price decreased
- `schedule_change` — departure time shifted, duration changed
- `points_improvement` — points cost decreased (paid tier only)
- `risk_change` — e.g. flight disappeared from search results
- Stops reduction (fewer connections)

---

## 2. Architecture & File Map

```
backend/
  src/
    config/
      monitoring.py                          # All env vars, feature flags, constants
    domain/
      monitoring/
        __init__.py
        models.py                            # Pydantic request/response schemas
        utils.py                             # Scoring, fingerprinting, debounce, helpers
        repo.py                              # DynamoDB CRUD (subscriptions, baselines, updates, rate limits)
        tokens.py                            # JWT tokens for verification + unsubscribe
        alerts.py                            # Kill-switch-gated email sender (two-step pattern)
    routes/
      monitoring.py                          # 8 API endpoints + cron handler
    app.py                                   # Registers monitoring_router

frontend/
  src/
    app/
      (app)/solo/
        booking/page.tsx                     # Post-booking monitoring opt-in UI (state machine)
        updates/[update_id]/page.tsx         # Update click-through page (renders change comparison)
      api/monitoring/verify/route.ts         # Next.js proxy for email verification magic links
      (app)/settings/page.tsx                # "Price Alerts" toggle in notification preferences
    lib/
      api.ts                                 # solo.startMonitoring(), solo.getMonitoringStatus(), solo.stopMonitoring()

infra/
  lib/
    dbStack.ts                               # DynamoDB table definitions (4 tables, 5 GSIs)
```

---

## 3. Data Model (DynamoDB)

### 3a. `tripy-monitoring-subscriptions`

**Primary Key:** `subscription_id` (String)

Stores both subscription items and lock items (for atomic uniqueness) in a single table.

| Field | Type | Description |
|---|---|---|
| `subscription_id` | String (PK) | `msub_<uuid4hex>` for subscriptions, `lock#<trip_email_key>` for locks |
| `trip_id` | String | Trip being monitored |
| `user_id` | String (optional) | Omitted for anonymous users (DynamoDB GSI rejects empty string keys) |
| `email` | String | Normalized email for alerts |
| `trip_email_key` | String | `{trip_id}#{email}` — enforces one active sub per trip+email combo |
| `tier` | String | `free_email` or `paid` |
| `state` | String | `pending_verification`, `active`, `paused`, `expired`, `cancelled` |
| `state_bucket` | String | `{state}#{shard}` — sharded partition key for the due-index GSI |
| `schema_version` | Number | Currently `1` |
| `baseline_snapshot_id` | String | FK to the baselines table |
| `query_version` | Number | Version of query inputs format |
| `next_check_at` | String (ISO) | When the cron should next check this subscription |
| `created_at` | String (ISO) | |
| `updated_at` | String (ISO) | |
| `expires_at` | String (ISO) | Subscription expiry date |
| `last_checked_at` | String (ISO) | |
| `last_alert_sent_at` | String (ISO) | |
| `last_change_fingerprint` | String | Fingerprint of the most recent detected change |
| `recent_fingerprints` | String (JSON array) | Ring buffer of the last 2 fingerprints (for debounce) |
| `cooldown_until` | String (ISO) | Suppresses alerts until this time |
| `active_token_jti` | String | JTI of the current verification token (single-use enforcement) |
| `consent_source` | String | `authenticated_signup` or `free_email_form` |
| `consent_ip_hash` | String | SHA-256 hash of truncated IP (/24 for IPv4, /48 for IPv6) |
| `consent_at` | String (ISO) | |

**GSIs:**
- `trip-email-index`: PK = `trip_email_key` — deduplication lookups
- `trip-index`: PK = `trip_id` — find all subs for a trip
- `user-index`: PK = `user_id` — find all subs for a user
- `due-index`: PK = `state_bucket`, SK = `next_check_at` — the cron's query target (sharded across 10 buckets)

> **GAP: Stale lock items (decision: use `lock_expires_at`).** Lock items (`lock#<trip_email_key>`) are created atomically with subscriptions via `TransactWriteItems`, and their `state` is updated alongside the subscription on cancel/expire. However, if a transaction partially fails or a subscription is deleted without cleaning up its lock, a stale lock can block new subscriptions for that trip+email pair forever.
>
> **Chosen approach: `lock_expires_at` field (not a reaper job).** A reaper would require a GSI on lock items in a mixed-key table, adding complexity and cost. Instead:
>
> 1. When creating a lock item, set `lock_expires_at` to `now + 24 hours` (ISO timestamp).
> 2. When a subscription transitions to `cancelled` or `expired`, set `lock_expires_at = now` on the corresponding lock (or delete the lock outright).
> 3. Update the creation condition expression to treat expired locks as absent:
>    `attribute_not_exists(subscription_id) OR #state IN (:cancelled, :expired) OR lock_expires_at < :now`
> 4. Active subscriptions refresh `lock_expires_at` during each cron check (heartbeat), ensuring locks for healthy subscriptions never expire spuriously.
>
> This handles orphaned locks from failed transactions without a scan job and adds no new infrastructure.

### 3b. `tripy-monitoring-baselines`

**Primary Key:** `baseline_id` (String, format: `mbl_<uuid4hex>`, 36 chars total)

| Field | Type | Description |
|---|---|---|
| `baseline_id` | String (PK) | |
| `schema_version` | Number | |
| `captured_at` | String (ISO) | When the baseline was captured |
| `selected_itinerary` | Map/String | The itinerary snapshot at opt-in time |
| `alternatives` | List | Alternative itineraries at opt-in (may be empty) |
| `query_inputs` | Map | Original search query inputs (for re-running searches) |

> **GAP: Missing `payment_context`.** The baseline captures *what* was booked but not *how it was paid for*. Without funding provenance, the system can detect a points price drop but cannot determine where freed-up value lives, whether the booking is changeable, or whether repricing is even applicable. See [Section 19](#19-critical-gap-baseline-missing-funding-provenance) for the required schema addition.

### 3c. `tripy-monitoring-updates`

**Primary Key:** `update_id` (String, format: `mupd_<uuid4hex>`, 37 chars total)

TTL attribute: `ttl` (epoch seconds, expires `UPDATE_EXPIRY_DAYS + UPDATE_TTL_GRACE_DAYS` = 120 days after creation)

| Field | Type | Description |
|---|---|---|
| `update_id` | String (PK) | Also acts as a capability token (UUID = auth) |
| `subscription_id` | String | FK to the subscription |
| `trip_id` | String | |
| `schema_version` | Number | |
| `detected_at` | String (ISO) | |
| `change_score` | String (numeric) | 0.0–1.0+ composite score. **Should be migrated to Number** — storing as String breaks sorting, comparisons, and analytics queries. Current code writes `str(score)`. |
| `severity` | String | `high` (score > 0.25) or `medium` |
| `baseline_summary` | String (JSON) | Serialized baseline itinerary |
| `new_candidate_summary` | String (JSON) | Serialized new candidate itinerary |
| `deltas` | String (JSON) | `{ bullets: DeltaBullet[], recommendation: string, caveat: string }` |
| `change_fingerprint` | String | For dedup |
| `email_status` | String | `sent`, `skipped_alerts_disabled`, `skipped_render_check_failed:...`, etc. |
| `email_sent_at` | String (ISO) | |
| `expires_at` | String (ISO) | 90 days after creation |
| `ttl` | Number | Epoch seconds for DynamoDB TTL auto-delete |
| `subscription_tier` | String | |

**GSI:**
- `sub-index`: PK = `subscription_id` — find all updates for a subscription

### 3d. `tripy-rate-limit-counters`

**Primary Key:** `pk` (String)

TTL attribute: `ttl`

| Field | Type | Description |
|---|---|---|
| `pk` | String (PK) | Scope key, e.g. `start:ip:<hash>`, `resend:email:<email>` |
| `count` | Number | Atomic counter (DynamoDB `ADD`) |
| `ttl` | Number | Epoch seconds — auto-expires after the window |

---

## 4. User-Facing Flow: Opt-In

The monitoring opt-in lives on the **booking page** (`frontend/src/app/(app)/solo/booking/page.tsx`) and follows a state machine:

```
asking → (user clicks "Yes, I booked") → booked
booked → (user clicks "Watch this trip") → email_input
email_input → (submit email) → email_pending_verification  (anonymous)
email_input → (submit email) → monitoring_active            (authenticated)
booked → (user clicks "No thanks") → dismissed
```

**State machine states:**
- `asking` — initial: "Did you book this trip?"
- `not_booked` — user said no
- `dismissed` — user declined monitoring
- `booked` — user confirmed booking, sees monitoring offer card
- `email_input` — user clicked "Watch this trip", email input visible
- `email_pending_verification` — verification email sent, waiting for click
- `monitoring_active` — monitoring is running

**State persistence:**
- For authenticated users: server truth via `solo.getMonitoringStatus(tripId)` on page load
- For anonymous users: `localStorage` with keys `tripy_monitoring_{tripId}` (with expiry for staleness) and `tripy_post_booking_{tripId}`

**Monitoring offer UI** (shown in `booked` state):
- Heading: "Want us to keep watching this trip?"
- Features grid: Price drops, Schedule changes, Direct flights, Better redemptions
- CTA: "Watch this trip" / "No thanks"
- Subtext: "Free · We check every 6 hours · Monitoring runs until 24h before departure or 14 days"

**Baseline capture:**
When the user submits, the frontend sends a `baseline_payload` containing:
- `schema_version`: 1
- `selected_itinerary`: the current itinerary snapshot from the booking page
- `alternatives`: (optional) other itineraries
- `query_inputs`: (optional) the original search parameters

---

## 5. Backend: Subscription Lifecycle

### `POST /solo/trips/{trip_id}/monitoring/start`

**File:** `backend/src/routes/monitoring.py` (lines 90–312)

1. **Auth check**: Tries to extract `user_id` from JWT. Falls through to anonymous if no valid token.
2. **Email resolution**: Uses `body.email`, or falls back to user profile email (authenticated only).
3. **Rate limiting** (checked AFTER validation to avoid burning tokens on bad requests):
   - Per-IP: max 10 starts/hour (using truncated IP hash)
   - Per-trip: max 10 starts/day
4. **Deduplication**: Queries `trip-email-index` for existing active/pending subscriptions.
   - If active: returns idempotent success
   - If pending: resends verification email (rate limited to 3/day per email)
5. **Baseline capture**: Builds baseline from `body.baseline_payload` or falls back to stored trip data.
6. **Atomic subscription creation**: Uses `TransactWriteItems` with a lock item to prevent race conditions.
   - Lock PK: `lock#{trip_id}#{email}`
   - Condition: lock must not exist, OR its state must be `cancelled`/`expired`
7. **Verification email** (anonymous only): Issues a JWT token, sends magic link via SES.
8. **Response**: Returns `subscription_id`, `state`, `tier`, `expires_at`, `email_sent`.

### `GET /solo/trips/{trip_id}/monitoring/status`

**File:** `backend/src/routes/monitoring.py` (lines 410–475)

Authenticated only. Verifies trip ownership (owner or collaborator), then returns the active subscription's status including `next_check_at`, `last_checked_at`, and alert count.

### `POST /solo/trips/{trip_id}/monitoring/stop`

**File:** `backend/src/routes/monitoring.py` (lines 482–515)

Authenticated only. Atomically transitions the subscription + lock to `cancelled` state and sets `next_check_at` to far future (`2099-01-01`).

---

## 6. Backend: Cron Job (The Monitoring Loop)

### `POST /solo/internal/monitoring-check`

**File:** `backend/src/routes/monitoring.py` (lines 700–974)

Protected by `X-Cron-Secret` header. This is the heart of the monitoring system.

**Execution flow for each due subscription:**

```
1. Query due subscriptions (across 10 shard buckets)
2. For each subscription (bounded concurrency = 3, per-sub timeout = 30s):
   a. Check expiry → if expired, transition to "expired" state
   b. Load baseline from baselines table
   c. Validate baseline schema version (>= 1) and query version (>= 1)
   d. Run search → ⚠️ STUBBED: candidate = baseline (no real search)
   e. Compute change score (0.0–1.0+)
   f. Compute change fingerprint (SHA-256 hash of identity + bucketed deltas)
   g. Check debounce (fingerprint must appear in 2 of last 3 checks for medium scores)
   h. Check cooldown (48h between alerts, with override for big changes)
   i. If alert triggered:
      - Create update record in DynamoDB
      - Attempt email send (two-step: always save record, gate email on kill switch + render check)
      - Set 48h cooldown
   j. Always: update next_check_at and last_checked_at
```

**Concurrency model:**
- Uses `asyncio.Semaphore(SEARCH_CONCURRENCY)` where `SEARCH_CONCURRENCY=3`
- Each subscription processed in a thread via `asyncio.to_thread`
- Per-subscription timeout: 30 seconds
- Overall job timeout: 300 seconds (5 minutes)

**Error resilience:**
- If processing fails, the error is logged and `next_check_at` is still updated (prevents infinite retry loops)
- If timeout occurs, the subscription is rescheduled for the next check interval

> **Operational note: `asyncio.to_thread` + network I/O.** The current cron uses `asyncio.to_thread(process_one, sub)` which runs each subscription check in a thread pool. This works for CPU-bound scoring/fingerprinting but is suboptimal when the search step (Phase 1) involves network I/O (API calls to flight search providers). Mixing thread offloading with async I/O adds complexity — if the search provider has an async client, the search call should be `await`ed natively within the async context rather than running in a thread. When wiring in real search, prefer making `process_one` an async function that awaits the search call directly and only offloads CPU-heavy steps to threads if profiling shows a need.

---

## 7. Scoring Engine

**File:** `backend/src/domain/monitoring/utils.py`, function `compute_change_score()` (lines 167–213)

Computes a weighted composite score (0.0–1.0+) measuring how much "better" the candidate is vs. the baseline.

| Factor | Weight | Cap | Tier |
|---|---|---|---|
| Cash price drop (% improvement) | 0.5 | 0.5 | Both |
| Duration improvement (minutes saved) | 0.15 | 0.15 | Both |
| Stops reduction (per stop removed) | 0.15 | — | Both |
| Points cost drop (% improvement) | 0.3 | 0.3 | Paid only |

**Examples:**
- 28% cash price drop → `0.28 × 0.5 = 0.14` (medium score)
- 60-minute duration improvement → `60/600 × 0.15 = 0.015`
- 1 fewer stop → `0.15`
- 20% points drop (paid) → `0.20 × 0.3 = 0.06`

**Score thresholds:**

| Range | Behavior |
|---|---|
| > 0.25 (`SCORE_THRESHOLD_HIGH`) | Alert immediately (no debounce needed) |
| 0.10–0.25 | Medium: requires 2 of last 3 checks to show same fingerprint |
| < 0.10 (`SCORE_THRESHOLD_MEDIUM_LOW`) | Noise — never alert |

> **GAP: Cash and points drops are treated as symmetric signals, but they are not.**
> A cash price drop is universally actionable — anyone can rebook at a lower price. A points price drop is only actionable if: (a) the original award booking is refundable or changeable, (b) award inventory still exists at the new price, and (c) change fees don't erase the savings. The scoring engine currently has no feasibility gate for points drops. See [Section 20](#20-critical-gap-points-drops-are-not-price-drops) for the required fix.

---

## 8. Fingerprinting & Debounce

### Fingerprinting

**File:** `backend/src/domain/monitoring/utils.py`, function `compute_change_fingerprint()` (lines 120–153)

Creates a SHA-256 hash (truncated to 16 hex chars) from:
- **Identity**: carrier + flight number + departure time for each segment
- **Cash delta**: bucketed to $25 increments
- **Points delta**: bucketed to 2,500 increments
- **Stops delta**: exact integer difference

Format: `"{identity}|cash:{bucket}|pts:{bucket}|stops:{delta}"` → SHA-256 → first 16 chars

The bucket sizes ($25 cash, 2,500 points) are intentionally wide to avoid noise from minor fluctuations while still catching real changes.

> **GAP: Fingerprint identity relies on flight numbers, which are unstable.**
>
> Airlines re-number flights seasonally (UA 123 → UA 456 for the same SFO→NRT service). Schedule publications shift departure times by 15–60 minutes. Using `carrier + flight_number + departure_time` as identity means:
>
> - A renumbered flight produces a completely different fingerprint, causing false "new option" alerts
> - A 20-minute schedule drift produces a different fingerprint, resetting debounce
> - The system can't tell "same flight, different number" from "genuinely different flight"
>
> **Required: replace flight-number-based identity with a stable itinerary signature.**
>
> The fingerprint identity component should be built from:
>
> | Component | Current | Required |
> |---|---|---|
> | Route | Not included | Origin + destination per segment |
> | Date | Departure time (exact) | Departure **date** + time bucket (30-min or 60-min) |
> | Carrier | Marketing carrier | Marketing **or** operating carrier |
> | Cabin | Not included | Economy / premium economy / business / first |
> | Stops | In delta only | Number of stops as identity component |
> | Duration | Not included | Total duration bucket (30-min increments) |
> | Flight number | Core identity | **Excluded** from identity, kept as supplementary detail |
>
> Example stable signature: `"SFO-NRT|2026-03-15|dep:1400|UA|economy|0stop|660min"` instead of `"UA123|2026-03-15T14:00:00"`.
>
> This prevents fingerprint churn from flight renumbering and minor schedule drift while still distinguishing genuinely different itineraries (different route, different time of day, different airline).

### Debounce

**File:** `backend/src/domain/monitoring/utils.py`, function `should_alert()` (lines 229–248)

Uses a ring buffer of the last 2 fingerprints stored on the subscription:

- **High score (> 0.25)**: alert immediately, no debounce
- **Medium score (0.10–0.25)**: require the same fingerprint to appear in at least 1 of the 2 prior checks (i.e., 2 of 3 consecutive checks show the same change)
- **Low score (< 0.10)**: never alert

This prevents alerting on transient price fluctuations — the change must persist across multiple check cycles.

---

## 9. Cooldown Logic

**File:** `backend/src/routes/monitoring.py` (lines 845–872)

After an alert is sent, a 48-hour cooldown (`COOLDOWN_HOURS=48`) is applied. During cooldown:

- Alerts are **suppressed** (`skipped_cooldown` counter incremented)
- **Unless** the cooldown override criteria are ALL met:
  1. Score > 0.40 (`COOLDOWN_OVERRIDE_SCORE`)
  2. The fingerprint is different from the last alerted fingerprint (`is_new_fp`)
  3. At least one of:
     - Cash drop >= $150 (`COOLDOWN_OVERRIDE_CASH_FLOOR`)
     - Points drop >= 10,000 (`COOLDOWN_OVERRIDE_POINTS_FLOOR`)
     - Stops decreased

This means if a dramatically better deal appears during cooldown, the user still gets notified.

---

## 10. Alert Sending (Two-Step Pattern)

**File:** `backend/src/domain/monitoring/alerts.py`

The alert sending follows a strict two-step pattern:

### Step A: Always create the update record
The update record is persisted in DynamoDB regardless of whether email sending is enabled. This ensures the data is never lost.

### Step B: Gated email send
Email is only attempted if ALL gates pass:

1. **Kill switch**: `MONITORING_ALERTS_ENABLED=true` (currently `false`)
2. **Render check**: HTTP GET to the frontend's update page API (`/solo/api/monitoring/updates/{update_id}`) must return:
   - Status 200
   - Non-empty `deltas.bullets` array

This enforces the trust rule: **"No alert emails are sent until the update click-through page can render stored comparison data."**

### Email status tracking

Every update record has an `email_status` field tracking what happened:

| Status | Meaning |
|---|---|
| `sent` | Email delivered successfully |
| `skipped_alerts_disabled` | Kill switch is off |
| `skipped_render_check_failed:<status>` | Frontend returned non-200 |
| `skipped_render_check_empty` | Frontend returned 200 but no bullets |
| `skipped_render_error:<ErrorType>` | Network/parsing error during render check |
| `skipped_email_not_enabled` | SES not configured |
| `skipped_send_failed:<error>` | SES send failed |
| `skipped_send_error:<ErrorType>` | Exception during send |

---

## 11. Frontend: Update Click-Through Page

**File:** `frontend/src/app/(app)/solo/updates/[update_id]/page.tsx`

This is the page users see when they click the link in an alert email. It:

1. Fetches the update from `GET /solo/api/monitoring/updates/{update_id}` (no auth required — UUID = capability token)
2. Handles states: loading, expired (410), error (404), degraded (old schema), and full comparison view
3. Renders:
   - **Header**: severity icon, "Something changed on your trip", detection timestamp
   - **Staleness warning**: if detected > 24 hours ago
   - **Delta bullets**: each change with type icon (price_drop, schedule_change, points_improvement, risk_change) and direction icon (improvement ↓, regression ↑, neutral ⏱)
   - **Recommendation** and **caveat** text
   - **Comparison cards**: side-by-side "Your Booking" vs "New Option Found" showing carrier, cash price, points cost, stops
   - **CTA**: "Check current prices" → links back to booking page

**Security**: The response never includes email, user_id, or subscription_id. The update_id UUID itself is the authorization token.

---

## 12. Email Verification Flow

**For anonymous users only** (authenticated users are immediately activated):

1. User submits email on booking page
2. Backend creates subscription in `pending_verification` state
3. Backend issues a JWT verification token:
   - Contains: `jti` (random UUID), `sub_id`, `email`, `trip_id`, `type: "verify"`
   - Expires: 24 hours
   - The `jti` is persisted on the subscription as `active_token_jti`
4. Verification email sent via SES with magic link pointing to `{FRONTEND_URL}/api/monitoring/verify?token=...`
5. Frontend proxy (`frontend/src/app/api/monitoring/verify/route.ts`) forwards to backend
6. Backend verifies:
   - JWT signature + expiry
   - Subscription exists and is in `pending_verification` state
   - JTI matches `active_token_jti` (single-use enforcement)
7. If valid: atomically transitions subscription + lock to `active`, sets `next_check_at`, clears JTI
8. Redirects to booking page with `?monitoring=activated`

**Token superseding**: If the user requests a resend, a new JTI is written to the subscription, invalidating any prior tokens.

---

## 13. Unsubscribe Flow

**File:** `backend/src/routes/monitoring.py` (lines 548–618)

Two unsubscribe mechanisms:

### Browser click (GET)
`GET /solo/monitoring/unsubscribe?token=...`
- Verifies the unsubscribe JWT (no expiry — per RFC 8058)
- Cancels the subscription
- Renders an HTML confirmation page

### One-click (POST) — RFC 8058
`POST /solo/monitoring/unsubscribe?token=...`
- Same verification
- Returns `{"ok": true}`
- Enables email clients that support one-click unsubscribe

**Scope**: Unsubscribe tokens have a `scope` field (`trip` or `all`). Currently `all` scope falls back to cancelling just the specific subscription (no email-only GSI for scanning all subs).

---

## 14. Configuration & Feature Flags

**File:** `backend/src/config/monitoring.py`

All env vars are optional with safe defaults (feature disabled if not set).

### Feature Flags

| Env Var | Default | Purpose |
|---|---|---|
| `MONITORING_ALERTS_ENABLED` | `false` | Master kill switch for alert emails |
| `MONITORING_PAID_ENABLED` | `false` | Gates paid tier API endpoints |

### Secrets

| Env Var | Fallback | Purpose |
|---|---|---|
| `MONITORING_CRON_SECRET` | `CRON_SECRET` | Protects internal cron endpoint |
| `MONITORING_TOKEN_SECRET` | `CRON_SECRET` → `"monitoring-dev-secret"` | JWT signing for verification + unsubscribe |

### Operational Constants

| Constant | Value | Purpose |
|---|---|---|
| `FREE_CHECK_INTERVAL_S` | 21,600 (6h) | Free tier check frequency |
| `PAID_CHECK_INTERVAL_S` | 7,200 (2h) | Paid tier check frequency |
| `FREE_MONITORING_DAYS` | 14 | Free tier max duration |
| `PAID_MONITORING_DAYS` | 30 | Paid tier max duration |
| `DEPARTURE_BUFFER_HOURS` | 24 | Stop monitoring 24h before departure |
| `COOLDOWN_HOURS` | 48 | Minimum gap between alerts |
| `CRON_BATCH_SIZE` | 25 | (Not currently used in query) |
| `SEARCH_CONCURRENCY` | 3 | Max parallel subscription checks |
| `PER_SUB_TIMEOUT_S` | 30 | Timeout per subscription check |
| `JOB_TIMEOUT_S` | 300 | Overall cron job timeout |
| `SCORE_THRESHOLD_HIGH` | 0.25 | Immediate alert threshold |
| `SCORE_THRESHOLD_MEDIUM_LOW` | 0.10 | Minimum score to consider alerting |
| `COOLDOWN_OVERRIDE_SCORE` | 0.40 | Score needed to break cooldown |
| `COOLDOWN_OVERRIDE_CASH_FLOOR` | $150 | Cash drop needed for cooldown override |
| `COOLDOWN_OVERRIDE_POINTS_FLOOR` | 10,000 | Points drop needed for cooldown override |
| `UPDATE_EXPIRY_DAYS` | 90 | Update page accessible for 90 days |
| `UPDATE_TTL_GRACE_DAYS` | 30 | DynamoDB auto-deletes 30 days after expiry |
| `DUE_INDEX_SHARD_COUNT` | 10 | Number of due-index partition shards |

---

## 15. Rate Limiting

**File:** `backend/src/domain/monitoring/repo.py`, function `check_rate_limit()` (lines 342–371)

Uses DynamoDB atomic counters with TTL-based auto-cleanup.

| Scope | Window | Limit |
|---|---|---|
| `start:ip:<hash>` | 1 hour | 10 starts |
| `start:trip:<trip_id>` | 1 day | 10 starts |
| `resend:email:<email>` | 1 day | 3 resends |
| `verify:ip:<hash>` | 1 hour | 20 verifications |

**Fail-open policy**: If the rate limit check itself errors (DynamoDB issue), the request is allowed through. This prevents rate limit infrastructure failures from blocking users.

---

## 16. Admin Tooling (Replay)

### `POST /solo/internal/monitoring-replay`

**File:** `backend/src/routes/monitoring.py` (lines 981–1023)

Protected by `X-Cron-Secret`. Re-attempts email sending for a specific update record.

**Use cases:**
- Kill switch was off during a cron run → update records created with `email_status=skipped_alerts_disabled` → flip switch → replay to send emails
- Render check temporarily failed → fix frontend → replay

**Guards:**
- Skips if `email_status` is already `sent` (idempotent)
- Still goes through all gates (kill switch + render check)

---

## 17. What's Implemented vs. Stubbed

### Fully Implemented

| Component | Status |
|---|---|
| DynamoDB table definitions (CDK) | Done |
| Subscription CRUD (create, read, cancel) | Done |
| Atomic deduplication (TransactWriteItems + lock) | Done |
| Baseline capture from frontend | Done |
| Email verification flow (JWT, magic links) | Done |
| Unsubscribe (per-trip, RFC 8058 one-click) | Done |
| Rate limiting (IP, trip, email) | Done |
| Cron endpoint structure (query due, process, update) | Done |
| Scoring engine (cash, schedule, stops, points) | Done |
| Fingerprinting with bucketed deltas | Done |
| Debounce (2-of-3 fingerprint matching) | Done |
| Cooldown with override for big changes | Done |
| Two-step alert sending (record first, gate email) | Done |
| Kill switch + render check | Done |
| Update click-through page (frontend) | Done |
| Monitoring opt-in UI on booking page | Done |
| Frontend API client (`solo.startMonitoring/getMonitoringStatus/stopMonitoring`) | Done |
| State persistence (localStorage for anon, server for auth) | Done |
| Admin replay tool | Done |
| Schedule materiality check | Done |
| Expiry handling in cron | Done |
| Settings page price alerts toggle (UI only) | Done |

### Stubbed / Not Implemented

| Component | Status | Impact |
|---|---|---|
| **Real flight search in cron** | **Stubbed** | **Blocker**: `candidate = selected_itinerary` means no changes are ever detected |
| **Delta bullet generation** | **Stubbed** | `deltas.bullets` is always `[]` → render check would fail even if search worked |
| **Paid tier (Stripe integration)** | Gated off | No revenue impact yet |
| **"Manage all alerts" page** | **Not built — TRUST RISK** | `/solo/monitoring/preferences` is linked in alert email footers but returns 404. **Broken links in alert emails destroy trust nearly as fast as wrong alerts.** Must either remove the link from email templates until the page exists, or redirect to `/settings` as a stopgap. |
| **Global unsubscribe (all trips)** | Partial | Per-trip works; "all" scope falls back to per-trip |
| **Settings page toggle backend integration** | Not wired | UI toggle exists but doesn't persist to server |
| **Repricing logic** | Not implemented | No automatic action when price drop detected |

---

## 18. Critical Gap: Search Integration

The single biggest gap is in the cron handler at `backend/src/routes/monitoring.py` lines 812–824:

```python
# 4. Run search (placeholder — integrate with real search pipeline)
#    For now, this is a stub that returns the baseline itself
#    TODO: Integrate with OrchestratorAgent / flight search pipeline
selected_itinerary = baseline.get("selected_itinerary", {})
if isinstance(selected_itinerary, str):
    try:
        selected_itinerary = json.loads(selected_itinerary)
    except json.JSONDecodeError:
        selected_itinerary = {}

# Placeholder: no change detected (search not implemented yet)
# When search is implemented, `candidate` will be the best match from search results
candidate = selected_itinerary  # TODO: replace with actual search result
```

**Why it's a blocker:**
- `candidate = selected_itinerary` → `compute_change_score(baseline, baseline, tier)` always returns `0.0`
- Score 0.0 < `SCORE_THRESHOLD_MEDIUM_LOW` (0.10) → `should_alert()` returns `False`
- No update records are ever created
- No emails are ever sent

**What's needed to complete it:**
1. Extract `query_inputs` from the baseline (search parameters like origin, destination, dates, etc.)
2. Re-run the search using the `OrchestratorAgent` or flight search pipeline
3. Match the returned results against the baseline itinerary (same route, similar timing)
4. Pick the best matching candidate
5. Replace `candidate = selected_itinerary` with the real search result

**Additionally**, the delta bullet generation (line 891) needs to be implemented:
```python
"deltas": json.dumps({
    "bullets": [],  # TODO: generate real delta bullets from scoring
    "recommendation": "",
    "caveat": "Prices change frequently. Verify current availability before booking.",
}),
```

Without bullets, even if a real candidate were found, the render check in `alerts.py` would fail:
```python
bullets = data.get("deltas", {}).get("bullets", [])
if not bullets:
    _mark_email_status(update_id, "skipped_render_check_empty")
    return False
```

A `generate_delta_bullets()` function would need to:
- Compare baseline vs candidate cash price → produce `DeltaBullet(type="price_drop", label="Cash price dropped 28%", detail="$847 → $612", direction="improvement")`
- Compare schedule → `DeltaBullet(type="schedule_change", ...)`
- Compare stops → `DeltaBullet(type="schedule_change", subtype="stops_decreased", ...)`
- Compare points cost (paid tier) → `DeltaBullet(type="points_improvement", ...)`

### 18c. Matching baseline → candidate is non-trivial

The current doc implies "re-run search, pick best match" but this is harder than it sounds:

- **Flight numbers change.** Airlines re-number flights seasonally. UA 123 today may be UA 456 next month for the same route/time.
- **Schedules drift.** Departure times shift by 15–60 minutes between schedule publications.
- **Award buckets differ.** A flight may exist at the same cash price but award availability disappears or changes classes (Saver → Standard).

**Required: route equivalence matching logic**

The candidate matcher needs:
1. **Route equivalence**: same origin + destination + date (not flight number)
2. **Time window tolerance**: e.g., departure within ±2 hours of baseline
3. **Carrier consistency rules**: same marketing carrier or same operating carrier
4. **Program compatibility**: if baseline used United miles, the candidate must be bookable with United miles

This logic belongs near the optimizer (`backend/src/optimization/`) not in monitoring utils — monitoring should call into it as a service.

### 18d. Search must be gated by payment type (cash vs. award)

The search integration must dispatch to different search modes depending on how the baseline booking was paid. This is not optional — running the wrong search type produces meaningless comparisons.

**Decision matrix:**

| `payment_context.payment_type` | Search Mode | What to Compare | Points Delta? |
|---|---|---|---|
| `cash` | Cash fare search (any provider) | Cash price only | No |
| `points` | Award search **for that specific program** | Points cost in that program | Yes |
| `mixed` | Both cash + award search for the program | Both prices | Yes (for award segments) |
| Missing (v1 baseline) | Cash fare search (fallback) | Cash price only | No — suppress `points_improvement` entirely |

**Why this matters:**

If the baseline was booked with 80k United miles and the cron runs a cash fare search, finding "$450 cash" means nothing — it doesn't tell the user whether the award price changed. Conversely, if the baseline was a $500 cash booking and the cron runs a United award search, finding "60k miles" is irrelevant to someone who paid cash.

**Implementation requirements:**

```python
def determine_search_mode(baseline: dict) -> str:
    payment_context = baseline.get("payment_context")
    if not payment_context:
        return "cash"  # v1 baselines — safe fallback
    payment_type = payment_context.get("payment_type", "cash")
    if payment_type == "points":
        program = payment_context["segments"][0]["program"]
        return f"award:{program}"  # e.g., "award:united"
    if payment_type == "mixed":
        program = payment_context["segments"][0]["program"]
        return f"mixed:{program}"
    return "cash"
```

The search dispatcher in the cron must route based on this mode. If award search is not yet supported for a given program, the cron should:
1. Fall back to cash search
2. Suppress all `points_improvement` deltas
3. Log `monitoring.award_search_unavailable program={program}`

This prevents the system from generating points-based alerts it can't substantiate.

### 18e. Delta bullets are not cosmetic

Delta bullets are:
- **Required for alerts** — the render check blocks emails if bullets are empty
- **Required for user trust** — vague "something changed" notifications destroy credibility
- **Required for monetization** — paid tier value proposition depends on actionable detail

Build a minimal `generate_delta_bullets()` early, even if it only handles cash price and stops. Don't leave it stubbed long.

---

## 19. Critical Gap: Baseline Missing Funding Provenance

### The problem

The baseline currently captures:
- `selected_itinerary` — what was booked
- `alternatives` — other options at the time
- `query_inputs` — how to re-run the search

But it does **not** capture **how the booking was paid for**.

This means the system can detect "award price dropped from 80k to 60k miles" but cannot answer:
- Which program owns those miles? (United? Delta? Transferred from Chase?)
- Were they transferred from a bank? (irreversible — bank points are gone)
- Was the booking changeable or refundable?
- What is the actual freed-up balance, and in which currency?

**Without funding provenance, monitoring can only notify — never advise.** Any reallocation, freed-balance calculation, or "here's what you could do with the savings" recommendation is impossible or dangerously wrong.

### Required schema addition: `payment_context`

Add to the baseline at opt-in time (schema_version bump to 2):

```json
{
  "baseline_id": "mbl_abc123",
  "schema_version": 2,
  "captured_at": "2026-02-10T12:00:00Z",
  "selected_itinerary": { ... },
  "alternatives": [ ... ],
  "query_inputs": { ... },
  "payment_context": {
    "payment_type": "points",
    "segments": [
      {
        "segment_index": 0,
        "program": "united",
        "currency": "miles",
        "amount": 80000,
        "cash_copay": 5.60,
        "funding_source_type": "transfer",
        "bank_origin": "chase",
        "funding_source_id": "transfer_eric_chase_united",
        "is_changeable": true,
        "is_refundable": false,
        "change_fee": 0,
        "redeposit_fee": 0
      }
    ],
    "total_points_used": 80000,
    "total_cash_used": 5.60,
    "captured_from": "booking_page_selection",
    "booking_ref": {
      "pnr": null,
      "confirmation_code": null,
      "marketing_carrier": "UA",
      "booked_at": "2026-02-10T12:00:00Z",
      "channel": "unknown",
      "fare_basis": null,
      "award_type": null
    }
  }
}
```

**Field definitions:**

| Field | Required | Description |
|---|---|---|
| `payment_type` | Yes | `"points"`, `"cash"`, or `"mixed"` |
| `segments[].program` | Yes | The loyalty program that owns the points *now* (e.g., `"united"`) |
| `segments[].currency` | Yes | `"miles"`, `"points"`, `"dollars"` |
| `segments[].amount` | Yes | Points/miles spent on this segment |
| `segments[].cash_copay` | Yes | Cash taxes/fees paid alongside points |
| `segments[].funding_source_type` | Yes | `"native"` (had miles already) or `"transfer"` (transferred from bank) |
| `segments[].bank_origin` | If transfer | Which bank the points came from (informational only — **never consumed downstream**) |
| `segments[].funding_source_id` | Yes | Matches `FundingSource.source_id` from the optimizer |
| `segments[].is_changeable` | Yes | Whether the award ticket allows changes |
| `segments[].is_refundable` | Yes | Whether miles can be redeposited |
| `segments[].change_fee` | Yes | Fee to change (in dollars), 0 if free |
| `segments[].redeposit_fee` | Yes | Fee to redeposit miles (in dollars), 0 if free |
| `booking_ref.pnr` | No | Airline PNR / record locator if user provides it |
| `booking_ref.confirmation_code` | No | Alternate confirmation code (OTA booking ref, etc.) |
| `booking_ref.marketing_carrier` | Yes | Marketing carrier code (e.g., `"UA"`) |
| `booking_ref.booked_at` | Yes | When the booking was made |
| `booking_ref.channel` | Yes | `"airline_direct"`, `"ota"`, or `"unknown"` — change rules differ by channel |
| `booking_ref.fare_basis` | No | Fare basis code if available (affects changeability) |
| `booking_ref.award_type` | No | `"saver"`, `"standard"`, `"everyday"`, etc. if available |

### Honest limitation: we almost certainly don't have PNR

Tripy is an optimization and search tool, not a booking engine. We recommend where and how to book — the user books directly with the airline or OTA. This means:

- **We will not have the PNR** in almost all cases
- **We will not have the fare basis** unless we can infer it from the search results
- **`is_changeable` is therefore a heuristic**, not a verified fact

The heuristic is derived from:
1. **Program-level defaults**: Most US domestic carriers allow free award changes. Most international awards have $0–$75 redeposit fees. These are stored in `backend/src/utils/card_benefits.py` and program metadata.
2. **Award type inference**: If we know the award was booked as "Saver" vs "Standard", we can look up changeability rules per program.
3. **Channel inference**: Airline-direct bookings are generally more changeable than OTA bookings.

**Because `is_changeable` is a heuristic, all points-drop alerts must caveat:**

> "Change policies vary. Verify with the airline that your ticket is changeable before rebooking."

This caveat is **non-optional** and must appear on every points-drop alert, even when our heuristic says "changeable." Only a PNR lookup against the airline's system can confirm changeability, and we don't have that capability.

### Where this data comes from

The booking page (`frontend/src/app/(app)/solo/booking/page.tsx`) already has access to:
- The selected itinerary with funding source information
- The optimizer result which includes `FundingSource` objects with `source_id`
- Transfer instructions which track bank → program transfers

At opt-in time, the frontend needs to package this into `payment_context` and include it in the `baseline_payload`.

### Backward compatibility

- Baselines with `schema_version: 1` (no `payment_context`) continue to work for price-drop notifications
- Repricing features require `schema_version >= 2`
- The cron should check: `if not baseline.get("payment_context"): skip_repricing_analysis()`

---

## 20. Critical Gap: Points Drops Are Not Price Drops

### The asymmetry

The scoring engine currently treats cash price drops and points price drops as symmetric signals. They are fundamentally different.

**Cash price drop: universally actionable**
- Anyone can rebook at the lower price
- Original ticket can usually be cancelled for credit
- No program-specific constraints

**Points price drop: conditionally actionable**
- Only matters if the original award booking is changeable
- Award inventory must still exist at the new price point
- Change/redeposit fees may erase the savings
- The freed miles exist only in the destination program (not the source bank)
- Some programs (e.g., Delta) have unpublished award charts — "drop" may be a temporary pricing fluctuation

### Current behavior (problematic)

```python
# In compute_change_score():
# Points improvement (paid tier only)
if tier == "paid":
    baseline_points = baseline.get("points_cost")
    candidate_points = candidate.get("points_cost")
    if baseline_points and candidate_points and baseline_points > 0:
        pct_drop = (baseline_points - candidate_points) / baseline_points
        if pct_drop > 0:
            score += min(pct_drop * 0.3, 0.3)
```

This scores a 25% points drop (80k → 60k) identically whether the booking is changeable or not. A non-changeable award with a points drop is noise — alerting the user about savings they can't capture erodes trust.

### Required fix: feasibility gate

Before scoring or generating a `points_improvement` delta, check feasibility:

```python
def is_points_drop_actionable(baseline: dict, payment_context: dict) -> tuple[bool, str]:
    """
    Returns (actionable, reason).
    If not actionable, the points_improvement delta should be suppressed or downgraded.
    """
    if not payment_context:
        return False, "no_payment_context"

    segments = payment_context.get("segments", [])
    if not segments:
        return False, "no_segment_data"

    # Check if any segment is changeable
    any_changeable = any(seg.get("is_changeable", False) for seg in segments)
    if not any_changeable:
        return False, "non_changeable_award"

    # Check if change fees eat the savings
    total_change_fees = sum(seg.get("change_fee", 0) for seg in segments)
    baseline_points = baseline.get("points_cost", 0)
    candidate_points = baseline.get("candidate_points_cost", 0)  # from search
    points_saved = baseline_points - candidate_points

    # Estimate savings in dollars using program-specific CPP
    cpp = get_estimated_cpp(program)
    estimated_savings_dollars = points_saved * cpp
    if total_change_fees >= estimated_savings_dollars:
        return False, "fees_exceed_savings"

    return True, "actionable"


# Program-specific CPP estimates (configurable)
# These are conservative floor estimates — actual value varies by route and cabin.
ESTIMATED_CPP_BY_PROGRAM = {
    "united": 0.013,      # United miles: ~1.3 cpp average
    "american": 0.014,    # AAdvantage: ~1.4 cpp
    "delta": 0.012,       # SkyMiles: ~1.2 cpp (variable pricing)
    "southwest": 0.014,   # Rapid Rewards: ~1.4 cpp (fixed)
    "jetblue": 0.013,     # TrueBlue: ~1.3 cpp
    "alaska": 0.018,      # Mileage Plan: ~1.8 cpp
    "british_airways": 0.012,  # Avios: ~1.2 cpp
    "air_france_klm": 0.012,   # Flying Blue: ~1.2 cpp
    "singapore": 0.018,   # KrisFlyer: ~1.8 cpp
    "ana": 0.015,         # ANA Mileage Club: ~1.5 cpp
    "marriott": 0.007,    # Marriott Bonvoy: ~0.7 cpp
    "hilton": 0.005,      # Hilton Honors: ~0.5 cpp
    "hyatt": 0.017,       # World of Hyatt: ~1.7 cpp
}
DEFAULT_CPP = 0.01  # Conservative fallback

def get_estimated_cpp(program: str) -> float:
    return ESTIMATED_CPP_BY_PROGRAM.get(program, DEFAULT_CPP)
```

> **This is a heuristic, not a rule.** CPP varies wildly by program, route, cabin, and time of year. A United Polaris award SFO→NRT might deliver 4+ cpp while a domestic economy saver delivers 1.2 cpp. The `ESTIMATED_CPP_BY_PROGRAM` map uses conservative floor estimates so the feasibility gate errs toward *showing* the alert rather than suppressing it. When both cash price and points price are available for the candidate (from a mixed search), prefer computing CPP directly: `candidate_cash_price / candidate_points_cost` instead of using the map.

### Bigger feasibility constraint: inventory persistence

The fee-based feasibility check above answers: "Are the savings worth the fees?" But there's a harder question it *cannot* answer:

> **"Is the award seat at the new price still available, and can the user actually reprice without losing their current seat?"**

In practice:
- Award inventory is ephemeral. A seat at 60k miles may appear for 2 hours and vanish.
- Repricing an award often requires cancelling the old booking and making a new one. If the new booking fails (seat gone), the user loses their original seat.
- Some programs (United, American) support "repricing in place" for certain award types, but many do not.

**We cannot fully solve this.** But we must acknowledge it in every alert:

> "Award prices and availability change frequently. Before making changes, verify the lower price is still available. Some airlines allow repricing without cancellation — contact the airline to confirm."

This caveat is **always** required, even when feasibility = `actionable`. The feasibility gate only checks fees, not real-time inventory.

**Behavior when not actionable:**

| Reason | Action |
|---|---|
| `no_payment_context` | Suppress `points_improvement` delta entirely (baseline v1 — can't assess) |
| `non_changeable_award` | Downgrade to informational caveat: "Award price dropped, but your ticket may not be changeable. Check with the airline." |
| `fees_exceed_savings` | Downgrade to informational: "Award price dropped by 20k miles, but change fees (~$X) may offset the savings (~$Y at estimated {cpp} cpp)." |
| `actionable` | Full `points_improvement` delta with freed-balance details + inventory caveat |

### Impact on scoring

When `is_points_drop_actionable()` returns `False`:
- Do **not** add points improvement to the composite score
- Do **not** count it toward cooldown override thresholds
- Optionally still create a low-priority informational bullet (direction = `"neutral"` not `"improvement"`)

This prevents the system from sending excited "You saved 20k miles!" alerts for non-changeable bookings where the user can't actually capture the savings.

---

# Part 3 — Award Repricing v1 Spec

> **Terminology clarification.** This system involves two distinct capabilities that should not be conflated:
>
> - **Repricing (v1):** Detect when the award price for the user's *existing* itinerary has dropped in the *destination program*, compute the freed balance, and assess whether rebooking at the lower price is feasible. This is what Phase 4 delivers.
> - **Reuse planning (future, v2+):** Given a freed balance in a destination program, suggest what the user could do with those miles (upgrades, hotel bookings, other trips). This requires optimizer integration and is Phase 5.
>
> v1 ships **repricing only**. The `reuse_suggestions` field exists in the schema as `null` — it is a placeholder for v2, not a v1 deliverable. All section headings, code, and UI copy should use "repricing" for v1 functionality.

---

## 21. Points Irreversibility Invariant (Non-Negotiable)

### The rule

> **Once points are transferred from a bank to an airline/hotel program, the transfer is irreversible. Any freed-up value from a price drop exists only in the destination program. The source bank balance is permanently reduced and must never be referenced as available for reallocation.**

This is not an implementation detail. It is a **correctness invariant** that must be enforced at every layer: data model, scoring, delta generation, UI copy, and any future reallocation logic.

### Why this matters

Without enforcement:
- A future engineer could write reallocation logic that says "You freed 20k Chase UR points" when those points are actually 20k United miles
- The UI could display "Use your freed Chase points for a hotel" when Chase points no longer exist
- The optimizer could attempt to re-consume bank balances that were already transferred

### Current state: exists as prose, not as code

The constraint is correctly described in this document and understood conceptually. But:
- There is **no persisted field** that answers: "Which program owns the value of this booking now?"
- There is **no validation** that prevents downstream logic from referencing bank origin as available balance
- There is **no guard clause** in any code path that blocks illegal reallocation suggestions

### Required enforcement: `funding_lock`

Every baseline with `schema_version >= 2` must include a `funding_lock` per segment in `payment_context`:

```json
{
  "segments": [
    {
      "segment_index": 0,
      "funding_lock": {
        "program": "united",
        "currency": "miles",
        "source_type": "transfer",
        "bank_origin": "chase",
        "irreversible": true,
        "locked_at": "2026-02-10T12:00:00Z"
      },
      ...
    }
  ]
}
```

**Invariant rules enforced everywhere downstream:**

| Rule | Enforcement Point | What Happens on Violation |
|---|---|---|
| Reallocation candidates **must match `funding_lock.program`** | `compute_reallocation_context()` | Return `None` — no reallocation computed |
| No optimizer path may consume `funding_lock.bank_origin` as available balance | Reallocation option ranking | Filter out any option requiring bank points |
| UI copy must say "[Program] miles freed", never "points freed" or "[Bank] points freed" | Delta bullet generation + frontend rendering | Use `funding_lock.program` and `funding_lock.currency` for all display strings |
| If `funding_lock` is absent, **do not compute reallocation** | Cron post-detection hook | Skip reallocation analysis, log warning |
| `bank_origin` is **informational only** — never used in any calculation or suggestion | All reallocation code paths | Code review enforcement + assertion guard |

### Guard clause (add to any repricing code path)

```python
class FundingLockViolation(Exception):
    """Raised when repricing targets the wrong program. This is a bug."""
    pass


def validate_funding_lock_invariant(
    funding_lock: dict,
    candidate_program: str,
) -> tuple[bool, str]:
    """
    Validate the irreversibility invariant.

    Returns (valid, reason). Does NOT raise — caller decides how to handle.
    In cron context: log + skip subscription (fail-closed).
    In unit tests: can assert on the return value.
    """
    if not funding_lock:
        return False, "missing_funding_lock"
    if not funding_lock.get("irreversible", True):
        return True, "non_irreversible"  # Cash bookings — no constraint
    if candidate_program != funding_lock["program"]:
        return False, (
            f"invariant_violation: candidate='{candidate_program}' "
            f"but funding_lock.program='{funding_lock['program']}'"
        )
    return True, "valid"
```

**Enforcement policy: fail-closed per subscription, never crash the cron.**

A violation of this invariant is a bug in our code — but a bug in one subscription's data must not take down the entire monitoring job. The policy is:

| Context | On Violation |
|---|---|
| Cron (`process_one`) | Log `error_code="funding_lock_invariant_violation"` at ERROR level, set `email_status="skipped_funding_lock_violation"` on the update record, skip repricing for this subscription, proceed with remaining subscriptions |
| Unit tests | Assert `valid == False` and verify the reason string |
| Any future API endpoint | Return 500 with opaque error, log full details internally |
| Code review | Any code path that consumes `bank_origin` for calculation (not display) must be rejected |

```python
# In the cron's process_one():
valid, reason = validate_funding_lock_invariant(funding_lock, program)
if not valid:
    logger.error(
        f"monitoring.funding_lock_invariant_violation "
        f"sub={sub_id} reason={reason}"
    )
    # Still create update record (cash price drop may be valid)
    # but skip repricing context entirely
    repricing_ctx = None
    # DO NOT raise — proceed with other subscriptions
```

This is a **correctness-critical** invariant treated as a **bug** (not user error), but enforced as **fail-closed per subscription** (not crash). The monitoring job continues, the violated subscription gets no repricing context, and the error is logged at a level that triggers alerts in production.

---

## 22. Repricing Product Contract (Hard Rules)

These are **product-level commitments**, not implementation notes. They constrain what the system may ever do, regardless of technical capability.

### Tripy will NEVER:

| Action | Why |
|---|---|
| Reverse a points transfer | Airline transfers are one-way. This is physically impossible. |
| Auto-rebook a flight | User consent is required for any booking change. |
| Spend freed miles automatically | Even if we detect savings, the user decides what to do with them. |
| Display bank origin as available balance | "20k Chase UR freed" is a lie — they're United miles now. |
| Suggest repricing without funding provenance | If we don't know how the booking was paid, we stay silent. |
| Claim certainty about changeability | Without PNR verification, `is_changeable` is a heuristic. All alerts caveat. |

### Tripy MAY:

| Action | Conditions |
|---|---|
| Detect freed destination-program balance | Only when `payment_context` with `funding_lock` is present |
| Report the estimated freed balance | Only with explicit program name and currency, never "points" generically |
| Assess fee-based feasibility | Using `is_changeable` heuristic + program-specific CPP estimates |
| Notify the user of the repricing opportunity | Via the existing monitoring alert pipeline |

### Tripy MUST ALWAYS:

| Requirement | Implementation |
|---|---|
| State which program owns the freed miles | Use `funding_lock.program` in all copy |
| Show "before / after" in destination currency | e.g., "United miles: 80,000 used → 60,000 needed = 20,000 freed" |
| Require explicit user confirmation before any action | No auto-rebook, no auto-spend |
| Caveat about changeability | "Change policies vary. Verify with the airline that your ticket is changeable before rebooking." (always, even when heuristic says changeable) |
| Caveat about inventory persistence | "Award prices and availability change frequently. Verify the lower price is still available." (always) |
| Degrade gracefully when data is missing | No `payment_context` → notify only, no repricing analysis |

### What v1 does NOT include (deferred to v2+)

| Capability | Status | Why deferred |
|---|---|---|
| "What can freed miles buy?" suggestions | v2 — `reuse_suggestions` field is `null` | Requires optimizer integration for cross-trip valuation |
| Ranked reuse options by CPP | v2 | Needs new ranking model |
| Auto-triggered re-optimization | v2+ | Complex state management, user consent flow |
| PNR-verified changeability | Likely never | Would require airline API integrations we don't have |

---

## 23. Repricing Data Model & Schema

### Update record additions

When the cron detects a points drop on a baseline with `payment_context`, the update record gains a `repricing_context`:

```json
{
  "update_id": "mupd_xyz789",
  "deltas": {
    "bullets": [
      {
        "type": "points_improvement",
        "label": "United award price dropped 25%",
        "detail": "80,000 → 60,000 United miles",
        "direction": "improvement"
      }
    ],
    "recommendation": "You could free up 20,000 United miles by rebooking at the lower award price.",
    "caveat": "Award availability changes frequently. Verify the lower price is still available and check for any change fees before rebooking."
  },
  "repricing_context": {
    "freed_balance": {
      "program": "united",
      "currency": "miles",
      "amount": 20000,
      "funding_lock_source_type": "transfer",
      "bank_origin_informational": "chase"
    },
    "feasibility": {
      "is_changeable": true,
      "is_changeable_source": "program_default_heuristic",
      "change_fee_dollars": 0,
      "redeposit_fee_dollars": 0,
      "net_savings_after_fees": 20000,
      "estimated_cpp_used": 0.013,
      "actionable": true,
      "reason_codes": ["changeable_heuristic", "inventory_unverified"],
      "caveats": [
        "Change policies vary. Verify with the airline that your ticket is changeable.",
        "Award availability changes frequently. Verify the lower price is still available."
      ]
    },
    "reuse_suggestions": null
  }
}
```

**Key constraint**: `repricing_context.freed_balance.program` must match `payment_context.segments[].funding_lock.program`. This is enforced by the invariant in Section 21.

**New fields vs. previous version:**
- `is_changeable_source`: tracks *how* we determined changeability (`"program_default_heuristic"`, `"award_type_lookup"`, `"user_provided"`, `"unknown"`) — important for transparency since we almost never have PNR (see Section 19)
- `estimated_cpp_used`: which CPP value was used for the fee comparison — makes the heuristic auditable
- `reason_codes`: machine-readable string array explaining why the feasibility decision was made — enables debugging and analytics without parsing human-readable caveats. Common codes: `"changeable_heuristic"`, `"changeable_confirmed"`, `"fees_exceed_savings"`, `"inventory_unverified"`, `"non_changeable_award"`, `"cash_booking_no_constraint"`
- `caveats`: array of mandatory caveat strings to display — ensures the UI never forgets them

### `reuse_suggestions` (v2 — not in v1)

For v1, `reuse_suggestions` is always `null`. The system only reports freed balance and feasibility.

When v2 implements reuse planning, this field would contain ranked options:

```json
"reuse_suggestions": [
  {
    "type": "upgrade_same_trip",
    "description": "Upgrade SFO→NRT to United Polaris business",
    "cost": 15000,
    "program": "united",
    "currency": "miles",
    "estimated_value_cpp": 3.2
  }
]
```

v2 is a separate product surface that requires optimizer integration. See Phase 5 in Section 25.

---

## 24. Monitoring → Repricing Bridge

### Current state: no bridge exists

The monitoring cron detects changes and creates update records. There is no post-detection hook that computes repricing context. The pipeline currently ends at "something changed."

### Required: post-detection repricing analysis

Add a stage between "alert triggered" and "create update record" in the cron:

```python
# After score computation and alert decision...
if alert_triggered:
    # NEW: compute repricing context if applicable
    repricing_ctx = None
    payment_context = baseline.get("payment_context")

    if payment_context and _includes_points_change(selected_itinerary, candidate):
        repricing_ctx = compute_repricing_context(
            baseline_payment_context=payment_context,
            baseline_itinerary=selected_itinerary,
            candidate_itinerary=candidate,
        )

    update_item = {
        ...
        "repricing_context": json.dumps(repricing_ctx) if repricing_ctx else None,
    }
```

### `compute_repricing_context()` implementation outline

```python
def compute_repricing_context(
    baseline_payment_context: dict,
    baseline_itinerary: dict,
    candidate_itinerary: dict,
) -> Optional[dict]:
    """
    Compute repricing context for a detected points drop.

    Returns None if:
    - No payment_context
    - No funding_lock
    - No meaningful points savings after fees
    
    Returns context with actionable=False (not None) if:
    - Booking is not changeable — we still want to show informational alert
    - Fees exceed savings — user should know the drop exists even if not worth acting on
    """
    segments = baseline_payment_context.get("segments", [])
    if not segments:
        return None

    for seg in segments:
        funding_lock = seg.get("funding_lock")
        if not funding_lock:
            continue  # Can't assess without lock

        if not funding_lock.get("irreversible", True):
            continue  # Cash bookings handled differently

        program = funding_lock["program"]
        currency = funding_lock["currency"]

        # Validate invariant: fail-closed per subscription (see Section 21)
        valid, reason = validate_funding_lock_invariant(funding_lock, program)
        if not valid:
            logger.error(f"monitoring.repricing_invariant_violation reason={reason}")
            return None  # Skip repricing, don't crash

        # Compute freed balance
        baseline_points = seg.get("amount", 0)
        candidate_points = candidate_itinerary.get("points_cost", 0)
        freed = baseline_points - candidate_points

        if freed <= 0:
            continue  # No savings

        # Feasibility check
        is_changeable = seg.get("is_changeable", False)
        changeable_source = seg.get("is_changeable_source", "unknown")
        change_fee = seg.get("change_fee", 0)
        redeposit_fee = seg.get("redeposit_fee", 0)
        total_fees = change_fee + redeposit_fee

        # Use program-specific CPP for fee comparison
        cpp = get_estimated_cpp(program)
        estimated_savings_dollars = freed * cpp
        fees_exceed = total_fees >= estimated_savings_dollars

        # Build caveats (always present)
        caveats = [
            "Change policies vary. Verify with the airline that your ticket is changeable.",
            "Award availability changes frequently. Verify the lower price is still available.",
        ]
        if not is_changeable:
            caveats.insert(0, "Based on typical program rules, this ticket may not be changeable.")
        if fees_exceed:
            caveats.insert(0, f"Change fees (~${total_fees}) may offset the savings (~${estimated_savings_dollars:.0f} at {cpp} cpp).")

        actionable = is_changeable and not fees_exceed

        return {
            "freed_balance": {
                "program": program,
                "currency": currency,
                "amount": freed,
                "funding_lock_source_type": funding_lock.get("source_type"),
                "bank_origin_informational": funding_lock.get("bank_origin"),
            },
            "feasibility": {
                "is_changeable": is_changeable,
                "is_changeable_source": changeable_source,
                "change_fee_dollars": change_fee,
                "redeposit_fee_dollars": redeposit_fee,
                "net_savings_after_fees": freed if actionable else 0,
                "estimated_cpp_used": cpp,
                "actionable": actionable,
                "caveats": caveats,
            },
            "reuse_suggestions": None,  # v1: not implemented (see Phase 5)
        }

    return None  # No repricing applicable
```

### Frontend rendering of repricing context

The update click-through page (`/solo/updates/[update_id]`) should render repricing context when present:

**If actionable:**
> **20,000 United miles freed**
> The award price for your SFO → NRT flight dropped from 80,000 to 60,000 United miles. If you rebook at the lower price, you'd free up 20,000 United miles. No change fees apply.
>
> [Check current United award prices →]

**If not actionable (non-changeable):**
> **Award price dropped**
> United is showing this route at 60,000 miles (down from 80,000), but your ticket may not be changeable. Contact United to check your options.

**If fees eat savings:**
> **Award price dropped, but fees may offset savings**
> The award price dropped by 20,000 miles, but the $150 change fee may offset the savings (~$200 at 1 cpp). Consider whether it's worth it.

---

## 25. Implementation Sequence

### Phase 1: Foundation (unblocks everything)

| Step | What | Files | Blocks |
|---|---|---|---|
| 1a | Switch all monitoring IDs to full `uuid4().hex` (32 hex) | `backend/src/domain/monitoring/repo.py` | Security baseline |
| 1b | Implement `stable_itinerary_signature()` and update fingerprinting | `backend/src/domain/monitoring/utils.py` | Accurate dedup + cooldown |
| 1c | Implement search integration in cron | `backend/src/routes/monitoring.py` | Everything |
| 1d | Build `generate_delta_bullets()` | `backend/src/domain/monitoring/utils.py` | Alert emails |
| 1e | Build route equivalence matcher | `backend/src/optimization/` (new module) | Accurate candidate matching |
| 1f | Add `lock_expires_at` to lock items + condition check | `backend/src/domain/monitoring/repo.py` | Operational safety |
| 1g | Fix "Manage alerts" link in emails (redirect to `/settings` or remove) | `backend/src/domain/monitoring/alerts.py` | Trust |
| 1h | Rate-limit backend update fetch endpoint + add `no-store` / `noindex` headers | `backend/src/routes/monitoring.py` | Security |

**After Phase 1**: Monitoring works end-to-end for cash price drops. Alerts are sent. Users see comparison pages. Fingerprinting is stable across flight renumbers. Update endpoints are hardened.

### Phase 2: Funding Provenance (unblocks repricing)

| Step | What | Files | Blocks |
|---|---|---|---|
| 2a | Add `payment_context` to `BaselinePayload` schema | `backend/src/domain/monitoring/models.py` | Repricing |
| 2b | Capture `payment_context` from booking page at opt-in | `frontend/src/app/(app)/solo/booking/page.tsx` | Repricing |
| 2c | Bump baseline `schema_version` to 2 | `backend/src/routes/monitoring.py` | — |
| 2d | Add `is_changeable`, `change_fee` data sourcing | Backend: booking instructions / card benefits | Feasibility gate |

**After Phase 2**: Baselines contain how the booking was paid. System can assess feasibility.

### Phase 3: Points Drop Correctness (unblocks trust)

| Step | What | Files | Blocks |
|---|---|---|---|
| 3a | Implement `is_points_drop_actionable()` feasibility gate | `backend/src/domain/monitoring/utils.py` | Accurate points alerts |
| 3b | Gate `points_improvement` scoring on feasibility | `backend/src/domain/monitoring/utils.py` | — |
| 3c | Add caveats to non-actionable points deltas | `backend/src/domain/monitoring/utils.py` | Trust |

**After Phase 3**: Points drop alerts are only sent when actionable. Non-actionable drops get informational caveats.

### Phase 4: Award Repricing v1 (the payoff)

| Step | What | Files | Blocks |
|---|---|---|---|
| 4a | Implement `funding_lock` invariant + `validate_funding_lock_invariant()` guard | New: `backend/src/domain/monitoring/repricing.py` | Safety |
| 4b | Implement `compute_repricing_context()` with per-program CPP + `reason_codes` | Same file | Core logic |
| 4c | Wire post-detection hook into cron (fail-closed per sub) | `backend/src/routes/monitoring.py` | — |
| 4d | Add `repricing_context` to update record schema | `backend/src/domain/monitoring/models.py` | — |
| 4e | Render repricing context + mandatory caveats on update page | `frontend/src/app/(app)/solo/updates/[update_id]/page.tsx` | User-facing |

**After Phase 4**: Users see "20,000 United miles freed" with program-correct language, feasibility status, fee context, and honest caveats about changeability and inventory persistence.

### Phase 5: Reuse Suggestions (v2 — future)

| Step | What | Files |
|---|---|---|
| 5a | Query optimizer for "what can X miles buy in this program?" | Integration with existing optimizer |
| 5b | Rank reuse options by estimated CPP value | New ranking logic |
| 5c | Populate `reuse_suggestions` in `repricing_context` | `backend/src/domain/monitoring/repricing.py` |
| 5d | Render ranked suggestions on update page | Frontend |

**After Phase 5**: Users see ranked suggestions like "Upgrade to Polaris business for 15,000 United miles" alongside freed balance. This is the full repricing + reuse experience.

### Phase 6: Operational hardening (ongoing)

| Step | What |
|---|---|
| 6a | Migrate `change_score` from String to Number in DynamoDB |
| 6b | Make cron search calls async-native (see Section 6) |

> **Note:** Several items originally planned for Phase 6 have been promoted to Phase 1 as pre-implementation decisions: stable itinerary signature (1b), lock TTL (1f), email footer link fix (1g), and update endpoint rate limiting (1h). These are now prerequisites, not polish.

---

## 26. Security & Threat Model

### Capability-based access to update pages

Update records are accessed via `GET /solo/api/monitoring/updates/{update_id}` with **no authentication required**. The `update_id` is a capability token — anyone who has the URL can view the update.

This is by design: update links are emailed to users who may not be logged in. But it creates a threat surface.

### Entropy analysis

| Component | Format | Entropy |
|---|---|---|
| `update_id` | `mupd_` + full `uuid4().hex` (32 hex chars) | 122 bits of randomness |

**Decision (implemented):** All monitoring IDs (`mupd_`, `msub_`, `mbl_`) now use the full 32 hex chars of `uuid4().hex` instead of truncating to 12. This gives 122 bits of entropy — brute-force is not a realistic concern. The `mupd_` prefix is 5 chars, so a full ID is 37 chars (e.g., `mupd_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`). All read paths treat IDs as opaque strings with no length assumptions.

> **Migration note:** Any existing records with 12-hex IDs continue to work — the fetch endpoint does a table lookup by exact PK match, not a parse. Old links are not broken.

### Threat: someone forwards the alert email

If a user forwards their alert email to a third party, that person can:

**View:**
- Carrier name, cash price, points cost, number of stops
- Baseline vs. candidate comparison
- Detection timestamp
- Trip ID (opaque string, not human-readable)

**Cannot view:**
- User email (never in response)
- User ID (never in response)
- Subscription ID (never in response)
- Passenger names (not stored in update records)
- Exact travel dates (only if present in itinerary snapshot segments)
- Full booking details or PNR

**Risk assessment:** Low-medium. The data revealed is comparable to what flight deal newsletters publish publicly. The main sensitivity is that it confirms *someone* is traveling on *roughly this route around this time*. For most users this is not a concern. For high-profile users it could be.

**Mitigation (not yet implemented):**
- Consider redacting segment departure dates from `baseline_summary` and `new_candidate_summary` in the public API response, showing only relative timing ("same-day flight" instead of "March 15, 2026")
- Add an optional "require login to view" mode for authenticated users who want tighter access control
- Set update page `X-Robots-Tag: noindex` header (prevent search engine indexing of update URLs)

### Threat: scraping update pages

An attacker could enumerate `update_id` values to scrape trip data at scale.

**Current mitigation:** None. The endpoint has no rate limiting.

**Required mitigation:**
1. **Rate limit the backend API endpoint** (`GET /solo/api/monitoring/updates/{update_id}`) — e.g., 30 requests/minute per IP. Use the existing rate-limit infrastructure (`tripy-rate-limit-counters` table) with key `update_fetch:ip:<hashed_ip>`. **Important:** the rate limit must be on the *backend API*, not only the Next.js page route — the API is the data source and can be called directly, bypassing the frontend.
2. **Add `Cache-Control: private, no-store`** and **`X-Robots-Tag: noindex`** to the backend API response headers (prevent CDN/proxy caching and search engine indexing of user trip data).
3. **Monitor for scraping patterns** — high volume from a single IP or IP range hitting sequential-ish update IDs.

### Threat: email enumeration via monitoring start

The `POST /solo/trips/{trip_id}/monitoring/start` endpoint accepts an email and sends a verification email. An attacker could use this to:
- Confirm whether an email address is associated with a Tripy account (by observing different behavior for known vs. unknown emails)
- Spam arbitrary email addresses with verification emails

**Current mitigation:**
- Per-IP rate limit: 10 starts/hour
- Per-trip rate limit: 10 starts/day
- Per-email resend limit: 3/day

**Assessment:** The rate limits are reasonable. The endpoint does not reveal whether an email is registered (it sends verification regardless). The main risk is low-volume targeted enumeration, which the rate limits adequately constrain.

### Threat: cron endpoint exposed

The `POST /solo/internal/monitoring-check` endpoint triggers the monitoring job. It's protected by the `X-Cron-Secret` header.

**Current mitigation:** Secret validation via `_validate_cron_secret()`.

**Recommendation:** Ensure the cron secret is:
- At least 32 bytes of entropy (64 hex chars)
- Different from `MONITORING_TOKEN_SECRET` (JWT signing)
- Rotatable without downtime (support checking against both old and new secret during rotation window)

### Privacy: data retention

| Data | Retention | Mechanism |
|---|---|---|
| Update records | 90 days + 30 days grace | DynamoDB TTL auto-delete |
| Baselines | Indefinite (tied to subscription lifetime) | No TTL — should add one |
| Subscriptions | Indefinite | No TTL — should add one for cancelled/expired |
| Rate limit counters | Window-based (1 hour or 1 day) | DynamoDB TTL auto-delete |

**Recommendation:** Add TTL to baselines (delete 30 days after subscription expires/cancels) and to terminal-state subscriptions (delete 90 days after cancellation/expiry). This limits data exposure from a breach and complies with data minimization principles.

### Summary of required security work

| Priority | Item | Effort |
|---|---|---|
| **High** | Rate limit the public update endpoint | Low — reuse existing rate-limit infra |
| **High** | Add `Cache-Control: private, no-store` to update responses | Trivial |
| **Medium** | Add `X-Robots-Tag: noindex` to update pages | Trivial |
| **Medium** | Add TTL to baselines and terminal subscriptions | Low |
| **Medium** | Increase `update_id` entropy (full uuid4 hex) | Low |
| **Low** | Optional "require login to view" for update pages | Medium |
| **Low** | Redact exact dates from public update response | Low |
