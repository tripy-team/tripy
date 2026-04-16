import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { generateItinerary, TRANSFER_PARTNERS } from "@/lib/itinerary-ai";
import type { ItineraryInput } from "@/lib/itinerary-ai";
import {
  searchFlightsForTravelers,
  type TravelerSearchInput,
  type FlightPreferences,
} from "@/lib/flight-search";
import { deriveStayWindows } from "@/lib/hotel-search";
import type { TravelerHotelSearchInput } from "@/lib/hotel-search";
import { searchAndScoreHotelsForTravelers } from "@/lib/hotel-scoring";
import type { HotelScoringContext } from "@/lib/hotel-scoring";
import type { Prisma } from "@/generated/prisma/client";

export const maxDuration = 60;

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
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const job = await prisma.itineraryJob.findFirst({
      where: { tripRequestId: id, status: "complete" },
      orderBy: { completedAt: "desc" },
    });

    if (!job || !job.result) {
      return json({ exists: false, result: null });
    }

    const result = job.result as Record<string, unknown>;
    delete result._completedSections;
    delete result._pendingSections;

    return json({ exists: true, result });
  } catch (error) {
    console.error("Get saved itinerary error:", error);
    return errorResponse("Failed to fetch saved itinerary", 500);
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

    const tripCheck = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!tripCheck) return errorResponse("Trip request not found", 404);

    const job = await prisma.itineraryJob.create({
      data: {
        tripRequestId: id,
        status: "processing",
      },
    });

    after(async () => {
      try {
        const trip = await prisma.tripRequest.findFirst({
          where: { id },
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

        if (!trip) {
          await prisma.itineraryJob.update({
            where: { id: job.id },
            data: { status: "failed", error: "Trip request not found", completedAt: new Date() },
          });
          return;
        }

        const prefs = trip.client?.preferences;
        const clientBalances = trip.client?.loyaltyBalances || [];

        // Use trip-level point balance overrides if set, otherwise use client balances
        type TripPointBalance = { loyaltyProgramId: string; programName: string; balance: number };
        const tripPointBalances = (trip.pointBalances as TripPointBalance[] | null) ?? [];

        const balances = tripPointBalances.length > 0
          ? clientBalances.map((b) => {
              const override = tripPointBalances.find((tp) => tp.loyaltyProgramId === b.loyaltyProgramId);
              if (override) {
                return { ...b, balance: override.balance };
              }
              // If this program wasn't enabled for the trip, exclude it by setting balance to 0
              return { ...b, balance: 0 };
            })
          : clientBalances;

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

        // --- Flight search setup ---
        const clientLoyaltyBalances = balances.map((b) => ({
          programName: b.loyaltyProgram?.name ?? "Unknown",
          programCode: b.loyaltyProgram?.code ?? "",
          category: b.loyaltyProgram?.category ?? "",
          balance: b.balance,
        }));
        const travelerInputs: TravelerSearchInput[] = [];
        if (trip.client) {
          travelerInputs.push({
            travelerId: "leader",
            travelerName: `${trip.client.firstName} ${trip.client.lastName}`,
            clientId: trip.client.id,
            originAirports: tripOrigins,
            destinationAirports: tripDests,
            loyaltyBalances: clientLoyaltyBalances,
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
            originAirports: t.useLeaderCities || !t.originAirports ? tripOrigins : (t.originAirports as string[]),
            destinationAirports: t.useLeaderCities || !t.destinationAirports ? tripDests : (t.destinationAirports as string[]),
            departureDate: t.departureDate ? t.departureDate.toISOString().split("T")[0] : undefined,
            returnDate: t.returnDate ? t.returnDate.toISOString().split("T")[0] : undefined,
            cabinPreference: t.cabinPreference ?? undefined,
            loyaltyBalances: tBalances,
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

        // --- Run searches independently, saving partial results as each completes ---
        const completedSections: string[] = [];
        const pendingSections = ["itinerary", "flights", "hotels"];
        let saveLock: Promise<void> = Promise.resolve();

        const savePartial = (
          sectionName: string,
          patch: Record<string, unknown>,
        ) => {
          saveLock = saveLock.then(async () => {
            completedSections.push(sectionName);
            const remaining = pendingSections.filter((s) => !completedSections.includes(s));
            const currentJob = await prisma.itineraryJob.findUnique({ where: { id: job.id } });
            const existing = (currentJob?.result as Record<string, unknown>) ?? {};
            const merged = {
              ...existing,
              ...patch,
              _completedSections: [...completedSections],
              _pendingSections: remaining,
            };
            const isAllDone = remaining.length === 0;
            await prisma.itineraryJob.update({
              where: { id: job.id },
              data: {
                result: merged as unknown as Prisma.InputJsonValue,
                ...(isAllDone ? { status: "complete", completedAt: new Date() } : {}),
              },
            });
          });
          return saveLock;
        };

        const itineraryPromise = generateItinerary(input).then(async (itinerary) => {
          await savePartial("itinerary", {
            summary: itinerary.summary,
            flights: itinerary.flights,
            hotels: itinerary.hotels,
            budgetBreakdown: itinerary.budgetBreakdown,
            pointsStrategy: itinerary.pointsStrategy,
            tips: itinerary.tips,
          });
          return itinerary;
        });

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
            }
          : undefined;

        const flightsPromise = searchFlightsForTravelers(
          travelerInputs, departureDate, returnDate, trip.cabinPreference ?? "economy", flightPrefs,
        ).catch((err) => {
          console.error("Flight search failed (non-fatal):", err);
          return [] as Awaited<ReturnType<typeof searchFlightsForTravelers>>;
        }).then(async (travelerFlights) => {
          await savePartial("flights", { travelerFlights });
          return travelerFlights;
        });

        const hotelsPromise = searchAndScoreHotelsForTravelers(
          hotelTravelerInputs, hotelScoringContext,
        ).catch((err) => {
          console.error("Hotel search failed (non-fatal):", err);
          return [] as Awaited<ReturnType<typeof searchAndScoreHotelsForTravelers>>;
        }).then(async (travelerHotels) => {
          await savePartial("hotels", { travelerHotels });
          return travelerHotels;
        });

        await Promise.all([
          itineraryPromise,
          flightsPromise,
          hotelsPromise,
        ]);
      } catch (error) {
        console.error("Generate itinerary background error:", error);
        await prisma.itineraryJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
            completedAt: new Date(),
          },
        }).catch(() => {});
      }
    });

    return json({ status: "processing", jobId: job.id });
  } catch (error) {
    console.error("Generate itinerary error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to generate itinerary",
      500,
    );
  }
}
