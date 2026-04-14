# Intake Form & Discovery Tab Redesign

## Overview

This document details the plan to:
1. Restructure the **Client Intake Form** to focus on building a reusable client preference profile (separated from trip-specific planning)
2. Add an **AI Discovery Chatbot** directly in the intake flow for real-time follow-up questions
3. Redesign the **Discovery Tab** on the client detail page to be the primary hub for preference learning
4. Remove the **Operations Tab** from the client detail page

---

## Problem with Current State

The current intake form mixes two concerns:
- **Trip-specific data** — destination, dates, budget range, number of travelers, trip type
- **Reusable client preferences** — cabin class, hotel style, travel pace, dietary needs, dealbreakers

This creates friction: every new trip re-captures preferences that don't change between trips. The intake form should serve as a one-time (or periodically updated) **client preference profile builder**, while trip-specific data belongs in the trip planning flow.

---

## Part 1: Redesign the Client Intake Form

### New Purpose

The intake form becomes a **Client Profile Builder** — a structured questionnaire that captures who the traveler is and how they prefer to travel, independent of any specific trip. Answers here populate the reusable `PreferenceProfile` that persists across all future trips.

Trip-specific details (destination, travel dates, budget for a specific trip, traveler count for a specific trip) move to the **Trip Planning flow** when an advisor creates a new trip request.

---

### New Step Structure (6 steps + AI Chat)

#### Step 1 — Who They Are
*Profile-level identity: how they travel, who they travel with*

- **Travel party type** — Solo, Couple, Family with Kids, Extended Family, Group
- **Children ages** — Multi-value text input (only shown if kids selected)
- **Typical trip pace** — Relaxed / Moderate / Active / Packed (single select chips)
- **Luxury vs. value orientation** — Luxury / Upscale / Balanced / Value / Budget (single select chips)
- **Family-friendly flag** — Toggle (yes/no)

*Remove from this step:* Trip type, destinations, departure airports, number of travelers (all move to trip planning)

---

#### Step 2 — Flight Preferences
*Permanent flight preferences that apply across trips*

- **Preferred cabin class** — Economy / Premium Economy / Business / First / Flexible (single select)
- **Layover preference** — Nonstop only / Prefer nonstop / No preference / Layovers fine if cheaper (single select)
- **Preferred airlines** — Multi-chip text input
- **Airlines to avoid** — Multi-chip text input
- **Home airports** — Multi-airport autocomplete (where they typically depart from)
- **Willing to reposition for a better deal?** — Yes / No / Maybe (single select)
- **Nonstop vs. savings tradeoff** — Free text or slider note

---

#### Step 3 — Accommodation Preferences
*Hotel and lodging style that applies across trips*

- **Preferred accommodation styles** — Multi-select chips (Boutique, Resort, Major Chain, All-Inclusive, Vacation Rental/Airbnb, Villa/Private, Eco-Lodge, Hostel/Budget, Luxury/5-Star, Bed & Breakfast)
- **Loyalty programs they hold** — Free text or structured multi-input (program name + notes)
- **Points/rewards notes** — Textarea (willingness to use points, transfer, etc.)
- **Accommodation deal-breakers** — Multi-chip (e.g., "no Marriott", "no shared bathrooms")

---

#### Step 4 — Experiences & Interests
*What they enjoy doing on trips — persists to future recommendations*

- **Desired experiences** — Multi-select chips (Beach & Relaxation, Fine Dining, Cultural/Historical Sites, Wildlife/Safari, Skiing/Snow Sports, Scuba Diving/Snorkeling, Spa & Wellness, Nightlife, Hiking/Nature, City Exploration, Wine/Food Tours, Shopping, Water Sports, Photography, Family Activities, Art & Museums, Festivals/Events, Road Trips) + custom entry
- **Dining preferences** — Textarea (cuisine preferences, dietary needs for restaurants)
- **Activity level** — Slider or chips: Low / Medium / High

---

#### Step 5 — Special Needs & Constraints
*Hard constraints that must be accounted for on every trip*

- **Accessibility needs** — Textarea
- **Dietary needs** — Textarea
- **Medical or health considerations** — Textarea (optional)
- **Hard constraints** — Multi-chip (things that are non-negotiable)
- **Soft preferences** — Textarea (nice-to-haves)

---

#### Step 6 — Dealbreakers
*Permanent do-not-book items across airlines, hotels, destinations, and conditions*

- **Airlines to never book** — Multi-chip
- **Hotels/brands to never book** — Multi-chip
- **Destinations to avoid** — Multi-chip
- **Conditions to avoid** — Multi-chip (e.g., "no red-eyes", "no more than 14-hour travel days")
- **Other notes** — Free text

---

#### Step 7 — AI Discovery Chat (new)
*A chatbot that asks smart follow-up questions based on the advisor's answers in steps 1–6*

See Part 3 for full chatbot design.

---

### Data Model Changes

The `ClientIntake` Prisma model needs to be restructured (or a new `ClientProfile` model introduced) to reflect the separation:

**Fields to keep on intake (profile-level):**
- `cabinPreference`, `hotelStyles`, `loyaltyNotes`
- `accessibilityNeeds`, `dietaryNeeds`
- `travelPace`, `layoverTolerance`, `luxuryPreference`, `familyFriendly`
- `travelerCount` (general party size), `childrenCount`, `childrenAges`
- `desiredExperiences`, `dealbreakers`
- `preferredAirlines`, `avoidedAirlines`
- `notes`, `isTemplate`, `templateName`, `status`

**Fields to move to trip planning (trip-specific):**
- `tripType` — move to TripRequest
- `destinations` — move to TripRequest
- `departureAirports` — keep a general "home airports" field on profile; specific departure on TripRequest
- `dateFlexibility`, `earliestDeparture`, `latestReturn`, `tripDurationDays` — all trip-specific, move to TripRequest
- `budgetMin`, `budgetMax`, `budgetCurrency`, `budgetNotes` — general budget range can stay as a profile preference, but specific budget per trip moves to TripRequest

**New fields to add:**
- `homeAirports` — String[] (general departure airports for this client)
- `willingToReposition` — Enum (yes / no / maybe)
- `activityLevel` — Enum (low / medium / high)
- `hardConstraints` — String[]
- `softPreferences` — String (free text)
- `medicalNotes` — String (optional, sensitive)
- `accommodationDealbreakers` — String[]
- `chatHistory` — JSON or relation to `ProfileChatMessage` model (see Part 3)

---

### Rename

Rename "New Intake" → **"Build Profile"** or **"Client Profile Intake"** throughout the UI to better reflect the purpose.

---

## Part 2: Remove the Operations Tab

### What to Remove

**From `frontend/src/app/(app)/clients/[clientId]/page.tsx`:**

1. Remove `'operations'` from the `Tab` type union (line 114)
2. Remove the `{ key: 'operations', label: 'Operations', show: true }` entry from the `tabs` array (line 846)
3. Remove the `{activeTab === 'operations' && <ClientOperationsPanel ... />}` render block (line 2519–2525)
4. Remove the `ClientOperationsPanel` import (line 93)

**Files that can be left in place (no deletion required for now):**
- `frontend/src/components/ClientOperationsPanel.tsx` — safe to keep but no longer rendered
- Related API routes and backend logic — no changes needed

**Imports to remove from `page.tsx`:** Any imports that were only used for the Operations panel and nothing else.

---

## Part 3: AI Discovery Chatbot in Intake

### Concept

After completing steps 1–6 of the intake, the advisor reaches an AI-powered chat screen. The AI reads the filled-in profile so far and generates personalized follow-up questions that the advisor can ask the client during a call or in-person meeting. The advisor types in the client's answers, and the AI uses those answers to:

1. Ask deeper follow-up questions
2. Surface any contradictions or gaps in the profile
3. Suggest preference updates that can be committed to the client profile

This is distinct from the meeting copilot (which is a standalone session). The chatbot inside intake is a focused, form-scoped discovery assistant that runs as the final step of profile building.

---

### AI Provider

Use the **Anthropic Claude API** (`claude-sonnet-4-6`) for:
- Better reasoning about nuanced travel preferences
- More natural follow-up question generation
- Contradiction detection (e.g., "client says budget but selected Business class")

The backend already has OpenAI integrated; add Anthropic SDK alongside it. The intake chatbot will use Claude.

---

### Frontend: Step 7 — Discovery Chat UI

**File:** `frontend/src/app/(app)/clients/[clientId]/intake/_components/intake-form.tsx`

**New UI elements for Step 7:**
```
┌─────────────────────────────────────────────────────────────┐
│  AI Discovery Questions                           [Generate] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Based on what you've shared, here are some questions       │
│  to ask your client:                                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Q: You mentioned Business class — do they have any  │  │
│  │  airline status that makes upgrades easier?          │  │
│  └──────────────────────────────────────────────────────┘  │
│  [Answer from client:]                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [textarea for advisor to type client's response]    │  │
│  └──────────────────────────────────────────────────────┘  │
│                              [Submit Answer →]              │
│                                                             │
│  ─────────── Conversation History ───────────              │
│  AI: You mentioned Business class...                        │
│  You: They have Delta Diamond status and...                 │
│  AI: Great! Given their Delta status, do they prefer...     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Component state additions:**
```typescript
// Inside IntakeFormProps / local state:
interface ChatMessage {
  role: 'assistant' | 'advisor';
  content: string;
  timestamp: Date;
}

const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState('');
const [chatLoading, setChatLoading] = useState(false);
const [chatInitialized, setChatInitialized] = useState(false);
```

**Flow:**
1. When advisor reaches Step 7, auto-trigger `POST /clients/{clientId}/intakes/{intakeId}/chat/start` with the current form data as context
2. Backend returns 2–3 initial questions based on profile gaps and interesting follow-ups
3. Advisor reads questions to client, types responses
4. Each response triggers `POST /clients/{clientId}/intakes/{intakeId}/chat/message` which returns the next follow-up
5. After 3–5 exchanges, the AI offers a "Wrap up" summary and suggests profile updates
6. Advisor can accept/reject suggested updates before completing intake

---

### Backend: New Chat Endpoints

**File:** `backend/src/routes/intake.py` (add new routes) or a new `backend/src/routes/intake_chat.py`

#### `POST /clients/{client_id}/intakes/{intake_id}/chat/start`

**Request:**
```json
{
  "intakeData": { ...current form fields... }
}
```

**Response:**
```json
{
  "sessionId": "uuid",
  "messages": [
    {
      "role": "assistant",
      "content": "Based on the profile so far, here are some questions to ask your client:\n\n1. You mentioned they prefer Business class — do they have airline status that affects which carriers they prefer?\n\n2. They selected 'Beach & Relaxation' and 'Cultural/Historical Sites' — would they prefer to balance these in a single trip or do they tend to plan separate trips for each?\n\n3. No dealbreakers were noted — is there any destination or hotel brand they've had a bad experience with?",
      "timestamp": "2026-04-13T..."
    }
  ]
}
```

#### `POST /clients/{client_id}/intakes/{intake_id}/chat/message`

**Request:**
```json
{
  "sessionId": "uuid",
  "advisorMessage": "They have Delta Diamond status and mostly fly Delta or partners. Bad experience with United years ago.",
  "messageHistory": [ ...prior messages... ]
}
```

**Response:**
```json
{
  "message": {
    "role": "assistant",
    "content": "That's helpful! Given their Delta Diamond status, a few follow-ups:\n\n1. Do they prefer to redeem miles for upgrades or keep them for future flights?\n2. Since they avoid United, should we also flag Star Alliance partners as a potential concern, or just United specifically?",
    "timestamp": "..."
  },
  "suggestedProfileUpdates": [
    {
      "field": "preferredAirlines",
      "value": ["Delta", "Delta partners"],
      "confidence": "high",
      "reason": "Confirmed Delta Diamond status"
    },
    {
      "field": "avoidedAirlines",
      "value": ["United"],
      "confidence": "high",
      "reason": "Advisor confirmed bad experience"
    }
  ]
}
```

#### `POST /clients/{client_id}/intakes/{intake_id}/chat/commit`

Commits `suggestedProfileUpdates` to the intake record. Advisor selects which ones to apply before completing intake.

---

### System Prompt Design (Claude)

```
You are a travel advisor discovery assistant helping a travel advisor build a detailed client preference profile.

The advisor has filled out a structured intake form with the following information:
{intake_data_as_structured_text}

Your role is to:
1. Identify gaps or vague answers in the profile that could affect trip planning
2. Spot potential contradictions (e.g., budget orientation but luxury accommodation preferences)
3. Ask 2-3 smart, specific follow-up questions the advisor can ask their client
4. When the advisor shares the client's answers, interpret them and suggest concrete profile updates
5. Keep questions conversational and specific — avoid generic questions

Tone: Professional, concise, helpful. You are writing questions the advisor will read aloud or relay to a client. Do not use jargon.

After 4-6 exchanges, offer a "Discovery Summary" that lists the key things learned and suggests profile field updates.
```

---

## Part 4: Discovery Tab Redesign

### Current State

The Discovery tab has 4 collapsible sections:
1. **Meetings** — standalone AI discovery sessions
2. **Intake Questionnaires** — lists intake forms
3. **Insights** — inferred preferences from trip history
4. **Follow-Up Questions** — AI-generated questions to ask

### New Design

Reorganize Discovery into 3 sections that reflect the new intake model:

---

#### Section 1 — Profile Intakes
*Previously "Intake Questionnaires"*

- Rename to **"Profile Intakes"** to reflect that intakes are now profile-building exercises, not trip-specific
- Show each intake with: status badge (Draft / Complete), last updated date, summary of filled sections
- Replace the "New Intake" label with **"Build Profile"**
- Show a completion percentage bar for each intake (how much of the profile is filled)
- Highlight any intake that was completed with the AI chatbot (show a "AI Discovery" badge)
- Remove the "Duplicate" action (less useful for profile intakes vs. trip-specific intakes)
- Keep "Delete"

---

#### Section 2 — AI Discovery Sessions
*Previously "Meetings"*

- Rename to **"AI Discovery Sessions"** to better reflect purpose
- Each session links to the existing meeting copilot page
- Add a "Start New Session" CTA that is more prominent
- Show session stats: questions asked, preferences captured, last active

---

#### Section 3 — Profile Insights
*Merge the current "Insights" and "Follow-Up Questions" sections*

Two sub-tabs or two accordion sub-sections within Insights:

**Inferred Preferences** (current "Insights"):
- Keep as-is: Accept / Reject cards for AI-inferred preferences
- Add a "Re-analyze" button that re-runs inference after new intakes

**Open Questions** (current "Follow-Up Questions"):
- Rename to "Open Questions"
- These are questions the system flags as still unanswered in the profile
- Keep Generate / Refresh button
- Add ability to mark a question as "answered via intake" to dismiss it
- Show question category as a pill badge (e.g., "Budget", "Flights", "Loyalty")

---

### Tab Label Change

Change the tab label from `Discovery` to **`Profile & Discovery`** to better communicate that this is where client understanding lives.

Or alternatively, keep it as `Discovery` but add a subtitle in the tab content header.

---

## Part 5: Summary of File Changes

| File | Change |
|------|--------|
| `frontend/src/app/(app)/clients/[clientId]/intake/_components/intake-form.tsx` | Restructure steps, remove trip-specific fields, add AI chat step |
| `frontend/src/app/(app)/clients/[clientId]/page.tsx` | Remove Operations tab, update Discovery tab sections, rename labels |
| `frontend/src/lib/api-client.ts` | Add chat API methods (`startIntakeChat`, `sendChatMessage`, `commitChatSuggestions`) |
| `backend/src/routes/intake.py` | Add `/chat/start`, `/chat/message`, `/chat/commit` endpoints |
| `backend/src/handlers/openAI.py` (or new `anthropic.py`) | Add Anthropic SDK handler for Claude-powered chat |
| `frontend/prisma/schema.prisma` | Add `homeAirports`, `willingToReposition`, `activityLevel`, `hardConstraints`, `softPreferences`, `medicalNotes`, `accommodationDealbreakers` fields; move trip-specific fields to TripRequest |

---

## Part 6: Implementation Order

### Phase 1 — Remove Operations Tab (30 min)
1. Remove `operations` from Tab type in `page.tsx`
2. Remove Operations tab from `tabs` array
3. Remove Operations render block
4. Remove `ClientOperationsPanel` import

### Phase 2 — Restructure Intake Form (2–3 hrs)
1. Update `STEPS` array — remove Trip Basics and Dates steps, restructure remaining steps
2. Update form field rendering for each new step
3. Add `homeAirports`, `activityLevel`, `willingToReposition`, `hardConstraints` fields to form state
4. Update `toFormData` and `fromFormData` helpers
5. Update Prisma schema to add new fields
6. Run Prisma migration

### Phase 3 — AI Chat Step (3–4 hrs)
1. Add Anthropic SDK to backend dependencies (`anthropic` Python package)
2. Create `backend/src/handlers/anthropic_handler.py` with the Claude client and intake chat logic
3. Add `/chat/start`, `/chat/message`, `/chat/commit` routes to `intake.py`
4. Add `startIntakeChat`, `sendChatMessage`, `commitChatSuggestions` to `api-client.ts`
5. Build the Step 7 chat UI in `intake-form.tsx`
6. Wire up loading states, error handling, and the profile update commit flow

### Phase 4 — Discovery Tab Redesign (2–3 hrs)
1. Rename "Intake Questionnaires" section to "Profile Intakes"
2. Rename "Meetings" to "AI Discovery Sessions"
3. Merge Insights and Follow-Up Questions into "Profile Insights" with sub-sections
4. Update tab label if desired
5. Add completion percentage display to intake cards
6. Update section CTAs (rename "New Intake" → "Build Profile")

---

## Open Questions

1. **Where does trip budget live?** — A general "typical budget range" can stay on the profile (as a preference signal), but per-trip budget belongs on TripRequest. Decide whether to keep `budgetMin`/`budgetMax` on the profile as soft guidance.

2. **Backward compatibility** — Existing `ClientIntake` records have `destinations` and `tripType`. Decide: migrate them to TripRequest records, or keep them as legacy data and just hide those fields in the new form UI.

3. **Chatbot session persistence** — Should chat history be stored in the DB (new `ProfileChatMessage` model) or kept in frontend state only? Storing it lets advisors resume sessions and provides an audit trail.

4. **Operations tab data** — Before removing the tab, confirm that none of the vendor request data is actively used. The `ClientOperationsPanel` component and its API routes can remain in the codebase even if the tab is hidden.

5. **Intake rename** — "Intake" as a term is used throughout the DB schema, API routes, and URL paths (`/intake/new`). Decide whether to rename the model and routes to `profile` or keep `intake` internally while changing only the UI labels.
