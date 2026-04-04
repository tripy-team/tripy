import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { runAndPersistInferences } from "@/lib/preference-inference";

/**
 * GET /api/clients/:id/inferred-preferences
 *
 * Returns all inferred preferences for a client, ordered by confidence.
 * If ?refresh=true, re-runs inference before returning.
 */
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

    const url = new URL(request.url);
    if (url.searchParams.get("refresh") === "true") {
      await runAndPersistInferences(id);
    }

    const inferences = await prisma.inferredPreference.findMany({
      where: { clientId: id },
      orderBy: [{ status: "asc" }, { confidence: "desc" }],
      include: {
        resolvedBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    return json(inferences);
  } catch (error) {
    console.error("List inferred preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}

/**
 * POST /api/clients/:id/inferred-preferences
 *
 * Triggers inference generation for a client.
 */
export async function POST(
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

    const count = await runAndPersistInferences(id);

    const inferences = await prisma.inferredPreference.findMany({
      where: { clientId: id },
      orderBy: [{ status: "asc" }, { confidence: "desc" }],
    });

    return json({ generated: count, inferences }, 201);
  } catch (error) {
    console.error("Generate inferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}
