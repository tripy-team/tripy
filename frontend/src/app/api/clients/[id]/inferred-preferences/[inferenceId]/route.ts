import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { applyInferenceToProfile } from "@/lib/preference-inference";
import type { InferenceStatus } from "@/generated/prisma/client";

/**
 * PATCH /api/clients/:id/inferred-preferences/:inferenceId
 *
 * Accept or reject an inferred preference.
 * Body: { status: "accepted" | "rejected" }
 *
 * When accepted, the inference can optionally be applied to the client's
 * preference profile. This is explicit and auditable.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; inferenceId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, inferenceId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const inference = await prisma.inferredPreference.findFirst({
      where: { id: inferenceId, clientId: id },
    });
    if (!inference) return errorResponse("Inference not found", 404);

    const body = await request.json();
    const { status } = body as { status: InferenceStatus };

    if (status !== "accepted" && status !== "rejected") {
      return errorResponse('Status must be "accepted" or "rejected"', 400);
    }

    const updated = await prisma.inferredPreference.update({
      where: { id: inferenceId },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedByUserId: user.id,
      },
    });

    if (status === "accepted") {
      await applyInferenceToProfile(inferenceId);
    }

    return json(updated);
  } catch (error) {
    console.error("Update inference error:", error);
    return errorResponse("Internal server error", 500);
  }
}
