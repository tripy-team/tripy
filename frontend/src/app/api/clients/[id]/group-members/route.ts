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
    });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.groupProfile.findUnique({ where: { clientId: id } });
    if (!profile) return json([]);

    const members = await prisma.groupMember.findMany({
      where: { groupProfileId: profile.id },
      include: {
        linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ isOrganizer: "desc" }, { createdAt: "asc" }],
    });

    return json(members);
  } catch (error) {
    console.error("List group members error:", error);
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
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);
    if (client.clientType !== "group") return errorResponse("Client is not a group type", 400);

    let profile = await prisma.groupProfile.findUnique({ where: { clientId: id } });
    if (!profile) {
      profile = await prisma.groupProfile.create({
        data: { clientId: id, groupType: "leisure_friends", decisionStyle: "consensus" },
      });
    }

    const body = await request.json();
    const { linkedClientId, name, email, departureCity, isOrganizer, notes } = body;

    if (!name && !linkedClientId) {
      return errorResponse("Either name or linkedClientId is required", 400);
    }

    // If linking an existing client, verify it belongs to this org
    if (linkedClientId) {
      const linked = await prisma.client.findFirst({
        where: { id: linkedClientId, organizationId: user.organizationId },
      });
      if (!linked) return errorResponse("Linked client not found", 404);
    }

    const member = await prisma.groupMember.create({
      data: {
        groupProfileId: profile.id,
        linkedClientId: linkedClientId || null,
        name: name || "",
        email: email || null,
        departureCity: departureCity || null,
        isOrganizer: isOrganizer ?? false,
        notes: notes || null,
      },
      include: {
        linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return json(member, 201);
  } catch (error) {
    console.error("Add group member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
