import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { extractProfileSuggestions } from "@/lib/meeting-copilot-ai";
import type { MeetingContext } from "@/lib/meeting-copilot-ai";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    if (session.entries.length === 0) {
      return errorResponse("No meeting entries to analyze");
    }

    const preferences = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    const context: MeetingContext = {
      clientName: `${client.firstName} ${client.lastName}`,
      existingPreferences: preferences
        ? (JSON.parse(JSON.stringify(preferences)) as Record<string, unknown>)
        : undefined,
      conversationSoFar: session.entries.map((e) => ({
        role: e.role,
        content: e.content,
      })),
    };

    const suggestions = await extractProfileSuggestions(context);

    const created = await prisma.meetingProfileSuggestion.createMany({
      data: suggestions.map((s) => ({
        sessionId: meetingId,
        targetField: s.targetField,
        suggestedValue: s.suggestedValue as never,
        confidence: s.confidence,
        evidence: s.evidence,
        rationale: s.rationale,
      })),
    });

    const newSuggestions = await prisma.meetingProfileSuggestion.findMany({
      where: { sessionId: meetingId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });

    return json({ extracted: created.count, suggestions: newSuggestions }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting extract POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
