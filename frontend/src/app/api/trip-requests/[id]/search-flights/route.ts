import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  searchFlightsForTravelers,
  type TravelerSearchInput,
  type FlightPreferences,
  type MultiCityLeg,
} from "@/lib/flight-search";
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

    const tripOrigins = trip.originAirports as string[];
    const tripDests = trip.destinationAirports as string[];
    const departureDate = trip.departureDate.toISOString().split("T")[0];
    const returnDate = trip.returnDate
      ? trip.returnDate.toISOString().split("T")[0]
      : undefined;

    let multiCityLegs: MultiCityLeg[] | null = null;
    const multiCityMatch = trip.notes?.match(/\[MULTI_CITY:(\[.*?\])\]/);
    if (multiCityMatch) {
      try {
        multiCityLegs = JSON.parse(multiCityMatch[1]) as MultiCityLeg[];
      } catch {
        multiCityLegs = null;
      }
    }

    const travelerInputs: TravelerSearchInput[] = [];
    const clientBalances = (trip.client?.loyaltyBalances ?? []).map((b) => ({
      programName: b.loyaltyProgram?.name ?? "Unknown",
      programCode: b.loyaltyProgram?.code ?? "",
      category: b.loyaltyProgram?.category ?? "",
      balance: b.balance,
    }));
    if (trip.client) {
      travelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        originAirports: tripOrigins,
        destinationAirports: tripDests,
        loyaltyBalances: clientBalances,
      });
    }
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      const tBalances = (t.client.loyaltyBalances ?? []).map((b) => ({
        programName: b.loyaltyProgram?.name ?? "Unknown",
        programCode: b.loyaltyProgram?.code ?? "",
        category: b.loyaltyProgram?.category ?? "",
        balance: b.balance,
      }));
      travelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        originAirports:
          t.useLeaderCities || !t.originAirports
            ? tripOrigins
            : (t.originAirports as string[]),
        destinationAirports:
          t.useLeaderCities || !t.destinationAirports
            ? tripDests
            : (t.destinationAirports as string[]),
        departureDate: t.departureDate
          ? t.departureDate.toISOString().split("T")[0]
          : undefined,
        returnDate: t.returnDate
          ? t.returnDate.toISOString().split("T")[0]
          : undefined,
        cabinPreference: t.cabinPreference ?? undefined,
        loyaltyBalances: tBalances,
      });
    }

    const prefs = trip.client?.preferences;
    const flightPrefs: FlightPreferences | undefined = prefs
      ? {
          prefersNonstop: prefs.prefersNonstop ?? undefined,
          maxLayoverMinutes: prefs.maxLayoverMinutes ?? undefined,
          avoidBasicEconomy: prefs.avoidBasicEconomy ?? undefined,
          preferredAirlines: (prefs.preferredAirlines as string[]) ?? undefined,
          avoidedAirlines: (prefs.avoidedAirlines as string[]) ?? undefined,
          willingToReposition: prefs.willingToReposition ?? undefined,
          redemptionStyle: prefs.redemptionStyle ?? undefined,
          budgetSensitivity: prefs.budgetSensitivity ?? undefined,
          preferredDepartureAirports:
            (prefs.preferredDepartureAirports as string[]) ?? undefined,
          loyaltyNotes: prefs.loyaltyNotes ?? undefined,
          budgetNotes: prefs.budgetNotes ?? undefined,
          travelPace: prefs.travelPace ?? undefined,
          dateFlexibility: prefs.dateFlexibility ?? undefined,
        }
      : undefined;

    const routeDesc = multiCityLegs
      ? multiCityLegs.map((l) => `${l.from.join("/")}→${l.to.join("/")}@${l.date}`).join(" | ")
      : `${tripOrigins.join(",")} → ${tripDests.join(",")} on ${departureDate}${returnDate ? ` – ${returnDate}` : ""}`;
    console.log(`[FlightSearch] Trip ${id}: ${routeDesc}, cabin=${trip.cabinPreference ?? "economy"}, travelers=${travelerInputs.length}, multiCity=${!!multiCityLegs}, SERPAPI_KEY=${process.env.SERPAPI_KEY ? `set(${process.env.SERPAPI_KEY.length}chars)` : "MISSING"}`);

    const travelerFlights = await searchFlightsForTravelers(
      travelerInputs,
      departureDate,
      returnDate,
      trip.cabinPreference ?? "economy",
      flightPrefs,
      multiCityLegs,
    );

    const totalCash = travelerFlights.reduce((sum, g) => sum + g.segments.reduce((s2, seg) => s2 + seg.cashOptions.length, 0), 0);
    const totalAward = travelerFlights.reduce((sum, g) => sum + g.segments.reduce((s2, seg) => s2 + seg.awardOptions.length, 0), 0);
    console.log(`[FlightSearch] Trip ${id}: Done. ${travelerFlights.length} traveler groups, ${totalCash} cash options, ${totalAward} award options`);

    // Persist results into the latest completed itinerary job (create one if none exists)
    const latestJob = await prisma.itineraryJob.findFirst({
      where: { tripRequestId: id, status: "complete" },
      orderBy: { completedAt: "desc" },
    });
    if (latestJob) {
      const existing = (latestJob.result as Record<string, unknown>) ?? {};
      await prisma.itineraryJob.update({
        where: { id: latestJob.id },
        data: {
          result: {
            ...existing,
            travelerFlights,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await prisma.itineraryJob.create({
        data: {
          tripRequestId: id,
          status: "complete",
          completedAt: new Date(),
          result: {
            summary: "",
            flights: [],
            hotels: [],
            budgetBreakdown: {
              totalEstimatedCash: 0,
              totalPointsUsed: [],
              flightsCash: 0,
              flightsPoints: "",
              hotelsCash: 0,
              hotelsPoints: "",
              savings: "",
            },
            pointsStrategy: "",
            tips: [],
            travelerFlights,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return json({ travelerFlights });
  } catch (error) {
    console.error("Flight search error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to search flights",
      500,
    );
  }
}
