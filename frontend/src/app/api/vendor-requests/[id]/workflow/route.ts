import { requireAuth, json, errorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transitionWorkflow, canTransition } from "@/lib/vendor-operations";
import type { VendorRequestStatus } from "@/generated/prisma/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    const vr = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { status: true },
    });
    if (!vr) return errorResponse("Vendor request not found", 404);

    const ALL_STATUSES: VendorRequestStatus[] = [
      "draft",
      "needs_advisor_review",
      "needs_client_approval",
      "approved_to_send",
      "sent_to_vendor",
      "awaiting_vendor_response",
      "follow_up_needed",
      "confirmed",
      "declined",
      "complete",
      "cancelled",
    ];

    const availableTransitions = ALL_STATUSES.filter((s) =>
      canTransition(vr.status, s),
    );

    return json({
      currentStatus: vr.status,
      availableTransitions,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const { toStatus, notes } = body;
    if (!toStatus) return errorResponse("toStatus is required");

    const vr = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!vr) return errorResponse("Vendor request not found", 404);

    const updated = await transitionWorkflow(id, toStatus, user.id, notes);
    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof Error && error.message.includes("Invalid transition")) {
      return errorResponse(error.message, 422);
    }
    console.error("Workflow transition error:", error);
    return errorResponse("Internal server error", 500);
  }
}
