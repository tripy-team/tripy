import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const source = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId: id },
    });
    if (!source) return errorResponse("Intake not found", 404);

    const body = await request.json().catch(() => ({}));
    const targetClientId = body.targetClientId || id;

    if (targetClientId !== id) {
      const targetClient = await prisma.client.findFirst({
        where: { id: targetClientId, organizationId: user.organizationId },
      });
      if (!targetClient) return errorResponse("Target client not found", 404);
    }

    const duplicate = await prisma.clientIntake.create({
      data: {
        clientId: targetClientId,
        createdByUserId: user.id,
        status: "draft",
        duplicatedFromId: intakeId,
        completedAt: null,
        isTemplate: source.isTemplate,
        templateName: source.templateName,
        tripType: source.tripType,
        tripTypeOther: source.tripTypeOther,
        destinations: source.destinations ?? undefined,
        departureAirports: source.departureAirports ?? undefined,
        dateFlexibility: source.dateFlexibility,
        earliestDeparture: source.earliestDeparture,
        latestReturn: source.latestReturn,
        tripDurationDays: source.tripDurationDays,
        budgetMin: source.budgetMin,
        budgetMax: source.budgetMax,
        budgetCurrency: source.budgetCurrency,
        budgetNotes: source.budgetNotes,
        cabinPreference: source.cabinPreference,
        hotelStyles: source.hotelStyles ?? undefined,
        loyaltyNotes: source.loyaltyNotes,
        accessibilityNeeds: source.accessibilityNeeds,
        dietaryNeeds: source.dietaryNeeds,
        travelPace: source.travelPace,
        layoverTolerance: source.layoverTolerance,
        luxuryPreference: source.luxuryPreference,
        familyFriendly: source.familyFriendly,
        travelerCount: source.travelerCount,
        childrenCount: source.childrenCount,
        childrenAges: source.childrenAges ?? undefined,
        desiredExperiences: source.desiredExperiences ?? undefined,
        dealbreakers: source.dealbreakers ?? undefined,
        preferredAirlines: source.preferredAirlines ?? undefined,
        avoidedAirlines: source.avoidedAirlines ?? undefined,
        notes: source.notes,
      },
    });

    return json(duplicate, 201);
  } catch (error) {
    console.error("Duplicate client intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}
