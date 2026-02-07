# Monitoring Feature — Setup Guide

Everything code-side is already implemented. This guide covers the **manual steps you need to do** to get the monitoring feature running locally and in production.

---

## Prerequisites

You already have these (verified from your `.env`):
- `CRON_SECRET` — reused as the default for monitoring cron auth
- `SES_SENDER_EMAIL` — reused for verification and alert emails
- `FRONTEND_URL` — reused for email links and render checks
- All Python dependencies are already in `requirements.txt` (PyJWT, httpx, pydantic, boto3)

---

## Step 1: Deploy the DynamoDB Tables

The CDK stack (`infra/lib/dbStack.ts`) already has the 4 new tables defined. You just need to deploy.

```bash
cd infra
npm install        # if you haven't recently
npx cdk diff       # preview what will be created
npx cdk deploy     # deploy the tables
```

This creates:
| Table | Purpose |
|---|---|
| `tripy-monitoring-subscriptions` | Subscriptions + lock items (4 GSIs) |
| `tripy-monitoring-baselines` | Baseline snapshots at opt-in time |
| `tripy-monitoring-updates` | Stored change records for click-through (TTL enabled) |
| `tripy-rate-limit-counters` | Rate limit counters (TTL enabled) |

All tables use **pay-per-request** billing, so there's no cost until you start writing data.

### If you prefer to skip CDK and create tables manually:

Go to AWS Console > DynamoDB and create each table with the keys/GSIs listed in `infra/lib/dbStack.ts` lines 98-167. The critical details:
- `tripy-monitoring-subscriptions`: PK = `subscription_id` (String), plus 4 GSIs (`trip-email-index`, `trip-index`, `user-index`, `due-index`)
- `tripy-monitoring-baselines`: PK = `baseline_id` (String)
- `tripy-monitoring-updates`: PK = `update_id` (String), TTL attribute = `ttl`, plus 1 GSI (`sub-index`)
- `tripy-rate-limit-counters`: PK = `pk` (String), TTL attribute = `ttl`

---

## Step 2: Add Environment Variables

### Backend (`backend/.env`)

Add these lines to your existing `.env` file. Most have safe defaults that fall back to your existing config, but it's good to be explicit:

```env
# Monitoring Feature
# Kill switch: keep false until update pages render correctly in staging
MONITORING_ALERTS_ENABLED=false

# Paid tier: keep false (free email monitoring only for Phase 1-3)
MONITORING_PAID_ENABLED=false

# Table names (match what CDK deployed)
MONITORING_TABLE_SUBSCRIPTIONS=tripy-monitoring-subscriptions
MONITORING_TABLE_BASELINES=tripy-monitoring-baselines
MONITORING_TABLE_UPDATES=tripy-monitoring-updates
RATE_LIMIT_TABLE=tripy-rate-limit-counters
```

**You do NOT need to set** `MONITORING_CRON_SECRET` or `MONITORING_TOKEN_SECRET` — they automatically fall back to your existing `CRON_SECRET`. Override them in production if you want separate secrets.

### Frontend (`frontend/.env.local`)

No changes required. The default is `NEXT_PUBLIC_MONITORING_PAID=false` (paid UI hidden). The monitoring feature works with your existing `NEXT_PUBLIC_BACKEND_URL`.

---

## Step 3: Start Backend + Frontend

No new install steps. Just start normally:

```bash
# Backend
cd backend
pip install -r requirements.txt   # only if you haven't recently
uvicorn src.app:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm run dev
```

The monitoring router registers automatically when the backend starts. Check the startup logs for:
```
[MONITORING CONFIG] alerts_enabled=False, paid_enabled=False, ...
```

---

## Step 4: Test the Flow Locally

### 4a. Create a trip and get to the booking page

1. Go to `http://localhost:3000` and create a solo trip
2. Run through optimization
3. Navigate to the booking page (`/solo/booking?trip_id=...`)

### 4b. Test the monitoring opt-in

1. Click "Yes, I booked"
2. You should see the monitoring offer card saying "Want us to keep watching this trip?" (free, not $7)
3. Click "Watch this trip" — the email input appears
4. Enter an email and click "Start watching"
5. If unauthenticated: you should see "Check your inbox to confirm" (pending verification)
6. If authenticated: you should see "We're watching this trip for you" (immediately active)

### 4c. Test the verification email (if SES is configured)

Check the email inbox for a "Verify your Tripy monitoring alerts" email. Click the link. You should be redirected back to the booking page with `?monitoring=activated`.

> **Tip**: If SES isn't sending locally, check the backend logs for `Verification URL: ...` and open it manually.

### 4d. Test the cron endpoint

```bash
curl -X POST http://localhost:8000/solo/internal/monitoring-check \
  -H "X-Cron-Secret: YOUR_CRON_SECRET_HERE" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "ok": true,
  "checked": 0,
  "updates_created": 0,
  "alerts_sent": 0,
  "alerts_skipped": 0,
  ...
}
```

### 4e. Test the update click-through page

Once a cron run creates an update record (it won't yet — search is stubbed), you can test the page at:
```
http://localhost:3000/solo/updates/{update_id}
```

---

## Step 5: Production Deployment Checklist

When you're ready to go live:

### 5a. Deploy tables
```bash
cd infra && npx cdk deploy
```

### 5b. Set env vars in your production environment

Wherever your backend env is configured (App Runner, ECS, Lambda, etc.):

```env
MONITORING_ALERTS_ENABLED=false   # keep off initially
MONITORING_PAID_ENABLED=false
MONITORING_TABLE_SUBSCRIPTIONS=tripy-monitoring-subscriptions
MONITORING_TABLE_BASELINES=tripy-monitoring-baselines
MONITORING_TABLE_UPDATES=tripy-monitoring-updates
RATE_LIMIT_TABLE=tripy-rate-limit-counters
```

Optionally override the secrets (recommended for production):
```env
MONITORING_CRON_SECRET=<generate a random 64-char hex>
MONITORING_TOKEN_SECRET=<generate a different random 64-char hex>
```

Generate secrets with:
```bash
openssl rand -hex 32
```

### 5c. Set up the cron trigger

The cron endpoint is `POST /solo/internal/monitoring-check` with the `X-Cron-Secret` header.

**Option A: EventBridge Scheduler (recommended)**
1. AWS Console > EventBridge > Schedules
2. Create a schedule: `rate(6 hours)` (or `rate(2 hours)` if you later enable paid tier)
3. Target: HTTP invoke your backend URL
4. Headers: `X-Cron-Secret: <your secret>`, `Content-Type: application/json`

**Option B: CloudWatch Events + Lambda**
Create a small Lambda that POSTs to your backend's cron endpoint on a schedule.

**Option C: External cron (e.g., cron-job.org, Railway cron)**
```
POST https://your-backend-url/solo/internal/monitoring-check
Header: X-Cron-Secret: <your secret>
Schedule: every 6 hours
```

### 5d. Enable alert emails (the "go live" moment)

This is the trust-critical step. Do it in this exact order:

1. **Trigger the cron manually** and verify it creates `monitoring_updates` records with `email_status=skipped_alerts_disabled`
2. **Open an update page** in production (`/solo/updates/{update_id}`) and confirm it renders the comparison data correctly
3. **Flip the switch**:
   ```env
   MONITORING_ALERTS_ENABLED=true
   ```
4. **Trigger cron again** and confirm `email_status=sent` appears on new updates
5. **Monitor** the render check fail rate. If it starts failing, flip `MONITORING_ALERTS_ENABLED=false` immediately

---

## What's NOT Yet Implemented (Future Work)

These are stubbed or deferred — the feature works without them:

| Item | Status | Notes |
|---|---|---|
| **Real flight search in cron** | Stubbed | `process_one()` in the cron uses the baseline as the "candidate" (no change detected). Wire in your search pipeline when ready. |
| **Delta bullet generation** | Stubbed | The `deltas.bullets` array is empty in cron-created records. Build a `generate_delta_bullets()` function from the scoring output. |
| **Paid tier (Stripe)** | Gated off | `MONITORING_PAID_ENABLED=false` hides all paid UI and rejects paid-tier API calls. |
| **"Manage all alerts" page** | Not built | The `/solo/monitoring/preferences` route is referenced in email footers but doesn't exist yet. |
| **Global unsubscribe** | Partial | Per-trip unsubscribe works. "Unsubscribe from all" cancels the specific subscription as a fallback (no email-only GSI). |

---

## File Map (What Was Created)

```
backend/
  src/
    config/
      monitoring.py           # Env vars, feature flags, constants
    domain/
      monitoring/
        __init__.py
        models.py             # Pydantic request/response models
        utils.py              # Scoring, fingerprinting, email masking, IP hashing
        repo.py               # DynamoDB operations (TransactWriteItems, rate limits)
        tokens.py             # JWT verification + unsubscribe tokens
        alerts.py             # Kill-switch-gated email sender
    routes/
      monitoring.py           # All 8 API endpoints + cron + replay

frontend/
  src/
    app/
      (app)/solo/
        updates/[update_id]/
          page.tsx            # Update click-through page
        booking/
          page.tsx            # (modified) Fixed state machine + free monitoring flow
      api/monitoring/verify/
        route.ts              # Next.js proxy for verification magic links
    lib/
      api.ts                  # (modified) Added solo.startMonitoring/getMonitoringStatus/stopMonitoring

infra/
  lib/
    dbStack.ts                # (modified) Added 4 DynamoDB tables with GSIs
```
