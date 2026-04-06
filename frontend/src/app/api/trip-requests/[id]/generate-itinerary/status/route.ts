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
      const result = job.result as Record<string, unknown> | null;
      if (result) {
        delete result._completedSections;
        delete result._pendingSections;
      }
      return json({ status: "complete", result });
    }

    if (job.status === "failed") {
      return json({ status: "failed", error: job.error });
    }

    const ageMs = Date.now() - new Date(job.createdAt).getTime();
    if (ageMs > 120_000) {
      await prisma.itineraryJob.update({
        where: { id: jobId },
        data: { status: "failed", error: "Processing timed out on server", completedAt: new Date() },
      }).catch(() => {});
      return json({ status: "failed", error: "Processing timed out on server — please try again" });
    }

    const partial = job.result as Record<string, unknown> | null;
    return json({
      status: "processing",
      partialResult: partial ?? undefined,
      completedSections: (partial?._completedSections as string[]) ?? [],
      pendingSections: (partial?._pendingSections as string[]) ?? ["itinerary", "flights", "hotels", "transport", "restaurants"],
    });
  } catch (error) {
    console.error("Itinerary status error:", error);
    return errorResponse("Failed to check status", 500);
  }
}
