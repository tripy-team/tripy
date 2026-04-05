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
    const { clientId, travelerType, mustTravelWithClientId, originAirports, destinationAirports, useLeaderCities } = body;

    if (!clientId) return errorResponse("clientId is required", 400);

    if (!useLeaderCities) {
      if (!originAirports || !Array.isArray(originAirports) || originAirports.length === 0) {
        return errorResponse("Start location is required", 400);
      }
      if (!destinationAirports || !Array.isArray(destinationAirports) || destinationAirports.length === 0) {
        return errorResponse("End location is required", 400);
      }
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.tripTraveler.findFirst({
      where: { tripRequestId: id, clientId },
    });
    if (existing) return errorResponse("This client is already a traveler on this trip", 409);

    const traveler = await prisma.tripTraveler.create({
      data: {
        tripRequestId: id,
        clientId,
        travelerType: travelerType ?? "adult",
        mustTravelWithClientId: mustTravelWithClientId || null,
        useLeaderCities: !!useLeaderCities,
        originAirports: useLeaderCities ? trip.originAirports : (originAirports ?? []),
        destinationAirports: useLeaderCities ? trip.destinationAirports : (destinationAirports ?? []),
      },
      include: { client: true },
    });

    return json(traveler, 201);
  } catch (error) {
    console.error("Add traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}
