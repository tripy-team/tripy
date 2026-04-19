import { RoomServiceClient } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { commitSuggestionsForClient } from "@/lib/profile-commit";
import { syncLoyaltyBalancesFromNotes } from "@/lib/loyalty-balance-sync";

// Mirrors buildRoomName() in lib/livekit-room.ts — inlined here because that
// module pulls in livekit-client, which must not end up in server bundles.
function buildRoomName(clientId: string, meetingId: string): string {
  return `tripy-${clientId}-${meetingId}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

async function deleteLiveKitRoom(roomName: string): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const host = process.env.LIVEKIT_API_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !host) return;
  // livekit-server-sdk wants https:// for the room service; swap the ws(s)://
  // scheme that the NEXT_PUBLIC_LIVEKIT_URL env typically uses.
  const httpHost = host.replace(/^ws(s?):\/\//, "http$1://");
  const svc = new RoomServiceClient(httpHost, apiKey, apiSecret);
  try {
    await svc.deleteRoom(roomName);
  } catch (err) {
    // deleteRoom fails with "room not found" if every participant has
    // already disconnected. That's the desired end state, so swallow it.
    console.warn("[LiveCall] deleteRoom failed:", err);
  }
}

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

    // Cactus emits credit-card / airline / hotel point balances as
    // `loyaltyNotes: "Amex MR: 100k; Chase UR: 300k"`. commitSuggestionsForClient
    // stores that raw text on ClientPreference, but the Balances tab reads
    // from ClientLoyaltyBalance rows. Parse out any program:amount pairs we
    // recognise and upsert them so the numbers show up where advisors expect.
    let balancesSynced = 0;
    const loyaltyNotesFromCall = commitReady.find(
      (i) => i.targetField === "loyaltyNotes",
    );
    if (loyaltyNotesFromCall) {
      try {
        balancesSynced = await syncLoyaltyBalancesFromNotes(
          clientId,
          loyaltyNotesFromCall.suggestedValue,
          user.id,
          `Live call extraction (${duration}s)`,
        );
      } catch (balanceErr) {
        console.error("[LiveCall] loyalty balance sync failed:", balanceErr);
      }
    }

    // Persist contradictions so the advisor can revisit unresolved conflicts
    // after the call (the Cactus session state is thrown away at call end).
    const contradictions: Array<{
      field: string;
      previous: unknown;
      new: unknown;
      evidence: string;
    }> = body.contradictions || [];

    if (contradictions.length > 0) {
      await prisma.profileContradiction.createMany({
        data: contradictions.map((c) => ({
          sessionId: meetingId,
          clientId,
          field: c.field,
          previousValue: c.previous as any,
          newValue: c.new as any,
          evidence: c.evidence,
        })),
      });
    }

    // Tear down the LiveKit room so the client's browser gets a real
    // Disconnected event (not just ParticipantDisconnected after the
    // advisor leaves). Without this the client stays connected to an
    // empty room, publishing mic/camera into the void.
    await deleteLiveKitRoom(buildRoomName(clientId, meetingId));

    return json({
      ...updated,
      transcriptSaved: transcriptChunks.length,
      suggestionsSaved: commitReady.length,
      autoCommitted,
      contradictionsSaved: contradictions.length,
      balancesSynced,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[LiveCall] stop error:", error);
    return errorResponse("Internal server error", 500);
  }
}
