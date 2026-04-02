import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
    });

    return json(org);
  } catch (error) {
    console.error("Get organization error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden", 403);

    const body = await request.json();
    const { name, slug } = body;

    if (slug) {
      const existing = await prisma.organization.findUnique({ where: { slug } });
      if (existing && existing.id !== user.organizationId) {
        return errorResponse("Slug already in use", 409);
      }
    }

    const org = await prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
      },
    });

    return json(org);
  } catch (error) {
    console.error("Update organization error:", error);
    return errorResponse("Internal server error", 500);
  }
}
