import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const PREFERENCE_FIELDS = [
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
  "defaultTradeoffWeights",
  "notes",
  "mergeStrategy",
] as const;

export async function GET(
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

    const preferences = await prisma.clientPreference.findUnique({
      where: { clientId: id },
    });

    return json(preferences);
  } catch (error) {
    console.error("Get preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PUT(
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
    const source = body._source ?? "manual";

    const existing = await prisma.clientPreference.findUnique({
      where: { clientId: id },
    });

    const updateData: Record<string, unknown> = {};
    for (const field of PREFERENCE_FIELDS) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }
    updateData.lastUpdatedSource = source;

    const preferences = await prisma.clientPreference.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        ...Object.fromEntries(
          PREFERENCE_FIELDS.map((f) => [f, body[f] ?? null]),
        ),
        preferredCabin: body.preferredCabin ?? "economy",
        prefersNonstop: body.prefersNonstop ?? false,
        willingToReposition: body.willingToReposition ?? false,
        avoidBasicEconomy: body.avoidBasicEconomy ?? false,
        redemptionStyle: body.redemptionStyle ?? "balanced",
        lastUpdatedSource: source,
        mergeStrategy: body.mergeStrategy ?? "merge",
      },
      update: updateData,
    });

    const changeLogs = [];
    for (const field of PREFERENCE_FIELDS) {
      if (body[field] === undefined) continue;
      const oldVal = existing ? (existing as Record<string, unknown>)[field] : null;
      const newVal = body[field];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changeLogs.push({
          preferenceId: preferences.id,
          changedByUserId: user.id,
          source,
          fieldName: field,
          oldValue: oldVal === undefined ? null : oldVal,
          newValue: newVal,
        });
      }
    }

    if (changeLogs.length > 0) {
      await prisma.preferenceChangeLog.createMany({ data: changeLogs });
    }

    return json(preferences);
  } catch (error) {
    console.error("Upsert preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}
