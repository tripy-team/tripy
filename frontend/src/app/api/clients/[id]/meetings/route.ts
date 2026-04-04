import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId } = await params;

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
    console.error("Meeting sessions GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId } = await params;
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return errorResponse("Title is required");
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.create({
      data: {
        clientId,
        advisorUserId: user.id,
        title: title.trim(),
      },
      include: {
        _count: { select: { entries: true, profileSuggestions: true } },
      },
    });

    return json(session, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting session POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
