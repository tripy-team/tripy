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
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) return errorResponse("Missing jobId", 400);

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const job = await prisma.itineraryJob.findFirst({
      where: { id: jobId, tripRequestId: id },
    });
    if (!job) return errorResponse("Job not found", 404);

    if (job.status === "complete") {
      return json({ status: "complete", result: job.result });
    }

    if (job.status === "failed") {
      return json({ status: "failed", error: job.error });
    }

    return json({ status: "processing" });
  } catch (error) {
    console.error("Itinerary status error:", error);
    return errorResponse("Failed to check status", 500);
  }
}
