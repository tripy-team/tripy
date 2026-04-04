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

    const existing = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Vendor request not found", 404);

    const vendorRequest = await prisma.vendorRequest.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    return json(vendorRequest);
  } catch (error) {
    console.error("Archive vendor request error:", error);
    return errorResponse("Internal server error", 500);
  }
}
