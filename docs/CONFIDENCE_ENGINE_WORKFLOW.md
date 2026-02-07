# Tripy Confidence Engine — Full Workflow Documentation

> **Theme:** Confidence → Speed → Inevitability  
> **Hard rule:** Trip generation is NEVER blocked behind authentication.

This document describes the complete workflow after the Confidence Engine implementation, including the precise connection between every frontend component and backend endpoint.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Identity Model: Authenticated vs Anonymous](#2-identity-model-authenticated-vs-anonymous)
3. [Complete User Flow (Step-by-Step)](#3-complete-user-flow-step-by-step)
4. [Frontend ↔ Backend Contract Map](#4-frontend--backend-contract-map)
5. [Phase 1 — Anonymous Trip Generation](#5-phase-1--anonymous-trip-generation)
6. [Phase 2 — "Confirm My Situation" Onboarding](#6-phase-2--confirm-my-situation-onboarding)
7. [Phase 3 — Decision Confidence Header](#7-phase-3--decision-confidence-header)
8. [Phase 4 — "Why NOT the Other Options"](#8-phase-4--why-not-the-other-options)
9. [Phase 5 — Progressive Disclosure](#9-phase-5--progressive-disclosure)
10. [Phase 6 — "Lock This Plan" Moment](#10-phase-6--lock-this-plan-moment)
11. [Phase 7 — Humanized Explanations](#11-phase-7--humanized-explanations)
12. [Phase 8 — "What Happens Next" Clarity](#12-phase-8--what-happens-next-clarity)
13. [Phase 9 — Delayed Sign-In Strategy](#13-phase-9--delayed-sign-in-strategy)
14. [Phase 10 — Analytics & Confidence Tracking](#14-phase-10--analytics--confidence-tracking)
15. [Data Flow Diagrams](#15-data-flow-diagrams)
16. [File Inventory](#16-file-inventory)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 15)                 │
│                                                         │
│  Layout ─── Auth Gate (public routes bypass) ────────── │
│    │                                                    │
│  /solo/setup ─── ConfirmSituation ─── PointsAllocation  │
│    │                                                    │
│  /solo/results                                          │
│    ├── DecisionHeader (FIRST thing user sees)           │
│    ├── Itinerary Cards                                  │
│    ├── Sidebar (Your Plan + progressive disclosure)     │
│    ├── LockPlanCTA                                      │
│    ├── WhyNotOthers (collapsed)                         │
│    ├── NextSteps                                        │
│    ├── SignInPrompt (modal, only on lock/save/monitor)  │
│    └── Calmness Vote                                    │
│                                                         │
│  API Client (api.ts)                                    │
│    ├── Auth: Bearer token OR X-Anon-Session-Id header   │
│    └── Serialization: snake_case ↔ camelCase            │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP (JSON)
                    │
┌───────────────────▼─────────────────────────────────────┐
│                   BACKEND (FastAPI)                       │
│                                                          │
│  Middleware                                               │
│    ├── CORS (expose X-Anon-Session-Id header)            │
│    └── Anon Session (echo anon ID in response)           │
│                                                          │
│  Auth Layer (jwt_auth.py)                                │
│    ├── get_current_user_id()  — requires JWT             │
│    ├── get_optional_user_id() — JWT or None              │
│    └── get_user_or_anon_id()  — JWT or anon session      │
│                                                          │
│  Solo Routes (/solo/*)                                   │
│    ├── POST /solo/trips           (get_user_or_anon_id)  │
│    ├── POST /solo/trips/:id/points(get_user_or_anon_id)  │
│    ├── POST /solo/optimize        (get_user_or_anon_id)  │
│    │     └── Returns: DecisionSummary + RejectedAlt.     │
│    ├── POST /solo/trips/:id/lock  (get_user_or_anon_id)  │
│    ├── POST /solo/migrate-session (get_current_user_id)  │
│    └── POST /solo/transfer-strategy (get_current_user_id)│
│                                                          │
│  Estimation Routes (app.py)                              │
│    ├── GET  /points/card-presets  (no auth)              │
│    └── POST /points/estimate      (no auth)              │
│                                                          │
│  Database: AWS DynamoDB                                   │
│    ├── TRIPS_TABLE    (createdBy = user_id OR anon_*)    │
│    └── POINTS_TABLE   (userProgram = userId#program)     │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Identity Model: Authenticated vs Anonymous

The system supports two identity types, distinguished by a string prefix:

| Property | Authenticated User | Anonymous Session |
|---|---|---|
| **ID format** | UUID from Cognito `sub` claim (e.g., `a1b2c3d4-e5f6-...`) | `anon_` + UUID v4 (e.g., `anon_a1b2c3d4-e5f6-...`) |
| **Source** | JWT `Authorization: Bearer <token>` header | `X-Anon-Session-Id` HTTP header |
| **Persisted where (frontend)** | `localStorage` + `sessionStorage` (`access_token`, `id_token`, `refresh_token`) | `localStorage` (`tripy_anon_session_id`) |
| **Survives refresh** | Yes (tokens in storage) | Yes (anon ID in localStorage) |
| **Can create trips** | Yes | Yes |
| **Can optimize** | Yes | Yes |
| **Can lock plans** | Yes (immediately) | Prompts sign-in first |
| **Can save/monitor** | Yes | Prompts sign-in first |
| **Data migration** | N/A | `POST /solo/migrate-session` transfers all anon trips to user account |

### How identity is resolved (backend)

```python
# jwt_auth.py — get_user_or_anon_id()
def get_user_or_anon_id(request, credentials):
    # 1. Try JWT token first
    if credentials:
        try:
            user_id = get_current_user_id(credentials)  # Cognito sub
            if user_id:
                return user_id  # e.g., "a1b2c3d4-..."
        except HTTPException:
            pass  # Fall through

    # 2. Check X-Anon-Session-Id header
    anon_session_id = request.headers.get("X-Anon-Session-Id")
    if anon_session_id:
        return anon_session_id  # e.g., "anon_a1b2c3d4-..."

    # 3. Generate fresh anonymous ID
    return f"anon_{uuid.uuid4()}"
```

### How identity is resolved (frontend)

```typescript
// api.ts — apiRequest()
// Inside the header-building logic:
if (token) {
    headers['Authorization'] = `Bearer ${token}`;
} else {
    // No JWT → use anonymous session
    const anonId = getAnonSessionId();  // from localStorage or new UUID
    headers['X-Anon-Session-Id'] = anonId;
}
```

### Helper: `is_anonymous()`

```python
ANON_PREFIX = "anon_"

def is_anonymous(user_or_anon_id: str) -> bool:
    return user_or_anon_id.startswith(ANON_PREFIX)
```

Used in the lock plan endpoint to decide whether to save immediately or prompt sign-in.

---

## 3. Complete User Flow (Step-by-Step)

Below is the full journey of a **new, anonymous user** from landing to plan lock:

```
1. User lands on /solo/setup
   │
   ├── Frontend: AppLayout checks pathname
   │   └── isPublicRoute('/solo/setup') → true → skip auth gate
   │
   ├── Frontend: SoloSetup loads
   │   ├── isAuthenticated() → false → skip profile load
   │   └── User fills in: origin, destination, dates, budget
   │
   ├── User optionally selects cards via ConfirmSituation component
   │   ├── GET /points/card-presets (no auth) → card presets
   │   └── User picks "Amex Gold" + "Chase Sapphire" → estimated balances
   │
2. User clicks "Generate Trip"
   │
   ├── Frontend: handleGenerate()
   │   ├── POST /solo/trips (X-Anon-Session-Id: anon_abc123)
   │   │   └── Backend: creates trip with createdBy = "anon_abc123"
   │   │   └── Returns: { tripId: "trip_xyz" }
   │   │
   │   ├── POST /solo/trips/trip_xyz/points (X-Anon-Session-Id: anon_abc123)
   │   │   └── Backend: stores points with confidence = "estimated"
   │   │
   │   └── router.push('/solo/results?trip_id=trip_xyz')
   │
3. Results page loads (/solo/results?trip_id=trip_xyz)
   │
   ├── Frontend: AppLayout
   │   └── isPublicRoute('/solo/results') → true → skip auth gate
   │
   ├── Frontend: fetchItineraries()
   │   ├── GET /solo/trips/trip_xyz (X-Anon-Session-Id: anon_abc123)
   │   ├── GET /solo/trips/trip_xyz/points (X-Anon-Session-Id: anon_abc123)
   │   └── POST /solo/optimize (X-Anon-Session-Id: anon_abc123)
   │       └── Backend: runs ILP solver → returns:
   │           {
   │             itineraries: [...],
   │             decision_summary: {
   │               headline: "Book this plan — saving you $847 with a direct flight.",
   │               confidence_level: "high",
   │               why_good: [...],
   │               tradeoffs: [...],
   │               risks: [...]
   │             },
   │             rejected_alternatives: [
   │               { label: "Cheapest option", rejection_reason: "..." },
   │               { label: "What Google Flights would show", rejection_reason: "..." }
   │             ]
   │           }
   │
4. User sees results
   │
   ├── DecisionHeader renders FIRST
   │   └── "Book this plan — saving you $847 with a direct flight."
   │   └── [High confidence] badge
   │   └── [Book this plan] CTA button
   │
   ├── Itinerary cards (each with humanized value_label)
   │   └── "Excellent value" instead of "CPP = 1.7"
   │
   ├── Sidebar: "Your Plan"
   │   ├── Route, "What you'll pay", "Points you'll use", "You're saving"
   │   ├── Progressive disclosure: [Show detailed breakdown] toggle
   │   │   └── CPP math, transfer ratios, savings % (hidden by default)
   │   ├── LockPlanCTA: [Lock this plan]
   │   ├── WhyNotOthers: collapsed "Why we didn't pick the other options"
   │   └── NextSteps: "What happens next" (Transfer → Book → Save → Monitor)
   │
5. User clicks "Lock this plan"
   │
   ├── Frontend: handleLockPlan()
   │   ├── trackEvent('lock_plan_clicked')
   │   ├── isAuthenticated() → false
   │   └── setShowSignInPrompt('lock')
   │
   ├── SignInPrompt modal appears:
   │   "Want us to remember this and keep watching for you?"
   │   ├── [Sign in to save] → router.push('/login?redirect=...')
   │   └── [Continue without saving] → dismiss modal
   │
6a. User signs in
   │
   ├── After login, frontend calls:
   │   POST /solo/migrate-session (Authorization: Bearer <jwt>)
   │   Body: { anon_session_id: "anon_abc123" }
   │   └── Backend: updates all trips.createdBy from "anon_abc123" to real user ID
   │   └── Backend: migrates points table entries
   │   └── Returns: { trips_migrated: 1 }
   │
   └── clearAnonSession() removes localStorage key
   │
6b. User continues without saving
   │
   └── Modal dismisses. Trip data stays in anon session.
       User can come back (same browser) and data is still there.
```

---

## 4. Frontend ↔ Backend Contract Map

Every API call between the frontend and backend is documented below.

### Trip Generation Flow (Anonymous-Safe)

| Step | Frontend Call | Backend Endpoint | Auth | Response Key Fields |
|---|---|---|---|---|
| Create trip | `solo.createTrip({...})` | `POST /solo/trips` | `get_user_or_anon_id` | `tripId`, `status: "draft"` |
| Upsert points | `solo.upsertPoints(tripId, [...])` | `POST /solo/trips/:id/points` | `get_user_or_anon_id` | `items[]`, `totalPoints` |
| Optimize | `solo.optimize({tripId, points})` | `POST /solo/optimize` | `get_user_or_anon_id` | `itineraries[]`, `decisionSummary`, `rejectedAlternatives[]` |
| Get trip | `solo.getTrip(tripId)` | `GET /solo/trips/:id` | `get_user_or_anon_id` | Full trip object |
| Get points | `solo.getPoints(tripId)` | `GET /solo/trips/:id/points` | `get_user_or_anon_id` | `items[]`, `totalPoints` |
| Get cache | `solo.getOptimizationCache(tripId)` | `GET /solo/optimization-cache/:id` | `get_user_or_anon_id` | Same as optimize response (cached) |

### Estimation Flow (No Auth Required)

| Step | Frontend Call | Backend Endpoint | Auth | Response Key Fields |
|---|---|---|---|---|
| Get card presets | `fetch('/points/card-presets')` | `GET /points/card-presets` | None | `presets[]` |
| Estimate points | `fetch('/points/estimate')` | `POST /points/estimate` | None | `estimatedPoints[]`, `disclaimer` |

### Lock & Save Flow (Auth-Dependent)

| Step | Frontend Call | Backend Endpoint | Auth | Response Key Fields |
|---|---|---|---|---|
| Lock plan | `solo.lockPlan(tripId, itineraryId, snapshot)` | `POST /solo/trips/:id/lock` | `get_user_or_anon_id` | `locked`, `requiresSignIn`, `message` |
| Select itinerary | `solo.selectItinerary(tripId, {...})` | `POST /solo/trips/:id/select` | `get_user_or_anon_id` | `ok`, `itineraryId` |
| Migrate session | `solo.migrateSession(anonSessionId)` | `POST /solo/migrate-session` | `get_current_user_id` (JWT required) | `tripsMigrated`, `message` |

### Protected Actions (JWT Required)

| Step | Frontend Call | Backend Endpoint | Auth |
|---|---|---|---|
| Transfer strategy | `solo.getTransferStrategy(tripId, itineraryId)` | `POST /solo/transfer-strategy` | `get_current_user_id` |
| Update trip status | — | `POST /solo/trips/:id/status` | `get_current_user_id` |
| Get selection | — | `GET /solo/trips/:id/selection` | `get_current_user_id` |

### Casing Convention

All backend responses use **snake_case**. The frontend `api.ts` uses `toCamelCase()` from `lib/serializers.ts` to convert every response to **camelCase** before returning to components.

| Backend field | Frontend field |
|---|---|
| `decision_summary` | `decisionSummary` |
| `confidence_level` | `confidenceLevel` |
| `why_good` | `whyGood` |
| `rejected_alternatives` | `rejectedAlternatives` |
| `rejection_reason` | `rejectionReason` |
| `price_or_points` | `priceOrPoints` |
| `value_label` | `valueLabel` |
| `is_estimated` | `isEstimated` |
| `best_option` | `bestOption` |
| `oop_metrics` | `oopMetrics` |
| `total_out_of_pocket` | `totalOutOfPocket` |
| `average_cpp` | `averageCpp` |
| `requires_sign_in` | `requiresSignIn` |
| `trips_migrated` | `tripsMigrated` |

---

## 5. Phase 1 — Anonymous Trip Generation

### Problem
Previously, the AppLayout (`frontend/src/app/(app)/layout.tsx`) redirected **all** unauthenticated users to `/login`. This blocked trip generation.

### Solution

**Frontend — Route-Level Auth Gating:**

```
frontend/src/app/(app)/layout.tsx
```

- `PUBLIC_ROUTES = ['/solo/setup', '/solo/results']`
- `isPublicRoute(pathname)` check runs before any auth redirect
- If the route is public, the layout immediately renders children without checking tokens

**Frontend — API Client Fallback:**

```
frontend/src/lib/api.ts
```

- `getAnonSessionId()` generates a UUID v4 prefixed with `anon_` and stores it in `localStorage` under key `tripy_anon_session_id`
- `apiRequest()` modified: when no JWT token is available, instead of throwing `"Authentication required"`, it attaches the `X-Anon-Session-Id` header
- `isAuthenticated()` exported so components can check auth state without side effects

**Backend — Dual-Identity Dependencies:**

```
backend/src/utils/jwt_auth.py
```

- `get_user_or_anon_id(request, credentials)` — new FastAPI dependency
  1. Tries to extract user ID from JWT (via `get_current_user_id`)
  2. Falls back to `X-Anon-Session-Id` header
  3. If neither exists, generates a fresh `anon_` ID
- `is_anonymous(id)` — helper to check if an ID starts with `anon_`

**Backend — Middleware:**

```
backend/src/app.py
```

- `anon_session_middleware` echoes `X-Anon-Session-Id` back in response headers
- CORS `expose_headers` includes `X-Anon-Session-Id` so the browser can read it

**Backend — Route Updates:**

```
backend/src/routes/solo.py
```

Six endpoints changed from `Depends(get_current_user_id)` to `Depends(get_user_or_anon_id)`:
- `POST /solo/trips` (create)
- `GET /solo/trips/:id` (get)
- `GET /solo/trips/:id/points` (get points)
- `POST /solo/trips/:id/points` (upsert points)
- `POST /solo/optimize` (optimize)
- `GET /solo/optimization-cache/:id` (cache)

---

## 6. Phase 2 — "Confirm My Situation" Onboarding

### Problem
The old flow required users to manually add each credit card program and enter exact point balances before generating a trip. This was high-friction for new users.

### Solution

**Backend — Card Presets & Estimation:**

```
backend/src/app.py
```

- `COMMON_CARD_PRESETS` — 7 pre-configured cards (Amex Gold, Amex Platinum, Chase Sapphire Preferred, Chase Sapphire Reserve, Capital One Venture X, Citi Premier, Bilt Mastercard) with conservative default balances
- `GET /points/card-presets` — returns presets (no auth)
- `POST /points/estimate` — accepts `card_ids[]`, returns estimated balances with `confidence: "estimated"` and `owner_type: "anon"`

**Backend — Points Model Update:**

```
backend/src/schemas/points.py
```

`PointsBalance` now includes:
- `owner_type: Optional[Literal["user", "anon"]]` — defaults to `"user"`
- `confidence: Optional[Literal["exact", "estimated", "unknown"]]` — defaults to `"exact"`

These fields flow through the entire system. The optimizer sees them but currently treats all balances equally (conservative estimation is handled by the default balances being intentionally low).

**Frontend — ConfirmSituation Component:**

```
frontend/src/components/ConfirmSituation.tsx
```

Three modes:
1. **Confirm** (has existing cards) — shows existing cards with "Looks right" / "Edit" / "Estimate for me"
2. **Select** (new user) — grid of card presets with checkboxes, then same three actions
3. **Edit** — inline editable fields for each card balance

The component:
- Loads presets from `GET /points/card-presets` on mount (with hardcoded fallback)
- Calls `onConfirm(cards)` with the finalized card list, each tagged with `confidence`
- Cards styled with brand colors (Amex blue, Chase indigo, Capital One red, etc.)

---

## 7. Phase 3 — Decision Confidence Header

This is the **most important** change. The user sees a confident verdict before any numbers.

### Backend — DecisionSummary Schema

```
backend/src/schemas/optimize.py
```

```python
class DecisionSummary(BaseModel):
    headline: str                                    # "Book this plan — saving you $847..."
    confidence_level: Literal["high", "medium", "low"]
    why_good: List[str]                              # Bullet points
    tradeoffs: List[str]                             # Honest downsides
    risks: List[str]                                 # What could go wrong
    is_estimated: bool = False                       # Estimated balances flag
```

Added to both `RankedItinerary` (per-itinerary) and `OptimizeSoloResponse` (top-level).

### Backend — Generation Logic

```
backend/src/routes/solo.py — _generate_decision_summary()
```

**Headline construction:**
- If `cash_saved > $100`: `"Book this plan — saving you $X"`
- If direct flight available: appends `"with a direct flight"`
- Fallback: `"This is your best option — {humanized_savings} vs paying cash."`

**Confidence level:**
- `high`: CPP >= 1.0 AND savings >= 10%, and balances are exact
- `medium`: CPP >= 0.8, OR balances are estimated
- `low`: CPP < 0.8

**Why Good bullets** (generated from metrics):
- Savings percentage
- CPP value quality (humanized)
- Direct flight presence
- Low out-of-pocket amount

**Tradeoffs** (honest):
- Number of point transfers required
- Connection stops

**Risks:**
- Award availability volatility
- Estimated balance disclaimer
- Short connection warnings

### Frontend — DecisionHeader Component

```
frontend/src/components/DecisionHeader.tsx
```

Renders at the **top** of the results page, before any itinerary cards:
- Large headline (text-2xl/3xl)
- Confidence badge (emerald/amber/red based on level)
- "Book this plan" primary CTA
- Expandable details section (three columns: Why Good / Tradeoffs / Risks)

**Integration in results page:**

```tsx
// frontend/src/app/(app)/solo/results/page.tsx
{usingSoloOptimizer && optimizeResponse?.decisionSummary && (
    <DecisionHeader
        summary={optimizeResponse.decisionSummary}
        onBookPlan={handleLockPlan}
    />
)}
```

The `decisionSummary` arrives from the backend `OptimizeSoloResponse`, auto-converted from `decision_summary` by the `toCamelCase` serializer.

---

## 8. Phase 4 — "Why NOT the Other Options"

### Backend — RejectedAlternative Schema & Engine

```
backend/src/schemas/optimize.py
```

```python
class RejectedAlternative(BaseModel):
    label: str              # "Cheapest option"
    description: str        # "SEA → CDG via LAX"
    rejection_reason: str   # "…requires a self-transfer with baggage recheck."
    price_or_points: Optional[str]  # "$423"
```

```
backend/src/routes/solo.py — _generate_rejected_alternatives()
```

Three categories always generated:
1. **Cheapest option** — finds lowest-OOP alternative, explains why it's worse (more stops, bad CPP)
2. **Best points value** — finds highest-CPP alternative, explains why it costs more out-of-pocket
3. **What Google Flights would show** — compares full cash price to the recommended plan's savings

### Frontend — WhyNotOthers Component

```
frontend/src/components/WhyNotOthers.tsx
```

- Collapsed by default (reduces cognitive load)
- Toggle button: "Why we didn't pick the other options (3)"
- Each alternative shows label, badge with price/points, and rejection reason
- No comparison tables — just opinionated text explanations

---

## 9. Phase 5 — Progressive Disclosure

### Problem
Showing CPP math, transfer ratios, and savings percentages overwhelms users who just want to know "should I book this?"

### Solution

```
frontend/src/app/(app)/solo/results/page.tsx
```

**Default view** (sidebar):
- Route
- Value label (humanized, e.g., "Excellent value")
- "What you'll pay" (cash price strikethrough, your cost, points, savings)
- Transfer summary
- Lock Plan CTA

**Expandable section** (hidden by default):
- CPP math: `1.7¢ per point (CPP)`
- Savings percentage: `42% off cash price`
- Transfer ratios: `Amex MR → Flying Blue: 1.0x ratio`

Toggle: `[Show detailed breakdown]` / `[Hide detailed breakdown]`

State: `showAdvancedDetails` boolean, toggled by a `<button>`.

---

## 10. Phase 6 — "Lock This Plan" Moment

### Frontend — LockPlanCTA Component

```
frontend/src/components/LockPlanCTA.tsx
```

Two states:
- **Unlocked**: Black button `[🔒 Lock this plan]` + subtext "We'll remember this decision and watch for better options."
- **Locked**: Green box with bookmark icon: "Plan locked — We'll remember this and watch for better options."

### Frontend — Lock Handler

```tsx
// frontend/src/app/(app)/solo/results/page.tsx
const handleLockPlan = async () => {
    trackEvent(EVENTS.LOCK_PLAN_CLICKED, { tripId, isAuthenticated: isAuthenticated() });
    
    if (!isAuthenticated()) {
        trackEvent(EVENTS.SIGN_IN_PROMPTED, { trigger: 'lock', tripId });
        setShowSignInPrompt('lock');  // Shows SignInPrompt modal
        return;
    }
    
    // Authenticated → save immediately
    await solo.selectItinerary(tripId, { ... });
    setIsLocked(true);
    trackEvent(EVENTS.PLAN_LOCKED, { tripId });
};
```

### Backend — Lock Plan Endpoint

```
POST /solo/trips/:trip_id/lock
Dependency: get_user_or_anon_id
```

```python
if is_anonymous(user_id):
    return LockPlanResponse(
        ok=True, locked=False,
        message="Sign in to lock this plan...",
        requires_sign_in=True,
    )
# else: save selection immediately
```

### Backend — Session Migration Endpoint

```
POST /solo/migrate-session
Dependency: get_current_user_id (JWT required)
Body: { anon_session_id: "anon_abc123" }
```

1. Scans `TRIPS_TABLE` for `createdBy == anon_session_id`
2. Updates each trip's `createdBy` to the authenticated user ID
3. Scans `POINTS_TABLE` for matching trip IDs and rewrites `userProgram` keys
4. Returns `{ trips_migrated: N }`

This ensures **zero data loss** when converting from anonymous to authenticated.

---

## 11. Phase 7 — Humanized Explanations

### Backend — Value Labels

```
backend/src/routes/solo.py — _humanize_cpp()
```

| CPP Range | Label |
|---|---|
| >= 2.0 | "Exceptional value" |
| >= 1.5 | "Excellent value" |
| >= 1.2 | "Solid use of points" |
| >= 0.8 | "Fair redemption" |
| >= 0.5 | "Below average — consider cash" |
| < 0.5 | "Wasteful redemption" |

The `value_label` field is set on every `RankedItinerary` during optimization.

### Frontend — Copy Changes

The sidebar in the results page uses conversational copy:

| Before | After |
|---|---|
| "Cost Breakdown" | "What you'll pay" |
| "Cash Price" | "Would cost in cash" |
| "You Pay" | "Your cost" |
| "Points Used" | "Points you'll use" |
| "Savings" | "You're saving" |
| "Transfers Needed" | "Points to transfer first" |
| "Selected Route" | "Your Plan" |
| "Best match" badge | Shows `valueLabel` from backend |

Numbers only appear in the expandable advanced section.

---

## 12. Phase 8 — "What Happens Next" Clarity

### Frontend — NextSteps Component

```
frontend/src/components/NextSteps.tsx
```

Two variants based on `hasTransfers` prop:

**With transfers (4 steps):**
1. Transfer your points — "Move points from your bank to the airline program. This usually takes 1-3 days."
2. Book the flight — "Once points arrive, search for the same flight on the airline's website and book with points."
3. Save your confirmation — "Screenshot your booking confirmation and transfer receipt."
4. We'll keep watching — "If a better deal appears or prices drop, we'll let you know."

**Without transfers (3 steps):**
1. Book the flight — direct booking
2. Save your confirmation
3. We'll keep watching

Visual: vertical timeline with colored icons and step numbers.

---

## 13. Phase 9 — Delayed Sign-In Strategy

### Rule
Sign-in is ONLY prompted for:
- Locking a plan
- Saving trips
- Alerts / monitoring
- Storing exact points

Sign-in NEVER blocks trip generation or results viewing.

### Frontend — SignInPrompt Component

```
frontend/src/components/SignInPrompt.tsx
```

Modal overlay with three trigger-specific copies:

| Trigger | Title |
|---|---|
| `lock` | "Want us to remember this and keep watching for you?" |
| `save` | "Save this trip to your account" |
| `monitor` | "Get notified about price changes" |

Buttons:
- **"Sign in to save"** → `router.push('/login?redirect=...')` (preserves return URL)
- **"Continue without saving"** → dismisses modal

### Integration

```tsx
// results/page.tsx
{showSignInPrompt && (
    <SignInPrompt
        trigger={showSignInPrompt}
        onDismiss={() => setShowSignInPrompt(null)}
        onContinueWithout={() => setShowSignInPrompt(null)}
    />
)}
```

---

## 14. Phase 10 — Analytics & Confidence Tracking

### Frontend — Analytics Module

```
frontend/src/lib/analytics.ts
```

In-memory event buffer with development console logging and `window.tripyAnalytics` exposure for debugging.

**Tracked Events:**

| Event | When Fired | Properties |
|---|---|---|
| `trip_result_viewed` | Results page loads with optimization data | `tripId`, `itineraryCount`, `hasDecisionSummary` |
| `lock_plan_clicked` | User clicks "Lock this plan" | `tripId`, `isAuthenticated` |
| `plan_locked` | Plan successfully locked | `tripId` |
| `sign_in_prompted` | Sign-in modal shown | `trigger`, `tripId` |
| `calmness_vote` | User answers "Did this make you feel calmer?" | `vote` ("yes"/"no"), `tripId` |

**Calmness Vote UI** (bottom of sidebar):

```
"Did this make you feel calmer about booking?"
[Yes, much calmer]  [Not really]
```

After voting: "Glad to hear it. Happy travels!" or "Thanks for the feedback — we'll keep improving."

---

## 15. Data Flow Diagrams

### Optimization Request → Response

```
Frontend                          Backend
────────                          ───────
solo.optimize({                   POST /solo/optimize
  tripId: "xyz",                    │
  points: {                         ├── get_user_or_anon_id()
    "chase_ur": 80000,              │     → "anon_abc123" (or real user ID)
    "amex_mr": 60000                │
  }                                 ├── solo_trip_service.get_solo_trip()
})                                  │     → trip preferences (origin, dest, dates, class)
                                    │
                                    ├── OrchestratorAgent.optimize_solo()
                                    │     ├── FlightAgent → AwardTool API + SerpAPI
                                    │     └── ILP Solver (PuLP/CBC)
                                    │           → ranked itineraries
                                    │
                                    ├── _transform_itineraries() → RankedItinerary[]
                                    │
                                    ├── _humanize_cpp() → value_label per itinerary
                                    │
                                    ├── _generate_decision_summary()
                                    │     → DecisionSummary (headline, confidence, etc.)
                                    │
                                    ├── _generate_rejected_alternatives()
                                    │     → RejectedAlternative[]
                                    │
                                    ├── _generate_insights()
                                    │     → TransferInsight[]
                                    │
                                    └── Return OptimizeSoloResponse
                                          │
                                          ▼
{                                   toCamelCase() serialization
  itineraries: [{                   ────────────────────────────
    id, rank, route,                Frontend receives camelCase:
    displayName,
    segments: [...],                  decisionSummary.headline
    oopMetrics: {                     decisionSummary.confidenceLevel
      totalCashPrice,                 decisionSummary.whyGood[]
      totalOutOfPocket,               rejectedAlternatives[].rejectionReason
      cashSaved,                      itineraries[].valueLabel
      savingsPercentage,
      totalPointsUsed,
      averageCpp
    },
    transfers: [...],
    decisionSummary: { ... },
    valueLabel: "Excellent value"
  }],
  decisionSummary: { ... },
  rejectedAlternatives: [...],
  bestOption: "itin_1",
  cached: false,
  computedAt: "2026-02-06T...",
  expiresAt: "2026-02-06T..."
}
```

### Anonymous → Authenticated Migration

```
Frontend                              Backend
────────                              ───────

1. User generates trip (anon)
   localStorage: tripy_anon_session_id = "anon_abc123"
   
   POST /solo/trips                   createdBy: "anon_abc123"
   POST /solo/trips/:id/points        userProgram: "anon_abc123#chase_ur"
   POST /solo/optimize                ✓ works

2. User clicks "Lock this plan"
   isAuthenticated() → false
   → ShowSignInPrompt('lock')

3. User signs in via /login
   localStorage: access_token = "<jwt>"
   
4. Frontend calls migration:
   POST /solo/migrate-session          Authorization: Bearer <jwt>
   Body: {                             │
     anon_session_id: "anon_abc123"    ├── Scan TRIPS_TABLE WHERE createdBy = "anon_abc123"
   }                                   │   → Update createdBy to "<cognito_sub>"
                                       │
                                       ├── Scan POINTS_TABLE WHERE tripId matches
                                       │   → Rewrite userProgram keys
                                       │
                                       └── Return { trips_migrated: 1 }

5. Frontend: clearAnonSession()
   localStorage.removeItem('tripy_anon_session_id')
```

---

## 16. File Inventory

### Modified Files (10)

| File | Changes |
|---|---|
| `backend/src/utils/jwt_auth.py` | Added `ANON_PREFIX`, `is_anonymous()`, `get_user_or_anon_id()` |
| `backend/src/app.py` | Added anon session middleware, CORS expose header, card presets endpoint, estimation endpoint |
| `backend/src/routes/solo.py` | Switched 6 endpoints to `get_user_or_anon_id`, added `_humanize_cpp()`, `_generate_decision_summary()`, `_generate_rejected_alternatives()`, lock plan endpoint, migrate session endpoint |
| `backend/src/schemas/optimize.py` | Added `DecisionSummary`, `RejectedAlternative` models; added `decision_summary` and `value_label` to `RankedItinerary`; added `decision_summary` and `rejected_alternatives` to `OptimizeSoloResponse` |
| `backend/src/schemas/points.py` | Added `owner_type` and `confidence` fields to `PointsBalance` |
| `backend/src/schemas/__init__.py` | Exported `DecisionSummary`, `RejectedAlternative` |
| `frontend/src/lib/api.ts` | Added anonymous session support (`getAnonSessionId`, `isAuthenticated`, `clearAnonSession`), updated `apiRequest()` fallback, added `DecisionSummary`/`RejectedAlternative` types, added `lockPlan()`/`migrateSession()` functions |
| `frontend/src/app/(app)/layout.tsx` | Added `PUBLIC_ROUTES`, `isPublicRoute()`, skip auth gate for public routes |
| `frontend/src/app/(app)/solo/setup/page.tsx` | Graceful profile loading for anonymous users, skip profile save for anon |
| `frontend/src/app/(app)/solo/results/page.tsx` | Integrated DecisionHeader, WhyNotOthers, LockPlanCTA, NextSteps, SignInPrompt, analytics tracking, progressive disclosure, calmness vote, humanized copy |

### New Files (7)

| File | Purpose |
|---|---|
| `frontend/src/components/DecisionHeader.tsx` | Confidence header with headline, badge, CTA, expandable details |
| `frontend/src/components/WhyNotOthers.tsx` | Collapsed rejection explanations section |
| `frontend/src/components/LockPlanCTA.tsx` | "Lock this plan" button with locked state |
| `frontend/src/components/NextSteps.tsx` | "What happens next" step-by-step guide |
| `frontend/src/components/SignInPrompt.tsx` | Value-triggered sign-in modal |
| `frontend/src/components/ConfirmSituation.tsx` | Card selection / confirmation UI |
| `frontend/src/lib/analytics.ts` | Event tracking for confidence signals |

---

## Final Check

> Does this feel like a **judgment engine** or a **search tool**?

- The user sees a **verdict** before prices → judgment
- The language is **opinionated** ("Book this plan", "Excellent value") → authority
- Alternatives are **rejected with reasons**, not presented as equals → conviction
- Numbers are **hidden by default**, expandable for power users → confidence
- The user is **never blocked** from getting their answer → respect
- The "Did this make you feel calmer?" prompt → the product knows what it's for
