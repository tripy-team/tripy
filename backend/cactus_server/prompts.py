"""Prompt templates for the Cactus live-call AI engine."""

TRAVEL_PREFERENCE_FIELDS = """
ONLY extract into the fields listed here. Any field not in this list will be
silently dropped — do not invent new field names.

Flight:
- preferredCabin: economy | premium_economy | business | first | flexible
- prefersNonstop: boolean
- maxLayoverMinutes: number (minutes)
- willingToReposition: boolean (driving/train to a cheaper airport)
- avoidBasicEconomy: boolean
- preferredAirlines: string[] (airline names or IATA codes)
- avoidedAirlines: string[]
- preferredDepartureAirports: string[] (home airports, e.g. "JFK", "SFO")

Hotel:
- preferredHotelTypes: string[] (boutique, resort, chain, all-inclusive, villa, etc.)
- roomPreferences: string[] (high floor, quiet room, king bed, ocean view, etc.)
- locationPreferences: string (walkable downtown, beachfront, near metro, etc.)

Budget & points:
- redemptionStyle: save_points | balanced | maximize_experience
- budgetSensitivity: price_conscious | moderate | comfort_first | luxury
- pointsVsCash: string (e.g. "points for flights, cash for hotels")
- loyaltyNotes: string — freeform text for credit card points, airline miles,
  hotel status, and willingness to transfer. Examples:
    "Chase Sapphire Reserve ~300k UR, willing to transfer to Hyatt"
    "Amex Platinum, ~500k Membership Rewards, United 1K status"
    "Delta Diamond, Marriott Titanium"
  Use this field for ANY concrete loyalty/points detail the client mentions.
- budgetNotes: string — concrete budget anchors the client stated. Examples:
    "~$8k per person for the honeymoon"
    "hotels under $500/night"
    "flights capped at $1500 each"
  Use this for actual dollar figures. Use budgetSensitivity for the qualitative tier.

Destinations & timing:
- preferredDestinations: string[] (places they've mentioned wanting or loving:
  "Italy", "Japan", "Patagonia")
- dateFlexibility: string ("flexible within June", "fixed: June 10-17",
  "avoid school weeks", "need to use by year-end")
- travelPace: relaxed | moderate | active | packed
- pastTripFeedback: string — what the client loved or hated on previous trips.
  Examples: "Loved Amalfi villa, hated the Positano crowds", "Best trip was
  the Safari; worst was the cruise — too rigid."

Dietary, accessibility, activities:
- accessibilityNeeds: string[] (wheelchair, ground floor, service animal, etc.)
- foodPreferences: string[] — dietary restrictions AND positive preferences:
  "vegetarian", "gluten-free", "no shellfish", "halal", "kosher", "loves sushi"
- activityPreferences: string[] (spa, golf, hiking, museums, nightlife, etc.)

Travel party & occasions:
- familyConsiderations: string (traveling with 2 kids ages 3 and 6, elderly
  parent needs ground floor, pregnant, etc.)
- specialOccasions: string[] (honeymoon, anniversary, milestone birthday, etc.)

Negative preferences:
- dislikes: string[] (crowds, long bus rides, red-eye flights, etc.)
- dealbreakers: string[] (hard no's: shared bathrooms, connecting flights
  through a specific hub, middle seats, etc.)

Freeform:
- notes: string — anything noteworthy that doesn't fit the fields above.
"""

KEYWORD_EXTRACTION_PROMPT = """You are a fast keyword spotter for a luxury travel advisor's live call. You only look at what the CLIENT just said, paired with the advisor's most recent question for context. Transcription is sketchy and often arrives as a few stray words rather than full sentences. Your job is to spot any concrete travel-preference keyword in the client's fragment and map it directly to a profile field.

Client name: {client_name}

What we already know about this client:
{existing_profile}

Advisor's most recent question (context only — never extract preferences from this): "{prior_question}"

Client just said: "{client_text}"

{field_definitions}

RULES:
- Only extract from what the client said. The advisor's question is context to disambiguate short answers.
- Use the advisor's question to resolve short answers:
    advisor asked "which cabin do you prefer?" + client said "business" → preferredCabin: "business"
    advisor asked "nonstop or a layover for savings?" + client said "nonstop" → prefersNonstop: true
    advisor asked "any dietary needs?" + client said "vegetarian" → foodPreferences: ["vegetarian"]
    advisor asked "favorite airlines?" + client said "United" → preferredAirlines: ["United"]
- If the client's fragment contains a concrete keyword on its own, map it directly. Examples:
    "business class" → preferredCabin: "business"
    "nonstop" / "direct flight" → prefersNonstop: true
    "Marriott" / "Four Seasons" / hotel brand → preferredHotelTypes or notes
    "wheelchair" / "stroller" / "service animal" → accessibilityNeeds
    "honeymoon" / "anniversary" / "birthday" → specialOccasions
    "boutique" / "resort" / "all-inclusive" → preferredHotelTypes
    "red-eye" (negative tone) → redEyeTolerance: "prefer not"
    "points" / "miles" → pointsVsCash: "prefer points"
    "luxury" / "splurge" → budgetSensitivity: "luxury"
- Confidence guide:
    0.85 — explicit keyword present, or a short answer that resolves unambiguously against the advisor's question
    0.65 — keyword present but ambiguous on its own
    skip if you would emit below 0.6
- Do NOT invent preferences. If the client said only "yeah" or "um" with no clear yes/no alignment to a specific field in the advisor's question, return [].
- NEVER copy a preference out of the advisor's question itself.

Return a JSON array. Each item:
- "targetField": one of the fields above
- "suggestedValue": the value (correct type)
- "confidence": 0.6 to 0.95
- "evidence": the exact keyword(s) from the client's fragment

Return ONLY the JSON array, no prose. Empty array if nothing matches: []"""


EXTRACTION_PROMPT = """You are an AI assistant helping a travel advisor during a live client call.
Analyze the labeled Q&A transcript below and extract travel preferences.

Client name: {client_name}

What we already know about this client:
{existing_profile}

Recent transcript (each line is prefixed with [advisor] or [client]):
{recent_text}

{field_definitions}

HOW TO READ THE TRANSCRIPT:
- [advisor] lines are the advisor's questions or prompts — they are context, NEVER a source of preferences.
- [client] lines are the client's answers — this is where preferences come from.
- To interpret a short client answer ("yes", "business", "Marriott"), pair it with the [advisor] line immediately before it. For example:
    [advisor]: do you prefer nonstop or will you take a layover for savings?
    [client]: nonstop, definitely
  → prefersNonstop: true, confidence high.
- A client answer that only agrees ("yeah", "sure", "that works") counts as a preference only if the preceding advisor line named a specific, unambiguous option.

RULES:
- Only extract what the [client] explicitly stated or clearly agreed to.
- Never copy a preference out of the advisor's question itself (e.g. if the advisor lists "business or first" and the client says nothing concrete, extract nothing).
- Do NOT guess or infer weak signals.

Return a JSON array of extractions. Each extraction must have:
- "targetField": one of the fields listed above
- "suggestedValue": the extracted value (matching the field's type)
- "confidence": 0.0-1.0 (how confident you are)
- "evidence": a short quote from the [client] line (plus the [advisor] question if needed for context)

If nothing can be extracted, return an empty array: []

Return ONLY valid JSON, no other text."""

REACTIVE_QUESTION_PROMPT = """You are an AI assistant helping a travel advisor during a live client call.

Recent conversation (each line prefixed with [advisor] or [client]):
{client_utterance}

What we already know about this client:
{existing_profile}

What we just learned from this exchange:
{new_extractions}

Profile fields still empty:
{missing_fields}

Questions already asked in this conversation:
{asked_questions}

Generate 1-3 natural follow-up questions the ADVISOR should ask next. They should:
1. DIG DEEPER into what the [client] just said (not random topic changes)
2. Feel conversational — the advisor should be able to ask these naturally
3. Target specific empty profile fields when possible
4. Prioritize questions that reveal preferences with high trip-planning value

RULES:
- Build on the [client] lines, not the [advisor] lines. The advisor's previous questions are context; don't re-ask them.
- If the client mentioned a destination, ask about their travel style THERE
- If the client mentioned a budget concern, ask about their flexibility/tradeoffs
- If the client mentioned a past trip, ask what they loved/hated about it
- If the client mentioned family, ask about ages/needs/preferences of family members
- Never repeat a question already asked in this conversation
- Never ask about information we already have

Return a JSON array:
[{{
  "questionText": "...",
  "category": "travel_style|budget|logistics|preferences|family|loyalty",
  "reason": "why this question matters right now",
  "priority": "high|medium|low",
  "targetFields": ["field1", "field2"],
  "triggerPhrase": "what the client said that prompted this"
}}]

Return ONLY valid JSON, no other text."""

TRIP_CONTEXT_QUESTION_PROMPT = """You are helping a travel advisor during a live call about a specific trip.

Trip details:
- Destination: {destinations}
- Dates: {travel_dates}
- Travelers: {traveler_names}
- Current status: {status}

Recent conversation (each line prefixed with [advisor] or [client] — build on the [client] lines):
{client_utterance}

What we already know about this client:
{existing_profile}

What we just learned:
{new_extractions}

Profile fields still empty:
{missing_fields}

Questions already asked:
{asked_questions}

Generate 1-3 follow-up questions that are SPECIFIC to this trip, not generic travel questions.
Focus on details that will directly improve this trip's planning.

Return a JSON array:
[{{
  "questionText": "...",
  "category": "trip_specific|travel_style|budget|logistics|preferences|family|loyalty",
  "reason": "why this question matters for THIS trip",
  "priority": "high|medium|low",
  "targetFields": ["field1", "field2"],
  "triggerPhrase": "what the client said that prompted this"
}}]

Return ONLY valid JSON, no other text."""
