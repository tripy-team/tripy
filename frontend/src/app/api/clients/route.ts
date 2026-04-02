import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const clients = await prisma.client.findMany({
      where: { organizationId: user.organizationId, status: "active" },
      include: {
        _count: { select: { loyaltyBalances: true } },
        householdMembers: { include: { household: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(clients);
  } catch (error) {
    console.error("List clients error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { firstName, lastName, email, phone, dateOfBirth, notes } = body;

    if (!firstName || !lastName) {
      return errorResponse("First name and last name are required", 400);
    }

    const client = await prisma.client.create({
      data: {
        organizationId: user.organizationId,
        ownerUserId: user.id,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        notes: notes || null,
      },
    });

    return json(client, 201);
  } catch (error) {
    console.error("Create client error:", error);
    return errorResponse("Internal server error", 500);
  }
}
