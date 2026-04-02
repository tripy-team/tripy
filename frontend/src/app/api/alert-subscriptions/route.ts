import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const subscriptions = await prisma.alertSubscription.findMany({
      where: { organizationId: user.organizationId },
      include: {
        client: true,
        household: true,
        tripRequest: true,
        targetProgram: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return json(subscriptions);
  } catch (error) {
    console.error("List alert subscriptions error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const {
      clientId,
      householdId,
      tripRequestId,
      alertType,
      targetProgramId,
      targetRoute,
      isActive,
    } = body;

    if (!alertType) {
      return errorResponse("alertType is required", 400);
    }

    const subscription = await prisma.alertSubscription.create({
      data: {
        organizationId: user.organizationId,
        clientId: clientId || null,
        householdId: householdId || null,
        tripRequestId: tripRequestId || null,
        alertType,
        targetProgramId: targetProgramId || null,
        targetRoute: targetRoute ?? null,
        isActive: isActive ?? true,
      },
    });

    return json(subscription, 201);
  } catch (error) {
    console.error("Create alert subscription error:", error);
    return errorResponse("Internal server error", 500);
  }
}
