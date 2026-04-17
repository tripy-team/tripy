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

const ARRAY_PREFERENCE_FIELDS = new Set([
  "preferredAirlines", "avoidedAirlines", "preferredHotelTypes",
  "roomPreferences", "accessibilityNeeds", "foodPreferences",
  "activityPreferences", "specialOccasions", "dislikes", "dealbreakers",
]);

export async function commitSuggestionsForClient(
  targetClientId: string,
  suggestions: Array<{ id: string; targetField: string; suggestedValue: unknown }>,
  userId: string,
) {
  const valid = suggestions.filter((s) => VALID_PREFERENCE_FIELDS.has(s.targetField));
  if (valid.length === 0) return 0;

  const existing = await prisma.clientPreference.findUnique({
    where: { clientId: targetClientId },
  });
  const existingRecord = existing as Record<string, unknown> | null;

  const updateData: Record<string, unknown> = {};
  for (const s of valid) {
    if (ARRAY_PREFERENCE_FIELDS.has(s.targetField)) {
      const existingArr = Array.isArray(existingRecord?.[s.targetField]) ? (existingRecord![s.targetField] as unknown[]) : [];
      const incomingArr = Array.isArray(s.suggestedValue) ? s.suggestedValue : [];
      updateData[s.targetField] = [...new Set([...existingArr, ...incomingArr])];
    } else {
      updateData[s.targetField] = s.suggestedValue;
    }
  }
  updateData.lastUpdatedSource = "inferred";

  if (existing) {
    const changeLogs = valid.map((s) => {
      const raw = existingRecord![s.targetField];
      return {
        preferenceId: existing.id,
        changedByUserId: userId,
        source: "inferred" as const,
        fieldName: s.targetField,
        oldValue: raw == null ? Prisma.DbNull : (raw as Prisma.InputJsonValue),
        newValue: updateData[s.targetField] == null ? Prisma.DbNull : (updateData[s.targetField] as Prisma.InputJsonValue),
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
