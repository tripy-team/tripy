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

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);

    const profile = await prisma.businessProfile.findUnique({ where: { clientId: id } });
    if (!profile) return json([]);

    const travelers = await prisma.businessTraveler.findMany({
      where: { businessProfileId: profile.id },
      include: { linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    return json(travelers);
  } catch (error) {
    console.error("List business travelers error:", error);
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

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);
    if (client.clientType !== "business") return errorResponse("Client is not a business type", 400);

    let profile = await prisma.businessProfile.findUnique({ where: { clientId: id } });
    if (!profile) {
      profile = await prisma.businessProfile.create({
        data: { clientId: id, companyName: `${client.firstName} ${client.lastName}`.trim() },
      });
    }

    const body = await request.json();
    const { linkedClientId, name, email, role, seniorityTier, notes } = body;
    if (!name && !linkedClientId) return errorResponse("Either name or linkedClientId is required", 400);

    if (linkedClientId) {
      const linked = await prisma.client.findFirst({ where: { id: linkedClientId, organizationId: user.organizationId } });
      if (!linked) return errorResponse("Linked client not found", 404);
    }

    const traveler = await prisma.businessTraveler.create({
      data: {
        businessProfileId: profile.id,
        linkedClientId: linkedClientId || null,
        name: name || "",
        email: email || null,
        role: role || null,
        seniorityTier: seniorityTier || null,
        notes: notes || null,
      },
      include: { linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    return json(traveler, 201);
  } catch (error) {
    console.error("Add business traveler error:", error);
    return errorResponse("Internal server error", 500);
  }
}
