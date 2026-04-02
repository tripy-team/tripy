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
      },
    });

    if (!household) return errorResponse("Household not found", 404);

    const allBalances = household.members.flatMap(
      (m) => m.client.loyaltyBalances,
    );

    const totalBalancesByProgram: Record<
      string,
      { programId: string; programName: string; category: string; totalBalance: number; pointValueCents: number }
    > = {};

    let estimatedPortfolioValueCents = 0;

    for (const bal of allBalances) {
      const key = bal.loyaltyProgramId;
      if (!totalBalancesByProgram[key]) {
        totalBalancesByProgram[key] = {
          programId: bal.loyaltyProgramId,
          programName: bal.loyaltyProgram.name,
          category: bal.loyaltyProgram.category,
          totalBalance: 0,
          pointValueCents: bal.loyaltyProgram.defaultPointValueCents ?? 1,
        };
      }
      totalBalancesByProgram[key].totalBalance += bal.balance;

      const valueCents =
        bal.balance * (bal.loyaltyProgram.defaultPointValueCents ?? 1);
      estimatedPortfolioValueCents += valueCents;
    }

    const programSummaries = Object.values(totalBalancesByProgram);

    const concentrationByProgram = programSummaries.map((p) => ({
      programId: p.programId,
      programName: p.programName,
      valueCents: p.totalBalance * p.pointValueCents,
      percentage:
        estimatedPortfolioValueCents > 0
          ? Math.round(
              ((p.totalBalance * p.pointValueCents) /
                estimatedPortfolioValueCents) *
                10000,
            ) / 100
          : 0,
    }));

    const now = new Date();
    const days30 = new Date(now.getTime() + 30 * 86400000);
    const days60 = new Date(now.getTime() + 60 * 86400000);
    const days90 = new Date(now.getTime() + 90 * 86400000);

    const expiringBalances = {
      within30Days: allBalances.filter(
        (b) => b.expirationDate && b.expirationDate <= days30,
      ),
      within60Days: allBalances.filter(
        (b) =>
          b.expirationDate &&
          b.expirationDate > days30 &&
          b.expirationDate <= days60,
      ),
      within90Days: allBalances.filter(
        (b) =>
          b.expirationDate &&
          b.expirationDate > days60 &&
          b.expirationDate <= days90,
      ),
    };

    const bankProgramValue = programSummaries
      .filter((p) => p.category === "transferable_bank")
      .reduce((sum, p) => sum + p.totalBalance * p.pointValueCents, 0);

    const flexibleCurrencyPercent =
      estimatedPortfolioValueCents > 0
        ? Math.round(
            (bankProgramValue / estimatedPortfolioValueCents) * 10000,
          ) / 100
        : 0;

    return json({
      totalBalancesByProgram: programSummaries,
      estimatedPortfolioValueCents,
      concentrationByProgram,
      expiringBalances,
      flexibleCurrencyPercent,
    });
  } catch (error) {
    console.error("Portfolio summary error:", error);
    return errorResponse("Internal server error", 500);
  }
}
