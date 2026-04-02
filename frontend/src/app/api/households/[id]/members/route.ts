import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const household = await prisma.household.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!household) return errorResponse("Household not found", 404);

    const body = await request.json();
    const { clientId, relationshipLabel, canRedeemForHousehold } = body;

    if (!clientId) return errorResponse("clientId is required", 400);

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const member = await prisma.householdMember.create({
      data: {
        householdId: id,
        clientId,
        relationshipLabel: relationshipLabel || null,
        canRedeemForHousehold: canRedeemForHousehold ?? false,
      },
      include: { client: true },
    });

    return json(member, 201);
  } catch (error) {
    console.error("Add household member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
