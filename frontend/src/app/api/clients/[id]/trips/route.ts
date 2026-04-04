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

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const trips = await prisma.tripRequest.findMany({
      where: { clientId: id },
      include: {
        recommendationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(trips);
  } catch (error) {
    console.error("List client trips error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
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
    const {
      title,
      originAirports,
      destinationAirports,
      departureDate,
      returnDate,
      travelerCount,
      cabinPreference,
      flexibilityDays,
      budgetCash,
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
        clientId: id,
        title,
        originAirports,
        destinationAirports,
        departureDate: new Date(departureDate),
        returnDate: returnDate ? new Date(returnDate) : null,
        travelerCount: travelerCount ?? 1,
        cabinPreference: cabinPreference ?? "economy",
        flexibilityDays: flexibilityDays ?? null,
        budgetCash: budgetCash ?? null,
        notes: notes || null,
      },
    });

    return json(trip, 201);
  } catch (error) {
    console.error("Create client trip error:", error);
    return errorResponse("Internal server error", 500);
  }
}
