import { prisma } from "@/lib/prisma";
import type { DashboardData } from "@/lib/api-client";

/** Minimal shape of the authenticated user needed to build the dashboard. */
export interface DashboardUser {
  organizationId: string;
  firstName: string;
  lastName: string | null;
}

/**
 * Builds the dashboard payload directly from Postgres.
 *
 * Shared by the `/api/dashboard` route (client-side fetch) and the dashboard
 * Server Component (server render), so both return identical data and there's a
 * single place to evolve the queries.
 */
export async function getDashboardData(user: DashboardUser): Promise<DashboardData> {
  const orgId = user.organizationId;
  const now = new Date();
  const maxEndsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const [totalClients, activeBonuses, activeTripAnalyses, recentAlerts] = await Promise.all([
    prisma.client.count({
      where: { organizationId: orgId, status: "active" },
    }),

    prisma.transferBonus.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now, lte: maxEndsAt },
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
        where: { alertSubscriptionId: { in: subIds.map((s) => s.id) } },
        include: { alertSubscription: true },
        orderBy: { triggeredAt: "desc" },
        take: 10,
      });
    })(),
  ]);

  const transferBonuses = activeBonuses.map((b) => ({
    id: b.id,
    fromProgram: b.fromProgram.name,
    fromProgramCode: b.fromProgram.code,
    toProgram: b.toProgram.name,
    toProgramCode: b.toProgram.code,
    bonusPercent: b.bonusPercent,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    sourceUrl: b.sourceUrl ?? undefined,
    sourceLabel: b.sourceLabel ?? undefined,
  }));

  return {
    advisorName: user.lastName ? `${user.firstName} ${user.lastName[0]}.` : user.firstName,
    totalClients,
    transferBonuses,
    transferBonusCount: transferBonuses.length,
    // Cast through unknown: these come straight from Prisma and match the wire
    // shape the route already returned; the API types use string dates.
    activeTripAnalyses: activeTripAnalyses as unknown as DashboardData["activeTripAnalyses"],
    recentAlerts: recentAlerts as unknown as DashboardData["recentAlerts"],
  };
}
