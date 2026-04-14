import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id, memberId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.groupProfile.findUnique({ where: { clientId: id } });
    if (!profile) return errorResponse("Group profile not found", 404);

    const member = await prisma.groupMember.findFirst({
      where: { id: memberId, groupProfileId: profile.id },
    });
    if (!member) return errorResponse("Member not found", 404);

    const body = await request.json();
    const { name, email, departureCity, isOrganizer, notes } = body;

    const updated = await prisma.groupMember.update({
      where: { id: memberId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(departureCity !== undefined && { departureCity }),
        ...(isOrganizer !== undefined && { isOrganizer }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return json(updated);
  } catch (error) {
    console.error("Update group member error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id, memberId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.groupProfile.findUnique({ where: { clientId: id } });
    if (!profile) return errorResponse("Group profile not found", 404);

    const member = await prisma.groupMember.findFirst({
      where: { id: memberId, groupProfileId: profile.id },
    });
    if (!member) return errorResponse("Member not found", 404);

    await prisma.groupMember.delete({ where: { id: memberId } });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Delete group member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
