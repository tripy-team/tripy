import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { generateRecommendationMemo } from "@/lib/openai";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const run = await prisma.recommendationRun.findUnique({
      where: { id },
      include: {
        tripRequest: {
          include: {
            travelers: { include: { client: true } },
            client: { include: { preferences: true } },
          },
        },
        options: {
          include: {
            travelerAllocations: {
              include: {
                tripTraveler: { include: { client: true } },
                loyaltyProgram: true,
              },
            },
            insights: true,
          },
          orderBy: { rank: "asc" },
        },
      },
    });

    if (!run) return errorResponse("Recommendation run not found", 404);

    const trip = await prisma.tripRequest.findFirst({
      where: {
        id: run.tripRequestId,
        organizationId: user.organizationId,
      },
    });
    if (!trip) return errorResponse("Unauthorized", 403);

    if (run.options.length === 0) {
      return errorResponse("No options available to generate memo", 400);
    }

    const topOption = run.options.find((o) => o.isRecommended) || run.options[0];
    const alternativeOptions = run.options.filter((o) => o.id !== topOption.id);

    const memoInput = {
      tripTitle: run.tripRequest.title,
      origin: run.tripRequest.originAirports as string[],
      destination: run.tripRequest.destinationAirports as string[],
      departureDate: run.tripRequest.departureDate.toISOString().split("T")[0],
      returnDate: run.tripRequest.returnDate
        ? run.tripRequest.returnDate.toISOString().split("T")[0]
        : undefined,
      travelers: run.tripRequest.travelers.map((t) => ({
        name: `${t.client.firstName} ${t.client.lastName}`,
        type: t.travelerType,
      })),
      topOption: {
        title: topOption.title,
        strategyType: topOption.strategyType,
        totalCashCost: topOption.totalCashCost,
        summary: topOption.summary,
        allocations: topOption.travelerAllocations.map((a) => ({
          travelerName: `${a.tripTraveler.client.firstName} ${a.tripTraveler.client.lastName}`,
          paymentType: a.paymentType,
          programName: a.loyaltyProgram?.name,
          pointsUsed: a.pointsUsed ?? undefined,
          cashUsed: a.cashUsed ?? undefined,
        })),
        insights: topOption.insights.map((i) => ({
          title: i.title,
          body: i.body,
          severity: i.severity,
        })),
      },
      alternativeOptions: alternativeOptions.map((o) => ({
        title: o.title,
        strategyType: o.strategyType,
        totalCashCost: o.totalCashCost,
        summary: o.summary,
      })),
      clientPreferences: run.tripRequest.client?.preferences
        ? {
            preferredCabin: run.tripRequest.client.preferences.preferredCabin,
            redemptionStyle: run.tripRequest.client.preferences.redemptionStyle,
          }
        : undefined,
    };

    const result = await generateRecommendationMemo(memoInput);

    const memo = await prisma.recommendationMemo.upsert({
      where: { recommendationRunId: id },
      create: {
        recommendationRunId: id,
        internalSummary: result.internalSummary,
        clientSummary: result.clientSummary,
        emailDraft: result.emailDraft,
      },
      update: {
        internalSummary: result.internalSummary,
        clientSummary: result.clientSummary,
        emailDraft: result.emailDraft,
      },
    });

    return json(memo, 201);
  } catch (error) {
    console.error("Generate memo error:", error);
    return errorResponse("Internal server error", 500);
  }
}
