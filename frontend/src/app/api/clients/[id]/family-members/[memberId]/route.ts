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

    const { count } = await prisma.familyMember.deleteMany({
      where: { id: memberId, clientId },
    });

    if (count === 0) return errorResponse("Group member not found", 404);

    return json({ success: true });
  } catch (error) {
    console.error("Delete group member error:", error);
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
    if (!existing) return errorResponse("Group member not found", 404);

    const body = await request.json();
    const { firstName, lastName, relationship, email, phone, dateOfBirth, notes } = body;

    const nameUpdate =
      firstName !== undefined || lastName !== undefined
        ? { name: `${firstName ?? existing.name.split(" ")[0]} ${lastName ?? existing.name.split(" ").slice(1).join(" ")}`.trim() }
        : {};

    const updated = await prisma.familyMember.update({
      where: { id: memberId },
      data: {
        ...nameUpdate,
        ...(relationship !== undefined && { relationship }),
        ...(email !== undefined && { email: email || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    });

    if (existing.linkedClientId) {
      const clientUpdate: Record<string, unknown> = {};
      if (firstName !== undefined) clientUpdate.firstName = firstName;
      if (lastName !== undefined) clientUpdate.lastName = lastName;
      if (email !== undefined) clientUpdate.email = email || null;
      if (phone !== undefined) clientUpdate.phone = phone || null;
      if (dateOfBirth !== undefined)
        clientUpdate.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;

      if (Object.keys(clientUpdate).length > 0) {
        await prisma.client.update({
          where: { id: existing.linkedClientId },
          data: clientUpdate,
        });

        // Also sync to any other FamilyMember rows referencing this linked client
        const familySync: Record<string, unknown> = {};
        if (firstName !== undefined || lastName !== undefined) {
          familySync.name = updated.name;
        }
        if (email !== undefined) familySync.email = email || null;
        if (phone !== undefined) familySync.phone = phone || null;
        if (dateOfBirth !== undefined)
          familySync.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;

        await prisma.familyMember.updateMany({
          where: {
            linkedClientId: existing.linkedClientId,
            id: { not: memberId },
          },
          data: familySync,
        });
      }
    }

    return json(updated);
  } catch (error) {
    console.error("Update group member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
