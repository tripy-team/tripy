import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const households = await prisma.household.findMany({
      where: { organizationId: user.organizationId },
      include: {
        members: { include: { client: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(households);
  } catch (error) {
    console.error("List households error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { name, notes } = body;

    if (!name) return errorResponse("Name is required", 400);

    const household = await prisma.household.create({
      data: {
        organizationId: user.organizationId,
        name,
        notes: notes || null,
      },
    });

    return json(household, 201);
  } catch (error) {
    console.error("Create household error:", error);
    return errorResponse("Internal server error", 500);
  }
}
