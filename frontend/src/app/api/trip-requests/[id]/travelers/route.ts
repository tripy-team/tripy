import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function POST(
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

    const body = await request.json();
    const { clientId, travelerType, mustTravelWithClientId } = body;

    if (!clientId) return errorResponse("clientId is required", 400);

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const traveler = await prisma.tripTraveler.create({
      data: {
        tripRequestId: id,
        clientId,
        travelerType: travelerType ?? "adult",
        mustTravelWithClientId: mustTravelWithClientId || null,
      },
      include: { client: true },
    });

    return json(traveler, 201);
  } catch (error) {
    console.error("Add traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}
