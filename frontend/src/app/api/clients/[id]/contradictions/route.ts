import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId } = await params;
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const contradictions = await prisma.profileContradiction.findMany({
      where: {
        clientId,
        ...(statusFilter && statusFilter !== "all"
          ? { status: statusFilter as "unresolved" | "resolved" | "dismissed" }
          : {}),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        session: { select: { id: true, title: true, createdAt: true } },
      },
    });

    return json(contradictions);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[Contradictions] GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}
