import OpenAI from "openai";

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
}

export interface MeetingRecapResult {
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
// Generate initial discovery questions
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

  const prompt = `You are a Meeting Copilot for a luxury travel advisor. During a live client discovery meeting, generate the most valuable questions the advisor should ask next.

${TRAVEL_PREFERENCE_FIELDS}

Client: ${context.clientName}

Known preferences:
${prefSummary}

Conversation so far:
${conversationLines}
${alreadyAsked}

Generate 5-8 smart questions ranked by priority. Focus on:
1. Critical gaps in preference data that block trip planning
2. Areas where the client may have unstated preferences
3. Emotional and experiential goals (what makes travel feel worthwhile)
4. Dealbreakers and bad experiences to avoid
5. Family/group dynamics that affect planning

Return a JSON object with key "questions" containing an array of objects, each with:
- questionText: the question the advisor should ask (conversational, not robotic)
- category: one of "flight", "hotel", "budget", "experience", "logistics", "family", "dealbreakers", "emotional"
- reason: why this question matters for trip planning (1 sentence)
- priority: "high", "medium", or "low"
- targetFields: array of preference field names this question helps fill`;

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
// Generate follow-up questions based on latest answers
// ---------------------------------------------------------------------------

export async function generateFollowUpQuestions(
  context: MeetingContext,
  latestAnswer: string,
): Promise<GeneratedQuestion[]> {
  const contextWithAnswer = {
    ...context,
    conversationSoFar: [
      ...context.conversationSoFar,
      { role: "advisor_note", content: latestAnswer },
    ],
  };
  return generateMeetingQuestions(contextWithAnswer);
}

// ---------------------------------------------------------------------------
// Extract structured profile suggestions from conversation
// ---------------------------------------------------------------------------

export async function extractProfileSuggestions(
  context: MeetingContext,
): Promise<ExtractedProfileSuggestion[]> {
  const conversationLines = context.conversationSoFar
    .map((e) => `[${e.role}]: ${e.content}`)
    .join("\n");

  const prompt = `You are an AI assistant for a luxury travel advisor. Analyze the meeting conversation below and extract structured traveler preferences that should be saved to the client profile.

${TRAVEL_PREFERENCE_FIELDS}

Client: ${context.clientName}

Meeting conversation:
${conversationLines}

For each preference you can infer from the conversation, return a JSON object with key "suggestions" containing an array of objects, each with:
- targetField: the exact field name from the preference model above
- suggestedValue: the value to set (use the correct type: string, boolean, number, or array)
- confidence: 0.0 to 1.0 (how confident you are based on what was said)
- evidence: the exact quote or paraphrase from the conversation that supports this
- rationale: why this value is the best interpretation (1 sentence)

Rules:
- Only extract preferences explicitly discussed or strongly implied
- For ambiguous statements, set confidence below 0.6
- Prefer specific values over vague ones
- If the client contradicted themselves, note the contradiction and set confidence low
- Include all relevant fields, even soft/extended ones not in the formal schema`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackSuggestions(context);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);
  return (parsed.suggestions || []).map(
    (s: Record<string, unknown>) => ({
      targetField: s.targetField || s.target_field || "",
      suggestedValue: s.suggestedValue ?? s.suggested_value ?? null,
      confidence: typeof s.confidence === "number" ? s.confidence : 0.5,
      evidence: s.evidence || "",
      rationale: s.rationale || "",
    }),
  );
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
  return {
    travelerSummary: `Discovery meeting with ${context.clientName}. ${entryCount} conversation entries recorded. Review the full conversation for detailed traveler preferences and priorities.`,
    newPreferencesLearned:
      "• Review meeting notes for specific preferences discussed\n• Check extracted suggestions for structured updates",
    unresolvedQuestions:
      "• Confirm budget range and flexibility\n• Clarify dealbreakers and must-haves\n• Discuss points vs cash preference",
    nextSteps:
      "• Review and approve extracted profile suggestions\n• Schedule follow-up if key areas were not covered\n• Create trip request based on meeting outcomes",
  };
}
