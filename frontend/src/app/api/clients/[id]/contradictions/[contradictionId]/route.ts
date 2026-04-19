import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

const VALID_STATUSES = new Set(["unresolved", "resolved", "dismissed"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contradictionId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, contradictionId } = await params;
    const body = await request.json().catch(() => ({}));

    const { status, resolutionNote } = body as {
      status?: string;
      resolutionNote?: string | null;
    };

    if (status && !VALID_STATUSES.has(status)) {
      return errorResponse("Invalid status", 400);
    }

    const existing = await prisma.profileContradiction.findFirst({
      where: { id: contradictionId, clientId },
      include: { client: { select: { organizationId: true } } },
    });
    if (!existing) return errorResponse("Contradiction not found", 404);
    if (existing.client.organizationId !== user.organizationId) {
      return errorResponse("Contradiction not found", 404);
    }

    const isResolving = status && status !== "unresolved";

    const updated = await prisma.profileContradiction.update({
      where: { id: contradictionId },
      data: {
        ...(status ? { status: status as "unresolved" | "resolved" | "dismissed" } : {}),
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        ...(isResolving
          ? { resolvedAt: existing.resolvedAt ?? new Date() }
          : status === "unresolved"
            ? { resolvedAt: null }
            : {}),
      },
    });

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[Contradictions] PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}
