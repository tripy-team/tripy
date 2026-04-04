import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, memberId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const member = await prisma.familyMember.findFirst({
      where: { id: memberId, clientId },
    });
    if (!member) return errorResponse("Family member not found", 404);

    await prisma.familyMember.delete({ where: { id: memberId } });

    return json({ success: true });
  } catch (error) {
    console.error("Delete family member error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, memberId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.familyMember.findFirst({
      where: { id: memberId, clientId },
    });
    if (!existing) return errorResponse("Family member not found", 404);

    const body = await request.json();
    const { name, relationship, email, phone, dateOfBirth, notes } = body;

    const updated = await prisma.familyMember.update({
      where: { id: memberId },
      data: {
        ...(name !== undefined && { name }),
        ...(relationship !== undefined && { relationship }),
        ...(email !== undefined && { email: email || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    });

    return json(updated);
  } catch (error) {
    console.error("Update family member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
