import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export const VALID_PREFERENCE_FIELDS = new Set([
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

export async function commitSuggestionsForClient(
  targetClientId: string,
  suggestions: Array<{ id: string; targetField: string; suggestedValue: unknown }>,
  userId: string,
) {
  const valid = suggestions.filter((s) => VALID_PREFERENCE_FIELDS.has(s.targetField));
  if (valid.length === 0) return 0;

  const updateData: Record<string, unknown> = {};
  for (const s of valid) {
    updateData[s.targetField] = s.suggestedValue;
  }
  updateData.lastUpdatedSource = "inferred";

  const existing = await prisma.clientPreference.findUnique({
    where: { clientId: targetClientId },
  });

  if (existing) {
    const changeLogs = valid.map((s) => {
      const raw = (existing as Record<string, unknown>)[s.targetField];
      return {
        preferenceId: existing.id,
        changedByUserId: userId,
        source: "inferred" as const,
        fieldName: s.targetField,
        oldValue: raw == null ? Prisma.DbNull : (raw as Prisma.InputJsonValue),
        newValue: s.suggestedValue == null ? Prisma.DbNull : (s.suggestedValue as Prisma.InputJsonValue),
      };
    });

    await prisma.clientPreference.update({
      where: { clientId: targetClientId },
      data: updateData,
    });

    if (changeLogs.length > 0) {
      await prisma.preferenceChangeLog.createMany({ data: changeLogs });
    }
  } else {
    await prisma.clientPreference.create({
      data: { clientId: targetClientId, ...updateData },
    });
  }

  return valid.length;
}
