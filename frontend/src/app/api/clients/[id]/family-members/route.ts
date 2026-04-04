import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const members = await prisma.familyMember.findMany({
      where: { clientId },
      orderBy: { createdAt: "asc" },
    });

    return json(members);
  } catch (error) {
    console.error("List family members error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);
    if (client.clientType !== "individual") {
      return errorResponse("Family members can only be added to individual clients", 400);
    }

    const body = await request.json();
    const { name, relationship, email, phone, dateOfBirth, notes } = body;

    if (!name || !relationship) {
      return errorResponse("Name and relationship are required", 400);
    }

    const member = await prisma.familyMember.create({
      data: {
        clientId,
        name,
        relationship,
        email: email || null,
        phone: phone || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        notes: notes || null,
      },
    });

    return json(member, 201);
  } catch (error) {
    console.error("Create family member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
