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
