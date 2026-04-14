import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  analyzeIntakeForPreferences,
  type IntakeData,
  type IntakeChatMessage,
  type AnalyzedPreferences,
} from "@/lib/intake-chat-ai";

const PREFERENCE_FIELDS = [
  "preferredCabin",
  "prefersNonstop",
  "maxLayoverMinutes",
  "willingToReposition",
  "avoidBasicEconomy",
  "preferredAirlines",
  "avoidedAirlines",
  "preferredHotelTypes",
  "redemptionStyle",
  "budgetSensitivity",
  "accessibilityNeeds",
  "foodPreferences",
  "activityPreferences",
  "familyConsiderations",
  "dealbreakers",
  "notes",
] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const intake = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId },
    });
    if (!intake) return errorResponse("Intake not found", 404);

    const body = await request.json().catch(() => ({}));
    const intakeData = (body.intakeData ?? {}) as IntakeData;
    const chatTranscript = (body.chatTranscript ?? []) as IntakeChatMessage[];

    const clientName = `${client.firstName} ${client.lastName}`;

    const analyzed: AnalyzedPreferences = await analyzeIntakeForPreferences(
      clientName,
      intakeData,
      chatTranscript,
    );

    const updateData: Record<string, unknown> = {};
    for (const field of PREFERENCE_FIELDS) {
      const value = (analyzed as Record<string, unknown>)[field];
      if (value !== undefined) updateData[field] = value;
    }
    updateData.lastUpdatedSource = "intake";

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId },
    });

    const preferences = await prisma.clientPreference.upsert({
      where: { clientId },
      create: {
        clientId,
        preferredCabin: (analyzed.preferredCabin as string) ?? "economy",
        prefersNonstop: analyzed.prefersNonstop ?? false,
        willingToReposition: analyzed.willingToReposition ?? false,
        avoidBasicEconomy: analyzed.avoidBasicEconomy ?? false,
        redemptionStyle: (analyzed.redemptionStyle as string) ?? "balanced",
        mergeStrategy: "merge",
        lastUpdatedSource: "intake",
        ...Object.fromEntries(
          PREFERENCE_FIELDS.filter((f) => (analyzed as Record<string, unknown>)[f] !== undefined).map(
            (f) => [f, (analyzed as Record<string, unknown>)[f]],
          ),
        ),
      } as never,
      update: updateData,
    });

    const changeLogs: Prisma.PreferenceChangeLogCreateManyInput[] = [];
    for (const field of PREFERENCE_FIELDS) {
      const newVal = (analyzed as Record<string, unknown>)[field];
      if (newVal === undefined) continue;
      const oldVal = existing ? (existing as Record<string, unknown>)[field] : null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changeLogs.push({
          preferenceId: preferences.id,
          changedByUserId: user.id,
          source: "intake",
          fieldName: field,
          oldValue: oldVal == null ? Prisma.DbNull : (oldVal as Prisma.InputJsonValue),
          newValue: newVal == null ? Prisma.DbNull : (newVal as Prisma.InputJsonValue),
        });
      }
    }
    if (changeLogs.length > 0) {
      await prisma.preferenceChangeLog.createMany({ data: changeLogs });
    }

    await prisma.clientIntake.update({
      where: { id: intakeId },
      data: { status: "complete" },
    });

    return json({
      preferences,
      analyzed,
      fieldsUpdated: Object.keys(updateData).filter((k) => k !== "lastUpdatedSource").length,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[IntakeAnalyze] POST failed:", error);
    return errorResponse("Failed to analyze intake", 500);
  }
}
