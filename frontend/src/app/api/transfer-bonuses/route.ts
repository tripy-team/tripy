import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const now = new Date();
    const maxEndsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const bonuses = await prisma.transferBonus.findMany({
      where: {
        isActive: true,
        endsAt: { gte: now, lte: maxEndsAt },
      },
      include: {
        fromProgram: true,
        toProgram: true,
      },
      orderBy: { endsAt: "asc" },
    });

    return json(bonuses);
  } catch (error) {
    console.error("List transfer bonuses error:", error);
    return errorResponse("Internal server error", 500);
  }
}
