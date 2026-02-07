# Confidence Levels & Warning System

## Design Principles

The system separates two independent dimensions:

1. **Decision Confidence** (badge) — "Should I book this?"
2. **Value Assessment** (label) — "How good is this financially?"

These are NOT the same axis. A cash-only trip can be **high confidence** with a value label of **"Cash booking"**. A points trip with great CPP but tight connections can be **medium confidence** with **"Excellent value"**.

**CPP does not determine confidence.** Confidence reflects execution risk, data quality, and booking complexity. Value reflects financial efficiency.

---

## Confidence Levels

Computed in `backend/src/routes/solo.py` → `_generate_decision_summary()`.

### High Confidence (green)
- **Label:** "High confidence"
- **Meaning:** Clean booking, low execution risk, data is solid
- **Triggers when:**
  - Risk assessment is "low"
  - Balances are NOT estimated
  - Applies equally to cash-only and points trips
- **Example reasons:**
  - "Clean cash booking — straightforward to book"
  - "Strong plan — initiate transfers and book within 48 hours"
  - "Clean booking — straightforward to book"

### Good Confidence / Medium (amber)
- **Label:** "Good confidence"
- **Meaning:** Plan is sound but has caveats
- **Triggers when:**
  - Balances are estimated (any point program = 0)
  - Risk assessment is "medium" (e.g., carrier change, moderate connection)
  - Estimated + transfers needed (compound uncertainty)
- **Example reasons:**
  - "Based on estimated balances — verify your actual points before booking"
  - "Good plan with some complexity — carrier change, bags may need rechecking"

### Proceed with Caution / Low (red)
- **Label:** "Proceed with caution"
- **Meaning:** Real execution risk — something could go wrong
- **Triggers when:**
  - Risk assessment is "high" (separate tickets, very tight connections, self-transfer)
- **Example reasons:**
  - "Complex booking — separate tickets, if one flight delayed airline won't rebook you"
- **Does NOT trigger** for:
  - Low CPP alone
  - Cash-only trips
  - Zero points used

### Confidence logic (pseudo-code)

```
if risk == "high"        → low   (real execution danger)
elif estimated + transfers → medium (compound uncertainty)
elif estimated           → medium (data uncertainty)
elif risk == "medium"    → medium (moderate complexity)
else                     → high  (clean booking, regardless of CPP)
```

### is_estimated check

```python
is_estimated = any(v == 0 for v in request.points.values()) if request.points else True
```

---

## Value Labels

Independent from confidence. Displayed as a separate badge next to the confidence badge.

| CPP Range | Label | Notes |
|-----------|-------|-------|
| Cash-only (0 points) | "Cash booking" | Not penalized |
| ≥ 2.0 | "Exceptional value" | |
| ≥ 1.5 | "Excellent value" | |
| ≥ 1.0 | "Good value" | |
| ≥ 0.8 | "Fair value" | |
| < 0.8 | "Below-average redemption" | |

---

## Confidence Reason

Every confidence level includes a `confidence_reason` — a one-sentence explanation displayed under the badge. The user never has to guess WHY the system chose that confidence level.

Examples:
- "Clean cash booking — straightforward to book"
- "Based on estimated balances — verify your actual points before booking"
- "Complex booking — separate tickets, if one flight delayed airline won't rebook you"

---

## Warning System

### Architecture: Structured Warnings

Warnings are now **typed by category** instead of a flat `string[]`:

```python
class StructuredWarnings(BaseModel):
    budget: Optional[WarningItem]      # Budget constraint violations
    points: Optional[WarningItem]      # Points incompatibility
    estimation: Optional[WarningItem]  # Data quality / estimation
    degradation: Optional[WarningItem] # Search fallback / limited data

class WarningItem(BaseModel):
    category: "budget" | "points" | "estimation" | "degradation"
    severity: "info" | "warning" | "error"
    headline: str       # Short heading for the banner
    message: str        # Full explanation
    details: dict       # Structured data (budgets, amounts, etc.)
```

Each category renders as its **own banner** with severity-appropriate styling:
- `error` → red background, red border
- `warning` → amber background, amber border
- `info` → blue background, blue border

### Warning Categories

#### Budget (severity: error, red)
- **Headline:** "Budget Too Low"
- **Trigger:** Best itinerary's OOP exceeds user's stated budget
- **Details:** `user_budget`, `min_cost`, `suggested_budget`
- **Shows:** Side-by-side budget comparison

#### Points (severity: warning, amber)
- **Headline:** "Points Unavailable"
- **Trigger:** Points couldn't be used (no transfer partner match)
- **Message:** Explains which programs don't connect, with humanized bank names
- **Guards:** Empty reachable airlines set produces clear language instead of "Your points can transfer to: ."

#### Estimation (severity: info, blue)
- **Headline:** "Estimated Data"
- **Trigger:** Search data is approximate or incomplete

#### Degradation (severity: warning or error, amber or red)
- **Headline:** "Limited Flight Data"
- **Trigger:** Primary search failed, fell back to cash-only or partial data

### Backward Compatibility

The response still includes `warnings: List[str]` (flat list) alongside `structured_warnings`. Frontend prefers `structured_warnings` when present, falls back to flat rendering.

---

## Before/After: UX Narrative

### Scenario: User searches SEA→CDG, $10 budget, 100k Bank of America points

#### BEFORE (old system)

**Badge:** 🔴 "Proceed with caution"
*(Because CPP = 0, which triggers low confidence)*

**Headline:** "Book this plan — with a direct flight."

**Why it's good:**
- ✅ Direct flight — no stressful connections
- ✅ Only $120 out of pocket

**What to watch out for:**
- Low risk — straightforward booking

**Warning banner (amber, single paragraph):**
> **Estimated Routes**
> ⚠️ No itinerary found within your $10 budget. The minimum cost for this trip is $120. We recommend setting your budget to at least $132.. Points could not be used because the available award flights are on airlines that your points (bank_of_america) cannot transfer to. Your points can transfer to: . Consider adding Chase Ultimate Rewards or other bank points to access more airlines.

**Problems:**
1. Red badge says "caution" but bullets say "low risk" → **contradictory signals**
2. "$132.." → **double period** (sentence period + join separator)
3. "bank_of_america" → **raw internal key** shown to user
4. "Your points can transfer to: ." → **empty list** not guarded
5. Budget + points warnings **merged into one paragraph** under misleading "Estimated Routes" heading
6. Four conflicting emotional signals (red badge, green bullets, amber warning, positive headline)

#### AFTER (new system)

**Badge:** 🟢 "High confidence"  |  🔵 "Cash booking"
*(Risk is low, booking is clean. CPP doesn't affect confidence.)*

**Confidence reason:** "Clean cash booking — straightforward to book"

**Headline:** "Book this — best cash price with a direct flight."

**Why it's good:**
- ✅ Best cash option we found for this route
- ✅ Direct flight — no stressful connections
- ✅ Only $120 out of pocket

**What you're giving up:**
- No points applied — your points programs don't connect to available flights

**What to watch out for:**
- Low risk — straightforward booking

**Warning banners (separate, typed):**

> 🔴 **Budget Too Low**
> No itinerary found within your $10 budget. The minimum cost for this trip is $120. We recommend setting your budget to at least $132.
>
> Your Budget: $10 → Recommended: $132

> 🟡 **Points Unavailable**
> Points could not be used because your points program (Bank of America) does not have transfer partners that match the available flights on this route. Consider adding Chase Ultimate Rewards or Amex Membership Rewards to access more airlines.

**What changed:**
1. Confidence reflects **execution risk**, not CPP → no contradiction
2. Value label explicitly says **"Cash booking"** — user understands the situation
3. Confidence reason **explains** the badge in one sentence
4. Headline acknowledges cash: **"best cash price"** instead of generic
5. Tradeoffs honestly say **"No points applied"** with reason
6. Budget and points are **separate banners** with correct headings
7. Bank name humanized: **"Bank of America"** instead of "bank_of_america"
8. Empty airlines list handled: **clear fallback message** instead of "transfer to: ."
9. No double periods, no emoji in message text (frontend controls styling)
10. Emotional signals are **coherent**: green badge, green bullets, amber/red warnings — each tells one story

---

## Source Files

| Component | File | Key Lines |
|-----------|------|-----------|
| Confidence + value logic | `backend/src/routes/solo.py` | `_generate_decision_summary()` |
| Risk assessment | `backend/src/routes/solo.py` | `_generate_risk_assessment()` |
| Schema (DecisionSummary + StructuredWarnings) | `backend/src/schemas/optimize.py` | `DecisionSummary`, `WarningItem`, `StructuredWarnings` |
| Budget/points warnings | `backend/src/agents/orchestrator.py` | Greedy optimizer warning generation |
| Frontend confidence display | `frontend/src/components/DecisionHeader.tsx` | Badge + value label + confidence reason |
| Frontend warning banners | `frontend/src/app/(app)/solo/results/page.tsx` | Structured warning rendering |
| Frontend types | `frontend/src/lib/api.ts` | `DecisionSummary`, `StructuredWarnings` interfaces |
