import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireAuth, json, errorResponse } from "@/lib/auth";

const VALID_PREFERENCE_FIELDS = new Set([
  "preferredCabin",
  "prefersNonstop",
  "maxLayoverMinutes",
  "willingToReposition",
  "avoidBasicEconomy",
  "preferredAirlines",
  "avoidedAirlines",
  "preferredHotelTypes",
  "roomPreferences",
  "locationPreferences",
  "redemptionStyle",
  "budgetSensitivity",
  "pointsVsCash",
  "accessibilityNeeds",
  "foodPreferences",
  "activityPreferences",
  "familyConsiderations",
  "specialOccasions",
  "dislikes",
  "dealbreakers",
  "notes",
]);

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

    const approved = await prisma.meetingProfileSuggestion.findMany({
      where: { sessionId: meetingId, status: "approved" },
    });

    if (approved.length === 0) {
      return json({ preview: [], message: "No approved suggestions to commit" });
    }

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    const preview = approved
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
        };
      });

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

    const updateData: Record<string, unknown> = {};
    for (const suggestion of validSuggestions) {
      updateData[suggestion.targetField] = suggestion.suggestedValue;
    }
    updateData.lastUpdatedSource = "inferred";

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    let preference;
    if (existing) {
      const changeLogs = validSuggestions.map((s) => {
        const raw = (existing as Record<string, unknown>)[s.targetField];
        return {
          preferenceId: existing.id,
          changedByUserId: user.id,
          source: "inferred" as const,
          fieldName: s.targetField,
          oldValue: raw == null ? Prisma.DbNull : (raw as Prisma.InputJsonValue),
          newValue: s.suggestedValue == null ? Prisma.DbNull : (s.suggestedValue as Prisma.InputJsonValue),
        };
      });

      preference = await prisma.clientPreference.update({
        where: { clientId },
        data: updateData,
      });

      if (changeLogs.length > 0) {
        await prisma.preferenceChangeLog.createMany({ data: changeLogs });
      }
    } else {
      preference = await prisma.clientPreference.create({
        data: {
          clientId,
          ...updateData,
        },
      });
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
      committed: validSuggestions.length,
      preference,
      fields: validSuggestions.map((s) => s.targetField),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Meeting commit POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
