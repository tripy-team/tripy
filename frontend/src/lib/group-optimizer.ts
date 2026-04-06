// ---------------------------------------------------------------------------
// Group Travel Optimizer — Pooled Points Allocation
//
// Solves: given N travelers with individual loyalty balances, find the
// minimum-cash assignment of bookings where one traveler's points can pay
// for another's segment (book-for-another, household pooling, transfers).
// ---------------------------------------------------------------------------

import type {
  GroupOptimizerInput,
  GroupAllocation,
  GroupSegment,
  GroupTraveler,
  SegmentAssignment,
  TransferRule,
  ActiveBonus,
  PoolingRule,
} from "./group-optimizer-types";

const MIN_CPP_THRESHOLD = 0.8;

interface Candidate {
  segmentId: string;
  segmentLabel: string;
  travelerId: string;
  travelerName: string;
  cashAmount: number;
  pointsUsed: number;
  pointsProgram: string | null;
  pointsProgramName: string | null;
  pointsOwnerId: string;
  pointsOwnerName: string;
  transferFrom?: string;
  transferFromName?: string;
  transferPointsNeeded?: number;
  transferRatio?: number;
  cashSavings: number;
  cpp: number;
  sourceBalanceKey: string;
}

export function optimizeGroupTravel(input: GroupOptimizerInput): GroupAllocation {
  const { travelers, segments, transferRules, activeBonuses, poolingRules, householdClientIds } = input;

  const travelerMap = new Map(travelers.map((t) => [t.id, t]));
  const poolingScopeMap = new Map(poolingRules.map((r) => [r.programCode, r.scope]));

  const candidates = generateAllCandidates(
    segments, travelers, transferRules, activeBonuses,
    poolingScopeMap, householdClientIds, travelerMap,
  );

  const assignments = solveGreedy(candidates, segments, travelers, travelerMap);
  return buildAllocation(assignments, segments);
}

function canPool(
  programCode: string,
  beneficiaryClientId: string,
  ownerClientId: string,
  poolingScopeMap: Map<string, string>,
  householdClientIds: string[],
  category: string,
): boolean {
  if (beneficiaryClientId === ownerClientId) return true;

  const scope = poolingScopeMap.get(programCode);

  if (category === "airline") {
    if (scope === "none") return false;
    return true; // airlines generally allow book-for-another
  }

  switch (scope) {
    case "unrestricted":
      return true;
    case "book_for_others":
      return true;
    case "authorized_user_like":
      return true;
    case "household_only":
      return (
        householdClientIds.includes(beneficiaryClientId) &&
        householdClientIds.includes(ownerClientId)
      );
    case "none":
    default:
      return false;
  }
}

function generateAllCandidates(
  segments: GroupSegment[],
  travelers: GroupTraveler[],
  transferRules: TransferRule[],
  activeBonuses: ActiveBonus[],
  poolingScopeMap: Map<string, string>,
  householdClientIds: string[],
  travelerMap: Map<string, GroupTraveler>,
): Candidate[] {
  const candidates: Candidate[] = [];
  const transferByFrom = new Map<string, TransferRule[]>();
  for (const rule of transferRules) {
    const existing = transferByFrom.get(rule.fromProgramCode) ?? [];
    existing.push(rule);
    transferByFrom.set(rule.fromProgramCode, existing);
  }

  const bonusMap = new Map<string, number>();
  for (const b of activeBonuses) {
    bonusMap.set(`${b.fromProgramId}→${b.toProgramId}`, b.bonusPercent);
  }

  for (const segment of segments) {
    const traveler = travelerMap.get(segment.travelerId);
    if (!traveler) continue;

    for (const award of segment.awardOptions) {
      // Direct award — each traveler's own balances
      for (const owner of travelers) {
        const bal = owner.balances.find(
          (b) => b.programCode === award.program || b.programName === award.programName,
        );
        if (!bal || bal.balance < award.pointsRequired) continue;

        if (
          !canPool(
            bal.programCode, traveler.clientId, owner.clientId,
            poolingScopeMap, householdClientIds, bal.category,
          )
        ) continue;

        const cashSavings = segment.bestCashPrice - award.taxes;
        if (cashSavings <= 0) continue;

        const cpp = (cashSavings / award.pointsRequired) * 100;
        if (cpp < MIN_CPP_THRESHOLD) continue;

        candidates.push({
          segmentId: segment.id,
          segmentLabel: segment.label,
          travelerId: traveler.id,
          travelerName: traveler.name,
          cashAmount: award.taxes,
          pointsUsed: award.pointsRequired,
          pointsProgram: bal.programCode,
          pointsProgramName: bal.programName,
          pointsOwnerId: owner.id,
          pointsOwnerName: owner.name,
          cashSavings,
          cpp,
          sourceBalanceKey: `${owner.id}:${bal.programCode}`,
        });
      }

      // Transfer-then-award — bank programs → award program
      for (const owner of travelers) {
        for (const bal of owner.balances) {
          if (bal.category !== "transferable_bank") continue;

          const rules = transferByFrom.get(bal.programCode) ?? [];
          for (const rule of rules) {
            const targetMatchesAward =
              award.program === rule.toProgramCode ||
              award.programName === rule.toProgramCode;
            if (!targetMatchesAward) continue;

            if (
              !canPool(
                bal.programCode, traveler.clientId, owner.clientId,
                poolingScopeMap, householdClientIds, "transferable_bank",
              )
            ) continue;

            const bonusKey = `${rule.fromProgramId}→${rule.toProgramId}`;
            const bonusPct = bonusMap.get(bonusKey) ?? 0;
            const effectiveRatio = rule.ratio * (1 + bonusPct / 100);
            const bankPointsNeeded = Math.ceil(award.pointsRequired / effectiveRatio);

            if (bal.balance < bankPointsNeeded) continue;

            const cashSavings = segment.bestCashPrice - award.taxes;
            if (cashSavings <= 0) continue;

            const cpp = (cashSavings / bankPointsNeeded) * 100;
            if (cpp < MIN_CPP_THRESHOLD) continue;

            candidates.push({
              segmentId: segment.id,
              segmentLabel: segment.label,
              travelerId: traveler.id,
              travelerName: traveler.name,
              cashAmount: award.taxes,
              pointsUsed: award.pointsRequired,
              pointsProgram: rule.toProgramCode,
              pointsProgramName: award.programName,
              pointsOwnerId: owner.id,
              pointsOwnerName: owner.name,
              transferFrom: bal.programCode,
              transferFromName: bal.programName,
              transferPointsNeeded: bankPointsNeeded,
              transferRatio: effectiveRatio,
              cashSavings,
              cpp,
              sourceBalanceKey: `${owner.id}:${bal.programCode}`,
            });
          }
        }
      }
    }
  }

  candidates.sort((a, b) => b.cpp - a.cpp);
  return candidates;
}

function solveGreedy(
  candidates: Candidate[],
  segments: GroupSegment[],
  travelers: GroupTraveler[],
  travelerMap: Map<string, GroupTraveler>,
): Map<string, SegmentAssignment> {
  const assignments = new Map<string, SegmentAssignment>();

  // Track remaining balances: "ownerId:programCode" → remaining
  const remaining = new Map<string, number>();
  for (const t of travelers) {
    for (const b of t.balances) {
      remaining.set(`${t.id}:${b.programCode}`, b.balance);
    }
  }

  // Track award seat consumption per route to avoid overbooking
  const awardSeatUsage = new Map<string, number>();

  for (const c of candidates) {
    if (assignments.has(c.segmentId)) continue;

    const balKey = c.sourceBalanceKey;
    const needed = c.transferPointsNeeded ?? c.pointsUsed;
    const available = remaining.get(balKey) ?? 0;
    if (available < needed) continue;

    // Check budget constraint
    const owner = travelerMap.get(c.pointsOwnerId);
    if (owner?.cashBudget != null) {
      let ownerCashSoFar = 0;
      for (const [, a] of assignments) {
        if (a.pointsOwnerId === c.pointsOwnerId) ownerCashSoFar += a.cashAmount;
      }
      if (ownerCashSoFar + c.cashAmount > owner.cashBudget) continue;
    }

    // Check seat availability — find the matching segment + award option
    const segment = segments.find((s) => s.id === c.segmentId);
    if (segment) {
      const matchAward = segment.awardOptions.find(
        (a) => a.program === c.pointsProgram || a.programName === c.pointsProgramName,
      );
      if (matchAward?.seatsRemaining != null) {
        const routeKey = `${segment.id}:${c.pointsProgram}`;
        const used = awardSeatUsage.get(routeKey) ?? 0;
        if (used >= matchAward.seatsRemaining) continue;
        awardSeatUsage.set(routeKey, used + 1);
      }
    }

    remaining.set(balKey, available - needed);
    assignments.set(c.segmentId, {
      segmentId: c.segmentId,
      segmentLabel: c.segmentLabel,
      travelerId: c.travelerId,
      travelerName: c.travelerName,
      paymentType: "points",
      cashAmount: c.cashAmount,
      pointsUsed: c.pointsUsed,
      pointsProgram: c.pointsProgram,
      pointsProgramName: c.pointsProgramName,
      pointsOwnerId: c.pointsOwnerId,
      pointsOwnerName: c.pointsOwnerName,
      transferFrom: c.transferFrom,
      transferFromName: c.transferFromName,
      transferPointsNeeded: c.transferPointsNeeded,
      transferRatio: c.transferRatio,
      cppAchieved: Math.round(c.cpp * 100) / 100,
    });
  }

  // Fill unassigned segments with cash
  for (const segment of segments) {
    if (assignments.has(segment.id)) continue;

    const traveler = travelerMap.get(segment.travelerId);
    assignments.set(segment.id, {
      segmentId: segment.id,
      segmentLabel: segment.label,
      travelerId: segment.travelerId,
      travelerName: traveler?.name ?? "Unknown",
      paymentType: "cash",
      cashAmount: segment.bestCashPrice,
      pointsUsed: 0,
      pointsProgram: null,
      pointsProgramName: null,
      pointsOwnerId: segment.travelerId,
      pointsOwnerName: traveler?.name ?? "Unknown",
      cppAchieved: 0,
    });
  }

  return assignments;
}

function buildAllocation(
  assignments: Map<string, SegmentAssignment>,
  segments: GroupSegment[],
): GroupAllocation {
  const assignmentList = Array.from(assignments.values());
  const totalCashCost = assignmentList.reduce((s, a) => s + a.cashAmount, 0);
  const totalCashBaseline = segments.reduce((s, seg) => s + seg.bestCashPrice, 0);

  let totalPointsValueCents = 0;
  for (const a of assignmentList) {
    if (a.pointsUsed > 0 && a.cppAchieved > 0) {
      totalPointsValueCents += Math.round(a.pointsUsed * a.cppAchieved);
    }
  }

  const cashSaved = totalCashBaseline - totalCashCost;

  return {
    assignments: assignmentList,
    totalCashCost,
    totalCashBaseline,
    totalPointsValueCents,
    cashSavedVsAllCash: cashSaved,
    savingsPercent: totalCashBaseline > 0 ? Math.round((cashSaved / totalCashBaseline) * 100) : 0,
  };
}
