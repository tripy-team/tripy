import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; travelerId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id, travelerId } = await params;

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.businessProfile.findUnique({ where: { clientId: id } });
    if (!profile) return errorResponse("Business profile not found", 404);

    const traveler = await prisma.businessTraveler.findFirst({ where: { id: travelerId, businessProfileId: profile.id } });
    if (!traveler) return errorResponse("Traveler not found", 404);

    const body = await request.json();
    const { name, email, role, seniorityTier, notes } = body;

    const updated = await prisma.businessTraveler.update({
      where: { id: travelerId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(role !== undefined && { role }),
        ...(seniorityTier !== undefined && { seniorityTier }),
        ...(notes !== undefined && { notes }),
      },
      include: { linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    return json(updated);
  } catch (error) {
    console.error("Update business traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; travelerId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id, travelerId } = await params;

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.businessProfile.findUnique({ where: { clientId: id } });
    if (!profile) return errorResponse("Business profile not found", 404);

    const traveler = await prisma.businessTraveler.findFirst({ where: { id: travelerId, businessProfileId: profile.id } });
    if (!traveler) return errorResponse("Traveler not found", 404);

    await prisma.businessTraveler.delete({ where: { id: travelerId } });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Delete business traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}
