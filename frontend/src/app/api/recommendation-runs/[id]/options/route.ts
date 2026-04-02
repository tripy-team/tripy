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
      include: { tripRequest: true },
    });
    if (!run) return errorResponse("Recommendation run not found", 404);

    const trip = await prisma.tripRequest.findFirst({
      where: { id: run.tripRequestId, organizationId: user.organizationId },
    });
    if (!trip) return errorResponse("Unauthorized", 403);

    const options = await prisma.recommendationOption.findMany({
      where: { recommendationRunId: id },
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
    });

    return json(options);
  } catch (error) {
    console.error("List recommendation options error:", error);
    return errorResponse("Internal server error", 500);
  }
}
