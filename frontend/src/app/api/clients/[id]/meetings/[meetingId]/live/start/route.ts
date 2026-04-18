import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

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
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    // Check for existing active call
    const existingCall = await prisma.liveCallSession.findFirst({
      where: {
        meetingSessionId: meetingId,
        status: { in: ["waiting", "connecting", "active"] },
      },
    });

    if (existingCall) {
      return json(existingCall);
    }

    const liveCall = await prisma.liveCallSession.create({
      data: {
        meetingSessionId: meetingId,
        status: "connecting",
        startedAt: new Date(),
      },
    });

    return json(liveCall, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[LiveCall] start error:", error);
    return errorResponse("Internal server error", 500);
  }
}
