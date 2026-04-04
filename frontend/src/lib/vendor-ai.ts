import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// ---------------------------------------------------------------------------
// Follow-up draft generation
// ---------------------------------------------------------------------------

export type DraftTone =
  | "gentle_nudge"
  | "firm_reminder"
  | "escalation"
  | "urgent_deadline";

export interface FollowUpDraftInput {
  vendorName: string;
  vendorContact?: string | null;
  requestType: string;
  requestDetails?: string | null;
  clientName?: string | null;
  tripTitle?: string | null;
  dueDate?: string | null;
  followUpCount: number;
  urgency: string;
  currentStatus: string;
  tone: DraftTone;
}

const TONE_INSTRUCTIONS: Record<DraftTone, string> = {
  gentle_nudge:
    "Write a polite, friendly follow-up. Assume the vendor is busy. Keep it warm and brief.",
  firm_reminder:
    "Write a professional but firm follow-up. Clearly reference the outstanding request and expected timeline.",
  escalation:
    "Write an escalation message. Convey that repeated follow-ups have been sent and a response is urgently needed. Remain professional but firm.",
  urgent_deadline:
    "Write an urgent message emphasizing an imminent deadline. Make the time-sensitivity very clear. Professional but direct.",
};

export async function generateFollowUpDraft(
  input: FollowUpDraftInput,
): Promise<string> {
  const prompt = `You are a professional travel advisor assistant. Generate a follow-up message to a vendor.

Context:
- Vendor: ${input.vendorName}${input.vendorContact ? ` (contact: ${input.vendorContact})` : ""}
- Request type: ${input.requestType.replace(/_/g, " ")}
- Details: ${input.requestDetails || "N/A"}
- Client: ${input.clientName || "N/A"}
- Trip: ${input.tripTitle || "N/A"}
- Due date: ${input.dueDate || "None specified"}
- Follow-ups already sent: ${input.followUpCount}
- Urgency: ${input.urgency}
- Current status: ${input.currentStatus.replace(/_/g, " ")}

Tone: ${TONE_INSTRUCTIONS[input.tone]}

Generate a concise, ready-to-send follow-up message. Do NOT include a subject line. Start with a greeting using the vendor name. End with a professional closing. Keep it under 150 words.`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackDraft(input);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 300,
  });

  return response.choices[0]?.message?.content?.trim() || generateFallbackDraft(input);
}

function generateFallbackDraft(input: FollowUpDraftInput): string {
  const greeting = `Dear ${input.vendorName} team,`;
  const ref = input.requestDetails
    ? `regarding our ${input.requestType.replace(/_/g, " ")} request (${input.requestDetails})`
    : `regarding our ${input.requestType.replace(/_/g, " ")} request`;

  const toneMap: Record<DraftTone, string> = {
    gentle_nudge: `I wanted to kindly follow up ${ref}. We understand you may be busy, but would appreciate an update at your convenience.`,
    firm_reminder: `I'm writing to follow up ${ref}. This is follow-up #${input.followUpCount + 1} and we would appreciate a response at your earliest convenience.${input.dueDate ? ` Our deadline is ${input.dueDate}.` : ""}`,
    escalation: `I'm following up again ${ref}. We've reached out ${input.followUpCount} time(s) previously without a response. We need to hear back promptly to proceed with our client's booking.`,
    urgent_deadline: `This is an urgent follow-up ${ref}. ${input.dueDate ? `Our deadline of ${input.dueDate} is approaching rapidly.` : "We need an immediate response."} Please prioritize this request.`,
  };

  const client = input.clientName ? `\n\nThis is for our client${input.tripTitle ? ` traveling on "${input.tripTitle}"` : ""}.` : "";

  return `${greeting}\n\n${toneMap[input.tone]}${client}\n\nThank you for your prompt attention.\n\nBest regards`;
}

// ---------------------------------------------------------------------------
// Client-to-vendor request translator
// ---------------------------------------------------------------------------

export interface TranslatorInput {
  vagueRequest: string;
  clientName?: string;
  tripType?: string;
  tripDestination?: string;
}

export interface TranslatorSuggestion {
  category: string;
  vendorAsk: string;
  specificity: "high" | "medium" | "low";
  requestType: string;
  confidence: number;
}

export interface TranslatorResult {
  suggestions: TranslatorSuggestion[];
  clarifyingQuestions: string[];
}

export async function translateClientRequest(
  input: TranslatorInput,
): Promise<TranslatorResult> {
  const prompt = `You are a travel operations expert. A travel advisor received a vague client request and needs to translate it into specific, operational vendor asks.

Client request: "${input.vagueRequest}"
${input.clientName ? `Client: ${input.clientName}` : ""}
${input.tripType ? `Trip type: ${input.tripType}` : ""}
${input.tripDestination ? `Destination: ${input.tripDestination}` : ""}

Return a JSON object with:
1. "suggestions": array of objects, each with:
   - "category": short category label (e.g. "Amenity", "Room", "Dining", "Transport", "Experience")
   - "vendor_ask": the specific, concrete vendor request text (operational and ready to send)
   - "specificity": "high", "medium", or "low"
   - "request_type": one of: room_upgrade, early_check_in, late_check_out, connecting_rooms, airport_transfer, amenity_request, dining_request, celebration_request, quote_request, custom_request
   - "confidence": 0-1 float indicating how confident this interpretation is
2. "clarifying_questions": array of strings — questions to ask the client when the request is too vague

Provide 2-6 suggestions. Be practical and operations-ready.`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackTranslation(input);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.6,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return generateFallbackTranslation(input);

  const parsed = JSON.parse(content);
  return {
    suggestions: (parsed.suggestions || []).map(
      (s: Record<string, unknown>) => ({
        category: s.category as string,
        vendorAsk: s.vendor_ask as string,
        specificity: s.specificity as "high" | "medium" | "low",
        requestType: s.request_type as string,
        confidence: s.confidence as number,
      }),
    ),
    clarifyingQuestions: parsed.clarifying_questions || [],
  };
}

function generateFallbackTranslation(
  input: TranslatorInput,
): TranslatorResult {
  const lower = input.vagueRequest.toLowerCase();
  const suggestions: TranslatorSuggestion[] = [];

  if (lower.includes("anniversary") || lower.includes("special") || lower.includes("celebrat")) {
    suggestions.push(
      { category: "Amenity", vendorAsk: "Champagne and chocolate-covered strawberries in-room upon arrival", specificity: "high", requestType: "celebration_request", confidence: 0.85 },
      { category: "Dining", vendorAsk: "Reserve a table with a view for anniversary dinner, note special occasion on reservation", specificity: "high", requestType: "dining_request", confidence: 0.8 },
      { category: "Room", vendorAsk: "Request high-floor room with best available view, king bed", specificity: "medium", requestType: "room_upgrade", confidence: 0.75 },
    );
  }
  if (lower.includes("luxury") || lower.includes("upscale") || lower.includes("premium")) {
    suggestions.push(
      { category: "Room", vendorAsk: "Upgrade to highest available suite or premium room category", specificity: "high", requestType: "room_upgrade", confidence: 0.9 },
      { category: "Amenity", vendorAsk: "Welcome amenity package with premium local items", specificity: "medium", requestType: "amenity_request", confidence: 0.7 },
    );
  }
  if (lower.includes("family") || lower.includes("kid") || lower.includes("child")) {
    suggestions.push(
      { category: "Room", vendorAsk: "Connecting rooms on the same floor, preferably near elevator", specificity: "high", requestType: "connecting_rooms", confidence: 0.85 },
      { category: "Amenity", vendorAsk: "Child-friendly amenities: crib/rollaway, child-proof room, kids welcome pack", specificity: "medium", requestType: "amenity_request", confidence: 0.8 },
    );
  }
  if (lower.includes("quiet") || lower.includes("peaceful") || lower.includes("relax")) {
    suggestions.push(
      { category: "Room", vendorAsk: "High-floor room away from elevator and ice machine, quiet side of property", specificity: "high", requestType: "room_upgrade", confidence: 0.85 },
    );
  }
  if (lower.includes("transfer") || lower.includes("airport") || lower.includes("pickup")) {
    suggestions.push(
      { category: "Transport", vendorAsk: "Private airport transfer with meet-and-greet, vehicle suitable for party size and luggage", specificity: "high", requestType: "airport_transfer", confidence: 0.9 },
    );
  }

  if (suggestions.length === 0) {
    suggestions.push(
      { category: "Custom", vendorAsk: `Custom request: ${input.vagueRequest}`, specificity: "low", requestType: "custom_request", confidence: 0.5 },
    );
  }

  const clarifyingQuestions: string[] = [];
  if (suggestions.some((s) => s.specificity === "low")) {
    clarifyingQuestions.push("Can you be more specific about what the client is looking for?");
  }
  if (!lower.includes("date") && !lower.includes("when")) {
    clarifyingQuestions.push("Is there a specific date or timeframe for this request?");
  }
  if (!lower.includes("budget") && !lower.includes("cost")) {
    clarifyingQuestions.push("Is there a budget or price sensitivity for this request?");
  }

  return { suggestions, clarifyingQuestions };
}
