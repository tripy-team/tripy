import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { extractProfileSuggestions, extractCrossClientInsights } from "@/lib/meeting-copilot-ai";
import type { MeetingContext } from "@/lib/meeting-copilot-ai";
import { loadRelatedClients } from "@/lib/related-clients";

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
      include: {
        entries: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    if (session.entries.length === 0) {
      return errorResponse("No meeting entries to analyze");
    }

    const preferences = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    const existingSuggestions = await prisma.meetingProfileSuggestion.findMany({
      where: { sessionId: meetingId },
    });

    const context: MeetingContext = {
      clientName: `${client.firstName} ${client.lastName}`,
      existingPreferences: preferences
        ? (JSON.parse(JSON.stringify(preferences)) as Record<string, unknown>)
        : undefined,
      conversationSoFar: session.entries.map((e) => ({
        role: e.role,
        content: e.content,
      })),
      contextPrompt: session.contextPrompt ?? undefined,
    };

    const suggestions = await extractProfileSuggestions(
      context,
      existingSuggestions.map((s) => ({
        targetField: s.targetField,
        suggestedValue: s.suggestedValue,
      })),
    );

    const normalize = (v: unknown): string =>
      JSON.stringify(v).toLowerCase().replace(/\s+/g, " ").trim();

    const toCreate: typeof suggestions = [];
    let updatedCount = 0;

    for (const s of suggestions) {
      const match = existingSuggestions.find((ex) => {
        if (ex.targetClientId) return false;
        if (ex.targetField !== s.targetField) return false;
        return normalize(ex.suggestedValue) === normalize(s.suggestedValue);
      });

      if (match) {
        const boosted = Math.min(1.0, match.confidence + (1 - match.confidence) * 0.3);
        if (boosted > match.confidence) {
          await prisma.meetingProfileSuggestion.update({
            where: { id: match.id },
            data: {
              confidence: boosted,
              evidence: s.evidence,
              rationale: s.rationale,
            },
          });
          match.confidence = boosted;
          updatedCount++;
        }
      } else {
        toCreate.push(s);
      }
    }

    if (toCreate.length > 0) {
      await prisma.meetingProfileSuggestion.createMany({
        data: toCreate.map((s) => ({
          sessionId: meetingId,
          targetField: s.targetField,
          suggestedValue: s.suggestedValue as never,
          confidence: s.confidence,
          evidence: s.evidence,
          rationale: s.rationale,
        })),
      });
    }

    // Cross-client extraction: find related clients and extract insights about them
    let crossClientCount = 0;
    try {
      const relatedClients = await loadRelatedClients(clientId);

      if (relatedClients.length > 0) {
        const crossInsights = await extractCrossClientInsights(context, relatedClients);

        if (crossInsights.length > 0) {
          const sourceDesc = `Learned from ${client.firstName} ${client.lastName}'s meeting on ${new Date().toLocaleDateString()}`;

          const existingCross = existingSuggestions.filter((s) => s.targetClientId);
          const newCross = crossInsights.filter((ci) => {
            return !existingCross.some(
              (ex) =>
                ex.targetClientId === ci.clientId &&
                ex.targetField === ci.targetField &&
                normalize(ex.suggestedValue) === normalize(ci.suggestedValue),
            );
          });

          // Boost confidence on repeated cross-client mentions
          for (const ci of crossInsights) {
            const match = existingCross.find(
              (ex) =>
                ex.targetClientId === ci.clientId &&
                ex.targetField === ci.targetField &&
                normalize(ex.suggestedValue) === normalize(ci.suggestedValue),
            );
            if (match) {
              const boosted = Math.min(0.95, match.confidence + (1 - match.confidence) * 0.25);
              if (boosted > match.confidence) {
                await prisma.meetingProfileSuggestion.update({
                  where: { id: match.id },
                  data: { confidence: boosted, evidence: ci.evidence },
                });
              }
            }
          }

          if (newCross.length > 0) {
            await prisma.meetingProfileSuggestion.createMany({
              data: newCross.map((ci) => ({
                sessionId: meetingId,
                targetField: ci.targetField,
                suggestedValue: ci.suggestedValue as never,
                confidence: ci.confidence,
                evidence: ci.evidence,
                rationale: ci.rationale,
                targetClientId: ci.clientId,
                sourceDescription: sourceDesc,
              })),
            });
            crossClientCount = newCross.length;
          }
        }
      }
    } catch (crossErr) {
      console.error("Cross-client extraction failed (non-blocking):", crossErr);
    }

    let allSuggestions: unknown[] = [];
    try {
      allSuggestions = await prisma.meetingProfileSuggestion.findMany({
        where: { sessionId: meetingId },
        orderBy: { createdAt: "desc" },
        include: {
          targetClient: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
    } catch {
      try {
        allSuggestions = await prisma.meetingProfileSuggestion.findMany({
          where: { sessionId: meetingId },
          orderBy: { createdAt: "desc" },
        });
      } catch {
        allSuggestions = [];
      }
    }

    return json(
      {
        extracted: toCreate.length,
        reinforced: updatedCount,
        crossClientExtracted: crossClientCount,
        suggestions: allSuggestions,
      },
      toCreate.length > 0 || crossClientCount > 0 ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting extract POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
