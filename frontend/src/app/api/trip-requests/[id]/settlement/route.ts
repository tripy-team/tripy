import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

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

    const settlement = await prisma.groupSettlement.findFirst({
      where: { tripRequestId: id },
      orderBy: { createdAt: "desc" },
    });

    if (!settlement) return errorResponse("No settlement found for this trip", 404);

    return json({
      id: settlement.id,
      tripRequestId: settlement.tripRequestId,
      splitMethod: settlement.splitMethod,
      pointValuationMethod: settlement.pointValuationMethod,
      contributions: settlement.contributionLedger,
      fairShares: settlement.fairShares,
      transfers: settlement.transfers,
      memo: settlement.memo,
      createdAt: settlement.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Get settlement error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const body = await request.json();

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const settlement = await prisma.groupSettlement.findFirst({
      where: { tripRequestId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!settlement) return errorResponse("No settlement found for this trip", 404);

    const updated = await prisma.groupSettlement.update({
      where: { id: settlement.id },
      data: {
        splitMethod: body.splitMethod ?? settlement.splitMethod,
        pointValuationMethod: body.pointValuationMethod ?? settlement.pointValuationMethod,
        memo: body.memo ?? settlement.memo,
      },
    });

    return json({
      id: updated.id,
      splitMethod: updated.splitMethod,
      pointValuationMethod: updated.pointValuationMethod,
      memo: updated.memo,
    });
  } catch (error) {
    console.error("Update settlement error:", error);
    return errorResponse("Internal server error", 500);
  }
}
