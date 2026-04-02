import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const orgId = user.organizationId;

    const [
      totalClients,
      totalHouseholds,
      expiringBalances,
      activeBonuses,
      activeTripAnalyses,
      recentAlerts,
    ] = await Promise.all([
      prisma.client.count({
        where: { organizationId: orgId, status: "active" },
      }),

      prisma.household.count({
        where: { organizationId: orgId },
      }),

      (async () => {
        const thirtyDays = new Date(Date.now() + 30 * 86400000);
        const clientIds = await prisma.client.findMany({
          where: { organizationId: orgId, status: "active" },
          select: { id: true },
        });
        const balances = await prisma.clientLoyaltyBalance.findMany({
          where: {
            clientId: { in: clientIds.map((c) => c.id) },
            expirationDate: { lte: thirtyDays, gte: new Date() },
          },
          include: {
            loyaltyProgram: true,
            client: { select: { firstName: true, lastName: true } },
          },
          orderBy: { expirationDate: "asc" },
        });
        return { count: balances.length, items: balances };
      })(),

      (async () => {
        const now = new Date();
        const bonuses = await prisma.transferBonus.findMany({
          where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
          include: { fromProgram: true, toProgram: true },
          orderBy: { endsAt: "asc" },
        });
        return { count: bonuses.length, items: bonuses };
      })(),

      (async () => {
        const trips = await prisma.tripRequest.findMany({
          where: {
            organizationId: orgId,
            status: { in: ["analyzing", "draft"] },
          },
        });
        return { count: trips.length };
      })(),

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

    return json({
      totalClients,
      totalHouseholds,
      expiringPointsSoon: expiringBalances,
      activeTransferBonuses: activeBonuses,
      activeTripAnalyses,
      recentAlerts,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return errorResponse("Internal server error", 500);
  }
}
