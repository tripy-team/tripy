# Price Drop Monitoring — Deep Dive

A comprehensive technical walkthrough of the price drop monitoring feature as it exists in the codebase today: architecture, data flow, what works, what's stubbed, and what's needed to complete it.

---

## Table of Contents

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
18. [Critical Gap: Search Integration](#18-critical-gap-search-integration)
19. [Reallocation: Current State & Design Considerations](#19-reallocation-current-state--design-considerations)

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
| `subscription_id` | String (PK) | `msub_<12-hex>` for subscriptions, `lock#<trip_email_key>` for locks |
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

### 3b. `tripy-monitoring-baselines`

**Primary Key:** `baseline_id` (String, format: `mbl_<12-hex>`)

| Field | Type | Description |
|---|---|---|
| `baseline_id` | String (PK) | |
| `schema_version` | Number | |
| `captured_at` | String (ISO) | When the baseline was captured |
| `selected_itinerary` | Map/String | The itinerary snapshot at opt-in time |
| `alternatives` | List | Alternative itineraries at opt-in (may be empty) |
| `query_inputs` | Map | Original search query inputs (for re-running searches) |

### 3c. `tripy-monitoring-updates`

**Primary Key:** `update_id` (String, format: `mupd_<12-hex>`)

TTL attribute: `ttl` (epoch seconds, expires `UPDATE_EXPIRY_DAYS + UPDATE_TTL_GRACE_DAYS` = 120 days after creation)

| Field | Type | Description |
|---|---|---|
| `update_id` | String (PK) | Also acts as a capability token (UUID = auth) |
| `subscription_id` | String | FK to the subscription |
| `trip_id` | String | |
| `schema_version` | Number | |
| `detected_at` | String (ISO) | |
| `change_score` | String (numeric) | 0.0–1.0+ composite score |
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
| **"Manage all alerts" page** | Not built | `/solo/monitoring/preferences` referenced in emails but doesn't exist |
| **Global unsubscribe (all trips)** | Partial | Per-trip works; "all" scope falls back to per-trip |
| **Settings page toggle backend integration** | Not wired | UI toggle exists but doesn't persist to server |
| **Reallocation logic** | Not implemented | No automatic action when price drop detected |

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

---

## 19. Reallocation: Current State & Design Considerations

### Current state: Not implemented

There is **no reallocation logic** anywhere in the codebase. The monitoring feature, when completed, will only **notify** the user of changes — it won't take any automatic action.

### What "reallocation" means in context

When a user books a flight using transferred points:
1. User has 100,000 Chase UR points
2. They transfer 80,000 Chase UR → 80,000 United miles (one-way, irreversible)
3. They book a flight for 80,000 United miles
4. Price drops to 60,000 United miles

The 20,000 freed-up points are **United miles**, not Chase UR points. The Chase points are gone. Any reallocation logic must operate on the **destination program** (where the transfer landed), not the **source program** (the credit card).

### Design considerations for future reallocation

The `FundingSource` model (`backend/src/optimization/models_v3.py`) already tracks the distinction:
- `native_{owner}_{program}` — direct program balance (e.g., United miles the user already had)
- `transfer_{owner}_{bank}_{program}` — points that were transferred from a bank (e.g., Chase → United)

If reallocation were to be built, it would need to:
1. Track which funding source was used for the original booking
2. When a price drop is detected, calculate the freed-up balance **in the destination program**
3. Determine what the freed-up points could be used for (another segment, a different trip, etc.)
4. Present options to the user (never auto-rebook without consent)

This is a complex feature that would touch the optimization engine, booking state, and user notification systems.
