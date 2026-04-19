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
  hotel status, and willingness to transfer. ALWAYS capture the points
  currency/program AND the amount when the client states a balance.

  Format each balance as "Program: <amount><unit>" (e.g. "Chase UR: 300k",
  "Amex MR: 500k", "United MileagePlus: 100k miles", "Marriott Bonvoy: 250k").
  Join multiple balances with "; ". Preserve the client's wording for anything
  else (status tier, card name, willingness to transfer).

  Number normalization (transcription may arrive any of these ways):
    "three hundred thousand", "300,000", "300 thousand", "300 K", "300k"
      → write as "300k"
    "1.2 million", "a million and a half", "1,500,000"
      → write as "1.5M"
    "about half a million", "roughly 500 K"
      → write as "~500k"

  Currency / program aliases to canonicalize:
    "UR" / "Ultimate Rewards" / "Chase points" → "Chase UR"
    "MR" / "Membership Rewards" / "Amex points" → "Amex MR"
    "ThankYou" / "TY points" / "Citi points" → "Citi TY"
    "Capital One miles" / "Venture miles" → "Capital One"
    "Bilt points" → "Bilt"
    airline miles: keep the airline name — "United miles", "Delta SkyMiles",
    "American AAdvantage", "Alaska Mileage Plan"
    hotel points: keep the program — "Hyatt", "Marriott Bonvoy", "Hilton Honors",
    "IHG One Rewards", "World of Hyatt"

  Full examples of what to write:
    client says "I've got about 300k Chase points and 500 thousand Amex MR"
      → "Chase UR: 300k; Amex MR: 500k"
    client says "300,000 United miles, Globalist with Hyatt, Titanium with Marriott"
      → "United MileagePlus: 300k miles; Hyatt: Globalist status; Marriott Bonvoy: Titanium status"
    client says "I'm fine transferring points if the math is better"
      → "willing to transfer points for better value"

- budgetNotes: string — concrete budget anchors with dollar figures or other
  currencies the client stated. ALWAYS preserve both the amount AND the
  currency symbol/code.

  Number/currency normalization:
    "eight thousand dollars", "$8,000", "8k", "8 grand" → "$8k"
    "ten thousand euros", "€10,000", "10k euro" → "€10k"
    "a thousand pounds per night", "£1000/night" → "£1k/night"
    "thirty five hundred" (in USD context) → "$3.5k"
    currencies to watch for: $ (USD), € (EUR), £ (GBP), ¥ (JPY),
      AU$ / A$ (AUD), C$ (CAD), CHF, zł (PLN)
    if the currency is ambiguous, write "8k USD" / "10k EUR" rather than
    guessing a symbol.

  Per-unit anchors the client states (per person, per night, total):
    "$8k per person for the honeymoon"
    "hotels under $500/night"
    "flights capped at $1500 each"
    "total trip budget around $25k"

  Use budgetNotes for dollar/currency figures. Use budgetSensitivity for the
  qualitative tier (price_conscious, moderate, comfort_first, luxury).

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
    advisor asked "how many Chase points?" + client said "about three hundred thousand" → loyaltyNotes: "Chase UR: 300k"
    advisor asked "what's your budget?" + client said "around eight thousand per person" → budgetNotes: "$8k per person"
- Points / miles / currency — whenever the client states a NUMBER paired with
  a points program, airline, hotel brand, or a dollar amount, capture BOTH
  the amount AND the currency/program into loyaltyNotes or budgetNotes. See
  the loyaltyNotes / budgetNotes field definitions for exact formatting and
  the full list of program aliases. Examples:
    "about 300k Chase points" → loyaltyNotes: "Chase UR: 300k"
    "five hundred thousand Amex MR" → loyaltyNotes: "Amex MR: 500k"
    "I have 100,000 United miles" → loyaltyNotes: "United MileagePlus: 100k miles"
    "Hyatt Globalist" → loyaltyNotes: "Hyatt: Globalist status"
    "I'll transfer points if it makes sense" → loyaltyNotes: "willing to transfer points for better value"
    "budget is around ten grand" → budgetNotes: "$10k"
    "maybe five thousand euros per person" → budgetNotes: "€5k per person"
    "under a thousand dollars a night for hotels" → budgetNotes: "hotels under $1000/night"
    A bare number with no program/currency context ("300k" alone) is too ambiguous — skip unless the advisor's question supplies the program.
- If the client's fragment contains a concrete keyword on its own, map it directly. Examples:
    "business class" → preferredCabin: "business"
    "nonstop" / "direct flight" → prefersNonstop: true
    "Marriott" / "Four Seasons" / hotel brand → preferredHotelTypes or notes
    "wheelchair" / "stroller" / "service animal" → accessibilityNeeds
    "honeymoon" / "anniversary" / "birthday" → specialOccasions
    "boutique" / "resort" / "all-inclusive" → preferredHotelTypes
    "points" / "miles" (without a number) → pointsVsCash: "prefer points"
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

POINTS, MILES, AND BUDGET NUMBERS (critical — these arrive in many shapes):
- When the [client] states a numeric balance with a points program, airline,
  or hotel brand, extract into loyaltyNotes. Always capture BOTH the amount
  AND the program. See the loyaltyNotes field definition above for the
  canonical format ("Program: <amount>", joined with "; ") and the list of
  program aliases (UR, MR, TY, MileagePlus, Bonvoy, etc.).
- When the [client] states a dollar figure or other currency amount for
  their budget, extract into budgetNotes. Always capture BOTH the amount
  AND the currency. See the budgetNotes field definition for the format.
- Transcription may render numbers as words ("three hundred thousand"),
  abbreviated ("300k", "300 K"), or with commas ("300,000"). Normalize to
  the shortest unambiguous form ("300k", "1.5M"). Preserve the client's
  currency/program verbatim; don't convert currencies.
- Collapse multiple mentions in a single exchange into one loyaltyNotes or
  budgetNotes extraction (join with "; "), not many separate extractions.
  Example:
    [client]: I've got maybe 300k Chase points and about half a million Amex MR
    → one extraction: loyaltyNotes = "Chase UR: 300k; Amex MR: ~500k"
- If the client just says a bare number with no program or currency context
  ("about three hundred thousand") and the advisor's prior line doesn't name
  one either, skip — it's too ambiguous to attribute.

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
  "targetFields": ["field1", "field2"]
}}]

Return ONLY valid JSON, no other text."""

# System prefix for the fused analysis call. Kept free of per-call variables
# so identical bytes are sent on every request — OpenAI's automatic prefix
# caching then serves the ~1700-token field definitions + rules block from
# cache, lowering prefill latency by several hundred ms.
FUSED_ANALYSIS_SYSTEM = """You are an AI assistant helping a travel advisor during a live client call.
Your job has TWO tasks in a single response:
(1) extract travel preferences from the recent [client] lines, and
(2) generate 1-3 follow-up questions the advisor should ask next.

""" + TRAVEL_PREFERENCE_FIELDS + """

HOW TO READ THE TRANSCRIPT:
- [advisor] lines are context, NEVER a source of preferences.
- [client] lines are the source of preferences and what follow-up questions should build on.
- Pair short client answers ("yes", "business", "Marriott") with the immediately preceding [advisor] question.

EXTRACTION RULES:
- Only extract what the [client] explicitly stated or clearly agreed to.
- Never copy a preference out of the advisor's question itself.
- For points/miles/budget, capture BOTH the amount AND the program/currency. Normalize to "300k"/"1.5M"/"$8k" forms using the aliases in the loyaltyNotes/budgetNotes field definitions.
- If nothing can be extracted, return "extractions": [].

QUESTION RULES:
- Build on the [client] lines, not the [advisor] lines.
- Feel conversational — the advisor should be able to ask these naturally.
- Target specific empty profile fields when possible.
- Never repeat a question already asked in this conversation.
- Never ask about information we already have.
- If there is no meaningful client speech to build on, return "questions": [].

Return ONLY valid JSON in this exact shape — no prose, no markdown:
{
  "extractions": [
    {"targetField": "...", "suggestedValue": "...", "confidence": 0.0, "evidence": "..."}
  ],
  "questions": [
    {"questionText": "...", "category": "travel_style|budget|logistics|preferences|family|loyalty", "reason": "...", "priority": "high|medium|low", "targetFields": ["..."]}
  ]
}"""


FUSED_ANALYSIS_USER_TEMPLATE = """Client name: {client_name}

What we already know about this client:
{existing_profile}

Recent transcript (each line prefixed with [advisor] or [client]):
{recent_text}

Profile fields still empty:
{missing_fields}

Questions already asked in this conversation:
{asked_questions}
{trip_context_block}{visual_insight_block}"""


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
  "targetFields": ["field1", "field2"]
}}]

Return ONLY valid JSON, no other text."""
