import OpenAI from "openai";
import type { ProfileSnapshot } from "./profile-completeness";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeetingContext {
  clientName: string;
  existingPreferences?: Record<string, unknown>;
  conversationSoFar: { role: string; content: string }[];
  previousQuestions?: string[];
  profileSnapshot?: ProfileSnapshot;
  contextPrompt?: string;
}

export interface AnsweredQuestion {
  questionText: string;
  answer: string;
  category?: string;
}

export interface SingleAnswerExtractionInput {
  questionText: string;
  answer: string;
  targetFields?: string[];
  contextPrompt?: string;
}

export interface RelatedClient {
  clientId: string;
  name: string;
  relationship: string;
}

export interface CrossClientInsight {
  clientId: string;
  clientName: string;
  targetField: string;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
  rationale: string;
}

export interface SingleAnswerExtractedSuggestion {
  targetField: string;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
  status: "pending";
}

export interface GeneratedQuestion {
  questionText: string;
  category: string;
  reason: string;
  priority: "high" | "medium" | "low";
  targetFields: string[];
}

export interface ExtractedProfileSuggestion {
  targetField: string;
  suggestedValue: unknown;
  confidence: number;
  evidence: string;
  rationale: string;
  category?: string;
}

export interface MeetingRecapResult {
  conversationSummary: string;
  travelerSummary: string;
  newPreferencesLearned: string;
  unresolvedQuestions: string;
  nextSteps: string;
}

// ---------------------------------------------------------------------------
// Domain knowledge: travel preference fields the AI should cover
// ---------------------------------------------------------------------------

const TRAVEL_PREFERENCE_FIELDS = `
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

Extended soft fields (not in schema but useful to capture as notes):
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
`;

// ---------------------------------------------------------------------------
// Helpers for profile-aware prompts
// ---------------------------------------------------------------------------

function buildProfileAwarenessBlock(snapshot?: ProfileSnapshot): string {
  if (!snapshot) return "";

  const { completeness, knownPreferences, sessionInsights } = snapshot;
  const lines: string[] = ["\n--- PROFILE AWARENESS ---"];

  lines.push(`Profile completeness: ${completeness.overallPercent}%`);
  lines.push(
    `Ready for trip planning: ${completeness.readyForTripPlanning ? "YES" : "NO"}`,
  );

  if (completeness.emptyCriticalFields.length > 0) {
    lines.push(
      `CRITICAL GAPS (must fill before trip planning): ${completeness.emptyCriticalFields.join(", ")}`,
    );
  }

  if (completeness.emptyFields.length > 0) {
    lines.push(`Other missing fields: ${completeness.emptyFields.join(", ")}`);
  }

  const knownEntries = Object.entries(knownPreferences).filter(
    ([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (knownEntries.length > 0) {
    lines.push("Known committed preferences:");
    for (const [k, v] of knownEntries) {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  if (sessionInsights.length > 0) {
    lines.push("Session insights (not yet committed):");
    for (const s of sessionInsights) {
      lines.push(
        `  ${s.targetField}: ${JSON.stringify(s.suggestedValue)} (confidence: ${s.confidence})`,
      );
    }
  }

  lines.push("--- END PROFILE AWARENESS ---\n");
  return lines.join("\n");
}

function buildContextPromptBlock(contextPrompt?: string): string {
  const trimmed = contextPrompt?.trim();
  if (!trimmed) return "";
  return `\n--- ADVISOR'S PRE-MEETING CONTEXT ---\nThe advisor wrote this before the meeting to describe what they want to cover:\n"""\n${trimmed}\n"""\nUse this to prioritize what you ask about and what you extract. Stay relevant to this context.\n--- END PRE-MEETING CONTEXT ---\n`;
}

function questionCountForCompleteness(overallPercent: number): string {
  if (overallPercent < 30) return "5-7";
  if (overallPercent < 70) return "3-5";
  return "2-3";
}

// ---------------------------------------------------------------------------
// Generate initial discovery questions (profile-aware)
// ---------------------------------------------------------------------------

export async function generateMeetingQuestions(
  context: MeetingContext,
): Promise<GeneratedQuestion[]> {
  const prefSummary = context.existingPreferences
    ? Object.entries(context.existingPreferences)
        .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join("\n")
    : "  (none on file)";

  const conversationLines =
    context.conversationSoFar.length > 0
      ? context.conversationSoFar
          .map((e) => `  [${e.role}]: ${e.content}`)
          .join("\n")
      : "  (no conversation yet)";

  const alreadyAsked = context.previousQuestions?.length
    ? `\nQuestions already asked (do NOT repeat these):\n${context.previousQuestions.map((q) => `  - ${q}`).join("\n")}`
    : "";

  const profileBlock = buildProfileAwarenessBlock(context.profileSnapshot);
  const contextBlock = buildContextPromptBlock(context.contextPrompt);
  const questionCount = context.profileSnapshot
    ? questionCountForCompleteness(context.profileSnapshot.completeness.overallPercent)
    : "5-8";

  const prompt = `You are a Meeting Copilot for a luxury travel advisor. During a live client discovery meeting, generate the most valuable questions the advisor should ask next.

${TRAVEL_PREFERENCE_FIELDS}
${profileBlock}${contextBlock}
Client: ${context.clientName}

Known preferences:
${prefSummary}

Conversation so far:
${conversationLines}
${alreadyAsked}

Generate ${questionCount} smart questions ranked by priority. Focus on:
1. CRITICAL GAPS first — fields that block trip planning (preferredCabin, budgetSensitivity, dealbreakers)
2. Areas where the client may have unstated preferences
3. Emotional and experiential goals (what makes travel feel worthwhile)
4. Dealbreakers and bad experiences to avoid
5. Family/group dynamics that affect planning

Rules:
- Prioritize questions that fill critical missing fields
- Do NOT ask about fields that are already well-known unless clarification is needed
- Keep questions conversational, not robotic — sound like a thoughtful advisor
- Each question should clearly target 1-3 preference fields

Return a JSON object with key "questions" containing an array of objects, each with:
- questionText: the question the advisor should ask (conversational, not robotic)
- category: one of "flight", "hotel", "budget", "experience", "logistics", "family", "dealbreakers", "emotional"
- reason: why this question matters for trip planning (1 sentence)
- priority: "high", "medium", or "low"
- targetFields: array of preference field names this question helps fill
- rationale: one of "critical_gap", "clarification", "depth" — why this question is being suggested`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackQuestions(context);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);
  return (parsed.questions || []).map(
    (q: Record<string, unknown>) => ({
      questionText: q.questionText || q.question_text || "",
      category: q.category || "experience",
      reason: q.reason || "",
      priority: q.priority || "medium",
      targetFields: q.targetFields || q.target_fields || [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Generate follow-up questions based on answered Q&A pairs
// ---------------------------------------------------------------------------

export async function generateFollowUpQuestions(
  context: MeetingContext,
  answeredQuestions: AnsweredQuestion[],
): Promise<GeneratedQuestion[]> {
  const prefSummary = context.existingPreferences
    ? Object.entries(context.existingPreferences)
        .filter(
          ([, v]) =>
            v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
        )
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join("\n")
    : "  (none on file)";

  const conversationLines =
    context.conversationSoFar.length > 0
      ? context.conversationSoFar
          .map((e) => `  [${e.role}]: ${e.content}`)
          .join("\n")
      : "  (no conversation yet)";

  const answeredBlock = answeredQuestions
    .map(
      (qa, i) =>
        `  ${i + 1}. Q: ${qa.questionText}\n     A: ${qa.answer}${qa.category ? ` [${qa.category}]` : ""}`,
    )
    .join("\n");

  const alreadyAsked = context.previousQuestions?.length
    ? `\nAll questions already asked (do NOT repeat these):\n${context.previousQuestions.map((q) => `  - ${q}`).join("\n")}`
    : "";

  const profileBlock = buildProfileAwarenessBlock(context.profileSnapshot);
  const contextBlock = buildContextPromptBlock(context.contextPrompt);
  const questionCount = context.profileSnapshot
    ? questionCountForCompleteness(context.profileSnapshot.completeness.overallPercent)
    : "4-6";

  const prompt = `You are a Meeting Copilot for a luxury travel advisor. The advisor has asked questions and recorded client answers. Now generate the NEXT round of deeper follow-up questions based on what the client revealed.

${TRAVEL_PREFERENCE_FIELDS}
${profileBlock}${contextBlock}
Client: ${context.clientName}

Known preferences:
${prefSummary}

Full conversation so far:
${conversationLines}

Questions asked & client answers this session:
${answeredBlock}
${alreadyAsked}

Based on the answers above, generate ${questionCount} follow-up questions that dig deeper. Focus on:
1. CRITICAL GAPS first — if any critical fields (preferredCabin, budgetSensitivity, dealbreakers) are still missing, prioritize those
2. Drill into vague or incomplete answers — get specifics
3. Explore contradictions or surprising answers
4. Uncover adjacent preferences implied by their answers
5. Fill remaining high-value gaps in the preference profile
6. Ask about emotional motivations behind stated preferences

Rules:
- Do NOT repeat any previously asked question
- Each follow-up should clearly build on something the client said
- Do NOT ask about fields that are already well-filled unless clarification is needed
- Keep questions conversational and warm

Return a JSON object with key "questions" containing an array of objects, each with:
- questionText: the follow-up question (conversational, references what the client said)
- category: one of "flight", "hotel", "budget", "experience", "logistics", "family", "dealbreakers", "emotional"
- reason: why this follow-up matters, referencing the answer it builds on (1 sentence)
- priority: "high", "medium", or "low"
- targetFields: array of preference field names this question helps fill
- rationale: one of "critical_gap", "clarification", "depth"`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackFollowUpQuestions(context, answeredQuestions);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);
  return (parsed.questions || []).map(
    (q: Record<string, unknown>) => ({
      questionText: q.questionText || q.question_text || "",
      category: q.category || "experience",
      reason: q.reason || "",
      priority: q.priority || "medium",
      targetFields: q.targetFields || q.target_fields || [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Extract structured profile suggestions from conversation
// ---------------------------------------------------------------------------

export async function extractProfileSuggestions(
  context: MeetingContext,
  existingSuggestions?: { targetField: string; suggestedValue: unknown }[],
): Promise<ExtractedProfileSuggestion[]> {
  const conversationLines = context.conversationSoFar
    .map((e) => `[${e.role}]: ${e.content}`)
    .join("\n");

  const alreadyExtracted = existingSuggestions?.length
    ? `\nPreferences already extracted in this session (with current confidence levels):\n${existingSuggestions
        .map((s) => `  - ${s.targetField}: ${JSON.stringify(s.suggestedValue)}`)
        .join("\n")}`
    : "";

  const contextBlock = buildContextPromptBlock(context.contextPrompt);

  const prompt = `You are an AI assistant for a luxury travel advisor. Analyze the meeting conversation below and extract COMPREHENSIVE traveler preferences and insights that should be saved to the client profile.

${TRAVEL_PREFERENCE_FIELDS}
${contextBlock}
Client: ${context.clientName}

Meeting conversation:
${conversationLines}
${alreadyExtracted}

Your job is to be thorough and diverse — extract EVERY useful insight from the conversation. Think about:

1. **Explicit preferences**: Things the client directly stated they want or don't want
2. **Implied preferences**: Reading between the lines — if they rave about a boutique hotel in Kyoto, infer they like boutique hotels AND cultural destinations
3. **Personality-driven insights**: Their travel personality — are they a planner or spontaneous? Do they value comfort or adventure? Do they seek status or authenticity?
4. **Relationship dynamics**: How they travel with others, who influences decisions, compromise patterns
5. **Emotional drivers**: What feelings they're chasing — escape, connection, accomplishment, romance, nostalgia
6. **Anti-preferences**: Not just dealbreakers but subtle aversions — things that make them uncomfortable or bored
7. **Lifestyle context**: Work schedule constraints, health considerations, cultural background that affects travel
8. **Aspiration signals**: Destinations or experiences they dream about, even if mentioned casually

For each insight, return a JSON object with key "suggestions" containing an array of objects, each with:
- targetField: the field name from the preference model above (for novel insights that don't map to a field, use "notes" and include a descriptive prefix in the value like "Travel personality: ..." or "Aspiration: ...")
- suggestedValue: the value to set (use the correct type: string, boolean, number, or array)
- confidence: 0.0 to 1.0 (how confident you are based on what was said — if the client has repeated or reinforced a preference multiple times, confidence should be HIGHER, approaching 1.0)
- evidence: the exact quote or close paraphrase from the conversation that supports this
- rationale: why this insight matters for trip planning (1 sentence)
- category: one of "flights", "hotels", "budget", "experiences", "lifestyle", "dealbreakers", "emotional", "logistics", "family", "food_and_dining"

Rules:
- Be COMPREHENSIVE — extract 10-20+ insights if the conversation is rich
- If you find NEW evidence that reinforces a previously extracted preference, DO include it again with higher confidence — we use repeated mentions to increase certainty
- For truly new insights not in the existing list, include them normally
- For array fields (like activityPreferences, dislikes), include NEW items not already captured
- Look for nuance — "I like hiking" vs "I like challenging multi-day treks" are different insights
- Capture the texture of preferences, not just binary yes/no
- For ambiguous statements, set confidence below 0.6 but still include them
- If the client contradicted themselves, note both sides with low confidence
- Don't be afraid to use "notes" for rich qualitative insights that don't fit a field`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackSuggestions(context);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);
  const raw: ExtractedProfileSuggestion[] = (parsed.suggestions || []).map(
    (s: Record<string, unknown>) => ({
      targetField: s.targetField || s.target_field || "",
      suggestedValue: s.suggestedValue ?? s.suggested_value ?? null,
      confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
      evidence: s.evidence || "",
      rationale: s.rationale || "",
      category: s.category || "experiences",
    }),
  );

  return raw;
}

// ---------------------------------------------------------------------------
// Extract preferences from a single answered question (per-answer extraction)
// ---------------------------------------------------------------------------

export async function extractFromSingleAnswer(
  input: SingleAnswerExtractionInput,
  clientName: string,
): Promise<SingleAnswerExtractedSuggestion[]> {
  const targetFieldHint = input.targetFields?.length
    ? `\nThe question was designed to discover these fields: ${input.targetFields.join(", ")}. Focus extraction on these fields, but also extract any other clearly stated preferences.`
    : "";

  const contextBlock = buildContextPromptBlock(input.contextPrompt);

  const prompt = `You are a precise preference extraction engine for a luxury travel advisor platform. Extract structured client preferences from a single question-answer pair.

${TRAVEL_PREFERENCE_FIELDS}
${contextBlock}
Client: ${clientName}

Question asked: "${input.questionText}"
Client's answer: "${input.answer}"
${targetFieldHint}

Extract 1-5 specific, structured preferences from this answer. Rules:
- ONLY extract what is clearly stated or strongly implied by the answer
- Do NOT hallucinate or over-infer — if it's ambiguous, skip it
- For each preference, map it to the correct targetField from the model above
- Set confidence based on how explicit the statement was:
  - 0.9-1.0: Directly and explicitly stated ("I always fly business class")
  - 0.7-0.85: Strongly implied ("I can't stand long flights" → prefersNonstop likely true)
  - 0.5-0.65: Moderately implied, needs confirmation
  - Below 0.5: Don't include it — too speculative
- Use "notes" as targetField for rich qualitative insights that don't map to a specific field

Return a JSON object with key "suggestions" containing an array of objects, each with:
- targetField: the preference field name
- suggestedValue: the value (correct type: string, boolean, number, or string[])
- confidence: 0.5 to 1.0
- evidence: the exact quote or close paraphrase from the answer`;

  if (!process.env.OPENAI_API_KEY) {
    return extractFallbackFromAnswer(input);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  const parsed = JSON.parse(content);
  return (parsed.suggestions || [])
    .slice(0, 5)
    .map((s: Record<string, unknown>) => ({
      targetField: s.targetField || s.target_field || "",
      suggestedValue: s.suggestedValue ?? s.suggested_value ?? null,
      confidence: typeof s.confidence === "number" ? Math.max(0.5, Math.min(1, s.confidence)) : 0.5,
      evidence: s.evidence || "",
      status: "pending" as const,
    }))
    .filter((s: SingleAnswerExtractedSuggestion) => s.targetField && s.suggestedValue !== null);
}

function extractFallbackFromAnswer(
  input: SingleAnswerExtractionInput,
): SingleAnswerExtractedSuggestion[] {
  const answer = input.answer.toLowerCase();
  const suggestions: SingleAnswerExtractedSuggestion[] = [];

  const patterns: Array<{ pattern: RegExp; field: string; value: unknown; confidence: number }> = [
    { pattern: /business\s*class/i, field: "preferredCabin", value: "business", confidence: 0.85 },
    { pattern: /first\s*class/i, field: "preferredCabin", value: "first", confidence: 0.85 },
    { pattern: /economy/i, field: "preferredCabin", value: "economy", confidence: 0.7 },
    { pattern: /\bnonstop\b|\bdirect\s*flight/i, field: "prefersNonstop", value: true, confidence: 0.8 },
    { pattern: /\bbudget\b|\bprice.?conscious/i, field: "budgetSensitivity", value: "price_conscious", confidence: 0.65 },
    { pattern: /\bluxury\b|\bsplurge\b/i, field: "budgetSensitivity", value: "luxury", confidence: 0.65 },
    { pattern: /\bboutique\b/i, field: "preferredHotelTypes", value: ["boutique"], confidence: 0.7 },
    { pattern: /\bresort\b/i, field: "preferredHotelTypes", value: ["resort"], confidence: 0.7 },
  ];

  for (const { pattern, field, value, confidence } of patterns) {
    if (pattern.test(answer)) {
      suggestions.push({
        targetField: field,
        suggestedValue: value,
        confidence,
        evidence: input.answer.slice(0, 200),
        status: "pending",
      });
    }
  }

  return suggestions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Cross-client profile extraction
// ---------------------------------------------------------------------------

export async function extractCrossClientInsights(
  context: MeetingContext,
  relatedClients: RelatedClient[],
): Promise<CrossClientInsight[]> {
  if (relatedClients.length === 0) return [];

  const conversationLines = context.conversationSoFar
    .map((e) => `[${e.role}]: ${e.content}`)
    .join("\n");

  if (!conversationLines.trim()) return [];

  const clientList = relatedClients
    .map((c) => `  - "${c.name}" (ID: ${c.clientId}, relationship to meeting client: ${c.relationship})`)
    .join("\n");

  const prompt = `You are an AI assistant for a luxury travel advisor platform. You are analyzing a discovery meeting conversation with "${context.clientName}" to find information about OTHER people who are also clients in the system.

${TRAVEL_PREFERENCE_FIELDS}

KNOWN RELATED CLIENTS (these people exist in the system):
${clientList}

MEETING CONVERSATION (this meeting is with ${context.clientName}):
${conversationLines}

Your task: Look for ANY information about the related clients listed above that was mentioned during this meeting. People often reveal preferences about their travel companions, family members, or friends.

Examples of what to look for:
- "My wife Sarah always insists on business class" → extract preferredCabin for Sarah
- "My husband hates long layovers" → extract prefersNonstop for husband
- "The kids are picky eaters, especially Tom" → extract foodPreferences for Tom
- "My mom needs wheelchair assistance" → extract accessibilityNeeds for mom
- "Dad loves adventure travel, always wants to go hiking" → extract activityPreferences for dad
- "My partner prefers boutique hotels over big chains" → extract preferredHotelTypes

Rules:
- ONLY extract preferences for the related clients listed above — match by name or relationship
- A match must be clear — the conversation must reference the person by name or by a relationship that maps to exactly one related client
- Set confidence based on how explicit and direct the statement is:
  - 0.6-0.75: Mentioned indirectly or implied ("my wife doesn't like..." when spouse is a client)
  - 0.75-0.85: Clearly stated about the person ("Sarah prefers...")
  - 0.85-0.95: Explicitly and repeatedly stated
- Do NOT extract preferences for the meeting's primary client (${context.clientName}) — those are handled separately
- If nothing about related clients is mentioned, return an empty array

Return a JSON object with key "insights" containing an array of objects, each with:
- clientId: the ID of the related client this insight is about
- clientName: the name of the related client
- targetField: the preference field name from the model above
- suggestedValue: the value (correct type)
- confidence: 0.5 to 0.95 (apply a slight discount since this is second-hand information)
- evidence: the exact quote or close paraphrase
- rationale: why this matters for that client's trip planning`;

  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const validClientIds = new Set(relatedClients.map((c) => c.clientId));

    return (parsed.insights || [])
      .filter((i: Record<string, unknown>) => {
        const id = i.clientId || i.client_id;
        return typeof id === "string" && validClientIds.has(id);
      })
      .map((i: Record<string, unknown>) => ({
        clientId: (i.clientId || i.client_id) as string,
        clientName: (i.clientName || i.client_name || "") as string,
        targetField: (i.targetField || i.target_field || "") as string,
        suggestedValue: i.suggestedValue ?? i.suggested_value ?? null,
        confidence: typeof i.confidence === "number"
          ? Math.max(0.5, Math.min(0.95, i.confidence))
          : 0.6,
        evidence: (i.evidence || "") as string,
        rationale: (i.rationale || "") as string,
      }))
      .filter((i: CrossClientInsight) => i.targetField && i.suggestedValue !== null);
  } catch (err) {
    console.error("Cross-client insight extraction failed:", err);
    return [];
  }
}

export async function extractCrossClientFromSingleAnswer(
  input: SingleAnswerExtractionInput,
  primaryClientName: string,
  relatedClients: RelatedClient[],
): Promise<CrossClientInsight[]> {
  if (relatedClients.length === 0) return [];

  const clientList = relatedClients
    .map((c) => `  - "${c.name}" (ID: ${c.clientId}, relationship: ${c.relationship})`)
    .join("\n");

  const prompt = `You are a precise preference extraction engine. Extract travel preferences mentioned about OTHER people (not the primary client) from a single Q&A pair.

${TRAVEL_PREFERENCE_FIELDS}

Primary client (do NOT extract for this person): ${primaryClientName}

Related clients to look for:
${clientList}

Question asked: "${input.questionText}"
Client's answer: "${input.answer}"

Extract preferences ONLY for the related clients listed above. If the answer mentions nothing about them, return an empty array.

Confidence should be 0.5-0.85 (second-hand information discount).

Return a JSON object with key "insights" containing an array (possibly empty) of objects, each with:
- clientId: the related client's ID
- clientName: the related client's name
- targetField: the preference field
- suggestedValue: the value
- confidence: 0.5 to 0.85
- evidence: quote from the answer
- rationale: why this matters`;

  if (!process.env.OPENAI_API_KEY) return [];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const validClientIds = new Set(relatedClients.map((c) => c.clientId));

    return (parsed.insights || [])
      .filter((i: Record<string, unknown>) => {
        const id = i.clientId || i.client_id;
        return typeof id === "string" && validClientIds.has(id);
      })
      .map((i: Record<string, unknown>) => ({
        clientId: (i.clientId || i.client_id) as string,
        clientName: (i.clientName || i.client_name || "") as string,
        targetField: (i.targetField || i.target_field || "") as string,
        suggestedValue: i.suggestedValue ?? i.suggested_value ?? null,
        confidence: typeof i.confidence === "number"
          ? Math.max(0.5, Math.min(0.85, i.confidence))
          : 0.6,
        evidence: (i.evidence || "") as string,
        rationale: (i.rationale || "") as string,
      }))
      .filter((i: CrossClientInsight) => i.targetField && i.suggestedValue !== null);
  } catch (err) {
    console.error("Cross-client per-answer extraction failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generate meeting recap
// ---------------------------------------------------------------------------

export async function generateMeetingRecap(
  context: MeetingContext,
  approvedSuggestions: { targetField: string; suggestedValue: unknown }[],
  rejectedSuggestions: { targetField: string; suggestedValue: unknown }[],
): Promise<MeetingRecapResult> {
  const conversationLines = context.conversationSoFar
    .map((e) => `[${e.role}]: ${e.content}`)
    .join("\n");

  const approvedStr = approvedSuggestions.length
    ? approvedSuggestions
        .map((s) => `  - ${s.targetField}: ${JSON.stringify(s.suggestedValue)}`)
        .join("\n")
    : "  (none)";

  const rejectedStr = rejectedSuggestions.length
    ? rejectedSuggestions
        .map((s) => `  - ${s.targetField}: ${JSON.stringify(s.suggestedValue)}`)
        .join("\n")
    : "  (none)";

  const prompt = `You are an AI assistant for a luxury travel advisor. Generate a concise recap of a client discovery meeting.

Client: ${context.clientName}

Meeting conversation:
${conversationLines}

Profile updates approved by advisor:
${approvedStr}

Profile updates rejected by advisor:
${rejectedStr}

Generate a JSON object with these keys:
- conversation_summary: a chronological 4-6 sentence narrative summary of the conversation itself — what the advisor asked, what the client said, how the discussion flowed, and any notable moments or topic shifts. Write it in plain prose, not bullets.
- traveler_summary: 2-3 sentences summarizing who this traveler is, their travel style, and key priorities
- new_preferences_learned: bullet list of new preferences learned in this meeting (use "• " prefix)
- unresolved_questions: bullet list of topics that still need clarification or weren't covered (use "• " prefix)
- next_steps: bullet list of recommended next actions for the advisor (use "• " prefix)`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackRecap(context);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.6,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);
  return {
    conversationSummary: parsed.conversation_summary || "",
    travelerSummary: parsed.traveler_summary || "",
    newPreferencesLearned: parsed.new_preferences_learned || "",
    unresolvedQuestions: parsed.unresolved_questions || "",
    nextSteps: parsed.next_steps || "",
  };
}

// ---------------------------------------------------------------------------
// Fallbacks (when no OpenAI key)
// ---------------------------------------------------------------------------

function generateFallbackQuestions(
  context: MeetingContext,
): GeneratedQuestion[] {
  const known = context.existingPreferences || {};
  const questions: GeneratedQuestion[] = [];

  if (!known.preferredCabin) {
    questions.push({
      questionText:
        "When you fly, do you have a cabin preference? Are you open to premium economy or business class, or do you typically prefer economy?",
      category: "flight",
      reason:
        "Cabin preference is fundamental to routing and pricing strategies.",
      priority: "high",
      targetFields: ["preferredCabin"],
    });
  }

  if (known.prefersNonstop == null) {
    questions.push({
      questionText:
        "How do you feel about layovers? Do you strongly prefer nonstop flights, or are you open to connections if it saves money or opens up better options?",
      category: "flight",
      reason:
        "Layover tolerance directly affects available routes and pricing.",
      priority: "high",
      targetFields: ["prefersNonstop", "maxLayoverMinutes"],
    });
  }

  if (!known.budgetSensitivity) {
    questions.push({
      questionText:
        "How would you describe your approach to travel budgets? Are you more focused on finding the best value, or do you prefer to prioritize comfort and experience?",
      category: "budget",
      reason:
        "Budget sensitivity determines which redemption strategies are viable.",
      priority: "high",
      targetFields: ["budgetSensitivity", "redemptionStyle"],
    });
  }

  if (!known.dealbreakers || (Array.isArray(known.dealbreakers) && known.dealbreakers.length === 0)) {
    questions.push({
      questionText:
        "Are there any absolute dealbreakers for you when traveling? Things that would ruin a trip — certain airlines, hotel types, travel styles?",
      category: "dealbreakers",
      reason:
        "Dealbreakers prevent costly recommendation mistakes.",
      priority: "high",
      targetFields: ["dealbreakers", "dislikes"],
    });
  }

  if (!known.preferredHotelTypes) {
    questions.push({
      questionText:
        "What kind of hotels do you gravitate toward? Boutique properties, big-name chains, resorts, or something else?",
      category: "hotel",
      reason: "Hotel style is essential for accommodation planning.",
      priority: "medium",
      targetFields: ["preferredHotelTypes", "locationPreferences"],
    });
  }

  questions.push({
    questionText:
      "When you think back on your best trip ever, what made it special? What would you want to recreate?",
    category: "emotional",
    reason:
      "Understanding what makes travel feel worthwhile reveals deep preferences.",
    priority: "medium",
    targetFields: ["activityPreferences", "specialOccasions"],
  });

  questions.push({
    questionText:
      "Have you had any bad travel experiences that you'd like to make sure we avoid?",
    category: "dealbreakers",
    reason:
      "Past negative experiences reveal hidden constraints and dealbreakers.",
    priority: "medium",
    targetFields: ["dealbreakers", "dislikes", "avoidedAirlines"],
  });

  questions.push({
    questionText:
      "Do you have any dietary needs, accessibility requirements, or health considerations we should keep in mind?",
    category: "logistics",
    reason: "Accessibility and dietary needs are non-negotiable constraints.",
    priority: "high",
    targetFields: ["accessibilityNeeds", "foodPreferences"],
  });

  return questions;
}

function generateFallbackFollowUpQuestions(
  context: MeetingContext,
  answeredQuestions: AnsweredQuestion[],
): GeneratedQuestion[] {
  const questions: GeneratedQuestion[] = [];
  const previousTexts = new Set(
    (context.previousQuestions || []).map((q) => q.toLowerCase()),
  );

  const answerText = answeredQuestions
    .map((qa) => `${qa.questionText} ${qa.answer}`)
    .join(" ")
    .toLowerCase();

  const categoryFollowUps: Record<string, GeneratedQuestion[]> = {
    flight: [
      {
        questionText:
          "You mentioned your flight preferences — when it comes to long-haul flights specifically, is there a minimum cabin class you'd want, or does it depend on the destination?",
        category: "flight",
        reason:
          "Long-haul vs short-haul preferences often differ and affect routing.",
        priority: "high",
        targetFields: ["preferredCabin", "prefersNonstop"],
      },
      {
        questionText:
          "Are there specific airlines you've had great experiences with, or any you'd rather avoid entirely?",
        category: "flight",
        reason:
          "Airline loyalty and aversions directly shape booking options.",
        priority: "medium",
        targetFields: ["preferredAirlines", "avoidedAirlines"],
      },
    ],
    hotel: [
      {
        questionText:
          "You shared some thoughts on hotels — how important is location versus the property itself? Would you pick a less fancy hotel in a perfect spot, or a luxury property further out?",
        category: "hotel",
        reason:
          "Location vs. property trade-off reveals booking prioritization.",
        priority: "high",
        targetFields: ["locationPreferences", "preferredHotelTypes"],
      },
      {
        questionText:
          "Any specific room preferences that make a stay better for you — like a high floor, a view, a king bed, or a quiet room away from the elevator?",
        category: "hotel",
        reason: "Room-level details prevent day-of disappointments.",
        priority: "medium",
        targetFields: ["roomPreferences"],
      },
    ],
    budget: [
      {
        questionText:
          "Based on what you shared about budget — are there specific areas of a trip where you're happy to splurge, like dining, hotel upgrades, or unique experiences?",
        category: "budget",
        reason:
          "Knowing splurge categories helps allocate budget where it matters most.",
        priority: "high",
        targetFields: ["splurgeCategories", "budgetSensitivity"],
      },
      {
        questionText:
          "When it comes to paying for travel, do you tend to prefer using points and miles, or would you rather pay cash and keep things simple?",
        category: "budget",
        reason:
          "Points vs. cash preference determines redemption strategy.",
        priority: "medium",
        targetFields: ["pointsVsCash", "redemptionStyle"],
      },
    ],
    experience: [
      {
        questionText:
          "You mentioned what you enjoy in travel — how would you describe your ideal pace? Do you like a packed itinerary, or would you rather have a few key activities and lots of free time?",
        category: "experience",
        reason:
          "Travel pace shapes daily itinerary structure and activity density.",
        priority: "high",
        targetFields: ["travelPace", "activityPreferences"],
      },
      {
        questionText:
          "Is there anything you've always wanted to try on a trip but haven't yet — a cooking class, a helicopter tour, a multi-day trek, that kind of thing?",
        category: "experience",
        reason:
          "Aspirational activities reveal deeper experiential preferences.",
        priority: "medium",
        targetFields: ["activityPreferences", "specialOccasions"],
      },
    ],
    dealbreakers: [
      {
        questionText:
          "You shared some things you'd rather avoid — can you think of a specific trip where something went wrong? What happened, and what would you want us to do differently?",
        category: "dealbreakers",
        reason:
          "Concrete bad experiences reveal non-obvious constraints.",
        priority: "high",
        targetFields: ["badPastExperiences", "dealbreakers"],
      },
      {
        questionText:
          "Are there any travel styles or situations that make you genuinely uncomfortable — like very crowded destinations, shared accommodations, or red-eye flights?",
        category: "dealbreakers",
        reason:
          "Comfort boundaries are hard to reverse once a trip is booked.",
        priority: "medium",
        targetFields: ["dealbreakers", "dislikes", "redEyeTolerance"],
      },
    ],
    emotional: [
      {
        questionText:
          "Thinking about what you said — when you come home from a great trip, what's the feeling you want to have? Relaxed and recharged, or excited and full of stories?",
        category: "emotional",
        reason:
          "The desired emotional outcome drives the entire trip design.",
        priority: "high",
        targetFields: ["whatMakesTripWorthwhile"],
      },
      {
        questionText:
          "Are there any upcoming milestones or occasions — an anniversary, birthday, retirement — where travel could play a special role?",
        category: "emotional",
        reason:
          "Occasion-based travel has different expectations and planning needs.",
        priority: "medium",
        targetFields: ["specialOccasions"],
      },
    ],
    family: [
      {
        questionText:
          "You mentioned who you typically travel with — how do their preferences differ from yours? Are there things they'd insist on that you might not choose yourself?",
        category: "family",
        reason:
          "Group dynamics create hidden constraints the primary traveler may not voice.",
        priority: "high",
        targetFields: ["familyConsiderations"],
      },
      {
        questionText:
          "When traveling with others, who usually makes the final decisions on where to stay or what to do — is it collaborative, or does one person take the lead?",
        category: "family",
        reason:
          "Knowing the decision-maker prevents misaligned recommendations.",
        priority: "medium",
        targetFields: ["familyConsiderations"],
      },
    ],
    logistics: [
      {
        questionText:
          "Based on what you've shared — how far in advance do you usually like to plan trips? Do you prefer having everything locked down early, or do you like some flexibility?",
        category: "logistics",
        reason:
          "Planning horizon affects fare classes, availability, and pricing.",
        priority: "medium",
        targetFields: ["travelPace"],
      },
      {
        questionText:
          "Is there a maximum travel time you'd tolerate to reach a destination — like, is 20+ hours of flying a dealbreaker, or are you open to it for the right place?",
        category: "logistics",
        reason:
          "Maximum travel time limits destination options for trip planning.",
        priority: "medium",
        targetFields: ["maxAcceptableTravelTime"],
      },
    ],
  };

  const answeredCategories = new Set<string>();
  for (const qa of answeredQuestions) {
    if (qa.category) answeredCategories.add(qa.category);
  }

  if (answeredCategories.size === 0) {
    for (const qa of answeredQuestions) {
      const a = qa.answer.toLowerCase();
      const q = qa.questionText.toLowerCase();
      const combined = `${q} ${a}`;
      if (combined.match(/\b(fly|flight|cabin|airline|nonstop|layover|seat)\b/))
        answeredCategories.add("flight");
      if (combined.match(/\b(hotel|room|resort|boutique|stay|property)\b/))
        answeredCategories.add("hotel");
      if (combined.match(/\b(budget|cost|price|money|spend|splurge|points|miles)\b/))
        answeredCategories.add("budget");
      if (combined.match(/\b(experience|activity|adventure|culture|relax|explore)\b/))
        answeredCategories.add("experience");
      if (combined.match(/\b(deal.?breaker|avoid|hate|worst|never|terrible)\b/))
        answeredCategories.add("dealbreakers");
      if (combined.match(/\b(feel|love|special|dream|emotional|meaningful|anniversary|birthday)\b/))
        answeredCategories.add("emotional");
      if (combined.match(/\b(family|kids|partner|spouse|group|parent|children)\b/))
        answeredCategories.add("family");
    }
  }

  for (const cat of answeredCategories) {
    const pool = categoryFollowUps[cat];
    if (!pool) continue;
    for (const fu of pool) {
      if (!previousTexts.has(fu.questionText.toLowerCase())) {
        questions.push(fu);
      }
    }
  }

  const uncoveredCategories = Object.keys(categoryFollowUps).filter(
    (cat) => !answeredCategories.has(cat),
  );
  for (const cat of uncoveredCategories) {
    if (questions.length >= 6) break;
    const pool = categoryFollowUps[cat];
    if (!pool) continue;
    const candidate = pool[0];
    if (candidate && !previousTexts.has(candidate.questionText.toLowerCase())) {
      questions.push({ ...candidate, priority: "low" });
    }
  }

  if (questions.length === 0) {
    questions.push({
      questionText:
        "Looking at everything you've shared so far — what's the one thing you'd want us to absolutely get right when planning your next trip?",
      category: "emotional",
      reason:
        "A broad synthesis question helps surface the client's top priority.",
      priority: "high",
      targetFields: ["whatMakesTripWorthwhile"],
    });
    questions.push({
      questionText:
        "Is there a destination that's been on your bucket list that we should start thinking about?",
      category: "experience",
      reason: "Dream destinations help frame future planning conversations.",
      priority: "medium",
      targetFields: ["activityPreferences"],
    });
  }

  return questions.slice(0, 6);
}

function generateFallbackSuggestions(
  context: MeetingContext,
): ExtractedProfileSuggestion[] {
  const suggestions: ExtractedProfileSuggestion[] = [];
  const allText = context.conversationSoFar
    .map((e) => e.content)
    .join(" ")
    .toLowerCase();

  if (allText.includes("business class") || allText.includes("lie flat")) {
    suggestions.push({
      targetField: "preferredCabin",
      suggestedValue: "business",
      confidence: 0.75,
      evidence: "Client mentioned business class or lie-flat seats in conversation.",
      rationale: "Direct mention of business class indicates cabin preference.",
    });
  }

  if (allText.includes("nonstop") || allText.includes("direct flight")) {
    suggestions.push({
      targetField: "prefersNonstop",
      suggestedValue: true,
      confidence: 0.8,
      evidence: "Client expressed preference for nonstop/direct flights.",
      rationale: "Explicit mention of nonstop preference.",
    });
  }

  if (allText.includes("budget") || allText.includes("price conscious")) {
    suggestions.push({
      targetField: "budgetSensitivity",
      suggestedValue: "price_conscious",
      confidence: 0.6,
      evidence: "Client discussed budget concerns during the meeting.",
      rationale: "Budget-related language suggests price sensitivity.",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      targetField: "notes",
      suggestedValue: `Meeting notes captured on ${new Date().toLocaleDateString()}. Review conversation for detailed preferences.`,
      confidence: 0.5,
      evidence: "General meeting notes.",
      rationale:
        "No specific preferences could be extracted automatically; manual review recommended.",
    });
  }

  return suggestions;
}

function generateFallbackRecap(
  context: MeetingContext,
): MeetingRecapResult {
  const entryCount = context.conversationSoFar.length;
  const preview = context.conversationSoFar
    .slice(0, 4)
    .map((e) => `${e.role}: ${e.content.slice(0, 140)}`)
    .join(" → ");
  return {
    conversationSummary: preview
      ? `Conversation covered ${entryCount} exchanges. Excerpts: ${preview}`
      : `Discovery meeting with ${context.clientName} — no transcript captured.`,
    travelerSummary: `Discovery meeting with ${context.clientName}. ${entryCount} conversation entries recorded. Review the full conversation for detailed traveler preferences and priorities.`,
    newPreferencesLearned:
      "• Review meeting notes for specific preferences discussed\n• Check extracted suggestions for structured updates",
    unresolvedQuestions:
      "• Confirm budget range and flexibility\n• Clarify dealbreakers and must-haves\n• Discuss points vs cash preference",
    nextSteps:
      "• Review and approve extracted profile suggestions\n• Schedule follow-up if key areas were not covered\n• Create trip request based on meeting outcomes",
  };
}
