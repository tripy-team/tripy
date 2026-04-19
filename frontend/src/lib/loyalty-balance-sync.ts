import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Aliases the Cactus extraction engine emits in `loyaltyNotes` (see
// backend/cactus_server/prompts.py). Each entry maps one of the short
// program labels the advisor's AI produces to the canonical
// `LoyaltyProgram.code` in the database seed.
const PROGRAM_CODE_ALIASES: Record<string, string> = {
  // Transferable bank points
  "chase ur": "chase_ultimate_rewards",
  "chase ultimate rewards": "chase_ultimate_rewards",
  "chase": "chase_ultimate_rewards",
  "amex mr": "amex_membership_rewards",
  "amex membership rewards": "amex_membership_rewards",
  "amex": "amex_membership_rewards",
  "membership rewards": "amex_membership_rewards",
  "citi ty": "citi_thankyou",
  "citi thankyou": "citi_thankyou",
  "thankyou": "citi_thankyou",
  "capital one": "capital_one_miles",
  "capital one miles": "capital_one_miles",
  "venture": "capital_one_miles",
  "bilt": "bilt_rewards",
  "bilt rewards": "bilt_rewards",
  // Airlines
  "united": "united_mileageplus",
  "united mileageplus": "united_mileageplus",
  "united miles": "united_mileageplus",
  "delta": "delta_skymiles",
  "delta skymiles": "delta_skymiles",
  "american": "american_aadvantage",
  "american aadvantage": "american_aadvantage",
  "aadvantage": "american_aadvantage",
  "southwest": "southwest_rapid_rewards",
  "southwest rapid rewards": "southwest_rapid_rewards",
  "alaska": "alaska_mileage_plan",
  "alaska mileage plan": "alaska_mileage_plan",
  "flying blue": "flying_blue",
  "aeroplan": "aeroplan",
  // Hotels
  "hyatt": "hyatt_world_of_hyatt",
  "world of hyatt": "hyatt_world_of_hyatt",
  "marriott": "marriott_bonvoy",
  "marriott bonvoy": "marriott_bonvoy",
  "bonvoy": "marriott_bonvoy",
  "hilton": "hilton_honors",
  "hilton honors": "hilton_honors",
  "ihg": "ihg_rewards",
  "ihg rewards": "ihg_rewards",
};

export interface ParsedBalance {
  programCode: string;
  balance: number;
  raw: string;
}

/**
 * Parse a loyaltyNotes string like
 * "Chase UR: 300k; Amex MR: 500k; Hyatt: Globalist status"
 * into structured {programCode, balance} pairs. Non-numeric entries
 * (e.g. elite-status mentions) are skipped — those belong in
 * loyaltyNotes, not the numeric balances table.
 */
export function parseLoyaltyNotes(notes: unknown): ParsedBalance[] {
  if (typeof notes !== "string" || !notes.trim()) return [];
  const segments = notes
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const results: ParsedBalance[] = [];
  for (const segment of segments) {
    const match = segment.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const programRaw = match[1].trim().toLowerCase();
    const valueRaw = match[2].trim();
    const programCode = PROGRAM_CODE_ALIASES[programRaw];
    if (!programCode) continue;
    const balance = parsePointsAmount(valueRaw);
    if (balance == null) continue;
    results.push({ programCode, balance, raw: segment });
  }
  return results;
}

// Accepts forms like "300k", "1.5M", "500000", "100k miles", "~500k".
function parsePointsAmount(raw: string): number | null {
  const cleaned = raw.replace(/[~,]/g, "").trim().toLowerCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([kmb])?/);
  if (!match) return null;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2];
  const multiplier =
    suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

/**
 * Take loyaltyNotes extracted during a live call and upsert matching
 * rows into ClientLoyaltyBalance so the Balances UI reflects the new
 * points. Only creates/updates balances for programs we can
 * confidently resolve from the aliases above; unmatched programs stay
 * in loyaltyNotes as free text.
 *
 * Returns the number of balance rows that were created or updated.
 */
export async function syncLoyaltyBalancesFromNotes(
  clientId: string,
  notes: unknown,
  changedByUserId: string,
  changeReason: string,
): Promise<number> {
  const parsed = parseLoyaltyNotes(notes);
  if (parsed.length === 0) return 0;

  const programs = await prisma.loyaltyProgram.findMany({
    where: { code: { in: parsed.map((p) => p.programCode) } },
    select: { id: true, code: true },
  });
  const byCode = new Map(programs.map((p) => [p.code, p.id]));

  let touched = 0;
  for (const p of parsed) {
    const loyaltyProgramId = byCode.get(p.programCode);
    if (!loyaltyProgramId) continue;

    const existing = await prisma.clientLoyaltyBalance.findFirst({
      where: { clientId, loyaltyProgramId },
    });

    if (existing) {
      if (existing.balance === p.balance) continue;
      const previousBalance = existing.balance;
      await prisma.$transaction([
        prisma.clientLoyaltyBalance.update({
          where: { id: existing.id },
          data: {
            balance: p.balance,
            source: "estimated",
            lastVerifiedAt: new Date(),
          },
        }),
        prisma.balanceLedgerEntry.create({
          data: {
            clientLoyaltyBalanceId: existing.id,
            previousBalance,
            newBalance: p.balance,
            changeReason,
            changedByUserId,
          },
        }),
      ]);
    } else {
      const created = await prisma.clientLoyaltyBalance.create({
        data: {
          clientId,
          loyaltyProgramId,
          balance: p.balance,
          source: "estimated",
          lastVerifiedAt: new Date(),
        } satisfies Prisma.ClientLoyaltyBalanceUncheckedCreateInput,
      });
      await prisma.balanceLedgerEntry.create({
        data: {
          clientLoyaltyBalanceId: created.id,
          previousBalance: 0,
          newBalance: p.balance,
          changeReason,
          changedByUserId,
        },
      });
    }
    touched += 1;
  }
  return touched;
}
