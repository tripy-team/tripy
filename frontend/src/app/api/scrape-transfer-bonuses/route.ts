import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const TPG_TRANSFER_BONUSES_URL =
  "https://thepointsguy.com/loyalty-programs/transfer-bonuses/";

const BANK_NAME_MAP: Record<string, string> = {
  "chase ultimate rewards": "chase_ultimate_rewards",
  "chase": "chase_ultimate_rewards",
  "american express membership rewards": "amex_membership_rewards",
  "amex membership rewards": "amex_membership_rewards",
  "amex": "amex_membership_rewards",
  "citi thankyou points": "citi_thankyou",
  "citi thankyou": "citi_thankyou",
  "citi": "citi_thankyou",
  "capital one miles": "capital_one_miles",
  "capital one": "capital_one_miles",
  "bilt rewards": "bilt_rewards",
  "bilt": "bilt_rewards",
  "wells fargo rewards": "wells_fargo_rewards",
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
  return isNaN(d.getTime()) ? null : d;
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

async function findOrCreateProgram(code: string, name: string) {
  let program = await prisma.loyaltyProgram.findUnique({ where: { code } });
  if (!program) {
    program = await prisma.loyaltyProgram.create({
      data: {
        code,
        name,
        category: code.includes("hotel") || code.includes("marriott") || code.includes("hilton") || code.includes("hyatt") || code.includes("ihg")
          ? "hotel"
          : code.includes("chase") || code.includes("amex") || code.includes("citi") || code.includes("capital") || code.includes("bilt") || code.includes("wells")
            ? "transferable_bank"
            : "airline",
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

    let synced = 0;
    let skipped = 0;

    for (const bonus of scraped) {
      const fromProgram = await findOrCreateProgram(
        bonus.fromProgramCode,
        bonus.fromDisplay,
      );
      const toProgram = await findOrCreateProgram(
        bonus.toProgramCode,
        bonus.toDisplay,
      );

      const now = new Date();
      const startsAt = bonus.startsAt ?? now;
      const endsAt =
        bonus.endsAt ?? new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      const existing = await prisma.transferBonus.findFirst({
        where: {
          fromProgramId: fromProgram.id,
          toProgramId: toProgram.id,
          bonusPercent: bonus.bonusPercent,
          isActive: true,
          endsAt: { gte: now },
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.transferBonus.create({
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
      synced++;
    }

    return json({
      success: true,
      scraped: scraped.length,
      synced,
      skipped,
      message: `Scraped ${scraped.length} bonuses from TPG. ${synced} new, ${skipped} already existed.`,
    });
  } catch (error) {
    console.error("TPG scrape error:", error);
    return errorResponse("Failed to scrape transfer bonuses", 500);
  }
}
