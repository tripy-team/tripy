import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; suggestionId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId, suggestionId } = await params;
    const body = await request.json();
    const { status } = body;

    const validStatuses = ["approved", "rejected"];
    if (!status || !validStatuses.includes(status)) {
      return errorResponse("Status must be 'approved' or 'rejected'");
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    const suggestion = await prisma.meetingProfileSuggestion.findFirst({
      where: { id: suggestionId, sessionId: meetingId },
    });
    if (!suggestion) return errorResponse("Suggestion not found", 404);

    if (suggestion.status === "committed") {
      return errorResponse("Cannot modify a committed suggestion");
    }

    const updated = await prisma.meetingProfileSuggestion.update({
      where: { id: suggestionId },
      data: {
        status,
        resolvedAt: new Date(),
      },
    });

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting suggestion PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}
