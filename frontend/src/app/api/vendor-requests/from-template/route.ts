import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { generateReminders, interpolateTemplate } from "@/lib/vendor-operations";

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const {
      templateId,
      tripRequestId,
      clientId,
      vendorName,
      vendorContact,
      dueDate,
      variables,
    } = body;

    if (!templateId || !tripRequestId || !vendorName) {
      return errorResponse("templateId, tripRequestId, and vendorName are required");
    }

    const template = await prisma.vendorRequestTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) return errorResponse("Template not found", 404);

    if (
      template.scope === "organization" &&
      template.organizationId !== user.organizationId
    ) {
      return errorResponse("Template not accessible", 403);
    }

    const trip = await prisma.tripRequest.findFirst({
      where: { id: tripRequestId, organizationId: user.organizationId },
      include: {
        client: { select: { firstName: true, lastName: true } },
      },
    });
    if (!trip) return errorResponse("Trip request not found", 404);

    const defaultVars: Record<string, string> = {
      vendorName,
      vendorContact: vendorContact || "",
      clientName: trip.client
        ? `${trip.client.firstName} ${trip.client.lastName}`
        : "",
      tripTitle: trip.title,
      dueDate: dueDate || "",
    };

    const mergedVars = { ...defaultVars, ...(variables || {}) };
    const requestDetails = interpolateTemplate(template.defaultBody, mergedVars);

    const vendorRequest = await prisma.vendorRequest.create({
      data: {
        organizationId: user.organizationId,
        tripRequestId,
        clientId: clientId || trip.clientId,
        createdByUserId: user.id,
        templateId: template.id,
        vendorName,
        vendorContact,
        requestType: template.requestType,
        requestDetails,
        urgency: template.defaultUrgency,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        tripRequest: { select: { id: true, title: true } },
        client: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await prisma.vendorRequestTimeline.create({
      data: {
        vendorRequestId: vendorRequest.id,
        eventType: "created_from_template",
        description: `Created from template: ${template.title}`,
        metadata: { templateId: template.id, userId: user.id },
      },
    });

    const reminderHours = Array.isArray(template.defaultReminders)
      ? (template.defaultReminders as number[])
      : undefined;
    await generateReminders(vendorRequest.id, reminderHours);

    return json(vendorRequest, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Create from template error:", error);
    return errorResponse("Internal server error", 500);
  }
}
