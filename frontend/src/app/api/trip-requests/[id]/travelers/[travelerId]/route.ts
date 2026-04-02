import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; travelerId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, travelerId } = await params;

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const traveler = await prisma.tripTraveler.findFirst({
      where: { id: travelerId, tripRequestId: id },
    });
    if (!traveler) return errorResponse("Traveler not found", 404);

    await prisma.tripTraveler.delete({ where: { id: travelerId } });

    return json({ success: true });
  } catch (error) {
    console.error("Remove traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}
