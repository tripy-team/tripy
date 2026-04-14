import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        loyaltyBalances: { include: { loyaltyProgram: true } },
        preferences: true,
        householdMembers: { include: { household: true } },
        tripRequests: { orderBy: { createdAt: "desc" } },
        groupProfile: { include: { members: { include: { linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } } } } } },
        businessProfile: { include: { travelers: { include: { linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } } } } } },
      },
    });

    if (!client) return errorResponse("Client not found", 404);
    return json(client);
  } catch (error) {
    console.error("Get client error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const existing = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Client not found", 404);

    const body = await request.json();
    const { firstName, lastName, email, phone, dateOfBirth, notes } = body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(dateOfBirth !== undefined && {
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        }),
        ...(notes !== undefined && { notes }),
      },
    });

    const nameChanged = firstName !== undefined || lastName !== undefined;
    const contactChanged =
      email !== undefined ||
      phone !== undefined ||
      dateOfBirth !== undefined;

    if (nameChanged || contactChanged) {
      const familyMemberUpdate: Record<string, unknown> = {};
      if (nameChanged) {
        familyMemberUpdate.name =
          `${client.firstName} ${client.lastName}`.trim();
      }
      if (email !== undefined) familyMemberUpdate.email = client.email;
      if (phone !== undefined) familyMemberUpdate.phone = client.phone;
      if (dateOfBirth !== undefined)
        familyMemberUpdate.dateOfBirth = client.dateOfBirth;

      await prisma.familyMember.updateMany({
        where: { linkedClientId: id },
        data: familyMemberUpdate,
      });
    }

    return json(client);
  } catch (error) {
    console.error("Update client error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const existing = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Client not found", 404);

    const client = await prisma.client.update({
      where: { id },
      data: { status: "archived" },
    });

    return json(client);
  } catch (error) {
    console.error("Archive client error:", error);
    return errorResponse("Internal server error", 500);
  }
}
