/**
 * Internal endpoint: returns active transfer bonuses in the ILP format
 * expected by the backend optimizer.
 *
 * No auth required — transfer bonus data is publicly available information
 * (sourced from TPG / NerdWallet). This endpoint exists so the backend
 * reads from the same Prisma DB the dashboard displays, keeping the two
 * consistent.
 *
 * Response shape:
 *   { bonuses: Record<string, number> }
 *
 * Keys are "bankCode|programCode" using the backend's ILP codes
 * (e.g. "chase|UA"). Values are multipliers (e.g. 1.4 for a 40% bonus).
 */

import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Prisma LoyaltyProgram.code → backend ILP bank code
// ---------------------------------------------------------------------------
const PRISMA_BANK_TO_ILP: Record<string, string> = {
  chase_ultimate_rewards: "chase",
  amex_membership_rewards: "amex",
  citi_thankyou: "citi",
  capital_one_miles: "capitalone",
  bilt_rewards: "bilt",
  wells_fargo_rewards: "wellsfargo",
  rove_miles: "rove",
};

// ---------------------------------------------------------------------------
// Prisma LoyaltyProgram.code → backend ILP airline/hotel code
// ---------------------------------------------------------------------------
const PRISMA_PROGRAM_TO_ILP: Record<string, string> = {
  // Airlines
  united_mileageplus: "UA",
  american_aadvantage: "AA",
  delta_skymiles: "DL",
  southwest_rapid_rewards: "WN",
  jetblue_trueblue: "B6",
  alaska_mileage_plan: "AS",
  british_airways_avios: "BA",
  flying_blue: "AF",
  virgin_atlantic: "VS",
  singapore_krisflyer: "SQ",
  cathay_pacific: "CX",
  ana_mileage_club: "NH",
  jal_mileage_bank: "JL",
  emirates_skywards: "EK",
  qatar_privilege_club: "QR",
  turkish_milesandsmiles: "TK",
  avianca_lifemiles: "AV",
  aeroplan: "AC",
  etihad_guest: "EY",
  qantas_frequent_flyer: "QF",
  sas_eurobonus: "SK",
  lufthansa_miles_and_more: "LH",
  iberia_avios: "IB",
  // Hotels
  marriott_bonvoy: "MAR",
  hilton_honors: "HH",
  hyatt: "HYATT",
  ihg_rewards: "IHG",
};

export async function GET() {
  try {
    const now = new Date();

    const activeBonuses = await prisma.transferBonus.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      include: { fromProgram: true, toProgram: true },
    });

    const bonuses: Record<string, number> = {};

    for (const b of activeBonuses) {
      const bankCode = PRISMA_BANK_TO_ILP[b.fromProgram.code];
      const programCode = PRISMA_PROGRAM_TO_ILP[b.toProgram.code];

      if (!bankCode || !programCode) continue;

      const key = `${bankCode}|${programCode}`;
      const multiplier = 1 + b.bonusPercent / 100;

      // If multiple bonuses exist for the same pair, keep the highest
      if (!bonuses[key] || multiplier > bonuses[key]) {
        bonuses[key] = multiplier;
      }
    }

    return NextResponse.json({ bonuses });
  } catch (error) {
    console.error("Internal transfer-bonuses error:", error);
    return NextResponse.json({ bonuses: {} }, { status: 500 });
  }
}
