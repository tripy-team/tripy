import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { generateTripBrief } from "@/lib/openai";
import type { TripBriefInput } from "@/lib/openai";

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
      include: {
        client: {
          include: {
            preferences: true,
            loyaltyBalances: { include: { loyaltyProgram: true } },
            familyMembers: true,
            intakes: {
              where: { status: "complete" },
              orderBy: { completedAt: "desc" },
              take: 1,
            },
          },
        },
        travelers: { include: { client: true } },
      },
    });

    if (!trip) return errorResponse("Trip request not found", 404);
    if (!trip.client) return errorResponse("Trip has no linked client", 400);

    const intake = trip.client.intakes[0];
    if (!intake) {
      return errorResponse(
        "No completed intake found for this client. Complete an intake first.",
        400,
      );
    }

    const briefInput: TripBriefInput = {
      clientName: `${trip.client.firstName} ${trip.client.lastName}`,
      intake: {
        tripType: intake.tripType ?? undefined,
        destinations: (intake.destinations as string[]) ?? undefined,
        departureAirports: (intake.departureAirports as string[]) ?? undefined,
        dateFlexibility: intake.dateFlexibility ?? undefined,
        earliestDeparture: intake.earliestDeparture
          ? intake.earliestDeparture.toISOString().split("T")[0]
          : undefined,
        latestReturn: intake.latestReturn
          ? intake.latestReturn.toISOString().split("T")[0]
          : undefined,
        tripDurationDays: intake.tripDurationDays ?? undefined,
        budgetMin: intake.budgetMin ?? undefined,
        budgetMax: intake.budgetMax ?? undefined,
        budgetCurrency: intake.budgetCurrency,
        budgetNotes: intake.budgetNotes ?? undefined,
        cabinPreference: intake.cabinPreference ?? undefined,
        hotelStyles: (intake.hotelStyles as string[]) ?? undefined,
        loyaltyNotes: intake.loyaltyNotes ?? undefined,
        accessibilityNeeds: intake.accessibilityNeeds ?? undefined,
        dietaryNeeds: intake.dietaryNeeds ?? undefined,
        travelPace: intake.travelPace ?? undefined,
        layoverTolerance: intake.layoverTolerance ?? undefined,
        luxuryPreference: intake.luxuryPreference ?? undefined,
        familyFriendly: intake.familyFriendly ?? undefined,
        travelerCount: intake.travelerCount ?? undefined,
        childrenCount: intake.childrenCount ?? undefined,
        childrenAges: (intake.childrenAges as number[]) ?? undefined,
        desiredExperiences:
          (intake.desiredExperiences as string[]) ?? undefined,
        dealbreakers: (intake.dealbreakers as string[]) ?? undefined,
        preferredAirlines:
          (intake.preferredAirlines as string[]) ?? undefined,
        avoidedAirlines: (intake.avoidedAirlines as string[]) ?? undefined,
        notes: intake.notes ?? undefined,
      },
      preferences: trip.client.preferences
        ? {
            preferredCabin: trip.client.preferences.preferredCabin,
            prefersNonstop: trip.client.preferences.prefersNonstop,
            maxLayoverMinutes:
              trip.client.preferences.maxLayoverMinutes ?? undefined,
            willingToReposition:
              trip.client.preferences.willingToReposition,
            redemptionStyle: trip.client.preferences.redemptionStyle,
            avoidBasicEconomy:
              trip.client.preferences.avoidBasicEconomy,
            preferredAirlines:
              (trip.client.preferences.preferredAirlines as string[]) ??
              undefined,
            avoidedAirlines:
              (trip.client.preferences.avoidedAirlines as string[]) ??
              undefined,
          }
        : undefined,
      loyaltyBalances: trip.client.loyaltyBalances.map((b) => ({
        programName: b.loyaltyProgram.name,
        balance: b.balance,
      })),
      familyMembers: trip.client.familyMembers.map((m) => ({
        name: m.name,
        relationship: m.relationship,
      })),
    };

    const result = await generateTripBrief(briefInput);

    const latestBrief = await prisma.tripBrief.findFirst({
      where: { tripRequestId: id },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latestBrief?.version ?? 0) + 1;

    const brief = await prisma.tripBrief.create({
      data: {
        tripRequestId: id,
        clientId: trip.client.id,
        intakeId: intake.id,
        generatedByUserId: user.id,
        version: nextVersion,
        executiveSummary: result.executiveSummary,
        hardConstraints: result.hardConstraints,
        softPreferences: result.softPreferences,
        pointsCashPosture: result.pointsCashPosture,
        acceptableTradeoffs: result.acceptableTradeoffs,
        doNotRecommend: result.doNotRecommend,
        operationalNotes: result.operationalNotes,
      },
      include: { generatedBy: { select: { firstName: true, lastName: true } } },
    });

    return json(brief, 201);
  } catch (error) {
    console.error("Generate trip brief error:", error);
    return errorResponse("Internal server error", 500);
  }
}
