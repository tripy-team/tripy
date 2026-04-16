import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const trips = await prisma.tripRequest.findMany({
      where: { organizationId: user.organizationId },
      include: {
        client: true,
        household: true,
        travelers: { include: { client: true } },
        recommendationRuns: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(trips);
  } catch (error) {
    console.error("List trip requests error:", error);
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
      title,
      originAirports,
      destinationAirports,
      departureDate,
      returnDate,
      travelerCount,
      cabinPreference,
      flexibilityDays,
      budgetCash,
      pointBalances,
      notes,
    } = body;

    if (!title || !originAirports || !destinationAirports || !departureDate) {
      return errorResponse(
        "title, originAirports, destinationAirports, and departureDate are required",
        400,
      );
    }

    const trip = await prisma.tripRequest.create({
      data: {
        organizationId: user.organizationId,
        ownerUserId: user.id,
        clientId: clientId || null,
        householdId: householdId || null,
        title,
        originAirports,
        destinationAirports,
        departureDate: new Date(departureDate),
        returnDate: returnDate ? new Date(returnDate) : null,
        travelerCount: travelerCount ?? 1,
        cabinPreference: cabinPreference ?? "economy",
        flexibilityDays: flexibilityDays ?? null,
        budgetCash: budgetCash ?? null,
        pointBalances: Array.isArray(pointBalances) && pointBalances.length > 0 ? pointBalances : undefined,
        notes: notes || null,
        ...(clientId
          ? {
              travelers: {
                create: {
                  clientId,
                  travelerType: "adult",
                  useLeaderCities: true,
                  originAirports: originAirports ?? [],
                  destinationAirports: destinationAirports ?? [],
                },
              },
            }
          : {}),
      },
    });

    return json(trip, 201);
  } catch (error) {
    console.error("Create trip request error:", error);
    return errorResponse("Internal server error", 500);
  }
}
