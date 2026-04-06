import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { extractFromSingleAnswer, extractCrossClientFromSingleAnswer } from "@/lib/meeting-copilot-ai";
import { loadRelatedClients } from "@/lib/related-clients";
import { commitSuggestionsForClient, VALID_PREFERENCE_FIELDS } from "@/lib/profile-commit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;
    const body = await request.json();

    const { role, content, metadata } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return errorResponse("Content is required");
    }

    const validRoles = ["advisor_note", "question_answer", "system"];
    if (!role || !validRoles.includes(role)) {
      return errorResponse("Role must be one of: advisor_note, question_answer, system");
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    if (session.status !== "active") {
      return errorResponse("Cannot add entries to a non-active meeting session");
    }

    const entry = await prisma.meetingEntry.create({
      data: {
        sessionId: meetingId,
        role,
        content: content.trim(),
        metadata: metadata || undefined,
      },
    });

    let extractedSuggestions: Array<{
      id: string;
      targetField: string;
      suggestedValue: unknown;
      confidence: number;
      evidence: string;
      status: string;
      targetClientId?: string | null;
      targetClient?: { id: string; firstName: string; lastName: string } | null;
      sourceDescription?: string | null;
    }> = [];

    let autoCommittedFields: string[] = [];

    const questionText = metadata?.questionText as string | undefined;
    const targetFields = metadata?.targetFields as string[] | undefined;
    const clientName = `${client.firstName} ${client.lastName}`;

    if (role === "question_answer" && questionText) {
      try {
        const extracted = await extractFromSingleAnswer(
          { questionText, answer: content.trim(), targetFields },
          clientName,
        );

        if (extracted.length > 0) {
          const existing = await prisma.meetingProfileSuggestion.findMany({
            where: { sessionId: meetingId, targetClientId: null },
            select: { targetField: true, suggestedValue: true },
          });

          const dedupedExtractions = deduplicateSuggestions(extracted, existing);

          if (dedupedExtractions.length > 0) {
            const rationaleTag = `[entry:${entry.id}] Extracted from answer to: "${questionText.slice(0, 100)}"`;

            await prisma.meetingProfileSuggestion.createMany({
              data: dedupedExtractions.map((s) => ({
                sessionId: meetingId,
                targetField: s.targetField,
                suggestedValue: s.suggestedValue as object,
                confidence: s.confidence,
                evidence: s.evidence,
                rationale: rationaleTag,
                status: "committed",
              })),
            });

            // Auto-commit to client profile
            const toCommit = dedupedExtractions
              .filter((s) => VALID_PREFERENCE_FIELDS.has(s.targetField))
              .map((s, i) => ({ id: `auto-${i}`, targetField: s.targetField, suggestedValue: s.suggestedValue }));

            if (toCommit.length > 0) {
              await commitSuggestionsForClient(clientId, toCommit, user.id);
              autoCommittedFields = toCommit.map((s) => s.targetField);
            }
          }
        }

        // Cross-client per-answer extraction
        try {
          const relatedClients = await loadRelatedClients(clientId);

          if (relatedClients.length > 0) {
            const crossInsights = await extractCrossClientFromSingleAnswer(
              { questionText, answer: content.trim(), targetFields },
              clientName,
              relatedClients,
            );

            if (crossInsights.length > 0) {
              const sourceDesc = `Learned from ${clientName}'s meeting on ${new Date().toLocaleDateString()}`;

              const existingCross = await prisma.meetingProfileSuggestion.findMany({
                where: { sessionId: meetingId, targetClientId: { not: null } },
                select: { targetClientId: true, targetField: true, suggestedValue: true },
              });

              const newCross = crossInsights.filter((ci) => {
                return !existingCross.some(
                  (ex) =>
                    ex.targetClientId === ci.clientId &&
                    ex.targetField === ci.targetField &&
                    normalizeValue(ex.suggestedValue) === normalizeValue(ci.suggestedValue),
                );
              });

              if (newCross.length > 0) {
                const rationaleTag = `[entry:${entry.id}]`;

                await prisma.meetingProfileSuggestion.createMany({
                  data: newCross.map((ci) => ({
                    sessionId: meetingId,
                    targetField: ci.targetField,
                    suggestedValue: ci.suggestedValue as object,
                    confidence: ci.confidence,
                    evidence: ci.evidence,
                    rationale: `${rationaleTag} ${ci.rationale}`,
                    targetClientId: ci.clientId,
                    sourceDescription: sourceDesc,
                    status: "committed",
                  })),
                });

                // Auto-commit cross-client suggestions
                const crossByClient = new Map<string, typeof newCross>();
                for (const ci of newCross) {
                  if (!crossByClient.has(ci.clientId)) crossByClient.set(ci.clientId, []);
                  crossByClient.get(ci.clientId)!.push(ci);
                }

                for (const [targetId, ciList] of crossByClient) {
                  const targetClient = await prisma.client.findFirst({
                    where: { id: targetId, organizationId: user.organizationId },
                  });
                  if (targetClient) {
                    const toCommit = ciList
                      .filter((ci) => VALID_PREFERENCE_FIELDS.has(ci.targetField))
                      .map((ci, i) => ({ id: `cross-${i}`, targetField: ci.targetField, suggestedValue: ci.suggestedValue }));
                    if (toCommit.length > 0) {
                      await commitSuggestionsForClient(targetId, toCommit, user.id);
                    }
                  }
                }
              }
            }
          }
        } catch (crossErr) {
          console.error("Cross-client per-answer extraction failed (non-blocking):", crossErr);
        }

        let recentSuggestions: unknown[] = [];
        try {
          recentSuggestions = await prisma.meetingProfileSuggestion.findMany({
            where: { sessionId: meetingId },
            orderBy: { createdAt: "desc" },
            take: 20,
            include: {
              targetClient: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          });
        } catch {
          try {
            recentSuggestions = await prisma.meetingProfileSuggestion.findMany({
              where: { sessionId: meetingId },
              orderBy: { createdAt: "desc" },
              take: 20,
            });
          } catch {
            recentSuggestions = [];
          }
        }

        const cutoff = new Date(Date.now() - 5000);
        extractedSuggestions = recentSuggestions.filter(
          (s) => new Date(s.createdAt) >= cutoff,
        );
      } catch (extractErr) {
        console.error("Auto-extraction failed (non-blocking):", extractErr);
      }
    }

    return json(
      {
        ...entry,
        extractedSuggestions: extractedSuggestions.length > 0 ? extractedSuggestions : undefined,
        autoCommittedFields: autoCommittedFields.length > 0 ? autoCommittedFields : undefined,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting entry POST error:", error);
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

    const { entryId, content } = body;

    if (!entryId || typeof entryId !== "string") {
      return errorResponse("entryId is required");
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return errorResponse("Content is required");
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    if (session.status !== "active") {
      return errorResponse("Cannot edit entries in a non-active meeting session");
    }

    const entry = await prisma.meetingEntry.findFirst({
      where: { id: entryId, sessionId: meetingId },
    });
    if (!entry) return errorResponse("Entry not found", 404);

    if (entry.role !== "question_answer") {
      return errorResponse("Only question_answer entries can be edited");
    }

    // Update the entry content
    const updatedEntry = await prisma.meetingEntry.update({
      where: { id: entryId },
      data: { content: content.trim() },
    });

    const entryMeta = entry.metadata as Record<string, unknown> | null;
    const questionText = entryMeta?.questionText as string | undefined;
    const targetFields = entryMeta?.targetFields as string[] | undefined;
    const clientName = `${client.firstName} ${client.lastName}`;

    let newSuggestions: Array<{
      id: string;
      targetField: string;
      suggestedValue: unknown;
      confidence: number;
      evidence: string;
      status: string;
      targetClientId?: string | null;
      targetClient?: { id: string; firstName: string; lastName: string } | null;
      sourceDescription?: string | null;
    }> = [];
    let autoCommittedFields: string[] = [];

    if (questionText) {
      // Find and remove old suggestions tied to this entry
      const entryTag = `[entry:${entryId}]`;
      const oldSuggestions = await prisma.meetingProfileSuggestion.findMany({
        where: {
          sessionId: meetingId,
          rationale: { contains: entryTag },
        },
      });

      if (oldSuggestions.length > 0) {
        await prisma.meetingProfileSuggestion.deleteMany({
          where: { id: { in: oldSuggestions.map((s) => s.id) } },
        });
      }

      // Re-extract from updated answer
      try {
        const extracted = await extractFromSingleAnswer(
          { questionText, answer: content.trim(), targetFields },
          clientName,
        );

        if (extracted.length > 0) {
          const existing = await prisma.meetingProfileSuggestion.findMany({
            where: { sessionId: meetingId, targetClientId: null },
            select: { targetField: true, suggestedValue: true },
          });

          const dedupedExtractions = deduplicateSuggestions(extracted, existing);

          if (dedupedExtractions.length > 0) {
            const rationaleTag = `[entry:${entryId}] Extracted from answer to: "${questionText.slice(0, 100)}"`;

            await prisma.meetingProfileSuggestion.createMany({
              data: dedupedExtractions.map((s) => ({
                sessionId: meetingId,
                targetField: s.targetField,
                suggestedValue: s.suggestedValue as object,
                confidence: s.confidence,
                evidence: s.evidence,
                rationale: rationaleTag,
                status: "committed",
              })),
            });

            // Auto-commit to client profile
            const toCommit = dedupedExtractions
              .filter((s) => VALID_PREFERENCE_FIELDS.has(s.targetField))
              .map((s, i) => ({ id: `auto-${i}`, targetField: s.targetField, suggestedValue: s.suggestedValue }));

            if (toCommit.length > 0) {
              await commitSuggestionsForClient(clientId, toCommit, user.id);
              autoCommittedFields = toCommit.map((s) => s.targetField);
            }
          }
        }

        // Cross-client re-extraction
        try {
          const relatedClients = await loadRelatedClients(clientId);

          if (relatedClients.length > 0) {
            const crossInsights = await extractCrossClientFromSingleAnswer(
              { questionText, answer: content.trim(), targetFields },
              clientName,
              relatedClients,
            );

            if (crossInsights.length > 0) {
              const sourceDesc = `Learned from ${clientName}'s meeting on ${new Date().toLocaleDateString()} (edited)`;
              const rationaleTag = `[entry:${entryId}]`;

              await prisma.meetingProfileSuggestion.createMany({
                data: crossInsights.map((ci) => ({
                  sessionId: meetingId,
                  targetField: ci.targetField,
                  suggestedValue: ci.suggestedValue as object,
                  confidence: ci.confidence,
                  evidence: ci.evidence,
                  rationale: `${rationaleTag} ${ci.rationale}`,
                  targetClientId: ci.clientId,
                  sourceDescription: sourceDesc,
                  status: "committed",
                })),
              });

              const crossByClient = new Map<string, typeof crossInsights>();
              for (const ci of crossInsights) {
                if (!crossByClient.has(ci.clientId)) crossByClient.set(ci.clientId, []);
                crossByClient.get(ci.clientId)!.push(ci);
              }

              for (const [targetId, ciList] of crossByClient) {
                const targetClient = await prisma.client.findFirst({
                  where: { id: targetId, organizationId: user.organizationId },
                });
                if (targetClient) {
                  const toCommit = ciList
                    .filter((ci) => VALID_PREFERENCE_FIELDS.has(ci.targetField))
                    .map((ci, i) => ({ id: `cross-${i}`, targetField: ci.targetField, suggestedValue: ci.suggestedValue }));
                  if (toCommit.length > 0) {
                    await commitSuggestionsForClient(targetId, toCommit, user.id);
                  }
                }
              }
            }
          }
        } catch (crossErr) {
          console.error("Cross-client re-extraction failed (non-blocking):", crossErr);
        }
      } catch (extractErr) {
        console.error("Re-extraction failed (non-blocking):", extractErr);
      }

      const entryTagForFetch = `[entry:${entryId}]`;
      try {
        newSuggestions = await prisma.meetingProfileSuggestion.findMany({
          where: {
            sessionId: meetingId,
            rationale: { contains: entryTagForFetch },
          },
          include: {
            targetClient: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        });
      } catch {
        try {
          newSuggestions = await prisma.meetingProfileSuggestion.findMany({
            where: {
              sessionId: meetingId,
              rationale: { contains: entryTagForFetch },
            },
          });
        } catch {
          newSuggestions = [];
        }
      }
    }

    return json({
      ...updatedEntry,
      extractedSuggestions: newSuggestions.length > 0 ? newSuggestions : undefined,
      autoCommittedFields: autoCommittedFields.length > 0 ? autoCommittedFields : undefined,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting entry PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}

function deduplicateSuggestions(
  newSuggestions: Array<{ targetField: string; suggestedValue: unknown; confidence: number; evidence: string; status: string }>,
  existing: Array<{ targetField: string; suggestedValue: unknown }>,
): Array<{ targetField: string; suggestedValue: unknown; confidence: number; evidence: string; status: string }> {
  const existingSet = new Set(
    existing.map((e) => `${e.targetField}::${normalizeValue(e.suggestedValue)}`),
  );

  return newSuggestions.filter((s) => {
    const key = `${s.targetField}::${normalizeValue(s.suggestedValue)}`;
    return !existingSet.has(key);
  });
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.toLowerCase().trim();
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase().trim()).sort().join(",");
  return JSON.stringify(value).toLowerCase();
}
