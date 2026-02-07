# Tripy Completion Features — Deployment Guide

Everything you need to do to take the Phases 11–16 features live.

**Time estimate:** ~30 minutes for Steps 1–4 (core). Step 5 is optional / future.

---

## Table of Contents

1. [Generate a share token secret](#step-1--generate-a-share-token-secret)
2. [Set up AWS SES for email delivery](#step-2--set-up-aws-ses-for-email-delivery)
3. [Enable DynamoDB TTL on anonymous data](#step-3--enable-dynamodb-ttl-on-anonymous-data)
4. [Deploy](#step-4--deploy)
5. [Wire remaining email triggers (optional / future)](#step-5--wire-remaining-email-triggers)
6. [Verify everything works](#step-6--verify-everything-works)

---

## Step 1 — Generate a share token secret

The magic link system uses HMAC-signed tokens. You need a strong secret for production.

### Generate the secret

```bash
openssl rand -hex 32
```

Copy the output. You'll use it in the next steps.

### Add to AWS Secrets Manager

Your production backend reads secrets from `tripy/production/api-keys` in Secrets Manager (configured in `apprunner.yaml`).

```bash
# Fetch current secret value
aws secretsmanager get-secret-value \
  --secret-id tripy/production/api-keys \
  --region us-east-1 \
  --query SecretString --output text > /tmp/tripy-secrets.json

# Edit /tmp/tripy-secrets.json and add:
#   "SHARE_TOKEN_SECRET": "<your generated hex string>"

# Update the secret
aws secretsmanager update-secret \
  --secret-id tripy/production/api-keys \
  --region us-east-1 \
  --secret-string file:///tmp/tripy-secrets.json

# Clean up
rm /tmp/tripy-secrets.json
```

### Add to local `.env` (for dev)

Open your `.env` file and add:

```
SHARE_TOKEN_SECRET=dev-only-not-for-production
```

The default fallback (`tripy-share-secret-dev`) works for local development, but it's better to set this explicitly so you don't forget.

---

## Step 2 — Set up AWS SES for email delivery

Without SES configured, the share/email flow still works — it just logs the magic link URL to the console instead of sending an email. This step makes email delivery real.

### 2a. Verify your sender identity

You need to verify either the email address or the entire domain in SES.

**Option A — Verify the domain (recommended):**

```bash
aws ses verify-domain-identity \
  --domain traveltripy.com \
  --region us-east-1
```

This returns a TXT record. Add it to your DNS (wherever `traveltripy.com` is managed — Route 53, Cloudflare, etc.):

| Type | Name | Value |
|------|------|-------|
| TXT  | `_amazonses.traveltripy.com` | *(the token SES gives you)* |

**Option B — Verify a single address:**

```bash
aws ses verify-email-identity \
  --email-address support@traveltripy.com \
  --region us-east-1
```

Check the inbox for a verification link and click it.

### 2b. Request production access (if still in sandbox)

By default, SES is in sandbox mode — you can only send to verified addresses. To send to real users:

1. Go to **AWS Console → SES → Account dashboard**
2. Click **Request production access**
3. Fill in: use case = transactional email, expected volume = low (< 1000/day), no marketing
4. AWS typically approves in 24 hours

### 2c. Add SES env vars to Secrets Manager

Add these to your `tripy/production/api-keys` secret (same process as Step 1):

```json
{
  "SES_SENDER_EMAIL": "support@traveltripy.com",
  "FRONTEND_URL": "https://traveltripy.com"
}
```

### 2d. Add to local `.env` (for dev)

```
SES_SENDER_EMAIL=
FRONTEND_URL=http://localhost:3000
```

Leave `SES_SENDER_EMAIL` empty for local dev — the code gracefully skips email sending and logs the share URL instead. Set `FRONTEND_URL` to your local frontend so magic links point to the right place during development.

---

## Step 3 — Enable DynamoDB TTL on anonymous data

The code already writes a `ttl` attribute (Unix epoch timestamp, 30 days from creation) on anonymous trip and points records. But DynamoDB won't delete them unless you enable TTL on the tables.

### Enable TTL on tripy-trips

```bash
aws dynamodb update-time-to-live \
  --table-name tripy-trips \
  --time-to-live-specification "Enabled=true, AttributeName=ttl" \
  --region us-east-1
```

### Enable TTL on tripy-points

```bash
aws dynamodb update-time-to-live \
  --table-name tripy-points \
  --time-to-live-specification "Enabled=true, AttributeName=ttl" \
  --region us-east-1
```

### Verify

```bash
aws dynamodb describe-time-to-live \
  --table-name tripy-trips \
  --region us-east-1

aws dynamodb describe-time-to-live \
  --table-name tripy-points \
  --region us-east-1
```

Both should show `TimeToLiveStatus: ENABLED` with `AttributeName: ttl`.

**Note:** DynamoDB TTL deletions are not instant — items are typically removed within 48 hours of expiration. This is fine for cleanup purposes.

---

## Step 4 — Deploy

### Backend (App Runner)

No new dependencies. The existing `requirements.txt` already includes `boto3`.

Your App Runner service auto-deploys from the repo. If not, trigger a manual deployment:

```bash
aws apprunner start-deployment \
  --service-arn <your-app-runner-service-arn> \
  --region us-east-1
```

The backend will pick up the new secrets from Secrets Manager on startup.

### Frontend (Amplify)

No new npm packages. Standard Next.js build.

Push to your deploy branch and Amplify builds automatically:

```bash
git push origin main
```

Or trigger manually in the Amplify console.

---

## Step 5 — Wire remaining email triggers

Seven email templates exist. Two are already wired. The rest need trigger logic, which you can add whenever you're ready.

| # | Template | When to send | Status | How to wire |
|---|----------|-------------|--------|-------------|
| 1 | `magic_link` | User clicks "Email me this plan" | **Live** | Already wired in `POST /solo/share` |
| 2 | `support_touch` | After a user's first trip | Ready | Call `send_support_touch_email()` — needs a cron/Lambda that finds first-time users |
| 3 | `post_result_followup` | 24–48 hrs after results, user hasn't booked | Ready | Cron/Lambda: query trips with `status != booked` and `created_at` 24–48 hrs ago |
| 4 | `lock_plan_prompt` | User signed in but didn't lock their plan | Ready | Cron/Lambda: query auth users with unlocked trips older than 1 hour |
| 5 | `i_booked_it` | User marks trip as "booked" | Ready | Add `send_i_booked_it_email()` call inside `update_solo_trip_status` when status changes to `booked` (requires user email lookup) |
| 6 | `monitoring_alert` | Price or availability changes on a saved plan | Ready | Requires monitoring infrastructure (future feature) |
| 7 | `gentle_nudge` | Repeat anonymous user with email on file | Ready | Cron/Lambda: query users with 2+ trips who haven't created an account |

**Simplest next step:** Wire template #5 (`i_booked_it`). It's a single function call in an existing endpoint — no cron needed. The others require a scheduled job, which you can add with an EventBridge rule + Lambda, or a simple cron inside the App Runner container.

---

## Step 6 — Verify everything works

Run through this checklist after deploying.

### Public pages

- [ ] Visit `https://traveltripy.com` — CTA goes to `/solo/setup`
- [ ] Visit `/pricing` — renders with nav + footer
- [ ] Visit `/faq` — accordion works, links to `/privacy` and `/contact`
- [ ] Visit `/privacy` — shows full privacy policy, contact email is `support@traveltripy.com`
- [ ] Visit `/terms` — shows full terms of service
- [ ] Visit `/contact` — shows contact info
- [ ] Footer on every page links to: Pricing, FAQ, Terms, Privacy, Contact

### Trip flow (anonymous)

- [ ] Go to `/solo/setup` without signing in — can fill out trip details
- [ ] Generate a trip — results page loads with itineraries
- [ ] Risk badges appear on itinerary cards ("Protected" / "Fragile" / "Risky")
- [ ] Evidence chips appear below the decision header
- [ ] Booking checklist renders in the sidebar with copy buttons
- [ ] Click "I Booked It" — button changes state, localStorage persists on refresh
- [ ] Sign-in prompt appears after clicking "I Booked It" as anon

### Cache

- [ ] Reload the results page — loads faster (cache hit), no re-optimization
- [ ] "Last checked" and "Expires" timestamps visible

### Email / Magic link

- [ ] Click "Email me this plan" — enter an email address
- [ ] Email arrives with magic link (if SES configured)
- [ ] Open magic link in a different browser — results load read-only
- [ ] Sign in on the magic link page — "Claim this plan" option appears

### Security

- [ ] Rapidly hit `/solo/optimize` 31+ times in 1 minute — should get a `429 Too Many Requests` response
- [ ] Send a garbage `X-Anon-Session-Id` header — backend generates a valid one instead of erroring

### Degradation

- [ ] If your award search provider is down, results still load with cash-only fallback and a disclaimer banner

---

## Quick reference — New environment variables

| Variable | Required | Default | Where to set |
|----------|----------|---------|-------------|
| `SHARE_TOKEN_SECRET` | Yes (production) | `tripy-share-secret-dev` | Secrets Manager |
| `SES_SENDER_EMAIL` | Yes (for email) | `""` (disabled) | Secrets Manager |
| `FRONTEND_URL` | Yes | `https://tripy.app` | Secrets Manager |
| `AWS_REGION` | Already set | `us-east-1` | `apprunner.yaml` |

---

## Quick reference — New DynamoDB attributes

| Table | Attribute | Type | Purpose |
|-------|-----------|------|---------|
| `tripy-trips` | `ttl` | Number (epoch) | Auto-delete anonymous trips after 30 days |
| `tripy-trips` | `isAnonymous` | Boolean | Marks anonymous-origin records |
| `tripy-points` | `ttl` | Number (epoch) | Auto-delete anonymous points after 30 days |

These attributes are written automatically by the backend. You only need to enable TTL on the tables (Step 3).

---

## What's already live (no action needed)

These features work immediately after deploy with no additional configuration:

- Risk badges + evidence chips on all itineraries
- Booking checklist with copy buttons
- "I Booked It" flow (localStorage for anon, backend for auth)
- Cache-first results loading with freshness timestamps
- All public pages (pricing, FAQ, privacy, terms, contact)
- Footer + navigation updates
- Landing page CTAs pointing to `/solo/setup`
- Rate limiting (30 req/min on sensitive endpoints)
- Anonymous session header validation
- Graceful degradation on search provider failures
- Analytics events for all new interactions
