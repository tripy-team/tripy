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
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const brief = await prisma.tripBrief.findFirst({
      where: { tripRequestId: id },
      orderBy: { version: "desc" },
      include: {
        generatedBy: { select: { firstName: true, lastName: true } },
      },
    });

    if (!brief) return json(null);
    return json(brief);
  } catch (error) {
    console.error("Get trip brief error:", error);
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
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const latestBrief = await prisma.tripBrief.findFirst({
      where: { tripRequestId: id },
      orderBy: { version: "desc" },
    });
    if (!latestBrief) return errorResponse("No brief exists to edit", 404);

    const allowedFields = [
      "executiveSummary",
      "hardConstraints",
      "softPreferences",
      "pointsCashPosture",
      "acceptableTradeoffs",
      "doNotRecommend",
      "operationalNotes",
    ] as const;

    const updateData: Record<string, string> = {};
    for (const field of allowedFields) {
      if (typeof body[field] === "string") {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return errorResponse("No valid fields to update", 400);
    }

    const updated = await prisma.tripBrief.update({
      where: { id: latestBrief.id },
      data: { ...updateData, isEdited: true },
      include: {
        generatedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return json(updated);
  } catch (error) {
    console.error("Update trip brief error:", error);
    return errorResponse("Internal server error", 500);
  }
}
