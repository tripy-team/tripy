import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

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

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
        questionSuggestions: { orderBy: { createdAt: "desc" } },
        profileSuggestions: {
          orderBy: { createdAt: "desc" },
          include: {
            targetClient: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        recap: true,
        advisor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!session) return errorResponse("Meeting session not found", 404);

    return json(session);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting session GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;
    const body = await request.json();

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    const updateData: Record<string, unknown> = {};
    if (body.title && typeof body.title === "string") updateData.title = body.title.trim();
    if (body.status && ["active", "completed", "archived"].includes(body.status)) {
      updateData.status = body.status;
    }
    if (body.summary !== undefined) updateData.summary = body.summary;

    const updated = await prisma.discoveryMeetingSession.update({
      where: { id: meetingId },
      data: updateData,
    });

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting session PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}
