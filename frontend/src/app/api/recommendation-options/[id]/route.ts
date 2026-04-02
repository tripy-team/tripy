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

    const option = await prisma.recommendationOption.findUnique({
      where: { id },
      include: {
        travelerAllocations: {
          include: {
            tripTraveler: { include: { client: true } },
            loyaltyProgram: true,
          },
        },
        insights: true,
        recommendationRun: { include: { tripRequest: true } },
      },
    });

    if (!option) return errorResponse("Option not found", 404);

    const trip = await prisma.tripRequest.findFirst({
      where: {
        id: option.recommendationRun.tripRequestId,
        organizationId: user.organizationId,
      },
    });
    if (!trip) return errorResponse("Unauthorized", 403);

    return json(option);
  } catch (error) {
    console.error("Get recommendation option error:", error);
    return errorResponse("Internal server error", 500);
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

    const option = await prisma.recommendationOption.findUnique({
      where: { id },
      include: {
        recommendationRun: { include: { tripRequest: true } },
      },
    });

    if (!option) return errorResponse("Option not found", 404);

    const trip = await prisma.tripRequest.findFirst({
      where: {
        id: option.recommendationRun.tripRequestId,
        organizationId: user.organizationId,
      },
    });
    if (!trip) return errorResponse("Unauthorized", 403);

    await prisma.recommendationOption.updateMany({
      where: { recommendationRunId: option.recommendationRunId },
      data: { isRecommended: false },
    });

    const updated = await prisma.recommendationOption.update({
      where: { id },
      data: { isRecommended: true },
    });

    return json(updated);
  } catch (error) {
    console.error("Select recommendation option error:", error);
    return errorResponse("Internal server error", 500);
  }
}
