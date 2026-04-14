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

  if (intake.accessibilityNeeds)
    lines.push(`Accessibility needs: ${intake.accessibilityNeeds}`);
  if (intake.dietaryNeeds)
    lines.push(`Dietary restrictions: ${intake.dietaryNeeds}`);
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
  claudeMessages.push({
    role: "user",
    content: `The client answered: ${advisorMessage}`,
  });

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
