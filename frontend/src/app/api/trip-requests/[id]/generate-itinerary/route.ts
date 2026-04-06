import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { generateItinerary, TRANSFER_PARTNERS } from "@/lib/itinerary-ai";
import type { ItineraryInput } from "@/lib/itinerary-ai";
import {
  searchFlightsForTravelers,
  type TravelerSearchInput,
} from "@/lib/flight-search";
import { deriveStayWindows } from "@/lib/hotel-search";
import type { TravelerHotelSearchInput } from "@/lib/hotel-search";
import { searchAndScoreHotelsForTravelers } from "@/lib/hotel-scoring";
import type { HotelScoringContext } from "@/lib/hotel-scoring";
import {
  searchRestaurantsForTrip,
  type RestaurantSearchInput,
} from "@/lib/restaurant-search";
import {
  searchAndScoreTransportForTravelers,
  type TransportScoringContext,
} from "@/lib/transport-scoring";
import type { TransportSearchInput } from "@/lib/transport-search";
import type { Prisma } from "@/generated/prisma/client";

export const maxDuration = 60;

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

    const activeBonuses = await prisma.transferBonus.findMany({
      where: { isActive: true, endsAt: { gte: new Date() } },
      include: { fromProgram: true, toProgram: true },
      orderBy: { bonusPercent: "desc" },
    });

    const multiCityMatch = trip.notes?.match(/\[MULTI_CITY:(\[.*?\])\]/);
    let multiCityLegs: ItineraryInput["multiCityLegs"];
    if (multiCityMatch) {
      try { multiCityLegs = JSON.parse(multiCityMatch[1]); } catch { /* ignore */ }
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
      returnDate: trip.returnDate ? trip.returnDate.toISOString().split("T")[0] : undefined,
      travelerCount: trip.travelerCount,
      cabinPreference: trip.cabinPreference,
      budgetCash: trip.budgetCash ?? undefined,
      flexibilityDays: trip.flexibilityDays ?? undefined,
      notes: cleanNotes || undefined,
      clientName: trip.client ? `${trip.client.firstName} ${trip.client.lastName}` : undefined,
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

    const tripOrigins = trip.originAirports as string[];
    const tripDests = trip.destinationAirports as string[];
    const departureDate = trip.departureDate.toISOString().split("T")[0];
    const returnDate = trip.returnDate ? trip.returnDate.toISOString().split("T")[0] : undefined;

    const travelerInputs: TravelerSearchInput[] = [];
    if (trip.client) {
      travelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        originAirports: tripOrigins,
        destinationAirports: tripDests,
      });
    }
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      travelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        originAirports: t.useLeaderCities || !t.originAirports ? tripOrigins : (t.originAirports as string[]),
        destinationAirports: t.useLeaderCities || !t.destinationAirports ? tripDests : (t.destinationAirports as string[]),
      });
    }

    // --- Hotel search setup ---
    const destinations = trip.destinationAirports as string[];
    const stayWindows = deriveStayWindows(destinations, departureDate, returnDate);

    const hotelPrograms: string[] = [];
    for (const b of balances) {
      const cat = b.loyaltyProgram?.category?.toLowerCase() ?? "";
      if (cat === "hotel") hotelPrograms.push(b.loyaltyProgram?.code ?? "");
    }

    const hotelTravelerInputs: TravelerHotelSearchInput[] = [];
    if (trip.client) {
      hotelTravelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        stayWindows,
        hotelPrograms,
      });
    }
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      hotelTravelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        stayWindows,
        hotelPrograms,
      });
    }

    const hotelScoringContext: HotelScoringContext = {
      clientName: trip.client ? `${trip.client.firstName} ${trip.client.lastName}` : "Guest",
      tripTitle: trip.title,
      travelerCount: trip.travelerCount,
      budgetCash: trip.budgetCash ?? undefined,
      preferences: {
        preferredHotelTypes: (prefs?.preferredHotelTypes as string[]) ?? undefined,
        roomPreferences: (prefs?.roomPreferences as string[]) ?? undefined,
        locationPreferences: prefs?.locationPreferences ?? undefined,
        budgetSensitivity: prefs?.budgetSensitivity ?? undefined,
        redemptionStyle: prefs?.redemptionStyle ?? undefined,
      },
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
      transferPartners: TRANSFER_PARTNERS,
    };

    // --- Transport search setup ---
    const transportTravelerInputs: TransportSearchInput[] = [];
    if (trip.client) {
      transportTravelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        originAirports: tripOrigins,
        destinationAirports: tripDests,
      });
    }
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      transportTravelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        originAirports: t.useLeaderCities || !t.originAirports ? tripOrigins : (t.originAirports as string[]),
        destinationAirports: t.useLeaderCities || !t.destinationAirports ? tripDests : (t.destinationAirports as string[]),
      });
    }

    const transportScoringContext: TransportScoringContext = {
      clientName: trip.client ? `${trip.client.firstName} ${trip.client.lastName}` : "Guest",
      tripTitle: trip.title,
      travelerCount: trip.travelerCount,
      budgetCash: trip.budgetCash ?? undefined,
      preferences: {
        budgetSensitivity: prefs?.budgetSensitivity ?? undefined,
        notes: cleanNotes || undefined,
      },
    };

    // --- Restaurant search setup ---
    const restaurantInput: RestaurantSearchInput = {
      destination: destinations.join(", "),
      departureDate,
      returnDate,
      travelerCount: trip.travelerCount,
      clientName: trip.client ? `${trip.client.firstName} ${trip.client.lastName}` : undefined,
      preferences: prefs
        ? {
            foodPreferences: (prefs.foodPreferences as string[]) ?? undefined,
            activityPreferences: (prefs.activityPreferences as string[]) ?? undefined,
            budgetSensitivity: prefs.budgetSensitivity ?? undefined,
            dislikes: (prefs.dislikes as string[]) ?? undefined,
            dealbreakers: (prefs.dealbreakers as string[]) ?? undefined,
            familyConsiderations: prefs.familyConsiderations ?? undefined,
            specialOccasions: (prefs.specialOccasions as string[]) ?? undefined,
            notes: prefs.notes ?? undefined,
          }
        : undefined,
    };

    // --- Run AI itinerary, flight search, hotel search, transport search, and restaurant search in parallel ---
    const [itinerary, travelerFlights, travelerHotels, travelerTransport, restaurants] = await Promise.all([
      generateItinerary(input),
      searchFlightsForTravelers(
        travelerInputs, departureDate, returnDate, trip.cabinPreference ?? "economy",
      ).catch((err) => {
        console.error("Flight search failed (non-fatal):", err);
        return [];
      }),
      searchAndScoreHotelsForTravelers(
        hotelTravelerInputs, hotelScoringContext,
      ).catch((err) => {
        console.error("Hotel search failed (non-fatal):", err);
        return [];
      }),
      searchAndScoreTransportForTravelers(
        transportTravelerInputs, departureDate, returnDate, transportScoringContext,
        trip.cabinPreference ?? "economy",
      ).catch((err) => {
        console.error("Transport search failed (non-fatal):", err);
        return [];
      }),
      searchRestaurantsForTrip(restaurantInput).catch((err) => {
        console.error("Restaurant search failed (non-fatal):", err);
        return [];
      }),
    ]);

    itinerary.travelerFlights = travelerFlights;
    itinerary.travelerHotels = travelerHotels;
    itinerary.travelerTransport = travelerTransport;
    itinerary.restaurants = restaurants;

    await prisma.itineraryJob.create({
      data: {
        tripRequestId: id,
        status: "complete",
        result: itinerary as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return json({ status: "complete", result: itinerary });
  } catch (error) {
    console.error("Generate itinerary error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate itinerary",
      500,
    );
  }
}
