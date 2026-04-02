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
      include: {
        client: true,
        household: true,
        travelers: { include: { client: true } },
        recommendationRuns: {
          include: {
            options: {
              orderBy: { rank: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!trip) return errorResponse("Trip request not found", 404);
    return json(trip);
  } catch (error) {
    console.error("Get trip request error:", error);
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

    const existing = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Trip request not found", 404);

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
      status,
      clientId,
      householdId,
    } = body;

    const trip = await prisma.tripRequest.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(originAirports !== undefined && { originAirports }),
        ...(destinationAirports !== undefined && { destinationAirports }),
        ...(departureDate !== undefined && {
          departureDate: new Date(departureDate),
        }),
        ...(returnDate !== undefined && {
          returnDate: returnDate ? new Date(returnDate) : null,
        }),
        ...(travelerCount !== undefined && { travelerCount }),
        ...(cabinPreference !== undefined && { cabinPreference }),
        ...(flexibilityDays !== undefined && { flexibilityDays }),
        ...(budgetCash !== undefined && { budgetCash }),
        ...(notes !== undefined && { notes }),
        ...(status !== undefined && { status }),
        ...(clientId !== undefined && { clientId }),
        ...(householdId !== undefined && { householdId }),
      },
    });

    return json(trip);
  } catch (error) {
    console.error("Update trip request error:", error);
    return errorResponse("Internal server error", 500);
  }
}
