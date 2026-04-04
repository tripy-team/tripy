import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { generateMeetingQuestions, generateFollowUpQuestions } from "@/lib/meeting-copilot-ai";
import type { MeetingContext } from "@/lib/meeting-copilot-ai";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;
    const body = await request.json().catch(() => ({}));
    const { followUp, latestAnswer } = body;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
        questionSuggestions: { select: { questionText: true } },
      },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

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
      previousQuestions: session.questionSuggestions.map((q) => q.questionText),
    };

    const questions =
      followUp && latestAnswer
        ? await generateFollowUpQuestions(context, latestAnswer)
        : await generateMeetingQuestions(context);

    const created = await prisma.meetingQuestionSuggestion.createMany({
      data: questions.map((q) => ({
        sessionId: meetingId,
        questionText: q.questionText,
        category: q.category,
        reason: q.reason,
        priority: q.priority,
        targetFields: q.targetFields,
      })),
    });

    const newSuggestions = await prisma.meetingQuestionSuggestion.findMany({
      where: { sessionId: meetingId },
      orderBy: { createdAt: "desc" },
      take: questions.length,
    });

    return json({ generated: created.count, questions: newSuggestions }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting questions POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
