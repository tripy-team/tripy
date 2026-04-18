"""Prompt templates for the Cactus live-call AI engine."""

TRAVEL_PREFERENCE_FIELDS = """
Target fields for discovery (ClientPreference model):
- preferredCabin: economy | premium_economy | business | first | flexible
- prefersNonstop: boolean
- maxLayoverMinutes: number
- willingToReposition: boolean
- avoidBasicEconomy: boolean
- preferredAirlines: string[] (airline names or codes)
- avoidedAirlines: string[]
- preferredHotelTypes: string[] (boutique, resort, chain, etc.)
- roomPreferences: string[] (high floor, quiet room, king bed, etc.)
- locationPreferences: string (walkable downtown, beachfront, etc.)
- redemptionStyle: save_points | balanced | maximize_experience
- budgetSensitivity: price_conscious | moderate | comfort_first | luxury
- pointsVsCash: string (prefer points, prefer cash, flexible)
- accessibilityNeeds: string[] (wheelchair, dietary, etc.)
- foodPreferences: string[] (vegetarian, no shellfish, halal, etc.)
- activityPreferences: string[] (adventure, cultural, relaxation, etc.)
- familyConsiderations: string (traveling with kids, elderly, etc.)
- specialOccasions: string[] (anniversary, birthday, honeymoon, etc.)
- dislikes: string[] (crowds, long bus rides, etc.)
- dealbreakers: string[] (shared bathrooms, red-eye flights, etc.)

Extended soft fields:
- seatPreference: aisle | window | no preference
- frontBackPreference: front | back | no preference
- extraLegroom: important | nice-to-have | not important
- lieFlatBusiness: must-have | nice-to-have | not important
- premiumEconomyWillingness: yes | no | depends
- redEyeTolerance: fine | prefer not | never
- maxAcceptableTravelTime: hours
- travelPace: relaxed | moderate | active | packed
- splurgeCategories: string[] (dining, hotel upgrades, experiences)
- badPastExperiences: string[] (so we can avoid repeating them)
- whatMakesTripWorthwhile: string (the emotional/experiential goal)
"""

EXTRACTION_PROMPT = """You are an AI assistant helping a travel advisor during a live client call.
Analyze what was just said and extract any travel preferences or profile information.

Client name: {client_name}

What we already know about this client:
{existing_profile}

Recent transcript to analyze:
{recent_text}

{field_definitions}

Extract structured preferences from the transcript. Only extract things the client
explicitly stated or strongly implied. Do NOT guess or infer weak signals.

Return a JSON array of extractions. Each extraction must have:
- "targetField": one of the fields listed above
- "suggestedValue": the extracted value (matching the field's type)
- "confidence": 0.0-1.0 (how confident you are)
- "evidence": the exact quote or close paraphrase from the transcript

If nothing can be extracted, return an empty array: []

Return ONLY valid JSON, no other text."""

REACTIVE_QUESTION_PROMPT = """You are an AI assistant helping a travel advisor during a live client call.

The client just said: "{client_utterance}"

What we already know about this client:
{existing_profile}

What we just learned from this statement:
{new_extractions}

Profile fields still empty:
{missing_fields}

Questions already asked in this conversation:
{asked_questions}

Generate 1-3 natural follow-up questions that:
1. DIG DEEPER into what the client just mentioned (not random topic changes)
2. Feel conversational — the advisor should be able to ask these naturally
3. Target specific empty profile fields when possible
4. Prioritize questions that reveal preferences with high trip-planning value

RULES:
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

The client just said: "{client_utterance}"

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
