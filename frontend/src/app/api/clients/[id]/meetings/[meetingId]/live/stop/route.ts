import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { commitSuggestionsForClient } from "@/lib/profile-commit";

// Confidence at/above which we skip the advisor-review step and sync
// straight into ClientPreference so display + downstream flight AI can use
// the new fact immediately. Lower-confidence extractions still land as
// pending MeetingProfileSuggestion rows for manual review.
const AUTO_COMMIT_CONFIDENCE = 0.85;

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

    // Find the active live call
    const liveCall = await prisma.liveCallSession.findFirst({
      where: {
        meetingSessionId: meetingId,
        status: { in: ["waiting", "connecting", "active", "paused"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!liveCall) return errorResponse("No active live call found", 404);

    const endedAt = new Date();
    const duration = liveCall.startedAt
      ? Math.floor((endedAt.getTime() - liveCall.startedAt.getTime()) / 1000)
      : 0;

    // Update live call status
    const updated = await prisma.liveCallSession.update({
      where: { id: liveCall.id },
      data: {
        status: "ended",
        endedAt,
        duration,
      },
    });

    // Persist transcript chunks if provided
    const transcriptChunks = body.transcript || [];
    if (transcriptChunks.length > 0) {
      await prisma.transcriptChunk.createMany({
        data: transcriptChunks.map((chunk: {
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
          processed: false,
        })),
      });
    }

    // Create a consolidated meeting entry from the transcript
    if (transcriptChunks.length > 0) {
      const consolidatedText = transcriptChunks
        .map((c: { speaker: string; text: string }) => `[${c.speaker}]: ${c.text}`)
        .join("\n");

      await prisma.meetingEntry.create({
        data: {
          sessionId: meetingId,
          role: "live_transcript",
          content: consolidatedText,
          metadata: {
            liveCallId: liveCall.id,
            duration,
            chunkCount: transcriptChunks.length,
          },
        },
      });
    }

    // Persist commit-ready suggestions and auto-sync the high-confidence ones
    // into ClientPreference so they show in the preferences tab and the
    // flight-booking AI can use them without waiting for manual review.
    const commitReady: Array<{
      targetField: string;
      suggestedValue: unknown;
      confidence: number;
      evidence: string;
    }> = body.commitReady || [];

    let autoCommitted = 0;
    if (commitReady.length > 0) {
      const autoItems = commitReady.filter(
        (i) => (i.confidence ?? 0) >= AUTO_COMMIT_CONFIDENCE,
      );
      const reviewItems = commitReady.filter(
        (i) => (i.confidence ?? 0) < AUTO_COMMIT_CONFIDENCE,
      );

      if (reviewItems.length > 0) {
        await prisma.meetingProfileSuggestion.createMany({
          data: reviewItems.map((item) => ({
            sessionId: meetingId,
            targetField: item.targetField,
            suggestedValue: item.suggestedValue as any,
            confidence: item.confidence,
            evidence: item.evidence,
            rationale: `Extracted from live call (${duration}s)`,
            status: "pending",
          })),
        });
      }

      if (autoItems.length > 0) {
        const autoRows = await prisma.$transaction(
          autoItems.map((item) =>
            prisma.meetingProfileSuggestion.create({
              data: {
                sessionId: meetingId,
                targetField: item.targetField,
                suggestedValue: item.suggestedValue as any,
                confidence: item.confidence,
                evidence: item.evidence,
                rationale: `Auto-committed from live call (${duration}s, confidence ≥ ${AUTO_COMMIT_CONFIDENCE})`,
                status: "approved",
              },
            }),
          ),
        );

        try {
          autoCommitted = await commitSuggestionsForClient(
            clientId,
            autoRows.map((r) => ({
              id: r.id,
              targetField: r.targetField,
              suggestedValue: r.suggestedValue,
            })),
            user.id,
          );

          if (autoRows.length > 0) {
            await prisma.meetingProfileSuggestion.updateMany({
              where: { id: { in: autoRows.map((r) => r.id) } },
              data: { status: "committed", resolvedAt: new Date() },
            });
          }
        } catch (commitErr) {
          // Don't fail the whole /live/stop call if the sync write blows
          // up — the suggestions still exist as "approved" so the advisor
          // can retry from the review UI.
          console.error("[LiveCall] auto-commit failed:", commitErr);
        }
      }
    }

    return json({
      ...updated,
      transcriptSaved: transcriptChunks.length,
      suggestionsSaved: commitReady.length,
      autoCommitted,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[LiveCall] stop error:", error);
    return errorResponse("Internal server error", 500);
  }
}
