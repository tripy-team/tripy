import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

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
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const job = await prisma.itineraryJob.create({
      data: { tripRequestId: id },
    });

    return json({ jobId: job.id, status: "processing" });
  } catch (error) {
    console.error("Generate itinerary kick-off error:", error);
    return errorResponse("Failed to start itinerary generation", 500);
  }
}
