import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  computeConfidence,
  type ConfidenceInput,
} from "@/lib/confidence-engine";

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
        client: {
          include: {
            preferences: true,
            loyaltyBalances: { select: { id: true }, take: 1 },
          },
        },
      },
    });

    if (!trip) return errorResponse("Trip request not found", 404);

    const input: ConfidenceInput = {
      tripRequest: {
        title: trip.title,
        originAirports: trip.originAirports,
        destinationAirports: trip.destinationAirports,
        departureDate: trip.departureDate,
        returnDate: trip.returnDate,
        travelerCount: trip.travelerCount,
        cabinPreference: trip.cabinPreference,
        flexibilityDays: trip.flexibilityDays,
        budgetCash: trip.budgetCash,
        notes: trip.notes,
      },
      clientPreferences: trip.client?.preferences ?? null,
      client: trip.client
        ? {
            firstName: trip.client.firstName,
            lastName: trip.client.lastName,
            notes: trip.client.notes,
          }
        : null,
      hasLoyaltyBalances: (trip.client?.loyaltyBalances?.length ?? 0) > 0,
    };

    const result = computeConfidence(input);
    return json(result);
  } catch (error) {
    console.error("Confidence calculation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
