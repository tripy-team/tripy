import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { generateMeetingRecap } from "@/lib/meeting-copilot-ai";
import type { MeetingContext } from "@/lib/meeting-copilot-ai";

export async function GET(
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

    const recap = await prisma.meetingRecap.findUnique({
      where: { sessionId: meetingId },
    });

    if (!recap) return json(null);
    return json(recap);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting recap GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

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
        profileSuggestions: true,
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
    };

    const approvedSuggestions = session.profileSuggestions
      .filter((s) => s.status === "approved" || s.status === "committed")
      .map((s) => ({
        targetField: s.targetField,
        suggestedValue: s.suggestedValue,
      }));

    const rejectedSuggestions = session.profileSuggestions
      .filter((s) => s.status === "rejected")
      .map((s) => ({
        targetField: s.targetField,
        suggestedValue: s.suggestedValue,
      }));

    const result = await generateMeetingRecap(
      context,
      approvedSuggestions,
      rejectedSuggestions,
    );

    const existingRecap = await prisma.meetingRecap.findUnique({
      where: { sessionId: meetingId },
    });

    let recap;
    if (existingRecap) {
      recap = await prisma.meetingRecap.update({
        where: { sessionId: meetingId },
        data: result,
      });
    } else {
      recap = await prisma.meetingRecap.create({
        data: {
          sessionId: meetingId,
          ...result,
        },
      });
    }

    return json(recap, existingRecap ? 200 : 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting recap POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
