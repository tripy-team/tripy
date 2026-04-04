import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const template = await prisma.vendorRequestTemplate.findUnique({
      where: { id },
    });
    if (!template) return errorResponse("Template not found", 404);

    if (
      template.scope === "organization" &&
      template.organizationId !== user.organizationId
    ) {
      return errorResponse("Not authorized", 403);
    }
    if (template.scope === "system") {
      return errorResponse("System templates cannot be modified", 403);
    }

    const updated = await prisma.vendorRequestTemplate.update({
      where: { id },
      data: {
        title: body.title,
        defaultBody: body.defaultBody,
        placeholders: body.placeholders,
        defaultUrgency: body.defaultUrgency,
        defaultReminders: body.defaultReminders,
        isActive: body.isActive,
      },
    });

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
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

    const template = await prisma.vendorRequestTemplate.findUnique({
      where: { id },
    });
    if (!template) return errorResponse("Template not found", 404);

    if (template.scope === "system") {
      return errorResponse("System templates cannot be deleted", 403);
    }
    if (template.organizationId !== user.organizationId) {
      return errorResponse("Not authorized", 403);
    }

    await prisma.vendorRequestTemplate.delete({ where: { id } });
    return json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}
