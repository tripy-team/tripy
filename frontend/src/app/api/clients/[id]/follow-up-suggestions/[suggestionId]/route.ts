import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const VALID_STATUSES = ["pending", "asked", "answered", "skipped"] as const;

// PATCH — update suggestion status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; suggestionId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, suggestionId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const suggestion = await prisma.followUpSuggestion.findFirst({
      where: { id: suggestionId, clientId },
    });
    if (!suggestion) return errorResponse("Suggestion not found", 404);

    const body = await request.json();
    const { status } = body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return errorResponse(
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
        400,
      );
    }

    const updated = await prisma.followUpSuggestion.update({
      where: { id: suggestionId },
      data: {
        status,
        statusChangedAt: status !== "pending" ? new Date() : null,
      },
    });

    return json(updated);
  } catch (error) {
    console.error("Update suggestion status error:", error);
    return errorResponse("Internal server error", 500);
  }
}
