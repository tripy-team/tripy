import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    const vendorRequest = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        tripRequest: { select: { id: true, title: true, departureDate: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        reminders: { orderBy: { remindAt: "asc" } },
        drafts: { orderBy: { createdAt: "desc" } },
        approvals: { orderBy: { createdAt: "desc" } },
        timeline: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    if (!vendorRequest) return errorResponse("Vendor request not found", 404);
    return json(vendorRequest);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor request GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Vendor request not found", 404);

    const allowedFields = [
      "vendorName",
      "vendorContact",
      "requestDetails",
      "urgency",
      "dueDate",
      "internalNotes",
      "followUpCount",
      "finalOutcome",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        data[field] = field === "dueDate" && body[field]
          ? new Date(body[field])
          : body[field];
      }
    }

    const updated = await prisma.vendorRequest.update({
      where: { id },
      data,
      include: {
        tripRequest: { select: { id: true, title: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (Object.keys(data).length > 0) {
      await prisma.vendorRequestTimeline.create({
        data: {
          vendorRequestId: id,
          eventType: "updated",
          description: `Fields updated: ${Object.keys(data).join(", ")}`,
          metadata: JSON.parse(JSON.stringify({ userId: user.id, changes: data })),
        },
      });
    }

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor request PATCH error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    const existing = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Vendor request not found", 404);

    await prisma.vendorRequest.delete({ where: { id } });
    return json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor request DELETE error:", error);
    return errorResponse("Internal server error", 500);
  }
}
