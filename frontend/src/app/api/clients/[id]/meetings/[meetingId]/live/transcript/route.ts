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

    // Get the latest live call for this meeting
    const liveCall = await prisma.liveCallSession.findFirst({
      where: { meetingSessionId: meetingId },
      orderBy: { createdAt: "desc" },
      include: {
        transcriptChunks: {
          orderBy: { startMs: "asc" },
        },
      },
    });

    if (!liveCall) {
      return json({ liveCall: null, chunks: [] });
    }

    return json({
      liveCall: {
        id: liveCall.id,
        status: liveCall.status,
        startedAt: liveCall.startedAt,
        endedAt: liveCall.endedAt,
        duration: liveCall.duration,
      },
      chunks: liveCall.transcriptChunks,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[LiveCall] transcript error:", error);
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
    const body = await request.json();

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const liveCall = await prisma.liveCallSession.findFirst({
      where: {
        meetingSessionId: meetingId,
        status: { in: ["active", "connecting"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!liveCall) return errorResponse("No active live call", 404);

    const chunks = body.chunks || [];
    if (chunks.length > 0) {
      await prisma.transcriptChunk.createMany({
        data: chunks.map((chunk: {
          speaker: string;
          text: string;
          startMs: number;
          endMs: number;
          confidence: number;
        }) => ({
          liveCallId: liveCall.id,
          speaker: chunk.speaker,
          text: chunk.text,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          confidence: chunk.confidence || 0,
        })),
      });
    }

    return json({ saved: chunks.length });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[LiveCall] transcript save error:", error);
    return errorResponse("Internal server error", 500);
  }
}
