import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntakeChatMessage {
  role: "assistant" | "advisor";
  content: string;
  timestamp: string;
}

export interface IntakeData {
  partyType?: string;
  childrenAges?: number[];
  travelPace?: string;
  luxuryPreference?: string;
  familyFriendly?: boolean;
  cabinPreference?: string;
  layoverTolerance?: string;
  departureAirports?: string[];
  willingToReposition?: string;
  preferredAirlines?: string[];
  avoidedAirlines?: string[];
  hotelStyles?: string[];
  loyaltyNotes?: string;
  accommodationDealbreakers?: string[];
  desiredExperiences?: string[];
  diningPreferences?: string;
  activityLevel?: string;
  accessibilityNeeds?: string;
  dietaryNeeds?: string;
  hardConstraints?: string[];
  notes?: string;
  dealbreakers?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIntakeForPrompt(intake: IntakeData, clientName: string): string {
  const lines: string[] = [`Client: ${clientName}`];

  if (intake.partyType) lines.push(`Travel party: ${intake.partyType}`);
  if (intake.childrenAges?.length)
    lines.push(`Children's ages: ${intake.childrenAges.join(", ")}`);
  if (intake.travelPace) lines.push(`Travel pace: ${intake.travelPace}`);
  if (intake.luxuryPreference)
    lines.push(`Luxury orientation: ${intake.luxuryPreference}`);
  if (intake.familyFriendly) lines.push(`Family-friendly: yes`);

  if (intake.cabinPreference)
    lines.push(`Preferred cabin: ${intake.cabinPreference}`);
  if (intake.layoverTolerance)
    lines.push(`Layover preference: ${intake.layoverTolerance}`);
  if (intake.departureAirports?.length)
    lines.push(`Home airports: ${intake.departureAirports.join(", ")}`);
  if (intake.willingToReposition)
    lines.push(`Willing to reposition: ${intake.willingToReposition}`);
  if (intake.preferredAirlines?.length)
    lines.push(`Preferred airlines: ${intake.preferredAirlines.join(", ")}`);
  if (intake.avoidedAirlines?.length)
    lines.push(`Airlines to avoid: ${intake.avoidedAirlines.join(", ")}`);

  if (intake.hotelStyles?.length)
    lines.push(`Hotel styles: ${intake.hotelStyles.join(", ")}`);
  if (intake.loyaltyNotes)
    lines.push(`Loyalty / points notes: ${intake.loyaltyNotes}`);
  if (intake.accommodationDealbreakers?.length)
    lines.push(
      `Accommodation to avoid: ${intake.accommodationDealbreakers.join(", ")}`,
    );

  if (intake.desiredExperiences?.length)
    lines.push(`Desired experiences: ${intake.desiredExperiences.join(", ")}`);
  if (intake.diningPreferences)
    lines.push(`Dining preferences: ${intake.diningPreferences}`);
  if (intake.activityLevel)
    lines.push(`Activity level: ${intake.activityLevel}`);

  lines.push(
    `Accessibility needs: ${intake.accessibilityNeeds?.trim() || "none"}`,
  );
  lines.push(
    `Dietary restrictions: ${intake.dietaryNeeds?.trim() || "none"}`,
  );
  if (intake.hardConstraints?.length)
    lines.push(`Hard constraints: ${intake.hardConstraints.join("; ")}`);

  if (intake.dealbreakers?.length)
    lines.push(`Dealbreakers: ${intake.dealbreakers.join("; ")}`);

  if (intake.notes) lines.push(`Advisor notes: ${intake.notes}`);

  const filled = lines.length - 1; // subtract the client name line
  const total = 14; // rough total of available categories
  lines.push(`\nProfile completeness: ${filled}/${total} categories filled`);

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a travel advisor discovery assistant. Your job is to help a travel advisor build a rich, reusable client preference profile.

The advisor has filled out a structured profile intake form. Based on what is filled (and what is missing or vague), you will generate smart, specific follow-up questions the advisor can ask the client.

Rules:
- Write 2-3 focused questions per turn. Do not dump a long list.
- Questions should be specific to what was already answered — reference actual details when possible.
- Flag contradictions or interesting tensions (e.g. "budget orientation but Business class preference").
- Avoid generic questions like "What kind of traveler are you?" — the intake form already answered that.
- Questions should sound natural enough for an advisor to say out loud to a client.
- When the advisor shares a client's answer, interpret it, then generate the next round of follow-ups.
- After 4-6 advisor responses, offer a brief "Discovery Summary" (3-5 bullets) capturing what was learned that is not already in the profile form.

Tone: Professional, specific, conversational. No jargon.`;

// ---------------------------------------------------------------------------
// Chat start — generate initial questions based on intake data
// ---------------------------------------------------------------------------

export async function generateInitialDiscoveryQuestions(
  clientName: string,
  intakeData: IntakeData,
): Promise<IntakeChatMessage> {
  const profileSummary = formatIntakeForPrompt(intakeData, clientName);

  const userContent = `Here is the client profile filled in so far:\n\n${profileSummary}\n\nGenerate 2-3 specific follow-up questions for the advisor to ask this client. The goal is to surface nuance, resolve ambiguity, or fill meaningful gaps in the profile.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";

  return {
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Continue conversation — respond to an advisor message
// ---------------------------------------------------------------------------

export async function continueDiscoveryChat(
  clientName: string,
  intakeData: IntakeData,
  messageHistory: IntakeChatMessage[],
  advisorMessage: string,
  generateOnly: boolean = false,
): Promise<IntakeChatMessage> {
  const profileSummary = formatIntakeForPrompt(intakeData, clientName);

  // Build conversation history for Claude
  const claudeMessages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: `Client profile:\n\n${profileSummary}\n\nNow begin the discovery conversation.`,
    },
  ];

  // Map the prior turns
  for (let i = 0; i < messageHistory.length; i++) {
    const msg = messageHistory[i];
    if (msg.role === "assistant") {
      claudeMessages.push({ role: "assistant", content: msg.content });
    } else {
      // advisor messages become "user" turns (advisor typing client's answers)
      claudeMessages.push({
        role: "user",
        content: `The client answered: ${msg.content}`,
      });
    }
  }

  // Add the new advisor message
  if (generateOnly) {
    claudeMessages.push({
      role: "user",
      content:
        "The advisor is asking you to generate a fresh round of 2-3 follow-up questions based on everything the client has shared so far in this conversation and the profile form. Do not ask the advisor to answer anything first — just produce new, specific questions that build on the existing answers and surface nuance or resolve ambiguity. If the conversation has covered enough ground, you may instead offer the brief Discovery Summary described in your instructions.",
    });
  } else {
    claudeMessages.push({
      role: "user",
      content: `The client answered: ${advisorMessage}`,
    });
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: claudeMessages,
  });

  const content =
    response.content[0].type === "text" ? response.content[0].text : "";

  return {
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Analyze intake + discovery chat into a structured preference profile
// ---------------------------------------------------------------------------

export interface AnalyzedPreferences {
  preferredCabin?: "economy" | "premium_economy" | "business" | "first" | "flexible";
  prefersNonstop?: boolean;
  maxLayoverMinutes?: number;
  willingToReposition?: boolean;
  avoidBasicEconomy?: boolean;
  preferredAirlines?: string[];
  avoidedAirlines?: string[];
  preferredHotelTypes?: string[];
  redemptionStyle?: "save_points" | "maximize_experience" | "balanced";
  budgetSensitivity?: "price_conscious" | "moderate" | "comfort_first" | "luxury";
  accessibilityNeeds?: string;
  foodPreferences?: string;
  activityPreferences?: string[];
  familyConsiderations?: string;
  dealbreakers?: string[];
  notes?: string;
}

const ANALYZE_SYSTEM_PROMPT = `You are a travel advisor's assistant. Given a structured intake form and any discovery chat transcript, extract a client preference profile as a JSON object via the provided tool.

Rules:
- Only include fields the intake or chat clearly supports. Omit fields when evidence is weak.
- Normalize free text into the enums given in the tool schema. Leave out enum fields if the value is ambiguous.
- The "notes" field should be a 2-3 sentence advisor-facing summary of anything important that didn't fit into a structured field.
- Never invent facts. If a field is missing from the intake, omit it.`;

export async function analyzeIntakeForPreferences(
  clientName: string,
  intakeData: IntakeData,
  chatTranscript: IntakeChatMessage[],
): Promise<AnalyzedPreferences> {
  const profileSummary = formatIntakeForPrompt(intakeData, clientName);

  const transcriptText = chatTranscript.length
    ? chatTranscript
        .map((m) => `${m.role === "assistant" ? "Assistant" : "Advisor/Client"}: ${m.content}`)
        .join("\n")
    : "(no discovery chat)";

  const userContent = `Intake form:\n\n${profileSummary}\n\nDiscovery chat transcript:\n\n${transcriptText}\n\nExtract the client's preference profile using the save_client_preferences tool.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: ANALYZE_SYSTEM_PROMPT,
    tools: [
      {
        name: "save_client_preferences",
        description:
          "Save the client's travel preference profile based on the intake form and discovery chat.",
        input_schema: {
          type: "object",
          properties: {
            preferredCabin: {
              type: "string",
              enum: ["economy", "premium_economy", "business", "first", "flexible"],
            },
            prefersNonstop: { type: "boolean" },
            maxLayoverMinutes: { type: "number" },
            willingToReposition: { type: "boolean" },
            avoidBasicEconomy: { type: "boolean" },
            preferredAirlines: { type: "array", items: { type: "string" } },
            avoidedAirlines: { type: "array", items: { type: "string" } },
            preferredHotelTypes: { type: "array", items: { type: "string" } },
            redemptionStyle: {
              type: "string",
              enum: ["save_points", "maximize_experience", "balanced"],
            },
            budgetSensitivity: {
              type: "string",
              enum: ["price_conscious", "moderate", "comfort_first", "luxury"],
            },
            accessibilityNeeds: { type: "string" },
            foodPreferences: { type: "string" },
            activityPreferences: { type: "array", items: { type: "string" } },
            familyConsiderations: { type: "string" },
            dealbreakers: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_client_preferences" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return {};
  }
  return toolUse.input as AnalyzedPreferences;
}
