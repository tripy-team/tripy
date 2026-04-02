import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden", 403);

    const { id } = await params;

    const existing = await prisma.transferBonus.findUnique({ where: { id } });
    if (!existing) return errorResponse("Transfer bonus not found", 404);

    const body = await request.json();
    const { bonusPercent, startsAt, endsAt, sourceUrl, sourceLabel, isActive } =
      body;

    const bonus = await prisma.transferBonus.update({
      where: { id },
      data: {
        ...(bonusPercent !== undefined && { bonusPercent }),
        ...(startsAt !== undefined && { startsAt: new Date(startsAt) }),
        ...(endsAt !== undefined && { endsAt: new Date(endsAt) }),
        ...(sourceUrl !== undefined && { sourceUrl }),
        ...(sourceLabel !== undefined && { sourceLabel }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        fromProgram: true,
        toProgram: true,
      },
    });

    return json(bonus);
  } catch (error) {
    console.error("Update transfer bonus error:", error);
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
    if (user.role !== "admin") return errorResponse("Forbidden", 403);

    const { id } = await params;

    const existing = await prisma.transferBonus.findUnique({ where: { id } });
    if (!existing) return errorResponse("Transfer bonus not found", 404);

    const bonus = await prisma.transferBonus.update({
      where: { id },
      data: { isActive: false },
    });

    return json(bonus);
  } catch (error) {
    console.error("Deactivate transfer bonus error:", error);
    return errorResponse("Internal server error", 500);
  }
}
