import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runRecommendationEngine } from "@/lib/recommendation-engine";

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
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    await prisma.tripRequest.update({
      where: { id },
      data: { status: "analyzing" },
    });

    const runId = await runRecommendationEngine(id, user.id);

    return json({ runId }, 201);
  } catch (error) {
    console.error("Analyze trip error:", error);
    return errorResponse("Internal server error", 500);
  }
}
