import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const orgId = user.organizationId;
    const now = new Date();

    const [
      totalClients,
      activeBonuses,
      activeTripAnalyses,
      recentAlerts,
    ] = await Promise.all([
      prisma.client.count({
        where: { organizationId: orgId, status: "active" },
      }),

      prisma.transferBonus.findMany({
        where: {
          isActive: true,
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
        include: { fromProgram: true, toProgram: true },
        orderBy: { endsAt: "asc" },
      }),

      prisma.tripRequest.findMany({
        where: {
          organizationId: orgId,
          status: { in: ["analyzing", "draft"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),

      (async () => {
        const subIds = await prisma.alertSubscription.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        });
        return prisma.alertEvent.findMany({
          where: {
            alertSubscriptionId: { in: subIds.map((s) => s.id) },
          },
          include: { alertSubscription: true },
          orderBy: { triggeredAt: "desc" },
          take: 10,
        });
      })(),
    ]);

    const transferBonusDetails = activeBonuses.map((b) => ({
      id: b.id,
      fromProgram: b.fromProgram.name,
      fromProgramCode: b.fromProgram.code,
      toProgram: b.toProgram.name,
      toProgramCode: b.toProgram.code,
      bonusPercent: b.bonusPercent,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      sourceUrl: b.sourceUrl,
      sourceLabel: b.sourceLabel,
    }));

    return json({
      advisorName: `${user.firstName} ${user.lastName}`,
      totalClients,
      transferBonuses: transferBonusDetails,
      transferBonusCount: transferBonusDetails.length,
      activeTripAnalyses,
      recentAlerts,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return errorResponse("Internal server error", 500);
  }
}
