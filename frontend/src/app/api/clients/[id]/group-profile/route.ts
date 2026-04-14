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

    const profile = await prisma.groupProfile.findUnique({
      where: { clientId: id },
      include: {
        members: {
          include: {
            linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return json(profile);
  } catch (error) {
    console.error("Get group profile error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PUT(
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

    const body = await request.json();
    const { groupType, estimatedSize, ageSpread, decisionStyle, roomArrangement, sharedBilling, notes } = body;

    const profile = await prisma.groupProfile.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        groupType: groupType || "leisure_friends",
        estimatedSize: estimatedSize ? Number(estimatedSize) : null,
        ageSpread: ageSpread || null,
        decisionStyle: decisionStyle || "consensus",
        roomArrangement: roomArrangement || null,
        sharedBilling: sharedBilling ?? false,
        notes: notes || null,
      },
      update: {
        ...(groupType !== undefined && { groupType }),
        ...(estimatedSize !== undefined && { estimatedSize: estimatedSize ? Number(estimatedSize) : null }),
        ...(ageSpread !== undefined && { ageSpread }),
        ...(decisionStyle !== undefined && { decisionStyle }),
        ...(roomArrangement !== undefined && { roomArrangement }),
        ...(sharedBilling !== undefined && { sharedBilling }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        members: {
          include: {
            linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    return json(profile);
  } catch (error) {
    console.error("Upsert group profile error:", error);
    return errorResponse("Internal server error", 500);
  }
}
