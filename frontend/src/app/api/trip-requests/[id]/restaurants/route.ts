import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  searchRestaurantsForTrip,
  type RestaurantSearchInput,
  type RestaurantRecommendation,
} from "@/lib/restaurant-search";

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
            preferences: true,
          },
        },
      },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const prefs = trip.client?.preferences;
    const destinations = trip.destinationAirports as string[];
    const destination = destinations.join(", ");

    const latestJob = await prisma.itineraryJob.findFirst({
      where: { tripRequestId: id, status: "complete" },
      orderBy: { completedAt: "desc" },
    });

    let dailyItinerary: RestaurantSearchInput["dailyItinerary"];
    if (latestJob?.result) {
      const result = latestJob.result as Record<string, unknown>;
      const daily = result.dailyItinerary as
        | { day: number; date: string; location: string; theme: string }[]
        | undefined;
      if (daily?.length) {
        dailyItinerary = daily.map((d) => ({
          day: d.day,
          date: d.date,
          location: d.location,
          theme: d.theme,
        }));
      }
    }

    const input: RestaurantSearchInput = {
      destination,
      departureDate: trip.departureDate.toISOString().split("T")[0],
      returnDate: trip.returnDate
        ? trip.returnDate.toISOString().split("T")[0]
        : undefined,
      travelerCount: trip.travelerCount,
      clientName: trip.client
        ? `${trip.client.firstName} ${trip.client.lastName}`
        : undefined,
      preferences: prefs
        ? {
            foodPreferences:
              (prefs.foodPreferences as string[]) ?? undefined,
            activityPreferences:
              (prefs.activityPreferences as string[]) ?? undefined,
            budgetSensitivity: prefs.budgetSensitivity ?? undefined,
            dislikes: (prefs.dislikes as string[]) ?? undefined,
            dealbreakers: (prefs.dealbreakers as string[]) ?? undefined,
            familyConsiderations: prefs.familyConsiderations ?? undefined,
            specialOccasions:
              (prefs.specialOccasions as string[]) ?? undefined,
            notes: prefs.notes ?? undefined,
          }
        : undefined,
      dailyItinerary,
    };

    const restaurants: RestaurantRecommendation[] =
      await searchRestaurantsForTrip(input);

    return json({ restaurants });
  } catch (error) {
    console.error("Restaurant search error:", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to search restaurants",
      500,
    );
  }
}
