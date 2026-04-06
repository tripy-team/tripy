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

    const origin = new URL(request.url).origin;
    const processUrl = `${origin}/api/trip-requests/${id}/generate-itinerary/process`;

    fetch(processUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Fire-and-forget: the processing Lambda runs independently.
      // The abort only affects THIS side of the connection.
    });

    // Small wait to ensure the HTTP request is dispatched
    await new Promise((r) => setTimeout(r, 200));

    return json({ jobId: job.id, status: "processing" });
  } catch (error) {
    console.error("Generate itinerary kick-off error:", error);
    return errorResponse("Failed to start itinerary generation", 500);
  }
}
