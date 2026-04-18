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
  console.error(`[MeetingSessions] ${method} failed at ${stage}:`, JSON.stringify(info));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let clientId = "unknown";
  try {
    const user = await requireAuth(request);
    ({ id: clientId } = await params);

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const sessions = await prisma.discoveryMeetingSession.findMany({
      where: { clientId },
      include: {
        _count: { select: { entries: true, profileSuggestions: true } },
        recap: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(sessions);
  } catch (error) {
    if (error instanceof Response) return error;
    logError("GET", "outer_catch", error, { clientId });
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let clientId = "unknown";
  try {
    const user = await requireAuth(request);
    ({ id: clientId } = await params);
    const body = await request.json();
    const { title, contextPrompt } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return errorResponse("Title is required");
    }

    const trimmedContext =
      typeof contextPrompt === "string" && contextPrompt.trim()
        ? contextPrompt.trim()
        : null;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.create({
      data: {
        clientId,
        advisorUserId: user.id,
        title: title.trim(),
        contextPrompt: trimmedContext,
      },
      include: {
        _count: { select: { entries: true, profileSuggestions: true } },
      },
    });

    return json(session, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    logError("POST", "outer_catch", error, { clientId });
    return errorResponse("Internal server error", 500);
  }
}
