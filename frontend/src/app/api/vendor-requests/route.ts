import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { generateReminders } from "@/lib/vendor-operations";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const tripRequestId = searchParams.get("tripRequestId");
    const status = searchParams.get("status");
    const vendorName = searchParams.get("vendorName");

    const where: Record<string, unknown> = {
      organizationId: user.organizationId,
    };
    if (tripRequestId) where.tripRequestId = tripRequestId;
    if (status) where.status = status;
    if (vendorName) where.vendorName = { contains: vendorName, mode: "insensitive" };

    const requests = await prisma.vendorRequest.findMany({
      where,
      include: {
        tripRequest: { select: { id: true, title: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
        reminders: { where: { status: "pending" }, orderBy: { remindAt: "asc" } },
        _count: { select: { drafts: true, approvals: true, reminders: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return json(requests);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor requests GET error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const {
      tripRequestId,
      clientId,
      vendorName,
      vendorContact,
      requestType,
      requestDetails,
      urgency,
      dueDate,
      internalNotes,
      templateId,
      customReminderHours,
    } = body;

    if (!tripRequestId || !vendorName || !requestType) {
      return errorResponse("tripRequestId, vendorName, and requestType are required");
    }

    const trip = await prisma.tripRequest.findFirst({
      where: { id: tripRequestId, organizationId: user.organizationId },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const vendorRequest = await prisma.vendorRequest.create({
      data: {
        organizationId: user.organizationId,
        tripRequestId,
        clientId: clientId || trip.clientId,
        createdByUserId: user.id,
        templateId,
        vendorName,
        vendorContact,
        requestType,
        requestDetails,
        urgency: urgency || "medium",
        dueDate: dueDate ? new Date(dueDate) : null,
        internalNotes,
      },
      include: {
        tripRequest: { select: { id: true, title: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await prisma.vendorRequestTimeline.create({
      data: {
        vendorRequestId: vendorRequest.id,
        eventType: "created",
        description: `Request created: ${requestType.replace(/_/g, " ")} for ${vendorName}`,
        metadata: { templateId, userId: user.id },
      },
    });

    await generateReminders(vendorRequest.id, customReminderHours);

    return json(vendorRequest, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor requests POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
