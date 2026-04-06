import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

function logError(method: string, stage: string, error: unknown, meta?: Record<string, string>) {
  const info = {
    method,
    stage,
    ...meta,
    name: error instanceof Error ? error.name : "Unknown",
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack.split("\n").slice(0, 5).join(" | ") } : {}),
  };
  console.error(`[MeetingSession] ${method} failed at ${stage}:`, JSON.stringify(info));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  let clientId = "unknown";
  let meetingId = "unknown";
  try {
    const user = await requireAuth(request);
    ({ id: clientId, meetingId } = await params);

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const baseInclude = {
      entries: { orderBy: { createdAt: "asc" as const } },
      questionSuggestions: { orderBy: { createdAt: "desc" as const } },
      recap: true as const,
      advisor: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    };

    let session;
    try {
      session = await prisma.discoveryMeetingSession.findFirst({
        where: { id: meetingId, clientId },
        include: {
          ...baseInclude,
          profileSuggestions: {
            orderBy: { createdAt: "desc" },
            include: {
              targetClient: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      });
    } catch (e1) {
      logError("GET", "query_with_targetClient", e1, { clientId, meetingId });
      try {
        session = await prisma.discoveryMeetingSession.findFirst({
          where: { id: meetingId, clientId },
          include: { ...baseInclude, profileSuggestions: { orderBy: { createdAt: "desc" } } },
        });
      } catch (e2) {
        logError("GET", "query_without_targetClient", e2, { clientId, meetingId });
        session = await prisma.discoveryMeetingSession.findFirst({
          where: { id: meetingId, clientId },
          include: baseInclude,
        });
      }
    }

    if (!session) return errorResponse("Meeting session not found", 404);

    return json(session);
  } catch (error) {
    if (error instanceof Response) return error;
    logError("GET", "outer_catch", error, { clientId, meetingId });
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  let clientId = "unknown";
  let meetingId = "unknown";
  try {
    const user = await requireAuth(request);
    ({ id: clientId, meetingId } = await params);
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
    logError("PATCH", "outer_catch", error, { clientId, meetingId });
    return errorResponse("Internal server error", 500);
  }
}
