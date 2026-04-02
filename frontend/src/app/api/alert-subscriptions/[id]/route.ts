import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const existing = await prisma.alertSubscription.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Subscription not found", 404);

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

    const subscription = await prisma.alertSubscription.update({
      where: { id },
      data: {
        ...(clientId !== undefined && { clientId }),
        ...(householdId !== undefined && { householdId }),
        ...(tripRequestId !== undefined && { tripRequestId }),
        ...(alertType !== undefined && { alertType }),
        ...(targetProgramId !== undefined && { targetProgramId }),
        ...(targetRoute !== undefined && { targetRoute }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return json(subscription);
  } catch (error) {
    console.error("Update alert subscription error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const existing = await prisma.alertSubscription.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Subscription not found", 404);

    await prisma.alertSubscription.delete({ where: { id } });

    return json({ success: true });
  } catch (error) {
    console.error("Delete alert subscription error:", error);
    return errorResponse("Internal server error", 500);
  }
}
