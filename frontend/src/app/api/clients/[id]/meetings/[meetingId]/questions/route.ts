import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import {
  generateMeetingQuestions,
  generateFollowUpQuestions,
} from "@/lib/meeting-copilot-ai";
import type { MeetingContext, AnsweredQuestion } from "@/lib/meeting-copilot-ai";
import { buildProfileSnapshot } from "@/lib/profile-completeness";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;
    const body = await request.json().catch(() => ({}));
    const { followUp, answeredQuestions } = body as {
      followUp?: boolean;
      answeredQuestions?: AnsweredQuestion[];
    };

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
        questionSuggestions: {
          select: { questionText: true, isUsed: true, round: true },
        },
        profileSuggestions: {
          select: {
            targetField: true,
            suggestedValue: true,
            confidence: true,
            status: true,
          },
        },
      },
    });
    if (!session) return errorResponse("Meeting session not found", 404);

    const [preferences, loyaltyCount, familyCount] = await Promise.all([
      prisma.clientPreference.findUnique({ where: { clientId } }),
      prisma.clientLoyaltyBalance.count({ where: { clientId } }),
      prisma.familyMember.count({ where: { clientId } }),
    ]);

    // Build profile snapshot for profile-aware question generation
    const prefsRecord = preferences
      ? (JSON.parse(JSON.stringify(preferences)) as Record<string, unknown>)
      : null;
    // Virtual fields whose source of truth lives outside ClientPreference —
    // mirror the client profile page so the returned % matches the UI.
    const extraFilled = new Set<string>();
    if (loyaltyCount > 0) extraFilled.add('loyaltyPrograms');
    if (familyCount > 0) extraFilled.add('familyConsiderations');
    const profileSnapshot = buildProfileSnapshot(
      prefsRecord,
      session.profileSuggestions.map((s) => ({
        targetField: s.targetField,
        suggestedValue: s.suggestedValue,
        confidence: s.confidence,
        status: s.status,
      })),
      extraFilled,
    );

    const maxRound = session.questionSuggestions.reduce(
      (max, q) => Math.max(max, q.round),
      0,
    );
    const nextRound = maxRound + 1;

    const context: MeetingContext = {
      clientName: `${client.firstName} ${client.lastName}`,
      existingPreferences: prefsRecord ?? undefined,
      conversationSoFar: session.entries.map((e) => ({
        role: e.role,
        content: e.content,
      })),
      previousQuestions: session.questionSuggestions.map((q) => q.questionText),
      profileSnapshot,
      contextPrompt: session.contextPrompt ?? undefined,
    };

    const questions =
      followUp && answeredQuestions?.length
        ? await generateFollowUpQuestions(context, answeredQuestions)
        : await generateMeetingQuestions(context);

    // Deduplicate: skip questions that are very similar to previously asked ones
    const previousTexts = new Set(
      session.questionSuggestions.map((q) => q.questionText.toLowerCase().trim()),
    );
    const deduped = questions.filter((q) => {
      const normalized = q.questionText.toLowerCase().trim();
      if (previousTexts.has(normalized)) return false;
      previousTexts.add(normalized);
      return true;
    });

    // Suppress questions targeting fields that are already well-filled
    // (keep them only if rationale is "clarification")
    const filledFields = new Set(profileSnapshot.completeness.filledFields);
    const filtered = deduped.filter((q) => {
      const allTargetsFilled = q.targetFields.length > 0 &&
        q.targetFields.every((f) => filledFields.has(f));
      if (!allTargetsFilled) return true;
      // Allow clarification questions through (rationale may be present from AI)
      return (q as unknown as Record<string, unknown>).rationale === "clarification";
    });

    const finalQuestions = filtered.length > 0 ? filtered : deduped.slice(0, 3);

    const created = await prisma.meetingQuestionSuggestion.createMany({
      data: finalQuestions.map((q) => ({
        sessionId: meetingId,
        questionText: q.questionText,
        category: q.category,
        reason: q.reason,
        priority: q.priority,
        targetFields: q.targetFields,
        round: nextRound,
      })),
    });

    const newSuggestions = await prisma.meetingQuestionSuggestion.findMany({
      where: { sessionId: meetingId },
      orderBy: { createdAt: "desc" },
      take: finalQuestions.length,
    });

    return json(
      {
        generated: created.count,
        questions: newSuggestions,
        round: nextRound,
        profileCompleteness: profileSnapshot.completeness.overallPercent,
      },
      201,
    );
  } catch (error) {
    if (error instanceof Response) return error;
    const info = {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack.split("\n").slice(0, 5).join(" | ") } : {}),
    };
    console.error("[MeetingQuestions] POST failed:", JSON.stringify(info));
    return errorResponse("Internal server error", 500);
  }
}
