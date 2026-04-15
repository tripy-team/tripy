import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const TPG_TRANSFER_BONUSES_URL =
  "https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/";

const BANK_NAME_MAP: Record<string, string> = {
  "chase ultimate rewards": "chase_ultimate_rewards",
  "chase": "chase_ultimate_rewards",
  "american express membership rewards": "amex_membership_rewards",
  "amex membership rewards": "amex_membership_rewards",
  "amex": "amex_membership_rewards",
  "citi thankyou points": "citi_thankyou",
  "citi thankyou rewards": "citi_thankyou",
  "citi thankyou": "citi_thankyou",
  "citi": "citi_thankyou",
  "capital one miles": "capital_one_miles",
  "capital one": "capital_one_miles",
  "bilt rewards": "bilt_rewards",
  "bilt": "bilt_rewards",
  "wells fargo rewards": "wells_fargo_rewards",
  "rove miles": "rove_miles",
  "rove": "rove_miles",
};

const PROGRAM_NAME_MAP: Record<string, string> = {
  "united mileageplus": "united_mileageplus",
  "united": "united_mileageplus",
  "american aadvantage": "american_aadvantage",
  "american airlines": "american_aadvantage",
  "delta skymiles": "delta_skymiles",
  "delta": "delta_skymiles",
  "southwest rapid rewards": "southwest_rapid_rewards",
  "southwest": "southwest_rapid_rewards",
  "jetblue trueblue": "jetblue_trueblue",
  "jetblue": "jetblue_trueblue",
  "alaska mileage plan": "alaska_mileage_plan",
  "alaska": "alaska_mileage_plan",
  "british airways executive club": "british_airways_avios",
  "british airways": "british_airways_avios",
  "avios": "british_airways_avios",
  "air france-klm flying blue": "flying_blue",
  "flying blue": "flying_blue",
  "virgin atlantic flying club": "virgin_atlantic",
  "virgin atlantic": "virgin_atlantic",
  "singapore krisflyer": "singapore_krisflyer",
  "singapore airlines": "singapore_krisflyer",
  "cathay pacific asia miles": "cathay_pacific",
  "cathay pacific": "cathay_pacific",
  "ana mileage club": "ana_mileage_club",
  "ana": "ana_mileage_club",
  "emirates skywards": "emirates_skywards",
  "emirates": "emirates_skywards",
  "qatar airways privilege club": "qatar_privilege_club",
  "qatar": "qatar_privilege_club",
  "turkish airlines miles&smiles": "turkish_milesandsmiles",
  "turkish airlines": "turkish_milesandsmiles",
  "avianca lifemiles": "avianca_lifemiles",
  "avianca": "avianca_lifemiles",
  "aeroplan": "aeroplan",
  "air canada aeroplan": "aeroplan",
  "marriott bonvoy": "marriott_bonvoy",
  "marriott": "marriott_bonvoy",
  "hilton honors": "hilton_honors",
  "hilton": "hilton_honors",
  "world of hyatt": "hyatt",
  "hyatt": "hyatt",
  "ihg one rewards": "ihg_rewards",
  "ihg": "ihg_rewards",
  "etihad guest": "etihad_guest",
  "etihad": "etihad_guest",
  "qantas frequent flyer": "qantas_frequent_flyer",
  "qantas": "qantas_frequent_flyer",
  "japan airlines mileage bank": "jal_mileage_bank",
  "japan airlines": "jal_mileage_bank",
  "jal mileage bank": "jal_mileage_bank",
  "jal": "jal_mileage_bank",
  "sas eurobonus": "sas_eurobonus",
  "sas": "sas_eurobonus",
  "lufthansa miles & more": "lufthansa_miles_and_more",
  "miles & more": "lufthansa_miles_and_more",
};

function normalizeBank(raw: string): string | null {
  const cleaned = raw.replace(/[®™℠]/g, "").trim().toLowerCase();
  if (BANK_NAME_MAP[cleaned]) return BANK_NAME_MAP[cleaned];
  for (const [key, code] of Object.entries(BANK_NAME_MAP)) {
    if (cleaned.includes(key) || key.includes(cleaned)) return code;
  }
  return null;
}

function normalizeProgram(raw: string): string | null {
  const cleaned = raw
    .replace(/[®™℠]/g, "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (PROGRAM_NAME_MAP[cleaned]) return PROGRAM_NAME_MAP[cleaned];
  for (const [key, code] of Object.entries(PROGRAM_NAME_MAP)) {
    if (cleaned.includes(key) || key.includes(cleaned)) return code;
  }
  return null;
}

function parseBonusPct(raw: string): number | null {
  const m = raw.match(/(\d+)\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

function parseDate(raw: string): Date | null {
  const cleaned = raw.trim().replace(/\.$/, "");
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    // TPG only lists month/day (no year). Always pin to the current year —
    // per spec, any resulting date before today is treated as outdated and
    // rejected downstream rather than rolled into next year.
    if (!/\d{4}/.test(cleaned)) {
      d.setFullYear(new Date().getFullYear());
    }
    return d;
  }
  const withYear = `${cleaned}, ${new Date().getFullYear()}`;
  const d2 = new Date(withYear);
  if (!isNaN(d2.getTime())) return d2;
  return null;
}

interface ScrapedBonus {
  fromProgramCode: string;
  toProgramCode: string;
  bonusPercent: number;
  startsAt: Date | null;
  endsAt: Date | null;
  fromDisplay: string;
  toDisplay: string;
}

function parseTPGHtml(html: string): ScrapedBonus[] {
  const results: ScrapedBonus[] = [];

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];

    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length < 2) continue;

    const headers = rows[0].map((h) => h.toLowerCase());
    const hasFrom = headers.some(
      (h) => h.includes("from") || h.includes("transfer from") || h.includes("bank"),
    );
    const hasTo = headers.some(
      (h) => h.includes("to") || h.includes("transfer to") || h.includes("partner"),
    );
    const hasBonus = headers.some(
      (h) => h.includes("bonus") || h.includes("percent"),
    );

    if (!hasFrom || !hasTo || !hasBonus) continue;

    const colFrom = headers.findIndex(
      (h) => h.includes("from") || h.includes("bank"),
    );
    const colTo = headers.findIndex(
      (h) => h.includes("to") || h.includes("partner"),
    );
    const colBonus = headers.findIndex(
      (h) => h.includes("bonus") || h.includes("percent"),
    );
    const colStart = headers.findIndex((h) => h.includes("start"));
    const colEnd = headers.findIndex(
      (h) => h.includes("end") || h.includes("expir"),
    );

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.length < 3) continue;

      const rawFrom = cells[colFrom] ?? "";
      const rawTo = cells[colTo] ?? "";
      const rawBonus = cells[colBonus] ?? "";

      const fromCode = normalizeBank(rawFrom);
      const toCode = normalizeProgram(rawTo);
      const pct = parseBonusPct(rawBonus);

      if (!fromCode || !toCode || pct === null) continue;

      const startsAt =
        colStart >= 0 && cells[colStart] ? parseDate(cells[colStart]) : null;
      const endsAt =
        colEnd >= 0 && cells[colEnd] ? parseDate(cells[colEnd]) : null;

      results.push({
        fromProgramCode: fromCode,
        toProgramCode: toCode,
        bonusPercent: pct,
        startsAt,
        endsAt,
        fromDisplay: rawFrom,
        toDisplay: rawTo,
      });
    }
  }

  return results;
}

const HOTEL_CODES = ["marriott", "hilton", "hyatt", "ihg"];
const BANK_CODES = ["chase", "amex", "citi", "capital", "bilt", "wells", "rove"];

async function findOrCreateProgram(code: string, name: string) {
  let program = await prisma.loyaltyProgram.findUnique({ where: { code } });
  if (!program) {
    const isHotel = HOTEL_CODES.some((h) => code.includes(h));
    const isBank = BANK_CODES.some((b) => code.includes(b));
    program = await prisma.loyaltyProgram.create({
      data: {
        code,
        name,
        category: isHotel ? "hotel" : isBank ? "transferable_bank" : "airline",
        supportsTransfer: true,
      },
    });
  }
  return program;
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Admin access required", 403);

    const res = await fetch(TPG_TRANSFER_BONUSES_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      return errorResponse(`Failed to fetch TPG page: ${res.status}`, 502);
    }

    const html = await res.text();
    const scraped = parseTPGHtml(html);

    const now = new Date();
    const maxEndsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    let synced = 0;
    let skipped = 0;
    let rejected = 0;
    const keepIds: string[] = [];

    const validBonuses = scraped.filter((b) => {
      if (!b.endsAt) {
        rejected++;
        return false;
      }
      if (b.endsAt.getTime() < now.getTime()) {
        rejected++;
        return false;
      }
      if (b.endsAt.getTime() > maxEndsAt.getTime()) {
        rejected++;
        return false;
      }
      if (b.startsAt && b.startsAt.getTime() > maxEndsAt.getTime()) {
        rejected++;
        return false;
      }
      return true;
    });

    for (const bonus of validBonuses) {
      const fromProgram = await findOrCreateProgram(
        bonus.fromProgramCode,
        bonus.fromDisplay,
      );
      const toProgram = await findOrCreateProgram(
        bonus.toProgramCode,
        bonus.toDisplay,
      );

      const startsAt = bonus.startsAt ?? now;
      const endsAt = bonus.endsAt!;

      const existing = await prisma.transferBonus.findFirst({
        where: {
          fromProgramId: fromProgram.id,
          toProgramId: toProgram.id,
          bonusPercent: bonus.bonusPercent,
          isActive: true,
        },
      });

      if (existing) {
        // Update end date in case it changed, and keep it active
        await prisma.transferBonus.update({
          where: { id: existing.id },
          data: { endsAt },
        });
        keepIds.push(existing.id);
        skipped++;
        continue;
      }

      const created = await prisma.transferBonus.create({
        data: {
          fromProgramId: fromProgram.id,
          toProgramId: toProgram.id,
          bonusPercent: bonus.bonusPercent,
          startsAt,
          endsAt,
          sourceUrl: TPG_TRANSFER_BONUSES_URL,
          sourceLabel: "The Points Guy",
          isActive: true,
        },
      });
      keepIds.push(created.id);
      synced++;
    }

    // Deactivate any bonuses that are no longer on the current TPG page,
    // or that are expired / more than a year from now.
    const deactivated = await prisma.transferBonus.updateMany({
      where: {
        isActive: true,
        OR: [
          { id: { notIn: keepIds } },
          { endsAt: { lt: now } },
          { endsAt: { gt: maxEndsAt } },
        ],
      },
      data: { isActive: false },
    });

    return json({
      success: true,
      scraped: scraped.length,
      validated: validBonuses.length,
      rejected,
      synced,
      skipped,
      deactivated: deactivated.count,
      message: `Scraped ${scraped.length} bonuses from TPG (${rejected} rejected as past/>1yr). ${synced} new, ${skipped} already existed, ${deactivated.count} stale removed.`,
    });
  } catch (error) {
    console.error("TPG scrape error:", error);
    return errorResponse("Failed to scrape transfer bonuses", 500);
  }
}
