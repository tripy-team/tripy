/**
 * POST /api/clients/[id]/custom-forms/generate
 * Uses Claude to generate custom form questions grouped into sections based on the client's profile.
 *
 * Body: { prompt?: string }  — advisor can optionally describe what they want to learn
 *
 * Returns: { questions: Array<{ id, label, type, options? }> }
 */

import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        preferences: true,
        intakes: { orderBy: { updatedAt: "desc" }, take: 1 },
        inferredPreferences: { where: { status: "pending" }, take: 10 },
        followUpSuggestions: { where: { status: "pending" }, take: 10 },
      },
    });
    if (!client) return errorResponse("Client not found", 404);

    const body = await request.json().catch(() => ({}));
    const { prompt } = body as { prompt?: string };

    // Build context about the client
    const clientName = `${client.firstName} ${client.lastName}`.trim();
    const prefs = client.preferences;
    const latestIntake = client.intakes[0];

    const profileContext: string[] = [`Client name: ${clientName}`, `Client type: ${client.clientType}`];

    if (prefs) {
      if (prefs.preferredCabin) profileContext.push(`Preferred cabin: ${prefs.preferredCabin}`);
      if (prefs.budgetSensitivity) profileContext.push(`Budget sensitivity: ${prefs.budgetSensitivity}`);
      if (prefs.prefersNonstop) profileContext.push("Prefers nonstop flights");
      if (prefs.preferredAirlines && Array.isArray(prefs.preferredAirlines)) {
        profileContext.push(`Preferred airlines: ${(prefs.preferredAirlines as string[]).join(", ")}`);
      }
      if (prefs.notes) profileContext.push(`Notes: ${prefs.notes}`);
    }

    if (latestIntake) {
      if (latestIntake.destinations) profileContext.push(`Recent destinations of interest: ${latestIntake.destinations}`);
      if (latestIntake.tripType) profileContext.push(`Trip type: ${latestIntake.tripType}`);
      if (latestIntake.travelPace) profileContext.push(`Travel pace: ${latestIntake.travelPace}`);
      if (latestIntake.luxuryPreference) profileContext.push(`Luxury preference: ${latestIntake.luxuryPreference}`);
    }

    const pendingFollowUps = client.followUpSuggestions
      .slice(0, 5)
      .map((s) => s.questionText);

    if (pendingFollowUps.length > 0) {
      profileContext.push(`Open questions about this client: ${pendingFollowUps.join("; ")}`);
    }

    const advisorInstruction = prompt
      ? `The advisor specifically wants to learn: "${prompt}"`
      : "Generate questions that will fill the most important gaps in this client's travel profile.";

    const systemPrompt = `You are an expert travel advisor assistant. Your job is to generate a focused set of 5–10 questions for a travel preference form that a client will fill out independently (not in a live conversation).

Guidelines:
- Questions should be clear, specific, and answerable without advisor guidance
- Mix question types: simple text, select (multiple choice), and textarea (longer answers)
- Focus on actionable preference data: destinations, accommodation style, pace, loyalty programs, constraints, special needs
- Avoid generic or vague questions
- Avoid duplicating information already known about the client
- Each question must have a unique short id (snake_case, e.g. "dream_destinations")

Return ONLY a JSON array with this structure (no markdown, no explanation):
[
  {
    "id": "question_id",
    "label": "The question text?",
    "type": "text" | "textarea" | "select",
    "options": ["Option 1", "Option 2"]  // only for type "select"
  }
]`;

    const userMessage = `Client profile:
${profileContext.join("\n")}

${advisorInstruction}

Generate 6–8 targeted questions for a travel preference form.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: userMessage }],
      system: systemPrompt,
    });

    const rawText =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "[]";

    // Parse the JSON response
    let questions: Array<{
      id: string;
      label: string;
      type: "text" | "textarea" | "select";
      options?: string[];
    }> = [];

    try {
      // Strip markdown code blocks if present
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      questions = JSON.parse(cleaned);
      if (!Array.isArray(questions)) questions = [];
    } catch {
      console.error("[generate-questions] Failed to parse AI response:", rawText);
      return errorResponse("Failed to generate questions — please try again", 500);
    }

    // Validate and sanitize
    const sanitized = questions
      .filter((q) => q.id && q.label && q.type)
      .map((q) => ({
        id: String(q.id).replace(/[^a-z0-9_]/gi, "_").slice(0, 50),
        label: String(q.label).slice(0, 300),
        type: (["text", "textarea", "select"].includes(q.type) ? q.type : "text") as "text" | "textarea" | "select",
        ...(q.type === "select" && Array.isArray(q.options)
          ? { options: q.options.map((o) => String(o).slice(0, 100)).slice(0, 10) }
          : {}),
      }));

    return json({ questions: sanitized });
  } catch (error) {
    console.error("Generate questions error:", error);
    return errorResponse("Internal server error", 500);
  }
}
