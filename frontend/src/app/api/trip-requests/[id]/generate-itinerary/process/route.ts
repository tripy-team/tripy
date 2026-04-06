import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import { generateItinerary } from "@/lib/itinerary-ai";
import type { ItineraryInput } from "@/lib/itinerary-ai";
import {
  searchFlightsForTravelers,
  type TravelerSearchInput,
} from "@/lib/flight-search";
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
  const body = await request.json();
  const jobId: string | undefined = body.jobId;
  if (!jobId) return errorResponse("Missing jobId", 400);

  const { id } = await params;

  const job = await prisma.itineraryJob.findFirst({
    where: { id: jobId, tripRequestId: id, status: "processing" },
  });
  if (!job) return errorResponse("Job not found or already completed", 404);

  // Return 200 immediately — run heavy processing after the response is sent.
  // This prevents CloudFront's 30s gateway timeout from killing the request.
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
          where: { id: jobId },
          data: { status: "failed", error: "Trip request not found", completedAt: new Date() },
        });
        return;
      }

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

      const tripOrigins = trip.originAirports as string[];
      const tripDests = trip.destinationAirports as string[];
      const departureDate = trip.departureDate.toISOString().split("T")[0];
      const returnDate = trip.returnDate
        ? trip.returnDate.toISOString().split("T")[0]
        : undefined;

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

      const transportTravelerInputs: TransportSearchInput[] = travelerInputs.map((t) => ({
        travelerId: t.travelerId,
        travelerName: t.travelerName,
        clientId: t.clientId,
        originAirports: t.originAirports,
        destinationAirports: t.destinationAirports,
      }));

      const transportScoringContext: TransportScoringContext = {
        clientName: trip.client ? `${trip.client.firstName} ${trip.client.lastName}` : "Guest",
        tripTitle: trip.title,
        travelerCount: trip.travelerCount,
        budgetCash: trip.budgetCash ?? undefined,
        preferences: {
          budgetSensitivity: prefs?.budgetSensitivity ?? undefined,
        },
      };

      const [itinerary, travelerFlights, travelerTransport] = await Promise.all([
        generateItinerary(input),
        searchFlightsForTravelers(
          travelerInputs,
          departureDate,
          returnDate,
          trip.cabinPreference ?? "economy",
        ).catch((err) => {
          console.error("Flight search failed (non-fatal):", err);
          return [];
        }),
        searchAndScoreTransportForTravelers(
          transportTravelerInputs,
          departureDate,
          returnDate,
          transportScoringContext,
          trip.cabinPreference ?? "economy",
        ).catch((err) => {
          console.error("Transport search failed (non-fatal):", err);
          return [];
        }),
      ]);

      itinerary.travelerFlights = travelerFlights;
      itinerary.travelerTransport = travelerTransport;

      await prisma.itineraryJob.update({
        where: { id: jobId },
        data: {
          status: "complete",
          result: itinerary as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Generate itinerary processing error:", error);
      await prisma.itineraryJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date(),
        },
      }).catch(() => {});
    }
  });

  return json({ status: "accepted" });
}
