import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  searchHotelsForTravelers,
  deriveStayWindows,
  buildMultiCityStayWindows,
  type TravelerHotelSearchInput,
  type StayWindow,
} from "@/lib/hotel-search";
import type { MultiCityLeg } from "@/lib/flight-search";
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

    const stayWindows: StayWindow[] = multiCityLegs && multiCityLegs.length >= 2
      ? buildMultiCityStayWindows(multiCityLegs)
      : deriveStayWindows(tripDests, departureDate, returnDate);

    if (stayWindows.length === 0) {
      return errorResponse(
        "No valid hotel stay windows could be derived from this trip",
        400,
      );
    }

    const hotelProgramsFromBalances = (
      balances: { loyaltyProgram?: { code?: string | null; category?: string | null } | null }[],
    ) =>
      balances
        .filter((b) => (b.loyaltyProgram?.category ?? "").toLowerCase() === "hotel")
        .map((b) => b.loyaltyProgram?.code ?? "")
        .filter(Boolean);

    const travelerInputs: TravelerHotelSearchInput[] = [];
    if (trip.client) {
      travelerInputs.push({
        travelerId: "leader",
        travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
        clientId: trip.client.id,
        stayWindows,
        hotelPrograms: hotelProgramsFromBalances(trip.client.loyaltyBalances ?? []),
      });
    }
    for (const t of trip.travelers ?? []) {
      if (!t.client) continue;
      travelerInputs.push({
        travelerId: t.id,
        travelerName: `${t.client.firstName} ${t.client.lastName}`,
        clientId: t.client.id,
        stayWindows,
        hotelPrograms: hotelProgramsFromBalances(t.client.loyaltyBalances ?? []),
      });
    }

    const windowDesc = stayWindows
      .map((w) => `${w.destination}:${w.checkIn}→${w.checkOut}(${w.nights}n)`)
      .join(" | ");
    console.log(
      `[HotelSearch] Trip ${id}: ${windowDesc}, travelers=${travelerInputs.length}, multiCity=${!!multiCityLegs}, SERPAPI_KEY=${process.env.SERPAPI_KEY ? `set(${process.env.SERPAPI_KEY.length}chars)` : "MISSING"}`,
    );

    const travelerHotels = await searchHotelsForTravelers(travelerInputs);

    const totalCash = travelerHotels.reduce(
      (sum, g) => sum + g.stays.reduce((s2, s) => s2 + s.cashOptions.length, 0),
      0,
    );
    const totalAward = travelerHotels.reduce(
      (sum, g) => sum + g.stays.reduce((s2, s) => s2 + s.awardOptions.length, 0),
      0,
    );
    console.log(
      `[HotelSearch] Trip ${id}: Done. ${travelerHotels.length} traveler groups, ${totalCash} cash options, ${totalAward} award options`,
    );

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
            travelerHotels,
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
            travelerHotels,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return json({ travelerHotels });
  } catch (error) {
    console.error("Hotel search error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to search hotels",
      500,
    );
  }
}

