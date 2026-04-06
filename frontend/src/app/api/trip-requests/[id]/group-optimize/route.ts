import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { optimizeGroupTravel } from "@/lib/group-optimizer";
import { computeSettlement } from "@/lib/settlement";
import type {
  GroupTraveler,
  GroupSegment,
  TransferRule,
  ActiveBonus,
  PoolingRule,
  SplitMethod,
} from "@/lib/group-optimizer-types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const splitMethod: SplitMethod = body.splitMethod ?? "proportional_to_cost";
    const waivedTravelerIds: string[] = body.waivedTravelerIds ?? [];

    const trip = await prisma.tripRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        travelers: {
          include: {
            client: {
              include: {
                loyaltyBalances: { include: { loyaltyProgram: true } },
              },
            },
          },
        },
        client: {
          include: {
            loyaltyBalances: { include: { loyaltyProgram: true } },
          },
        },
        household: { include: { members: true } },
      },
    });

    if (!trip) return errorResponse("Trip request not found", 404);
    if (trip.travelers.length < 2) {
      return errorResponse("Group optimization requires at least 2 travelers", 400);
    }

    const transferRulesRaw = await prisma.programTransferRule.findMany({
      where: { isActive: true },
      include: { fromProgram: true, toProgram: true },
    });

    const now = new Date();
    const activeBonusesRaw = await prisma.transferBonus.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    });

    const poolingRulesRaw = await prisma.programPoolingRule.findMany({
      include: { loyaltyProgram: true },
    });

    const householdClientIds = trip.household?.members?.map((m) => m.clientId) ?? [];

    const groupTravelers: GroupTraveler[] = trip.travelers.map((t) => ({
      id: t.id,
      clientId: t.clientId,
      name: `${t.client.firstName} ${t.client.lastName}`,
      balances: (t.client.loyaltyBalances ?? []).map((b) => ({
        programId: b.loyaltyProgramId,
        programCode: b.loyaltyProgram.code,
        programName: b.loyaltyProgram.name,
        category: b.loyaltyProgram.category,
        balance: b.balance,
        pointValueCents: b.loyaltyProgram.defaultPointValueCents ?? 1.0,
      })),
    }));

    const ESTIMATED_CASH: Record<string, number> = {
      economy: 450, premium_economy: 850, business: 2500, first: 5000, flexible: 450,
    };
    const cashEstimate = ESTIMATED_CASH[trip.cabinPreference] ?? 450;

    const segments: GroupSegment[] = trip.travelers.map((t) => ({
      id: `flight_${t.id}`,
      travelerId: t.id,
      segmentType: "flight" as const,
      label: `Flight for ${t.client.firstName} ${t.client.lastName}`,
      bestCashPrice: cashEstimate,
      awardOptions: (t.client.loyaltyBalances ?? [])
        .filter((b) => b.balance > 0 && (b.loyaltyProgram.defaultPointValueCents ?? 0) > 0)
        .map((b) => {
          const cpp = b.loyaltyProgram.defaultPointValueCents ?? 1.0;
          const pointsNeeded = Math.ceil((cashEstimate * 0.95) / (cpp / 100));
          return {
            program: b.loyaltyProgram.code,
            programName: b.loyaltyProgram.name,
            pointsRequired: pointsNeeded,
            taxes: Math.round(cashEstimate * 0.05),
          };
        }),
    }));

    const transferRules: TransferRule[] = transferRulesRaw.map((r) => ({
      fromProgramId: r.fromProgramId,
      fromProgramCode: r.fromProgram.code,
      toProgramId: r.toProgramId,
      toProgramCode: r.toProgram.code,
      ratio: r.ratioNumerator / r.ratioDenominator,
      isIrreversible: r.isIrreversible,
      estimatedTransferTimeHours: r.estimatedTransferTimeHours ?? undefined,
    }));

    const activeBonuses: ActiveBonus[] = activeBonusesRaw.map((b) => ({
      fromProgramId: b.fromProgramId,
      toProgramId: b.toProgramId,
      bonusPercent: b.bonusPercent,
    }));

    const poolingRules: PoolingRule[] = poolingRulesRaw.map((r) => ({
      programId: r.loyaltyProgramId,
      programCode: r.loyaltyProgram.code,
      scope: r.poolingScope,
    }));

    const pointValuations: Record<string, number> = {};
    for (const t of groupTravelers) {
      for (const b of t.balances) {
        if (!pointValuations[b.programCode]) {
          pointValuations[b.programCode] = b.pointValueCents;
        }
      }
    }

    const allocation = optimizeGroupTravel({
      travelers: groupTravelers,
      segments,
      transferRules,
      activeBonuses,
      poolingRules,
      pointValuations,
      householdClientIds,
    });

    const settlement = computeSettlement({
      assignments: allocation.assignments,
      travelers: groupTravelers,
      splitMethod,
      pointValuations,
      waivedTravelerIds,
    });

    // Persist settlement
    await prisma.groupSettlement.create({
      data: {
        tripRequestId: id,
        splitMethod,
        pointValuationMethod: "actual_redemption",
        contributionLedger: JSON.parse(JSON.stringify(settlement.contributions)),
        fairShares: JSON.parse(JSON.stringify(settlement.fairShares)),
        transfers: JSON.parse(JSON.stringify(settlement.transfers)),
        memo: settlement.memo,
      },
    });

    return json({
      allocation: {
        assignments: allocation.assignments,
        totalCashCost: allocation.totalCashCost,
        totalCashBaseline: allocation.totalCashBaseline,
        cashSavedVsAllCash: allocation.cashSavedVsAllCash,
        savingsPercent: allocation.savingsPercent,
      },
      settlement: {
        contributions: settlement.contributions,
        fairShares: settlement.fairShares,
        transfers: settlement.transfers,
        memo: settlement.memo,
      },
    });
  } catch (error) {
    console.error("Group optimize error:", error);
    return errorResponse("Internal server error", 500);
  }
}
