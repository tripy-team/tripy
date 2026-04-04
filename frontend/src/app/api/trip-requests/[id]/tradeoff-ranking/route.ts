import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const WEIGHT_FIELDS = [
  "cashCost",
  "pointsUsage",
  "redemptionValue",
  "travelTime",
  "fewestLayovers",
  "premiumExperience",
  "flexibility",
  "familyConvenience",
] as const;

function clampWeight(v: unknown): number | undefined {
  if (typeof v !== "number") return undefined;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const ranking = await prisma.tripTradeoffRanking.findUnique({
      where: { tripRequestId: id },
    });

    if (!ranking) {
      return json({
        tripRequestId: id,
        cashCost: 50,
        pointsUsage: 50,
        redemptionValue: 50,
        travelTime: 50,
        fewestLayovers: 50,
        premiumExperience: 50,
        flexibility: 50,
        familyConvenience: 50,
      });
    }

    return json(ranking);
  } catch (error) {
    console.error("Get tradeoff ranking error:", error);
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

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const body = await request.json();

    const data: Record<string, number> = {};
    for (const field of WEIGHT_FIELDS) {
      const val = clampWeight(body[field]);
      if (val !== undefined) data[field] = val;
    }

    if (Object.keys(data).length === 0) {
      return errorResponse("At least one weight field is required", 400);
    }

    const ranking = await prisma.tripTradeoffRanking.upsert({
      where: { tripRequestId: id },
      create: { tripRequestId: id, ...data },
      update: data,
    });

    return json(ranking);
  } catch (error) {
    console.error("Update tradeoff ranking error:", error);
    return errorResponse("Internal server error", 500);
  }
}
