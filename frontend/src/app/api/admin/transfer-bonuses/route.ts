import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden", 403);

    const body = await request.json();
    const {
      fromProgramId,
      toProgramId,
      bonusPercent,
      startsAt,
      endsAt,
      sourceUrl,
      sourceLabel,
    } = body;

    if (!fromProgramId || !toProgramId || !bonusPercent || !startsAt || !endsAt) {
      return errorResponse(
        "fromProgramId, toProgramId, bonusPercent, startsAt, and endsAt are required",
        400,
      );
    }

    const bonus = await prisma.transferBonus.create({
      data: {
        fromProgramId,
        toProgramId,
        bonusPercent,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        sourceUrl: sourceUrl || null,
        sourceLabel: sourceLabel || "manual",
        // Admin-entered bonuses are authoritative and must never be overwritten
        // or deactivated by the scrapers.
        confidence: "manual",
      },
      include: {
        fromProgram: true,
        toProgram: true,
      },
    });

    return json(bonus, 201);
  } catch (error) {
    console.error("Create transfer bonus error:", error);
    return errorResponse("Internal server error", 500);
  }
}
