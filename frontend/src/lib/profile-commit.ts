import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { syncLoyaltyBalancesFromNotes } from "@/lib/loyalty-balance-sync";

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
  "loyaltyNotes",
  "budgetNotes",
  "preferredDestinations",
  "preferredDepartureAirports",
  "dateFlexibility",
  "travelPace",
  "pastTripFeedback",
]);

const ARRAY_PREFERENCE_FIELDS = new Set([
  "preferredAirlines", "avoidedAirlines", "preferredHotelTypes",
  "roomPreferences", "accessibilityNeeds", "foodPreferences",
  "activityPreferences", "specialOccasions", "dislikes", "dealbreakers",
  "preferredDestinations", "preferredDepartureAirports",
]);

// Text fields where successive extractions accumulate (advisor learns more
// over multiple calls). A single overwrite would wipe prior Chase points
// when the client next mentions Amex, so we append if the new text isn't
// already present.
const ACCUMULATIVE_TEXT_FIELDS = new Set([
  "loyaltyNotes",
  "budgetNotes",
  "pastTripFeedback",
]);

function mergeAccumulativeText(existing: unknown, incoming: unknown): string {
  const ex = typeof existing === "string" ? existing.trim() : "";
  const inc = typeof incoming === "string" ? incoming.trim() : "";
  if (!inc) return ex;
  if (!ex) return inc;
  if (ex.toLowerCase().includes(inc.toLowerCase())) return ex;
  return `${ex}; ${inc}`;
}

export async function commitSuggestionsForClient(
  targetClientId: string,
  suggestions: Array<{ id: string; targetField: string; suggestedValue: unknown }>,
  userId: string,
  changeReason: string = "Extracted from client conversation",
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
      // Carry a pending value within this batch forward, so two suggestions
      // for the same array field from the same call union correctly instead
      // of the second clobbering the first.
      const existingArr = Array.isArray(updateData[s.targetField])
        ? (updateData[s.targetField] as unknown[])
        : Array.isArray(existingRecord?.[s.targetField])
        ? (existingRecord![s.targetField] as unknown[])
        : [];
      const incomingArr = Array.isArray(s.suggestedValue) ? s.suggestedValue : [];
      updateData[s.targetField] = [...new Set([...existingArr, ...incomingArr])];
    } else if (ACCUMULATIVE_TEXT_FIELDS.has(s.targetField)) {
      const base =
        updateData[s.targetField] ?? existingRecord?.[s.targetField] ?? null;
      updateData[s.targetField] = mergeAccumulativeText(base, s.suggestedValue);
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

  // If loyaltyNotes changed, parse "Amex MR: 10k; Chase UR: 300k" segments
  // and upsert structured ClientLoyaltyBalance rows. The Balances tab and
  // downstream booking engine read from that table, not from loyaltyNotes —
  // without this step the free text is written but point balances never
  // appear for advisors. Non-fatal: a sync failure shouldn't undo the
  // preference update.
  if (typeof updateData.loyaltyNotes === "string" && updateData.loyaltyNotes) {
    try {
      await syncLoyaltyBalancesFromNotes(
        targetClientId,
        updateData.loyaltyNotes,
        userId,
        changeReason,
      );
    } catch (err) {
      console.error("[profile-commit] loyalty balance sync failed:", err);
    }
  }

  return valid.length;
}
