import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { generateItinerary } from "@/lib/itinerary-ai";
import type { ItineraryInput } from "@/lib/itinerary-ai";
import {
  searchFlightsForTravelers,
  type TravelerSearchInput,
} from "@/lib/flight-search";

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
            loyaltyBalances: { include: { loyaltyProgram: true } },
            preferences: true,
          },
        },
        travelers: {
          include: {
            client: {
              include: {
                loyaltyBalances: { include: { loyaltyProgram: true } },
              },
            },
          },
        },
      },
    });

    if (!trip) return errorResponse("Trip request not found", 404);

    const prefs = trip.client?.preferences;
    const balances = trip.client?.loyaltyBalances || [];

    const now = new Date();
    const activeBonuses = await prisma.transferBonus.findMany({
      where: { isActive: true, endsAt: { gte: now } },
      include: { fromProgram: true, toProgram: true },
      orderBy: { bonusPercent: "desc" },
    });

    const multiCityMatch = trip.notes?.match(/\[MULTI_CITY:(\[.*?\])\]/);
    let multiCityLegs: ItineraryInput["multiCityLegs"];
    if (multiCityMatch) {
      try {
        multiCityLegs = JSON.parse(multiCityMatch[1]);
      } catch {
        // ignore parse errors
      }
    }

    const cleanNotes = trip.notes
      ?.replace(/\[MULTI_CITY:\[.*?\]\]\s*/g, "")
      .replace(/\[TRAVELER_FLIGHTS:\[[\s\S]*?\]\]\s*/g, "")
      .trim();

    const input: ItineraryInput = {
      tripTitle: trip.title,
      originAirports: trip.originAirports as string[],
      destinationAirports: trip.destinationAirports as string[],
      departureDate: trip.departureDate.toISOString().split("T")[0],
      returnDate: trip.returnDate
        ? trip.returnDate.toISOString().split("T")[0]
        : undefined,
      travelerCount: trip.travelerCount,
      cabinPreference: trip.cabinPreference,
      budgetCash: trip.budgetCash ?? undefined,
      flexibilityDays: trip.flexibilityDays ?? undefined,
      notes: cleanNotes || undefined,
      clientName: trip.client
        ? `${trip.client.firstName} ${trip.client.lastName}`
        : undefined,
      preferences: prefs
        ? {
            preferredCabin: prefs.preferredCabin,
            prefersNonstop: prefs.prefersNonstop,
            maxLayoverMinutes: prefs.maxLayoverMinutes ?? undefined,
            willingToReposition: prefs.willingToReposition,
            avoidBasicEconomy: prefs.avoidBasicEconomy,
            preferredAirlines: (prefs.preferredAirlines as string[]) ?? undefined,
            avoidedAirlines: (prefs.avoidedAirlines as string[]) ?? undefined,
            preferredHotelTypes: (prefs.preferredHotelTypes as string[]) ?? undefined,
            roomPreferences: (prefs.roomPreferences as string[]) ?? undefined,
            locationPreferences: prefs.locationPreferences ?? undefined,
            redemptionStyle: prefs.redemptionStyle,
            budgetSensitivity: prefs.budgetSensitivity ?? undefined,
            pointsVsCash: prefs.pointsVsCash ?? undefined,
            foodPreferences: (prefs.foodPreferences as string[]) ?? undefined,
            activityPreferences: (prefs.activityPreferences as string[]) ?? undefined,
            familyConsiderations: prefs.familyConsiderations ?? undefined,
            specialOccasions: (prefs.specialOccasions as string[]) ?? undefined,
            dislikes: (prefs.dislikes as string[]) ?? undefined,
            dealbreakers: (prefs.dealbreakers as string[]) ?? undefined,
            notes: prefs.notes ?? undefined,
          }
        : undefined,
      loyaltyBalances: balances.map((b) => ({
        programName: b.loyaltyProgram?.name ?? "Unknown",
        programCode: b.loyaltyProgram?.code ?? "",
        category: b.loyaltyProgram?.category ?? "",
        balance: b.balance,
      })),
      transferBonuses: activeBonuses.map((b) => ({
        fromProgram: b.fromProgram?.name ?? "Unknown",
        toProgram: b.toProgram?.name ?? "Unknown",
        bonusPercent: b.bonusPercent,
        endsAt: b.endsAt.toISOString().split("T")[0],
      })),
      multiCityLegs,
    };

    // Build per-traveler search inputs
    const tripOrigins = trip.originAirports as string[];
    const tripDests = trip.destinationAirports as string[];
    const departureDate = trip.departureDate.toISOString().split("T")[0];
    const returnDate = trip.returnDate
      ? trip.returnDate.toISOString().split("T")[0]
      : undefined;

    const travelerInputs: TravelerSearchInput[] = [];

    // Lead traveler (the client)
    if (trip.client) {
      travelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        originAirports: tripOrigins,
        destinationAirports: tripDests,
      });
    }

    // Additional travelers
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      const tOrigins =
        t.useLeaderCities || !t.originAirports
          ? tripOrigins
          : (t.originAirports as string[]);
      const tDests =
        t.useLeaderCities || !t.destinationAirports
          ? tripDests
          : (t.destinationAirports as string[]);

      travelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        originAirports: tOrigins,
        destinationAirports: tDests,
      });
    }

    // Run AI itinerary + real flight search in parallel
    const [itinerary, travelerFlights] = await Promise.all([
      generateItinerary(input),
      searchFlightsForTravelers(
        travelerInputs,
        departureDate,
        returnDate,
        trip.cabinPreference ?? "economy",
      ),
    ]);

    itinerary.travelerFlights = travelerFlights;

    return json(itinerary);
  } catch (error) {
    console.error("Generate itinerary error:", error);
    return errorResponse("Failed to generate itinerary", 500);
  }
}
