import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;
    const body = await request.json();

    const { role, content, metadata } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return errorResponse("Content is required");
    }

    const validRoles = ["advisor_note", "question_answer", "system"];
    if (!role || !validRoles.includes(role)) {
      return errorResponse("Role must be one of: advisor_note, question_answer, system");
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    if (session.status !== "active") {
      return errorResponse("Cannot add entries to a non-active meeting session");
    }

    const entry = await prisma.meetingEntry.create({
      data: {
        sessionId: meetingId,
        role,
        content: content.trim(),
        metadata: metadata || undefined,
      },
    });

    return json(entry, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting entry POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
