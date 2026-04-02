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

    const household = await prisma.household.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        members: {
          include: {
            client: {
              include: {
                loyaltyBalances: { include: { loyaltyProgram: true } },
              },
            },
          },
        },
        tripRequests: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!household) return errorResponse("Household not found", 404);
    return json(household);
  } catch (error) {
    console.error("Get household error:", error);
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

    const existing = await prisma.household.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return errorResponse("Household not found", 404);

    const body = await request.json();
    const { name, notes } = body;

    const household = await prisma.household.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(notes !== undefined && { notes }),
      },
    });

    return json(household);
  } catch (error) {
    console.error("Update household error:", error);
    return errorResponse("Internal server error", 500);
  }
}
