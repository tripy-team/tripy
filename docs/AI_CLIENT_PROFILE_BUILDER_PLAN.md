# AI Client Profile Builder — Implementation Plan

**Goal:** Every question and follow-up question in a discovery meeting is AI-generated via OpenAI, progressively building a rich client profile so both the advisor and AI understand exactly what the client wants on their trip.

---

## Current State

### What already exists

| Component | Path | Status |
|-----------|------|--------|
| Question generation | `frontend/src/lib/meeting-copilot-ai.ts` → `generateMeetingQuestions` | Generates 5–8 initial questions via `gpt-4o-mini` |
| Follow-up generation | `meeting-copilot-ai.ts` → `generateFollowUpQuestions` | Generates 4–6 follow-ups from answered Q&A pairs |
| Profile extraction | `meeting-copilot-ai.ts` → `extractProfileSuggestions` | Extracts 10–20+ structured insights from conversation |
| Meeting recap | `meeting-copilot-ai.ts` → `generateMeetingRecap` | Summarizes meeting into 4 sections |
| Questions API | `api/clients/[id]/meetings/[meetingId]/questions/route.ts` | Stores questions by round, tracks `previousQuestions` to avoid repeats |
| Extract API | `api/clients/[id]/meetings/[meetingId]/extract/route.ts` | Deduplicates suggestions, boosts confidence on repeated evidence |
| Commit API | `api/clients/[id]/meetings/[meetingId]/commit/route.ts` | Writes approved suggestions to `ClientPreference` |
| Meeting UI | `clients/[clientId]/meeting/[meetingId]/page.tsx` | Two-column layout: conversation left, AI panel right |
| Client preference model | Prisma `ClientPreference` | ~20 typed fields (cabin, airlines, hotels, budget, etc.) |
| Preference fields doc | `TRAVEL_PREFERENCE_FIELDS` in `meeting-copilot-ai.ts` | Embedded field reference the AI uses for question targeting |

### What's missing

1. **No automatic question generation** — questions only fire when the advisor clicks "Generate Questions" or "Follow-Up Questions" manually
2. **No profile-awareness in question strategy** — the AI doesn't see what percentage of the profile is filled or which critical fields remain empty
3. **No progressive profile snapshot** — the AI doesn't get a running tally of what it's already learned *this session* (only prior session data)
4. **No profile completeness scoring** — no way to know when the profile is "good enough" or which gaps are blocking trip planning
5. **No cross-meeting memory** — each meeting starts from `ClientPreference` but doesn't see insights from prior meetings that were never committed
6. **No auto-extraction** — preferences are only extracted when the advisor clicks "Extract Preferences" manually

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Meeting Copilot UI                       │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │   Conversation    │    │   AI Panel                    │  │
│  │   ─────────────   │    │   Questions │ Profile │ Recap │  │
│  │   Advisor types   │    │   [AI-generated, context-     │  │
│  │   client answers  │    │    aware, auto-refreshing]    │  │
│  │                   │    │                               │  │
│  │   ← auto-extract  │    │   Profile Completeness: 67%  │  │
│  │     on each entry │    │   ██████████░░░░░ 14/21 fields│  │
│  └──────────────────┘    └──────────────────────────────┘   │
└────────────────────┬──────────────────────────────────────┬──┘
                     │                                      │
                     ▼                                      ▼
           ┌─────────────────┐                  ┌───────────────────┐
           │  Questions API   │                  │  Extract API       │
           │  POST /questions │                  │  POST /extract     │
           └────────┬────────┘                  └─────────┬─────────┘
                    │                                      │
                    ▼                                      ▼
      ┌──────────────────────────────────────────────────────────┐
      │                  OpenAI (gpt-4o-mini)                     │
      │                                                           │
      │  Context fed to every call:                               │
      │  ├── Client name + existing ClientPreference              │
      │  ├── Full conversation so far                             │
      │  ├── All previously asked questions                       │
      │  ├── Session profile snapshot (live extracted insights)   │
      │  ├── Profile completeness analysis                        │
      │  └── Cross-meeting history (prior meeting summaries)      │
      └──────────────────────────────────────────────────────────┘
                    │
                    ▼
      ┌──────────────────────────────────────────────────────────┐
      │            MeetingProfileSuggestion rows                  │
      │            (pending → approved → committed)               │
      │                         │                                 │
      │                         ▼                                 │
      │                  ClientPreference                         │
      │            (the persistent client profile)                │
      └──────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Profile Completeness Engine

**Why:** The AI needs to know what it already knows and what gaps remain. Without this, it generates generic questions instead of targeted ones.

#### 1.1 Define profile field registry

Create a structured registry of all profile fields with metadata.

**File:** `frontend/src/lib/profile-fields.ts` (new)

```typescript
interface ProfileFieldDef {
  key: string;
  label: string;
  category: 'flight' | 'hotel' | 'budget' | 'experience' | 'logistics' | 'family' | 'dealbreakers' | 'emotional';
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'enum' | 'boolean' | 'number' | 'string' | 'string[]' | 'json';
  tripBlocking: boolean; // does an empty value block trip planning?
  description: string;   // what this field captures, for the AI
}
```

Critical fields (trip-blocking):
- `preferredCabin`
- `budgetSensitivity`
- `prefersNonstop`
- `dealbreakers`
- `redemptionStyle`

High-priority fields:
- `preferredAirlines`, `avoidedAirlines`
- `preferredHotelTypes`, `locationPreferences`
- `activityPreferences`
- `familyConsiderations`
- `foodPreferences`, `accessibilityNeeds`

Medium/low fields:
- Soft preferences (seat preference, legroom, travel pace, splurge categories, etc.)

#### 1.2 Compute profile completeness

**File:** `frontend/src/lib/profile-completeness.ts` (new)

```typescript
interface ProfileCompleteness {
  overallPercent: number;            // 0–100
  criticalFieldsFilled: number;
  criticalFieldsTotal: number;
  filledFields: string[];
  emptyFields: string[];
  emptyCriticalFields: string[];
  categoryBreakdown: Record<string, { filled: number; total: number }>;
  readyForTripPlanning: boolean;     // all critical fields filled
}

function computeProfileCompleteness(
  preferences: Record<string, unknown> | null,
  sessionInsights: { targetField: string; suggestedValue: unknown; status: string }[]
): ProfileCompleteness
```

This function merges committed `ClientPreference` data with in-session `MeetingProfileSuggestion` rows (pending + approved) to produce a live completeness picture. The AI sees this on every call.

#### 1.3 Build profile snapshot for AI context

**File:** modify `frontend/src/lib/meeting-copilot-ai.ts`

Add a new interface and helper:

```typescript
interface ProfileSnapshot {
  completeness: ProfileCompleteness;
  sessionInsights: { field: string; value: unknown; confidence: number }[];
  priorMeetingSummaries: string[];    // from MeetingRecap.travelerSummary
}
```

Extend `MeetingContext` to include `profileSnapshot: ProfileSnapshot`.

---

### Phase 2: Smart Question Generation

**Why:** Questions should be strategically chosen based on what the AI already knows, what's missing, and what the client just said.

#### 2.1 Redesign the question generation prompt

**File:** modify `frontend/src/lib/meeting-copilot-ai.ts` → `generateMeetingQuestions`

Current prompt asks for "5-8 smart questions ranked by priority." Change to:

**New prompt structure:**

```
You are a Meeting Copilot for a luxury travel advisor building a comprehensive 
client profile. Your questions should systematically fill gaps in the client's 
travel preference profile.

PROFILE COMPLETENESS: {overallPercent}%
CRITICAL GAPS (trip-blocking): {emptyCriticalFields}
HIGH-PRIORITY GAPS: {emptyHighPriorityFields}

ALREADY KNOWN:
{filledFieldsSummary}

SESSION INSIGHTS (learned this meeting):
{sessionInsightsSummary}

PRIOR MEETING CONTEXT:
{priorMeetingSummaries}

FULL CONVERSATION:
{conversationSoFar}

QUESTIONS ALREADY ASKED (do NOT repeat):
{previousQuestions}

STRATEGY:
- If critical fields are empty, prioritize those (trip planning is blocked)
- If the client just revealed something, ask ONE targeted follow-up before moving on
- Group related questions naturally (don't jump between flight, hotel, food randomly)
- Use the client's own words and context to make questions feel conversational
- Ask open-ended questions that reveal multiple preferences at once
- After critical gaps are filled, probe for emotional drivers and dealbreakers
- For each question, specify exactly which profile fields it targets

Generate {questionCount} questions. Return JSON...
```

Key changes:
- AI sees profile completeness percentage and specific gaps
- AI sees what was already learned this session (not just committed preferences)
- AI sees prior meeting summaries for continuity
- AI follows a gap-filling strategy: critical → high → emotional → soft
- Question count adapts: more questions when profile is sparse, fewer when nearly complete

#### 2.2 Redesign the follow-up question prompt

**File:** modify `frontend/src/lib/meeting-copilot-ai.ts` → `generateFollowUpQuestions`

New prompt additions:

```
PROFILE UPDATE: After analyzing the answers, these are the NEW insights extracted:
{newlyExtractedInsights}

REMAINING GAPS (updated after this round):
{remainingGaps}

Based on what the client just revealed, generate follow-up questions that:
1. Dig deeper into vague answers — get specific, actionable preferences
2. Connect what they said to adjacent profile fields (e.g., "You mentioned boutique 
   hotels — does that mean you prefer walkable downtown locations too?")
3. Fill the highest-priority remaining gaps
4. Probe for contradictions or nuance ("You said budget-conscious but also mentioned 
   wanting lie-flat business — how do you balance those?")
5. Ask about emotional motivations that reveal hidden preferences
```

#### 2.3 Add dynamic question count

**File:** modify `frontend/src/lib/meeting-copilot-ai.ts`

```typescript
function getQuestionCount(completeness: ProfileCompleteness, isFollowUp: boolean): number {
  if (isFollowUp) {
    return completeness.overallPercent > 80 ? 2 : 4;
  }
  if (completeness.overallPercent < 30) return 8;  // lots of gaps
  if (completeness.overallPercent < 60) return 6;
  if (completeness.overallPercent < 80) return 4;
  return 3; // profile nearly complete, just probing
}
```

---

### Phase 3: Auto-Extract on Every Answer

**Why:** Currently extraction only happens when the advisor clicks "Extract Preferences." The profile should update in real-time as answers come in.

#### 3.1 Lightweight per-answer extraction

**File:** new function in `frontend/src/lib/meeting-copilot-ai.ts`

```typescript
export async function extractFromSingleAnswer(
  context: MeetingContext,
  question: { questionText: string; targetFields: string[] },
  answer: string,
): Promise<ExtractedProfileSuggestion[]>
```

This is a cheaper, faster extraction that:
- Only looks at the single Q&A pair (not the full conversation)
- Knows which `targetFields` the question was aimed at
- Uses a shorter prompt optimized for single-answer extraction
- Returns 1–5 suggestions (much smaller than full extraction)
- Uses lower `max_tokens` for speed

**Prompt:**
```
A client was asked: "{questionText}"
They answered: "{answer}"

This question targeted these profile fields: {targetFields}

Extract structured preferences from this answer. Be precise — only extract 
what the answer clearly states or strongly implies.

Return JSON with key "suggestions" containing an array...
```

#### 3.2 Wire auto-extraction into the answer flow

**File:** modify `api/clients/[id]/meetings/[meetingId]/entries/route.ts`

When a new entry with `role: 'question_answer'` is created:
1. Save the entry (existing behavior)
2. If `metadata.questionText` exists, trigger lightweight extraction
3. Create new `MeetingProfileSuggestion` rows from extracted data
4. Return the entry + any new suggestions in the response

**File:** modify `clients/[clientId]/meeting/[meetingId]/page.tsx`

After recording an answer:
1. Show a subtle "Analyzing..." indicator on the Insights tab
2. When extraction completes, update the suggestions list
3. Bump the Insights tab badge count
4. Optionally show a toast: "2 new insights from that answer"

---

### Phase 4: Auto-Generate Follow-Up Questions

**Why:** The advisor shouldn't have to click "Follow-Up Questions" — new questions should appear automatically after answers are recorded.

#### 4.1 Trigger question generation after answers

**File:** modify `clients/[clientId]/meeting/[meetingId]/page.tsx`

After recording an answer and receiving auto-extraction results:
1. Check how many unanswered questions remain in the current round
2. If ≤ 1 remain, auto-generate the next round of follow-up questions
3. Use the updated profile snapshot (including just-extracted insights) as context
4. Show new questions with "Latest" badge and scroll indicator

Flow:
```
Advisor records answer
  → Entry saved
  → Auto-extract preferences (Phase 3)
  → Profile snapshot updated
  → If few questions remain: auto-generate follow-ups
  → New questions appear in AI panel
```

#### 4.2 Add a question generation strategy mode

**File:** modify `api/clients/[id]/meetings/[meetingId]/questions/route.ts`

Add a `strategy` parameter to the request body:

```typescript
type QuestionStrategy = 
  | 'initial'           // first round — broad discovery
  | 'follow_up'         // drill into answered topics
  | 'gap_fill'          // target remaining empty fields
  | 'deep_dive'         // explore emotional/aspirational dimensions
  | 'closing'           // final questions to wrap up
```

The API determines the strategy automatically based on:
- Profile completeness: < 30% → `initial`, 30-60% → `follow_up`, 60-80% → `gap_fill`, > 80% → `deep_dive` or `closing`
- Number of rounds already completed
- Whether critical fields are still empty

---

### Phase 5: Cross-Meeting Profile Memory

**Why:** Clients may have multiple meetings over time. The AI should remember what it learned before and not re-ask the same things.

#### 5.1 Feed prior meeting recaps into context

**File:** modify `api/clients/[id]/meetings/[meetingId]/questions/route.ts`

Before generating questions:
1. Fetch all completed `DiscoveryMeetingSession` records for this client (excluding current)
2. For each, load the `MeetingRecap.travelerSummary`
3. Include in the `MeetingContext` as `priorMeetingSummaries`

#### 5.2 Feed uncommitted insights from prior meetings

**File:** modify `api/clients/[id]/meetings/[meetingId]/questions/route.ts`

Also fetch `MeetingProfileSuggestion` rows from prior sessions that are still `pending` or `approved` (never committed). Include these as "tentative profile data" in the AI context, so the AI doesn't re-ask about things that were already discovered but not yet saved.

---

### Phase 6: Profile View in Meeting UI

**Why:** The advisor needs to see the profile being built in real-time to understand what the AI knows and what gaps remain.

#### 6.1 Add a "Profile" tab to the AI panel

**File:** modify `clients/[clientId]/meeting/[meetingId]/page.tsx`

Replace the three-tab layout (`Questions | Insights | Recap`) with four tabs:

```
Questions | Profile | Insights | Recap
```

The **Profile** tab shows:
- **Completeness bar**: visual progress indicator (e.g., 67% complete)
- **Category breakdown**: flight prefs 4/5, hotel prefs 2/4, budget 1/3, etc.
- **Critical gaps highlighted in red**: fields that block trip planning
- **Known preferences**: grouped by category, showing both committed values and session-learned values with confidence bars
- **"Ready for trip planning"** badge when all critical fields are filled

#### 6.2 Real-time profile updates

The Profile tab updates live as:
- New answers are recorded and auto-extracted
- The advisor dismisses or restores insights
- Insights are committed to the profile

---

### Phase 7: OpenAI Prompt Engineering Details

#### 7.1 System prompt for all meeting copilot calls

Create a shared system prompt that all meeting copilot functions use:

```
You are Tripy's Meeting Copilot — an AI assistant embedded in a live client 
discovery meeting between a luxury travel advisor and their client.

Your role is to help the advisor build a comprehensive travel preference profile 
for this client. The profile will be used by Tripy's recommendation engine to 
generate optimized trip plans using the client's loyalty points and cash.

KEY PRINCIPLES:
- Questions should feel natural and conversational, not like a form
- Read between the lines — infer preferences from stories and anecdotes
- Notice emotional cues — what excites the client vs. what they tolerate
- Capture the texture of preferences, not just binary yes/no
- A great profile captures not just WHAT they want but WHY they want it
- Contradiction is normal — people have context-dependent preferences
- The advisor is the expert; you're providing intelligent structure

PROFILE FIELDS YOU'RE BUILDING:
{TRAVEL_PREFERENCE_FIELDS}
```

#### 7.2 Temperature tuning

| Function | Temperature | Rationale |
|----------|-------------|-----------|
| Initial questions | 0.7 | Creative, varied discovery |
| Follow-up questions | 0.5 | More focused, context-dependent |
| Single-answer extraction | 0.3 | Precise, factual extraction |
| Full extraction | 0.5 | Balanced precision and inference |
| Meeting recap | 0.6 | Narrative quality matters |

#### 7.3 Token optimization

| Function | Estimated input tokens | Estimated output tokens | Cost per call (gpt-4o-mini) |
|----------|----------------------|------------------------|---------------------------|
| Initial questions | ~800–1,500 | ~500–800 | ~$0.001 |
| Follow-up questions | ~1,200–2,500 | ~400–600 | ~$0.001 |
| Single-answer extract | ~300–600 | ~200–400 | ~$0.0005 |
| Full extraction | ~1,500–4,000 | ~800–2,000 | ~$0.002 |
| Meeting recap | ~2,000–5,000 | ~500–1,000 | ~$0.002 |

Per meeting (estimated 20 minutes, 10 answers): ~$0.015 total.

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/lib/profile-fields.ts` | Profile field registry with metadata (priority, category, trip-blocking flag) |
| `frontend/src/lib/profile-completeness.ts` | Computes profile completeness from preferences + session insights |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/lib/meeting-copilot-ai.ts` | Extended `MeetingContext` with `ProfileSnapshot`; redesigned prompts for `generateMeetingQuestions` and `generateFollowUpQuestions` to be profile-aware; new `extractFromSingleAnswer` function; shared system prompt; dynamic question counts |
| `frontend/src/app/api/clients/[id]/meetings/[meetingId]/questions/route.ts` | Load prior meeting recaps + uncommitted insights; compute profile completeness; pass extended context to AI; add `strategy` parameter |
| `frontend/src/app/api/clients/[id]/meetings/[meetingId]/extract/route.ts` | No structural changes — already handles incremental extraction well |
| `frontend/src/app/api/clients/[id]/meetings/[meetingId]/entries/route.ts` | Add auto-extraction on `question_answer` entries; return new suggestions in response |
| `frontend/src/app/(app)/clients/[clientId]/meeting/[meetingId]/page.tsx` | Add Profile tab; auto-generate follow-ups after answers; show real-time profile completeness; handle auto-extraction results inline |

### Database Changes

None. The existing schema (`MeetingQuestionSuggestion`, `MeetingProfileSuggestion`, `ClientPreference`, `MeetingRecap`) already supports everything needed. The profile completeness is computed at runtime, not stored.

---

## Implementation Sequence

### Step 1: Profile Completeness Engine (Phase 1)
1. Create `profile-fields.ts` with the field registry
2. Create `profile-completeness.ts` with the completeness calculator
3. Unit test: given various `ClientPreference` states, verify correct completeness percentages

### Step 2: Enhanced AI Prompts (Phase 2 + Phase 7)
1. Create the shared system prompt
2. Redesign `generateMeetingQuestions` prompt to include profile completeness and gaps
3. Redesign `generateFollowUpQuestions` prompt to include session insights and remaining gaps
4. Add dynamic question count logic
5. Update the questions API route to load prior meetings and compute profile snapshot
6. Test: generate questions for clients with varying profile completeness levels

### Step 3: Auto-Extraction (Phase 3)
1. Implement `extractFromSingleAnswer` in `meeting-copilot-ai.ts`
2. Modify the entries API route to trigger extraction on `question_answer` entries
3. Return new suggestions in the entry response
4. Update the meeting UI to display inline extraction results

### Step 4: Auto-Follow-Up Generation (Phase 4)
1. Add logic to the meeting page to auto-trigger follow-up generation when questions run low
2. Add the `strategy` parameter to the questions API
3. Test: record 3 answers and verify new questions auto-appear

### Step 5: Cross-Meeting Memory (Phase 5)
1. Modify the questions API to fetch prior meeting recaps
2. Fetch uncommitted suggestions from prior sessions
3. Include both in the AI context
4. Test: start a second meeting for the same client and verify the AI references prior discoveries

### Step 6: Profile Tab UI (Phase 6)
1. Add the Profile tab to the meeting page
2. Wire completeness data to the UI
3. Show category breakdowns and critical gap highlighting
4. Real-time updates as answers flow in

---

## How the Complete Flow Works

```
1. Advisor starts a meeting
      │
      ▼
2. AI generates initial questions (profile-aware)
   ├── Sees: committed ClientPreference (if any)
   ├── Sees: prior meeting recaps + uncommitted insights
   ├── Sees: profile completeness = 12% (new client) or 65% (returning)
   └── Targets: critical gaps first (cabin, budget, dealbreakers)
      │
      ▼
3. Advisor asks question, records client's answer
      │
      ▼
4. Auto-extraction runs on the answer
   ├── Extracts 1–3 structured preferences
   ├── Creates MeetingProfileSuggestion rows
   └── Updates profile completeness in real-time
      │
      ▼
5. Profile tab updates (67% → 72%)
      │
      ▼
6. When unanswered questions run low, AI auto-generates follow-ups
   ├── Sees: all session insights so far (not just committed prefs)
   ├── Sees: updated profile completeness and remaining gaps
   ├── Builds on specific answers ("You mentioned Kyoto — are you drawn 
   │   to other cultural destinations, or was that a one-off?")
   └── Strategy adapts: gap_fill → deep_dive → closing
      │
      ▼
7. Cycle repeats (steps 3–6) throughout the meeting
      │
      ▼
8. By meeting end, profile is 85%+ complete
   ├── All critical fields filled
   ├── Rich qualitative insights captured
   ├── Advisor reviews insights, dismisses any that feel wrong
   └── "Save to Profile" commits approved insights to ClientPreference
      │
      ▼
9. Generate recap (AI sees the full enriched profile)
      │
      ▼
10. Next meeting: AI remembers everything, asks only about what's new
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Profile completeness after first meeting | ≥ 70% |
| Profile completeness after second meeting | ≥ 90% |
| Avg questions per meeting | 12–18 (across 3–4 rounds) |
| Auto-extraction accuracy | ≥ 80% of suggestions approved (not dismissed) |
| Time to first trip-planning-ready profile | ≤ 1 meeting for simple clients |
| Advisor clicks to generate questions | 0 (after initial round, all auto-generated) |
| Duplicate questions across meetings | 0 |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenAI latency slows down the meeting flow | Use `gpt-4o-mini` (fast); auto-extraction runs in background; show questions from prior round while new ones generate |
| AI hallucinates preferences not stated by client | Low temperature (0.3) for extraction; confidence scores; advisor reviews before commit |
| Too many questions overwhelm the advisor | Dynamic question count; profile completeness threshold; "closing" strategy mode |
| Auto-generation creates noisy/low-quality questions | Strategy-based generation; previous question dedup; advisor can manually trigger instead |
| Cross-meeting context exceeds token limits | Summarize prior meetings (use recap only, not full conversation); truncate to most recent 3 meetings |
| Cost of OpenAI calls per meeting | At ~$0.015 per meeting with `gpt-4o-mini`, this is negligible; monitor and alert if costs spike |
