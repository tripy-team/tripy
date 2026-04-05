import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { VALID_PREFERENCE_FIELDS, commitSuggestionsForClient } from "@/lib/profile-commit";

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

    let approved;
    try {
      approved = await prisma.meetingProfileSuggestion.findMany({
        where: { sessionId: meetingId, status: "approved" },
        include: {
          targetClient: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
    } catch {
      approved = await prisma.meetingProfileSuggestion.findMany({
        where: { sessionId: meetingId, status: "approved" },
      });
    }

    if (approved.length === 0) {
      return json({ preview: [], message: "No approved suggestions to commit" });
    }

    // Group by target client (null = primary client, otherwise cross-client)
    const primarySuggestions = approved.filter((s) => !s.targetClientId);
    const crossClientSuggestions = approved.filter((s) => s.targetClientId);

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    const preview = primarySuggestions
      .filter((s) => VALID_PREFERENCE_FIELDS.has(s.targetField))
      .map((s) => {
        const currentValue = existing
          ? (existing as Record<string, unknown>)[s.targetField]
          : undefined;
        return {
          id: s.id,
          targetField: s.targetField,
          currentValue,
          suggestedValue: s.suggestedValue,
          confidence: s.confidence,
          evidence: s.evidence,
          rationale: s.rationale,
          willOverwrite: currentValue != null,
          targetClientId: null as string | null,
          targetClientName: null as string | null,
        };
      });

    // Build cross-client preview
    const crossClientIds = [...new Set(crossClientSuggestions.map((s) => s.targetClientId!))];
    const crossPrefs = crossClientIds.length > 0
      ? await prisma.clientPreference.findMany({
          where: { clientId: { in: crossClientIds } },
        })
      : [];
    const crossPrefMap = new Map(crossPrefs.map((p) => [p.clientId, p]));

    for (const s of crossClientSuggestions) {
      if (!VALID_PREFERENCE_FIELDS.has(s.targetField)) continue;
      const targetPref = crossPrefMap.get(s.targetClientId!);
      const currentValue = targetPref
        ? (targetPref as Record<string, unknown>)[s.targetField]
        : undefined;

      preview.push({
        id: s.id,
        targetField: s.targetField,
        currentValue,
        suggestedValue: s.suggestedValue,
        confidence: s.confidence,
        evidence: s.evidence,
        rationale: s.rationale,
        willOverwrite: currentValue != null,
        targetClientId: s.targetClientId,
        targetClientName: s.targetClient
          ? `${s.targetClient.firstName} ${s.targetClient.lastName}`
          : null,
      });
    }

    return json({ preview });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting commit preview GET error:", error);
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

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    const approved = await prisma.meetingProfileSuggestion.findMany({
      where: { sessionId: meetingId, status: "approved" },
    });

    if (approved.length === 0) {
      return errorResponse("No approved suggestions to commit");
    }

    const validSuggestions = approved.filter((s) =>
      VALID_PREFERENCE_FIELDS.has(s.targetField),
    );

    if (validSuggestions.length === 0) {
      return errorResponse("No suggestions map to valid preference fields");
    }

    // Group suggestions by target client
    const primarySuggestions = validSuggestions.filter((s) => !s.targetClientId);
    const crossClientMap = new Map<string, typeof validSuggestions>();

    for (const s of validSuggestions) {
      if (s.targetClientId) {
        const existing = crossClientMap.get(s.targetClientId) || [];
        existing.push(s);
        crossClientMap.set(s.targetClientId, existing);
      }
    }

    let committedCount = 0;

    // Commit primary client suggestions
    if (primarySuggestions.length > 0) {
      await commitSuggestionsForClient(clientId, primarySuggestions, user.id);
      committedCount += primarySuggestions.length;
    }

    // Commit cross-client suggestions
    for (const [targetId, suggestions] of crossClientMap) {
      // Verify the target client belongs to the same organization
      const targetClient = await prisma.client.findFirst({
        where: { id: targetId, organizationId: user.organizationId },
      });
      if (targetClient) {
        await commitSuggestionsForClient(targetId, suggestions, user.id);
        committedCount += suggestions.length;
      }
    }

    await prisma.meetingProfileSuggestion.updateMany({
      where: {
        id: { in: validSuggestions.map((s) => s.id) },
      },
      data: {
        status: "committed",
        resolvedAt: new Date(),
      },
    });

    return json({
      committed: committedCount,
      primaryCommitted: primarySuggestions.length,
      crossClientCommitted: committedCount - primarySuggestions.length,
      fields: validSuggestions.map((s) => s.targetField),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting commit POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
