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

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const versions = await prisma.tripBrief.findMany({
      where: { tripRequestId: id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        isEdited: true,
        createdAt: true,
        generatedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return json(versions);
  } catch (error) {
    console.error("List brief versions error:", error);
    return errorResponse("Internal server error", 500);
  }
}
