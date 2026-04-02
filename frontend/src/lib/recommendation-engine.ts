import { prisma } from "./prisma";
import type {
  StrategyType,
  PaymentType,
  InsightType,
  Severity,
} from "@/generated/prisma";

interface TravelerWithBalances {
  travelerId: string;
  clientId: string;
  clientName: string;
  balances: {
    programId: string;
    programCode: string;
    programName: string;
    category: string;
    balance: number;
    pointValueCents: number;
    expirationDate: Date | null;
  }[];
}

interface TransferPath {
  fromProgramId: string;
  toProgramId: string;
  ratio: number;
  isIrreversible: boolean;
  bonusPercent: number;
}

interface StrategyCandidate {
  title: string;
  strategyType: StrategyType;
  totalCashCost: number;
  totalPointsUsed: Record<string, number>;
  estimatedTotalValueCents: number;
  weightedScore: number;
  isRecommended: boolean;
  summary: string;
  allocations: {
    tripTravelerId: string;
    paymentType: PaymentType;
    loyaltyProgramId: string | null;
    pointsUsed: number;
    cashUsed: number;
    taxesAndFees: number;
    rationale: string;
  }[];
  insights: {
    insightType: InsightType;
    title: string;
    body: string;
    severity: Severity;
  }[];
}

const WEIGHTS = {
  cashSavings: 0.35,
  cpp: 0.25,
  flexibilityPenalty: 0.2,
  transferRisk: 0.1,
  inconvenience: 0.1,
};

const FLEXIBLE_PROGRAMS = [
  "chase_ultimate_rewards",
  "amex_membership_rewards",
  "capital_one_miles",
  "citi_thankyou",
  "bilt_rewards",
];

const ESTIMATED_CASH_PER_TRAVELER_CENTS: Record<string, number> = {
  economy: 45000,
  premium_economy: 85000,
  business: 250000,
  first: 500000,
  flexible: 45000,
};

export async function runRecommendationEngine(
  tripRequestId: string,
  userId: string,
): Promise<string> {
  const trip = await prisma.tripRequest.findUnique({
    where: { id: tripRequestId },
    include: {
      travelers: { include: { client: true } },
      client: true,
      household: true,
    },
  });

  if (!trip) throw new Error("Trip request not found");

  const run = await prisma.recommendationRun.create({
    data: {
      tripRequestId,
      createdByUserId: userId,
      status: "running",
      engineVersion: "v1",
    },
  });

  try {
    const travelersWithBalances = await loadTravelerBalances(trip.travelers);
    const transferPaths = await loadTransferPaths();
    const activeBonuses = await loadActiveBonuses();

    const estimatedCashPerTraveler =
      ESTIMATED_CASH_PER_TRAVELER_CENTS[trip.cabinPreference] || 45000;
    const totalEstimatedCash = estimatedCashPerTraveler * trip.travelers.length;

    const strategies = generateStrategies(
      travelersWithBalances,
      transferPaths,
      activeBonuses,
      totalEstimatedCash,
      estimatedCashPerTraveler,
      trip.cabinPreference,
    );

    strategies.sort((a, b) => b.weightedScore - a.weightedScore);
    strategies[0].isRecommended = true;

    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i];
      const option = await prisma.recommendationOption.create({
        data: {
          recommendationRunId: run.id,
          rank: i + 1,
          title: s.title,
          strategyType: s.strategyType,
          totalCashCost: s.totalCashCost,
          totalPointsUsed: s.totalPointsUsed,
          estimatedTotalValueCents: s.estimatedTotalValueCents,
          weightedScore: s.weightedScore,
          isRecommended: s.isRecommended,
          summary: s.summary,
        },
      });

      for (const alloc of s.allocations) {
        await prisma.recommendationTravelerAllocation.create({
          data: {
            recommendationOptionId: option.id,
            tripTravelerId: alloc.tripTravelerId,
            paymentType: alloc.paymentType,
            loyaltyProgramId: alloc.loyaltyProgramId,
            pointsUsed: alloc.pointsUsed,
            cashUsed: alloc.cashUsed,
            taxesAndFees: alloc.taxesAndFees,
            rationale: alloc.rationale,
          },
        });
      }

      for (const insight of s.insights) {
        await prisma.recommendationInsight.create({
          data: {
            recommendationOptionId: option.id,
            insightType: insight.insightType,
            title: insight.title,
            body: insight.body,
            severity: insight.severity,
          },
        });
      }
    }

    await prisma.recommendationRun.update({
      where: { id: run.id },
      data: { status: "complete", completedAt: new Date() },
    });

    await prisma.tripRequest.update({
      where: { id: tripRequestId },
      data: { status: "complete" },
    });

    return run.id;
  } catch (error) {
    await prisma.recommendationRun.update({
      where: { id: run.id },
      data: { status: "failed" },
    });
    throw error;
  }
}

async function loadTravelerBalances(
  travelers: { id: string; clientId: string; client: { firstName: string; lastName: string } }[],
): Promise<TravelerWithBalances[]> {
  const result: TravelerWithBalances[] = [];

  for (const t of travelers) {
    const balances = await prisma.clientLoyaltyBalance.findMany({
      where: { clientId: t.clientId },
      include: { loyaltyProgram: true },
    });

    result.push({
      travelerId: t.id,
      clientId: t.clientId,
      clientName: `${t.client.firstName} ${t.client.lastName}`,
      balances: balances.map((b) => ({
        programId: b.loyaltyProgramId,
        programCode: b.loyaltyProgram.code,
        programName: b.loyaltyProgram.name,
        category: b.loyaltyProgram.category,
        balance: b.balance,
        pointValueCents: b.loyaltyProgram.defaultPointValueCents || 1.0,
        expirationDate: b.expirationDate,
      })),
    });
  }

  return result;
}

async function loadTransferPaths(): Promise<TransferPath[]> {
  const rules = await prisma.programTransferRule.findMany({
    where: { isActive: true },
  });

  return rules.map((r) => ({
    fromProgramId: r.fromProgramId,
    toProgramId: r.toProgramId,
    ratio: r.ratioNumerator / r.ratioDenominator,
    isIrreversible: r.isIrreversible,
    bonusPercent: 0,
  }));
}

async function loadActiveBonuses(): Promise<
  { fromProgramId: string; toProgramId: string; bonusPercent: number }[]
> {
  const now = new Date();
  const bonuses = await prisma.transferBonus.findMany({
    where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
  });

  return bonuses.map((b) => ({
    fromProgramId: b.fromProgramId,
    toProgramId: b.toProgramId,
    bonusPercent: b.bonusPercent,
  }));
}

function generateStrategies(
  travelers: TravelerWithBalances[],
  transferPaths: TransferPath[],
  activeBonuses: { fromProgramId: string; toProgramId: string; bonusPercent: number }[],
  totalEstimatedCash: number,
  cashPerTraveler: number,
  cabin: string,
): StrategyCandidate[] {
  const strategies: StrategyCandidate[] = [];

  // Strategy 1: All Cash
  strategies.push(
    generateCashOnlyStrategy(travelers, totalEstimatedCash, cashPerTraveler),
  );

  // Strategy 2: Maximize Points (minimize cash)
  strategies.push(
    generatePointsFirstStrategy(
      travelers,
      totalEstimatedCash,
      cashPerTraveler,
      transferPaths,
      activeBonuses,
    ),
  );

  // Strategy 3: Balanced Mix
  strategies.push(
    generateBalancedStrategy(
      travelers,
      totalEstimatedCash,
      cashPerTraveler,
      transferPaths,
      activeBonuses,
    ),
  );

  // Strategy 4: Preserve Flexible Currencies
  strategies.push(
    generatePreserveFlexibleStrategy(
      travelers,
      totalEstimatedCash,
      cashPerTraveler,
    ),
  );

  // Strategy 5: Wait & Watch (if bonuses detected)
  if (activeBonuses.length > 0) {
    strategies.push(
      generateWaitStrategy(
        travelers,
        totalEstimatedCash,
        cashPerTraveler,
        activeBonuses,
      ),
    );
  }

  return strategies;
}

function generateCashOnlyStrategy(
  travelers: TravelerWithBalances[],
  totalCash: number,
  cashPerTraveler: number,
): StrategyCandidate {
  const allocations = travelers.map((t) => ({
    tripTravelerId: t.travelerId,
    paymentType: "cash" as PaymentType,
    loyaltyProgramId: null,
    pointsUsed: 0,
    cashUsed: cashPerTraveler,
    taxesAndFees: Math.round(cashPerTraveler * 0.12),
    rationale: `Full cash booking for ${t.clientName}`,
  }));

  return {
    title: "All Cash Booking",
    strategyType: "cash_only",
    totalCashCost: totalCash,
    totalPointsUsed: {},
    estimatedTotalValueCents: totalCash,
    weightedScore: scoreStrategy(totalCash, totalCash, 0, 0, 0),
    isRecommended: false,
    summary:
      "Pay entirely in cash. Preserves all loyalty balances for future use. Simplest option with no transfer risk.",
    allocations,
    insights: [
      {
        insightType: "preserve_currency",
        title: "All points preserved",
        body: "This option keeps your entire loyalty portfolio intact for future high-value redemptions.",
        severity: "info",
      },
    ],
  };
}

function generatePointsFirstStrategy(
  travelers: TravelerWithBalances[],
  totalCash: number,
  cashPerTraveler: number,
  _transferPaths: TransferPath[],
  activeBonuses: { fromProgramId: string; toProgramId: string; bonusPercent: number }[],
): StrategyCandidate {
  const allocations: StrategyCandidate["allocations"] = [];
  const insights: StrategyCandidate["insights"] = [];
  const totalPointsUsed: Record<string, number> = {};
  let remainingCash = totalCash;

  for (const t of travelers) {
    const sortedBalances = [...t.balances].sort(
      (a, b) => a.pointValueCents - b.pointValueCents,
    );

    let covered = false;
    for (const bal of sortedBalances) {
      if (bal.balance <= 0) continue;

      const pointsNeeded = Math.ceil(cashPerTraveler / bal.pointValueCents);
      if (bal.balance >= pointsNeeded * 0.5) {
        const usable = Math.min(bal.balance, pointsNeeded);
        const cashSaved = Math.round(usable * bal.pointValueCents);
        const cashNeeded = Math.max(0, cashPerTraveler - cashSaved);
        const taxes = Math.round(cashPerTraveler * 0.05);

        totalPointsUsed[bal.programCode] =
          (totalPointsUsed[bal.programCode] || 0) + usable;
        remainingCash -= cashSaved;

        allocations.push({
          tripTravelerId: t.travelerId,
          paymentType: cashNeeded > 0 ? "mixed" : "points",
          loyaltyProgramId: bal.programId,
          pointsUsed: usable,
          cashUsed: cashNeeded + taxes,
          taxesAndFees: taxes,
          rationale: `Redeem ${usable.toLocaleString()} ${bal.programName} points at ${bal.pointValueCents.toFixed(1)}¢/pt${cashNeeded > 0 ? `, plus $${(cashNeeded / 100).toFixed(0)} cash` : ""}`,
        });

        if (bal.pointValueCents < 1.0) {
          insights.push({
            insightType: "low_value_redemption",
            title: `Low-value ${bal.programName} redemption`,
            body: `Using ${bal.programName} points at ${bal.pointValueCents.toFixed(1)}¢/pt — below the 1¢ threshold. Consider cash instead.`,
            severity: "warning",
          });
        }

        if (FLEXIBLE_PROGRAMS.includes(bal.programCode)) {
          insights.push({
            insightType: "preserve_currency",
            title: `Spending flexible ${bal.programName}`,
            body: `This depletes ${usable.toLocaleString()} ${bal.programName} points — a flexible transfer currency. Consider preserving for a higher-value future redemption.`,
            severity: "info",
          });
        }

        covered = true;
        break;
      }
    }

    if (!covered) {
      allocations.push({
        tripTravelerId: t.travelerId,
        paymentType: "cash",
        loyaltyProgramId: null,
        pointsUsed: 0,
        cashUsed: cashPerTraveler,
        taxesAndFees: Math.round(cashPerTraveler * 0.12),
        rationale: `Insufficient points for ${t.clientName}, using cash`,
      });
    }
  }

  if (activeBonuses.length > 0) {
    insights.push({
      insightType: "wait_for_bonus",
      title: "Active transfer bonus available",
      body: `There ${activeBonuses.length === 1 ? "is" : "are"} ${activeBonuses.length} active transfer bonus${activeBonuses.length > 1 ? "es" : ""} that could improve this strategy.`,
      severity: "info",
    });
  }

  const actualCash = allocations.reduce((sum, a) => sum + a.cashUsed, 0);

  return {
    title: "Maximize Points Redemption",
    strategyType: "points_only",
    totalCashCost: actualCash,
    totalPointsUsed,
    estimatedTotalValueCents: totalCash,
    weightedScore: scoreStrategy(
      totalCash,
      actualCash,
      Object.keys(totalPointsUsed).length > 0 ? 1.5 : 0,
      0.3,
      0.1,
    ),
    isRecommended: false,
    summary: `Maximize use of existing loyalty balances to minimize cash outlay. ${Object.entries(totalPointsUsed)
      .map(([k, v]) => `${v.toLocaleString()} ${k}`)
      .join(", ")} points used.`,
    allocations,
    insights,
  };
}

function generateBalancedStrategy(
  travelers: TravelerWithBalances[],
  totalCash: number,
  cashPerTraveler: number,
  _transferPaths: TransferPath[],
  _activeBonuses: { fromProgramId: string; toProgramId: string; bonusPercent: number }[],
): StrategyCandidate {
  const allocations: StrategyCandidate["allocations"] = [];
  const insights: StrategyCandidate["insights"] = [];
  const totalPointsUsed: Record<string, number> = {};

  for (const t of travelers) {
    const nonFlexible = t.balances.filter(
      (b) => !FLEXIBLE_PROGRAMS.includes(b.programCode) && b.balance > 0,
    );
    const highValue = nonFlexible.filter((b) => b.pointValueCents >= 1.2);

    if (highValue.length > 0) {
      const best = highValue.sort(
        (a, b) => b.pointValueCents - a.pointValueCents,
      )[0];
      const halfCash = Math.round(cashPerTraveler * 0.5);
      const pointsNeeded = Math.ceil(halfCash / best.pointValueCents);
      const usable = Math.min(best.balance, pointsNeeded);
      const cashSaved = Math.round(usable * best.pointValueCents);
      const taxes = Math.round(cashPerTraveler * 0.05);

      totalPointsUsed[best.programCode] =
        (totalPointsUsed[best.programCode] || 0) + usable;

      allocations.push({
        tripTravelerId: t.travelerId,
        paymentType: "mixed",
        loyaltyProgramId: best.programId,
        pointsUsed: usable,
        cashUsed: cashPerTraveler - cashSaved + taxes,
        taxesAndFees: taxes,
        rationale: `Split: ${usable.toLocaleString()} ${best.programName} pts + cash for ${t.clientName}`,
      });
    } else {
      allocations.push({
        tripTravelerId: t.travelerId,
        paymentType: "cash",
        loyaltyProgramId: null,
        pointsUsed: 0,
        cashUsed: cashPerTraveler,
        taxesAndFees: Math.round(cashPerTraveler * 0.12),
        rationale: `No high-value non-flexible programs for ${t.clientName}`,
      });
    }
  }

  insights.push({
    insightType: "preserve_currency",
    title: "Flexible currencies preserved",
    body: "This strategy avoids spending transferable bank points, keeping them available for future premium redemptions.",
    severity: "info",
  });

  const actualCash = allocations.reduce((sum, a) => sum + a.cashUsed, 0);

  return {
    title: "Balanced Cash + Points",
    strategyType: "mixed",
    totalCashCost: actualCash,
    totalPointsUsed,
    estimatedTotalValueCents: totalCash,
    weightedScore: scoreStrategy(totalCash, actualCash, 1.2, 0.1, 0.2),
    isRecommended: false,
    summary:
      "A balanced approach: use non-flexible loyalty programs where value is strong, pay cash for the rest. Preserves bank currencies for future use.",
    allocations,
    insights,
  };
}

function generatePreserveFlexibleStrategy(
  travelers: TravelerWithBalances[],
  totalCash: number,
  cashPerTraveler: number,
): StrategyCandidate {
  const allocations: StrategyCandidate["allocations"] = [];
  const insights: StrategyCandidate["insights"] = [];
  const totalPointsUsed: Record<string, number> = {};

  for (const t of travelers) {
    const nonFlexible = t.balances
      .filter(
        (b) => !FLEXIBLE_PROGRAMS.includes(b.programCode) && b.balance > 0,
      )
      .sort((a, b) => b.pointValueCents - a.pointValueCents);

    if (nonFlexible.length > 0 && nonFlexible[0].pointValueCents >= 1.0) {
      const best = nonFlexible[0];
      const pointsNeeded = Math.ceil(cashPerTraveler / best.pointValueCents);
      const usable = Math.min(best.balance, pointsNeeded);
      const cashSaved = Math.round(usable * best.pointValueCents);
      const taxes = Math.round(cashPerTraveler * 0.05);

      totalPointsUsed[best.programCode] =
        (totalPointsUsed[best.programCode] || 0) + usable;

      allocations.push({
        tripTravelerId: t.travelerId,
        paymentType: cashSaved >= cashPerTraveler * 0.8 ? "points" : "mixed",
        loyaltyProgramId: best.programId,
        pointsUsed: usable,
        cashUsed: Math.max(0, cashPerTraveler - cashSaved) + taxes,
        taxesAndFees: taxes,
        rationale: `Use locked program ${best.programName} first, preserve flexible currencies`,
      });
    } else {
      allocations.push({
        tripTravelerId: t.travelerId,
        paymentType: "cash",
        loyaltyProgramId: null,
        pointsUsed: 0,
        cashUsed: cashPerTraveler,
        taxesAndFees: Math.round(cashPerTraveler * 0.12),
        rationale: `Cash for ${t.clientName} — no usable locked-in program balances`,
      });
    }

    const flexBalance = t.balances
      .filter((b) => FLEXIBLE_PROGRAMS.includes(b.programCode))
      .reduce((s, b) => s + b.balance * b.pointValueCents, 0);

    if (flexBalance > 0) {
      insights.push({
        insightType: "preserve_currency",
        title: `Preserving ${t.clientName}'s flexible currencies`,
        body: `${t.clientName} has ~$${Math.round(flexBalance / 100).toLocaleString()} in flexible bank currencies. This strategy keeps them intact.`,
        severity: "info",
      });
    }
  }

  const actualCash = allocations.reduce((sum, a) => sum + a.cashUsed, 0);

  return {
    title: "Preserve Flexible Currencies",
    strategyType: "mixed",
    totalCashCost: actualCash,
    totalPointsUsed,
    estimatedTotalValueCents: totalCash,
    weightedScore: scoreStrategy(totalCash, actualCash, 1.0, 0.0, 0.3),
    isRecommended: false,
    summary:
      "Prioritize spending locked-in airline/hotel points first. Keep transferable bank currencies for higher-value future redemptions.",
    allocations,
    insights,
  };
}

function generateWaitStrategy(
  travelers: TravelerWithBalances[],
  totalCash: number,
  cashPerTraveler: number,
  activeBonuses: { fromProgramId: string; toProgramId: string; bonusPercent: number }[],
): StrategyCandidate {
  const allocations = travelers.map((t) => ({
    tripTravelerId: t.travelerId,
    paymentType: "cash" as PaymentType,
    loyaltyProgramId: null,
    pointsUsed: 0,
    cashUsed: cashPerTraveler,
    taxesAndFees: Math.round(cashPerTraveler * 0.12),
    rationale: `Hold and monitor transfer bonuses for ${t.clientName}`,
  }));

  const bestBonus = activeBonuses.sort(
    (a, b) => b.bonusPercent - a.bonusPercent,
  )[0];
  const insights: StrategyCandidate["insights"] = [
    {
      insightType: "wait_for_bonus",
      title: `${bestBonus.bonusPercent}% transfer bonus active`,
      body: `A ${bestBonus.bonusPercent}% transfer bonus is currently available. Waiting could yield significantly more points per transfer.`,
      severity: "warning",
    },
  ];

  return {
    title: "Wait for Better Timing",
    strategyType: "hold_and_wait",
    totalCashCost: totalCash,
    totalPointsUsed: {},
    estimatedTotalValueCents: totalCash,
    weightedScore: scoreStrategy(totalCash, totalCash, 0, 0, 0.5) - 0.1,
    isRecommended: false,
    summary: `Active transfer bonuses suggest holding off on immediate redemption. Monitor for an improved points-based option.`,
    allocations,
    insights,
  };
}

function scoreStrategy(
  baselineCash: number,
  actualCash: number,
  avgCpp: number,
  transferRisk: number,
  inconvenience: number,
): number {
  const cashSavings =
    baselineCash > 0 ? (baselineCash - actualCash) / baselineCash : 0;
  const normalizedCpp = Math.min(avgCpp / 2.0, 1.0);
  const flexPenalty = avgCpp > 1.5 ? 0.3 : 0;

  return (
    WEIGHTS.cashSavings * cashSavings +
    WEIGHTS.cpp * normalizedCpp -
    WEIGHTS.flexibilityPenalty * flexPenalty -
    WEIGHTS.transferRisk * transferRisk -
    WEIGHTS.inconvenience * inconvenience
  );
}
