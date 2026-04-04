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

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const preference = await prisma.clientPreference.findUnique({
      where: { clientId: id },
    });
    if (!preference) return json([]);

    const logs = await prisma.preferenceChangeLog.findMany({
      where: { preferenceId: preference.id },
      include: {
        changedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return json(logs);
  } catch (error) {
    console.error("Get preference history error:", error);
    return errorResponse("Internal server error", 500);
  }
}
