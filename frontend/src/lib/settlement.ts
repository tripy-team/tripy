// ---------------------------------------------------------------------------
// Settlement Calculator — Payback Algorithm for Group Travel
//
// After the optimizer assigns bookings (possibly using one traveler's points
// for another), this module computes who owes whom.
// ---------------------------------------------------------------------------

import type {
  SegmentAssignment,
  GroupTraveler,
  SplitMethod,
  SettlementInput,
  SettlementResult,
  TravelerContribution,
  TravelerFairShare,
  SettlementTransfer,
  PointContributionItem,
} from "./group-optimizer-types";

export function computeSettlement(input: SettlementInput): SettlementResult {
  const {
    assignments,
    travelers,
    splitMethod,
    customSplits,
    pointValuations,
    waivedTravelerIds = [],
  } = input;

  const travelerMap = new Map(travelers.map((t) => [t.id, t]));

  const contributions = computeContributions(assignments, travelerMap, pointValuations);
  const fairShares = computeFairShares(assignments, travelers, splitMethod, customSplits);
  const transfers = computeTransfers(contributions, fairShares, travelerMap, waivedTravelerIds);
  const memo = generateMemo(contributions, fairShares, transfers, assignments, travelerMap);

  return { contributions, fairShares, transfers, memo };
}

// ---------------------------------------------------------------------------
// Step 1: Compute what each traveler actually contributed
// ---------------------------------------------------------------------------

function computeContributions(
  assignments: SegmentAssignment[],
  travelerMap: Map<string, GroupTraveler>,
  pointValuations: Record<string, number>,
): TravelerContribution[] {
  const contribMap = new Map<string, TravelerContribution>();

  for (const [, t] of travelerMap) {
    contribMap.set(t.id, {
      travelerId: t.id,
      travelerName: t.name,
      cashPaid: 0,
      pointsContributed: [],
      totalContributionCents: 0,
    });
  }

  for (const a of assignments) {
    const ownerContrib = contribMap.get(a.pointsOwnerId);
    if (!ownerContrib) continue;

    ownerContrib.cashPaid += a.cashAmount;

    if (a.pointsUsed > 0 && a.pointsProgram) {
      const sourceProgram = a.transferFrom ?? a.pointsProgram;
      const pointsSpentFromSource = a.transferPointsNeeded ?? a.pointsUsed;
      const cppForProgram = pointValuations[sourceProgram] ?? a.cppAchieved ?? 1.0;
      const valueCents = Math.round(pointsSpentFromSource * cppForProgram);

      const beneficiary = travelerMap.get(a.travelerId);

      const item: PointContributionItem = {
        program: sourceProgram,
        programName: a.transferFromName ?? a.pointsProgramName ?? sourceProgram,
        points: pointsSpentFromSource,
        valueCents,
        usedForTravelerId: a.travelerId,
        usedForTravelerName: beneficiary?.name ?? a.travelerName,
        usedForSegmentId: a.segmentId,
        usedForSegmentLabel: a.segmentLabel,
      };

      ownerContrib.pointsContributed.push(item);
    }
  }

  for (const [, c] of contribMap) {
    const pointsValueCents = c.pointsContributed.reduce((s, p) => s + p.valueCents, 0);
    c.totalContributionCents = Math.round(c.cashPaid * 100) + pointsValueCents;
  }

  return Array.from(contribMap.values());
}

// ---------------------------------------------------------------------------
// Step 2: Compute fair share per traveler
// ---------------------------------------------------------------------------

function computeFairShares(
  assignments: SegmentAssignment[],
  travelers: GroupTraveler[],
  splitMethod: SplitMethod,
  customSplits?: Record<string, number>,
): TravelerFairShare[] {
  const segmentsByTraveler = new Map<string, { segmentId: string; segmentLabel: string; cashEquivalent: number }[]>();

  for (const a of assignments) {
    const existing = segmentsByTraveler.get(a.travelerId) ?? [];
    const cashEquivalent = a.paymentType === "cash"
      ? a.cashAmount
      : a.cashAmount + Math.round((a.pointsUsed * (a.cppAchieved || 1.0)) / 100);
    existing.push({ segmentId: a.segmentId, segmentLabel: a.segmentLabel, cashEquivalent });
    segmentsByTraveler.set(a.travelerId, existing);
  }

  const totalTripValue = assignments.reduce((sum, a) => {
    if (a.paymentType === "cash") return sum + a.cashAmount;
    return sum + a.cashAmount + Math.round((a.pointsUsed * (a.cppAchieved || 1.0)) / 100);
  }, 0);

  return travelers.map((t) => {
    const segs = segmentsByTraveler.get(t.id) ?? [];
    let fairShareCents: number;

    switch (splitMethod) {
      case "equal":
        fairShareCents = Math.round((totalTripValue / travelers.length) * 100);
        break;

      case "custom":
        if (customSplits && customSplits[t.id] != null) {
          fairShareCents = Math.round(totalTripValue * (customSplits[t.id] / 100) * 100);
        } else {
          fairShareCents = Math.round((totalTripValue / travelers.length) * 100);
        }
        break;

      case "proportional_to_cost":
      default: {
        const travelerSegmentTotal = segs.reduce((s, seg) => s + seg.cashEquivalent, 0);
        fairShareCents = Math.round(travelerSegmentTotal * 100);
        break;
      }
    }

    return {
      travelerId: t.id,
      travelerName: t.name,
      fairShareCents,
      segmentBreakdown: segs,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 3: Compute settlement transfers (who pays whom)
// ---------------------------------------------------------------------------

function computeTransfers(
  contributions: TravelerContribution[],
  fairShares: TravelerFairShare[],
  travelerMap: Map<string, GroupTraveler>,
  waivedTravelerIds: string[],
): SettlementTransfer[] {
  const balanceMap = new Map<string, number>();
  for (const c of contributions) {
    const fs = fairShares.find((f) => f.travelerId === c.travelerId);
    if (!fs) continue;

    if (waivedTravelerIds.includes(c.travelerId)) {
      balanceMap.set(c.travelerId, 0);
    } else {
      balanceMap.set(c.travelerId, c.totalContributionCents - fs.fairShareCents);
    }
  }

  // Redistribute waived amounts proportionally
  if (waivedTravelerIds.length > 0) {
    const nonWaived = contributions.filter((c) => !waivedTravelerIds.includes(c.travelerId));
    for (const c of nonWaived) {
      const fs = fairShares.find((f) => f.travelerId === c.travelerId);
      if (!fs) continue;
      balanceMap.set(c.travelerId, c.totalContributionCents - fs.fairShareCents);
    }
  }

  type Entry = { id: string; name: string; balance: number };
  const creditors: Entry[] = [];
  const debtors: Entry[] = [];

  for (const [id, balance] of balanceMap) {
    const t = travelerMap.get(id);
    const name = t?.name ?? "Unknown";
    if (balance > 50) {
      creditors.push({ id, name, balance });
    } else if (balance < -50) {
      debtors.push({ id, name, balance: -balance });
    }
  }

  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => b.balance - a.balance);

  const transfers: SettlementTransfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.balance, debtor.balance);

    const breakdown = buildTransferBreakdown(
      debtor.id, creditor.id, contributions, travelerMap,
    );

    transfers.push({
      fromTravelerId: debtor.id,
      fromName: debtor.name,
      toTravelerId: creditor.id,
      toName: creditor.name,
      amountCents: amount,
      reason: `${debtor.name} owes ${creditor.name} for group trip expenses`,
      breakdown,
    });

    creditor.balance -= amount;
    debtor.balance -= amount;
    if (creditor.balance <= 50) ci++;
    if (debtor.balance <= 50) di++;
  }

  return transfers;
}

function buildTransferBreakdown(
  debtorId: string,
  creditorId: string,
  contributions: TravelerContribution[],
  travelerMap: Map<string, GroupTraveler>,
): string[] {
  const creditorContrib = contributions.find((c) => c.travelerId === creditorId);
  if (!creditorContrib) return [];

  const lines: string[] = [];
  const creditorName = travelerMap.get(creditorId)?.name ?? "Unknown";

  for (const p of creditorContrib.pointsContributed) {
    if (p.usedForTravelerId === debtorId) {
      lines.push(
        `${creditorName}'s ${p.programName} points covered ${p.usedForTravelerName}'s ` +
        `${p.usedForSegmentLabel} (${p.points.toLocaleString()} pts, valued at $${(p.valueCents / 100).toFixed(0)})`,
      );
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Step 4: Generate human-readable memo
// ---------------------------------------------------------------------------

function generateMemo(
  contributions: TravelerContribution[],
  fairShares: TravelerFairShare[],
  transfers: SettlementTransfer[],
  assignments: SegmentAssignment[],
  travelerMap: Map<string, GroupTraveler>,
): string {
  const lines: string[] = [];
  lines.push("=== GROUP TRIP SETTLEMENT SUMMARY ===");
  lines.push("");

  lines.push("BOOKINGS:");
  for (const a of assignments) {
    const method = a.paymentType === "cash"
      ? `Cash $${a.cashAmount.toFixed(0)}`
      : a.transferFrom
        ? `${a.transferFromName} → ${a.pointsProgramName} transfer (${(a.transferPointsNeeded ?? a.pointsUsed).toLocaleString()} pts)`
        : `${a.pointsProgramName} award (${a.pointsUsed.toLocaleString()} pts)`;
    const ownerNote = a.pointsOwnerId !== a.travelerId && a.pointsUsed > 0
      ? ` [points from ${a.pointsOwnerName}]`
      : "";
    lines.push(`  ${a.segmentLabel} (${a.travelerName}): ${method}${ownerNote}`);
    if (a.pointsUsed > 0) {
      lines.push(`    Cash portion: $${a.cashAmount.toFixed(0)} | CPP: ${a.cppAchieved.toFixed(1)}¢`);
    }
  }
  lines.push("");

  lines.push("CONTRIBUTION LEDGER:");
  for (const c of contributions) {
    const pointsVal = c.pointsContributed.reduce((s, p) => s + p.valueCents, 0);
    lines.push(
      `  ${c.travelerName}: Cash $${c.cashPaid.toFixed(0)} + Points value $${(pointsVal / 100).toFixed(0)} = Total $${(c.totalContributionCents / 100).toFixed(0)}`,
    );
  }
  lines.push("");

  lines.push("FAIR SHARES:");
  for (const fs of fairShares) {
    lines.push(`  ${fs.travelerName}: $${(fs.fairShareCents / 100).toFixed(0)}`);
  }
  lines.push("");

  if (transfers.length === 0) {
    lines.push("SETTLEMENT: No payments needed — contributions match fair shares.");
  } else {
    lines.push("SETTLEMENT:");
    for (const t of transfers) {
      lines.push(`  ${t.fromName} owes ${t.toName}: $${(t.amountCents / 100).toFixed(2)}`);
      for (const b of t.breakdown) {
        lines.push(`    • ${b}`);
      }
    }
  }

  return lines.join("\n");
}
