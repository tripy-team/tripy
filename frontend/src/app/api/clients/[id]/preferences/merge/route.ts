import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { CabinPreference, RedemptionStyle } from "@/generated/prisma/client";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const MERGEABLE_FIELDS = [
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
] as const;

type MergeStrategy = "overwrite" | "merge" | "suggest";

function mergeArrayField(
  existing: unknown,
  incoming: unknown,
  strategy: MergeStrategy,
): unknown {
  if (strategy === "overwrite") return incoming;

  const existingArr = Array.isArray(existing) ? existing : [];
  const incomingArr = Array.isArray(incoming) ? incoming : [];

  if (strategy === "merge") {
    return [...new Set([...existingArr, ...incomingArr])];
  }
  return incoming;
}

function mergeScalarField(
  existing: unknown,
  incoming: unknown,
  strategy: MergeStrategy,
): unknown {
  if (strategy === "overwrite") return incoming;
  if (strategy === "merge") {
    return existing != null ? existing : incoming;
  }
  return incoming;
}

function isArrayField(field: string): boolean {
  return [
    "preferredAirlines",
    "avoidedAirlines",
    "preferredHotelTypes",
    "roomPreferences",
    "accessibilityNeeds",
    "foodPreferences",
    "activityPreferences",
    "specialOccasions",
    "dislikes",
    "dealbreakers",
  ].includes(field);
}

/**
 * POST: merge intake data into the client's preference profile.
 * Body: { intakeData: { ... }, strategy?: "overwrite" | "merge" | "suggest" }
 *
 * - "overwrite": replace all fields with intake data
 * - "merge": combine arrays, keep existing scalars if present
 * - "suggest": return a diff preview without saving
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const body = await request.json();
    const { intakeData, strategy: requestedStrategy } = body;
    if (!intakeData || typeof intakeData !== "object") {
      return errorResponse("intakeData is required", 400);
    }

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId: id },
    });

    const existingRecord = existing as Record<string, unknown> | null;
    const strategy: MergeStrategy = requestedStrategy ?? existing?.mergeStrategy ?? "merge";

    const merged: Record<string, unknown> = {};
    const diff: { field: string; oldValue: unknown; newValue: unknown }[] = [];

    for (const field of MERGEABLE_FIELDS) {
      if (intakeData[field] === undefined) continue;
      const oldVal = existingRecord?.[field] ?? null;
      const newVal = isArrayField(field)
        ? mergeArrayField(oldVal, intakeData[field], strategy)
        : mergeScalarField(oldVal, intakeData[field], strategy);

      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff.push({ field, oldValue: oldVal, newValue: newVal });
        merged[field] = newVal;
      }
    }

    if (strategy === "suggest") {
      return json({ strategy: "suggest", diff, applied: false });
    }

    if (diff.length === 0) {
      return json({
        strategy,
        diff: [],
        applied: true,
        preferences: existing,
      });
    }

    merged.lastUpdatedSource = "intake";

    const preferences = await prisma.clientPreference.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        ...merged,
        preferredCabin:
          (merged.preferredCabin as CabinPreference) ?? "economy",
        prefersNonstop:
          (merged.prefersNonstop as boolean) ?? false,
        willingToReposition:
          (merged.willingToReposition as boolean) ?? false,
        avoidBasicEconomy:
          (merged.avoidBasicEconomy as boolean) ?? false,
        redemptionStyle:
          (merged.redemptionStyle as RedemptionStyle) ?? "balanced",
        lastUpdatedSource: "intake",
      },
      update: merged,
    });

    const changeLogs = diff.map((d) => ({
      preferenceId: preferences.id,
      changedByUserId: user.id,
      source: "intake" as const,
      fieldName: d.field,
      oldValue: d.oldValue == null ? Prisma.DbNull : (d.oldValue as Prisma.InputJsonValue),
      newValue: d.newValue == null ? Prisma.DbNull : (d.newValue as Prisma.InputJsonValue),
    }));

    if (changeLogs.length > 0) {
      await prisma.preferenceChangeLog.createMany({ data: changeLogs });
    }

    return json({ strategy, diff, applied: true, preferences });
  } catch (error) {
    console.error("Merge preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}
