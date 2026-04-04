import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

// POST — convert a follow-up suggestion into a client message draft
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; suggestionId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, suggestionId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const suggestion = await prisma.followUpSuggestion.findFirst({
      where: { id: suggestionId, clientId },
    });
    if (!suggestion) return errorResponse("Suggestion not found", 404);

    const clientName = client.firstName;
    const advisorName = `${user.firstName} ${user.lastName}`;

    const subject = "Quick question about your upcoming trip";
    const body = [
      `Hi ${clientName},`,
      "",
      `${suggestion.questionText}`,
      "",
      "Understanding this will help me find the best options for you.",
      "",
      "Looking forward to hearing from you!",
      "",
      `Best,`,
      advisorName,
    ].join("\n");

    // Auto-mark the suggestion as "asked"
    await prisma.followUpSuggestion.update({
      where: { id: suggestionId },
      data: { status: "asked", statusChangedAt: new Date() },
    });

    return json({
      subject,
      body,
      suggestion: {
        id: suggestion.id,
        questionText: suggestion.questionText,
        reason: suggestion.reason,
      },
    });
  } catch (error) {
    console.error("Message draft error:", error);
    return errorResponse("Internal server error", 500);
  }
}
