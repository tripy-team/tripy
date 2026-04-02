import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(
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
        tripRequest: true,
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
        memo: true,
      },
    });

    if (!run) return errorResponse("Recommendation run not found", 404);

    const trip = await prisma.tripRequest.findFirst({
      where: { id: run.tripRequestId, organizationId: user.organizationId },
    });
    if (!trip) return errorResponse("Unauthorized", 403);

    return json(run);
  } catch (error) {
    console.error("Get recommendation run error:", error);
    return errorResponse("Internal server error", 500);
  }
}
