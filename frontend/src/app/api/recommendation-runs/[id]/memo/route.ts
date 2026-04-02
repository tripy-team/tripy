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

    const memo = await prisma.recommendationMemo.findUnique({
      where: { recommendationRunId: id },
    });

    if (!memo) return errorResponse("Memo not found", 404);

    return json(memo);
  } catch (error) {
    console.error("Get memo error:", error);
    return errorResponse("Internal server error", 500);
  }
}
