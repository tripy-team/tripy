import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

interface MemoInput {
  tripTitle: string;
  origin: string[];
  destination: string[];
  departureDate: string;
  returnDate?: string;
  travelers: { name: string; type: string }[];
  topOption: {
    title: string;
    strategyType: string;
    totalCashCost: number;
    summary: string;
    allocations: {
      travelerName: string;
      paymentType: string;
      programName?: string;
      pointsUsed?: number;
      cashUsed?: number;
    }[];
    insights: { title: string; body: string; severity: string }[];
  };
  alternativeOptions: {
    title: string;
    strategyType: string;
    totalCashCost: number;
    summary: string;
  }[];
  clientPreferences?: {
    preferredCabin: string;
    redemptionStyle: string;
  };
}

export async function generateRecommendationMemo(input: MemoInput) {
  const prompt = `You are a travel advisor writing recommendation memos for luxury travel clients.

Given the following trip analysis data, generate three outputs:

1. **internal_summary**: A concise advisor-facing summary (2-3 paragraphs) explaining the recommendation logic, trade-offs considered, and strategic reasoning. Use industry jargon freely.

2. **client_summary**: A client-friendly summary (2-3 paragraphs) explaining what you recommend and why, written warmly and professionally. Avoid technical loyalty program jargon.

3. **email_draft**: A ready-to-send email draft the advisor can copy-paste to the client. Include a greeting, the recommendation summary, key next steps, and a warm closing.

Trip: ${input.tripTitle}
Route: ${input.origin.join("/")} → ${input.destination.join("/")}
Dates: ${input.departureDate}${input.returnDate ? ` – ${input.returnDate}` : " (one-way)"}
Travelers: ${input.travelers.map((t) => `${t.name} (${t.type})`).join(", ")}
${input.clientPreferences ? `Preferences: ${input.clientPreferences.preferredCabin} cabin, ${input.clientPreferences.redemptionStyle} style` : ""}

Top Recommendation: ${input.topOption.title} (${input.topOption.strategyType})
Cash cost: $${(input.topOption.totalCashCost / 100).toLocaleString()}
Summary: ${input.topOption.summary}

Traveler Allocations:
${input.topOption.allocations
  .map(
    (a) =>
      `- ${a.travelerName}: ${a.paymentType}${a.programName ? ` via ${a.programName}` : ""}${a.pointsUsed ? ` (${a.pointsUsed.toLocaleString()} pts)` : ""}${a.cashUsed ? ` ($${(a.cashUsed / 100).toLocaleString()})` : ""}`,
  )
  .join("\n")}

Key Insights:
${input.topOption.insights.map((i) => `- [${i.severity}] ${i.title}: ${i.body}`).join("\n")}

Alternative Strategies Considered:
${input.alternativeOptions.map((o) => `- ${o.title} (${o.strategyType}): $${(o.totalCashCost / 100).toLocaleString()} — ${o.summary}`).join("\n")}

Return a JSON object with keys: internal_summary, client_summary, email_draft. All values should be strings.`;

  if (!process.env.OPENAI_API_KEY) {
    return {
      internalSummary: generateFallbackInternalSummary(input),
      clientSummary: generateFallbackClientSummary(input),
      emailDraft: generateFallbackEmailDraft(input),
    };
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  const parsed = JSON.parse(content);
  return {
    internalSummary: parsed.internal_summary,
    clientSummary: parsed.client_summary,
    emailDraft: parsed.email_draft,
  };
}

// ---------------------------------------------------------------------------
// Trip Brief generation
// ---------------------------------------------------------------------------

export interface TripBriefInput {
  clientName: string;
  intake: {
    tripType?: string;
    destinations?: string[];
    departureAirports?: string[];
    dateFlexibility?: string;
    earliestDeparture?: string;
    latestReturn?: string;
    tripDurationDays?: number;
    budgetMin?: number;
    budgetMax?: number;
    budgetCurrency?: string;
    budgetNotes?: string;
    cabinPreference?: string;
    hotelStyles?: string[];
    loyaltyNotes?: string;
    accessibilityNeeds?: string;
    dietaryNeeds?: string;
    travelPace?: string;
    layoverTolerance?: string;
    luxuryPreference?: string;
    familyFriendly?: boolean;
    travelerCount?: number;
    childrenCount?: number;
    childrenAges?: number[];
    desiredExperiences?: string[];
    dealbreakers?: string[];
    preferredAirlines?: string[];
    avoidedAirlines?: string[];
    notes?: string;
  };
  preferences?: {
    preferredCabin?: string;
    prefersNonstop?: boolean;
    maxLayoverMinutes?: number;
    willingToReposition?: boolean;
    redemptionStyle?: string;
    avoidBasicEconomy?: boolean;
    preferredAirlines?: string[];
    avoidedAirlines?: string[];
  };
  loyaltyBalances?: { programName: string; balance: number }[];
  familyMembers?: { name: string; relationship: string }[];
}

export interface TripBriefResult {
  executiveSummary: string;
  hardConstraints: string;
  softPreferences: string;
  pointsCashPosture: string;
  acceptableTradeoffs: string;
  doNotRecommend: string;
  operationalNotes: string;
}

export async function generateTripBrief(
  input: TripBriefInput,
): Promise<TripBriefResult> {
  const prompt = `You are an expert travel advisor assistant. Generate a concise one-page advisor brief for a client trip. The brief must be readable in under 1 minute.

Given the following client and intake data, generate a JSON object with these seven sections:

1. **executive_summary**: 2-3 sentence summary of what the traveler wants — destination, trip type, who is traveling, when, and the overall vibe. Written for an advisor to quickly orient.

2. **hard_constraints**: Bullet list of non-negotiable requirements (dates, budget ceiling, accessibility needs, cabin minimums, dietary restrictions, etc.).

3. **soft_preferences**: Bullet list of nice-to-haves (hotel style, travel pace, preferred airlines, layover tolerance, luxury level, desired experiences).

4. **points_cash_posture**: 2-3 sentences on how the client wants to pay — their redemption style, loyalty program balances, willingness to use points vs cash, and any loyalty notes.

5. **acceptable_tradeoffs**: Bullet list of tradeoffs the advisor can make without checking back (e.g., "OK with 1-stop if saves 40k points", "flexible on hotel brand if location is central").

6. **do_not_recommend**: Bullet list of things to actively avoid — airlines, hotel types, destinations, experiences, or approaches the client dislikes or has flagged as dealbreakers.

7. **operational_notes**: Any logistical notes for the advisor — family considerations, special occasions, timing sensitivities, coordination needs, or anything that affects how to service this client.

Client: ${input.clientName}
${input.intake.tripType ? `Trip Type: ${input.intake.tripType}` : ""}
${input.intake.destinations?.length ? `Destinations: ${input.intake.destinations.join(", ")}` : ""}
${input.intake.departureAirports?.length ? `Departure From: ${input.intake.departureAirports.join(", ")}` : ""}
${input.intake.dateFlexibility ? `Date Flexibility: ${input.intake.dateFlexibility}` : ""}
${input.intake.earliestDeparture ? `Earliest Departure: ${input.intake.earliestDeparture}` : ""}
${input.intake.latestReturn ? `Latest Return: ${input.intake.latestReturn}` : ""}
${input.intake.tripDurationDays ? `Duration: ${input.intake.tripDurationDays} days` : ""}
${input.intake.budgetMin || input.intake.budgetMax ? `Budget: ${input.intake.budgetMin ? `$${input.intake.budgetMin}` : ""}${input.intake.budgetMin && input.intake.budgetMax ? " – " : ""}${input.intake.budgetMax ? `$${input.intake.budgetMax}` : ""} ${input.intake.budgetCurrency || "USD"}` : ""}
${input.intake.budgetNotes ? `Budget Notes: ${input.intake.budgetNotes}` : ""}
${input.intake.cabinPreference ? `Cabin: ${input.intake.cabinPreference}` : ""}
${input.intake.hotelStyles?.length ? `Hotel Styles: ${input.intake.hotelStyles.join(", ")}` : ""}
${input.intake.loyaltyNotes ? `Loyalty Notes: ${input.intake.loyaltyNotes}` : ""}
${input.intake.travelPace ? `Travel Pace: ${input.intake.travelPace}` : ""}
${input.intake.layoverTolerance ? `Layover Tolerance: ${input.intake.layoverTolerance}` : ""}
${input.intake.luxuryPreference ? `Luxury Level: ${input.intake.luxuryPreference}` : ""}
${input.intake.familyFriendly !== undefined ? `Family Friendly: ${input.intake.familyFriendly ? "Yes" : "No"}` : ""}
${input.intake.travelerCount ? `Travelers: ${input.intake.travelerCount}` : ""}
${input.intake.childrenCount ? `Children: ${input.intake.childrenCount}${input.intake.childrenAges?.length ? ` (ages: ${input.intake.childrenAges.join(", ")})` : ""}` : ""}
${input.intake.desiredExperiences?.length ? `Desired Experiences: ${input.intake.desiredExperiences.join(", ")}` : ""}
${input.intake.dealbreakers?.length ? `Dealbreakers: ${input.intake.dealbreakers.join(", ")}` : ""}
${input.intake.preferredAirlines?.length ? `Preferred Airlines: ${input.intake.preferredAirlines.join(", ")}` : ""}
${input.intake.avoidedAirlines?.length ? `Avoided Airlines: ${input.intake.avoidedAirlines.join(", ")}` : ""}
${input.intake.accessibilityNeeds ? `Accessibility: ${input.intake.accessibilityNeeds}` : ""}
${input.intake.dietaryNeeds ? `Dietary: ${input.intake.dietaryNeeds}` : ""}
${input.intake.notes ? `Notes: ${input.intake.notes}` : ""}
${input.preferences ? `\nStored Preferences: cabin=${input.preferences.preferredCabin || "none"}, nonstop=${input.preferences.prefersNonstop ? "yes" : "no"}, redemption=${input.preferences.redemptionStyle || "balanced"}, reposition=${input.preferences.willingToReposition ? "yes" : "no"}, avoidBasicEconomy=${input.preferences.avoidBasicEconomy ? "yes" : "no"}` : ""}
${input.loyaltyBalances?.length ? `\nLoyalty Balances:\n${input.loyaltyBalances.map((b) => `- ${b.programName}: ${b.balance.toLocaleString()} pts`).join("\n")}` : ""}
${input.familyMembers?.length ? `\nFamily Members:\n${input.familyMembers.map((m) => `- ${m.name} (${m.relationship})`).join("\n")}` : ""}

Return a JSON object with keys: executive_summary, hard_constraints, soft_preferences, points_cash_posture, acceptable_tradeoffs, do_not_recommend, operational_notes. All values should be strings (use bullet points with "• " prefix for list sections).`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackTripBrief(input);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.6,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  const parsed = JSON.parse(content);
  return {
    executiveSummary: parsed.executive_summary,
    hardConstraints: parsed.hard_constraints,
    softPreferences: parsed.soft_preferences,
    pointsCashPosture: parsed.points_cash_posture,
    acceptableTradeoffs: parsed.acceptable_tradeoffs,
    doNotRecommend: parsed.do_not_recommend,
    operationalNotes: parsed.operational_notes,
  };
}

function generateFallbackTripBrief(input: TripBriefInput): TripBriefResult {
  const destinations = input.intake.destinations?.join(", ") || "TBD";
  const tripType = input.intake.tripType?.replace(/_/g, " ") || "trip";
  const travelers = input.intake.travelerCount || 1;
  const cabin = input.intake.cabinPreference?.replace(/_/g, " ") || "economy";

  const budgetStr =
    input.intake.budgetMin || input.intake.budgetMax
      ? `$${input.intake.budgetMin || "?"}–$${input.intake.budgetMax || "?"} ${input.intake.budgetCurrency || "USD"}`
      : "Not specified";

  const balanceSummary = input.loyaltyBalances?.length
    ? input.loyaltyBalances
        .map((b) => `• ${b.programName}: ${b.balance.toLocaleString()} pts`)
        .join("\n")
    : "No loyalty balances on file.";

  return {
    executiveSummary: `${input.clientName} is planning a ${tripType} to ${destinations} for ${travelers} traveler${travelers !== 1 ? "s" : ""}. Preferred cabin is ${cabin}.${input.intake.earliestDeparture ? ` Target departure around ${input.intake.earliestDeparture}.` : ""}`,
    hardConstraints: [
      input.intake.budgetMax ? `• Budget ceiling: $${input.intake.budgetMax}` : null,
      input.intake.accessibilityNeeds ? `• Accessibility: ${input.intake.accessibilityNeeds}` : null,
      input.intake.dietaryNeeds ? `• Dietary: ${input.intake.dietaryNeeds}` : null,
      input.intake.cabinPreference ? `• Minimum cabin: ${cabin}` : null,
      input.intake.earliestDeparture ? `• Earliest departure: ${input.intake.earliestDeparture}` : null,
      input.intake.latestReturn ? `• Latest return: ${input.intake.latestReturn}` : null,
    ]
      .filter(Boolean)
      .join("\n") || "• No hard constraints specified.",
    softPreferences: [
      input.intake.hotelStyles?.length ? `• Hotel styles: ${input.intake.hotelStyles.join(", ")}` : null,
      input.intake.travelPace ? `• Travel pace: ${input.intake.travelPace}` : null,
      input.intake.layoverTolerance ? `• Layover tolerance: ${input.intake.layoverTolerance.replace(/_/g, " ")}` : null,
      input.intake.luxuryPreference ? `• Luxury level: ${input.intake.luxuryPreference}` : null,
      input.intake.preferredAirlines?.length ? `• Preferred airlines: ${input.intake.preferredAirlines.join(", ")}` : null,
      input.intake.desiredExperiences?.length ? `• Experiences: ${input.intake.desiredExperiences.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n") || "• No soft preferences specified.",
    pointsCashPosture: `Budget range: ${budgetStr}. Redemption style: ${input.preferences?.redemptionStyle || "balanced"}.\n\nAvailable balances:\n${balanceSummary}`,
    acceptableTradeoffs: input.intake.dateFlexibility
      ? `• Date flexibility: ${input.intake.dateFlexibility.replace(/_/g, " ")}`
      : "• No explicit tradeoffs indicated — confirm with client before making substitutions.",
    doNotRecommend: [
      input.intake.dealbreakers?.length ? input.intake.dealbreakers.map((d) => `• ${d}`).join("\n") : null,
      input.intake.avoidedAirlines?.length ? `• Avoid airlines: ${input.intake.avoidedAirlines.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n") || "• No dealbreakers specified.",
    operationalNotes: [
      input.intake.familyFriendly ? "• Family-friendly options required." : null,
      input.intake.childrenCount ? `• ${input.intake.childrenCount} children traveling${input.intake.childrenAges?.length ? ` (ages: ${input.intake.childrenAges.join(", ")})` : ""}.` : null,
      input.familyMembers?.length ? `• Family members: ${input.familyMembers.map((m) => `${m.name} (${m.relationship})`).join(", ")}.` : null,
      input.intake.notes ? `• Client notes: ${input.intake.notes}` : null,
      input.intake.budgetNotes ? `• Budget notes: ${input.intake.budgetNotes}` : null,
      input.intake.loyaltyNotes ? `• Loyalty notes: ${input.intake.loyaltyNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n") || "• No additional operational notes.",
  };
}

// ---------------------------------------------------------------------------
// Recommendation Memo fallbacks
// ---------------------------------------------------------------------------

function generateFallbackInternalSummary(input: MemoInput): string {
  return `**Recommendation Analysis for ${input.tripTitle}**\n\nThe engine evaluated ${input.alternativeOptions.length + 1} strategies for ${input.origin.join("/")} → ${input.destination.join("/")}. The top recommendation "${input.topOption.title}" was selected based on a ${input.topOption.strategyType} approach with a total cash outlay of $${(input.topOption.totalCashCost / 100).toLocaleString()}.\n\n${input.topOption.insights.map((i) => `• ${i.title}: ${i.body}`).join("\n")}\n\n${input.topOption.summary}`;
}

function generateFallbackClientSummary(input: MemoInput): string {
  return `We've analyzed the best options for your upcoming trip from ${input.origin.join("/")} to ${input.destination.join("/")}.\n\nOur top recommendation is the "${input.topOption.title}" approach. ${input.topOption.summary}\n\nThe estimated cost is $${(input.topOption.totalCashCost / 100).toLocaleString()}.`;
}

function generateFallbackEmailDraft(input: MemoInput): string {
  return `Hi there,\n\nI've completed the analysis for your upcoming ${input.tripTitle} trip and wanted to share our recommendation.\n\n${generateFallbackClientSummary(input)}\n\nLet me know if you'd like to discuss these options or if you have any questions.\n\nBest regards,\nYour Travel Advisor`;
}
