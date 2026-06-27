import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const TPG_TRANSFER_BONUSES_URL =
  "https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/";
const NERDWALLET_TRANSFER_BONUSES_URL =
  "https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses";

interface BonusSource {
  url: string;
  label: string;
}

const BONUS_SOURCES: BonusSource[] = [
  { url: TPG_TRANSFER_BONUSES_URL, label: "The Points Guy" },
  { url: NERDWALLET_TRANSFER_BONUSES_URL, label: "NerdWallet" },
];

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

// The transfer SOURCE (the "transfer from" column) was historically banks only.
// Hotel and airline programs can now also be a source (e.g. a Marriott -> airline
// bonus), so try the bank map first, then fall back to the general program map.
function normalizeSource(raw: string): string | null {
  return normalizeBank(raw) ?? normalizeProgram(raw);
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
  sourceLabel: string;
  sourceUrl: string;
}

function parseBonusHtml(
  html: string,
  sourceLabel: string,
  sourceUrl: string,
): ScrapedBonus[] {
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

      // SOURCE may be a bank, hotel, or airline (not bank-only anymore).
      const fromCode = normalizeSource(rawFrom);
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
        sourceLabel,
        sourceUrl,
      });
    }
  }

  return results;
}

const HOTEL_CODES = ["marriott", "hilton", "hyatt", "ihg"];
const BANK_CODES = ["chase", "amex", "citi", "capital", "bilt", "wells", "rove"];

interface ReconciledBonus {
  fromProgramCode: string;
  toProgramCode: string;
  bonusPercent: number;
  startsAt: Date | null;
  endsAt: Date | null;
  fromDisplay: string;
  toDisplay: string;
  sourceLabel: string; // joined labels that agreed
  sourceUrl: string;
  confidence: "high" | "single";
  needsReview: boolean;
}

/**
 * Cross-source reconciliation. Groups scraped rows by (from, to):
 *  - >=2 distinct sources agree on the same bonus % -> confidence "high"
 *  - only one source reports it -> confidence "single" (still trusted; the
 *    other source simply may not list every promo)
 *  - sources report DIFFERENT % for the same pair -> needsReview, kept inactive
 *    until a human resolves the conflict.
 */
function reconcile(rows: ScrapedBonus[]): ReconciledBonus[] {
  const groups = new Map<string, ScrapedBonus[]>();
  for (const r of rows) {
    const key = `${r.fromProgramCode}|${r.toProgramCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const out: ReconciledBonus[] = [];
  for (const group of groups.values()) {
    // Map each distinct % -> set of source labels reporting it.
    const pctToSources = new Map<number, Set<string>>();
    for (const r of group) {
      if (!pctToSources.has(r.bonusPercent))
        pctToSources.set(r.bonusPercent, new Set());
      pctToSources.get(r.bonusPercent)!.add(r.sourceLabel);
    }

    const distinctPcts = [...pctToSources.keys()];
    // Choose the % backed by the most distinct sources (majority vote).
    const chosenPct = distinctPcts.sort(
      (a, b) => pctToSources.get(b)!.size - pctToSources.get(a)!.size,
    )[0];
    const agreeingSources = pctToSources.get(chosenPct)!;
    const conflict = distinctPcts.length > 1;

    const matching = group.filter((r) => r.bonusPercent === chosenPct);
    const starts = matching
      .map((r) => r.startsAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    const ends = matching
      .map((r) => r.endsAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    out.push({
      fromProgramCode: matching[0].fromProgramCode,
      toProgramCode: matching[0].toProgramCode,
      bonusPercent: chosenPct,
      startsAt: starts[0] ?? null,
      endsAt: ends[0] ?? null,
      fromDisplay: matching[0].fromDisplay,
      toDisplay: matching[0].toDisplay,
      sourceLabel: [...agreeingSources].join(", "),
      sourceUrl: matching[0].sourceUrl,
      confidence: agreeingSources.size >= 2 ? "high" : "single",
      needsReview: conflict,
    });
  }
  return out;
}

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

    // Fetch every source in parallel; tolerate individual source failures so a
    // single flaky page doesn't abort the whole refresh.
    const perSource = await Promise.all(
      BONUS_SOURCES.map(async (src) => {
        try {
          const res = await fetch(src.url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (!res.ok) {
            console.warn(`Bonus source ${src.label} returned ${res.status}`);
            return [] as ScrapedBonus[];
          }
          const html = await res.text();
          return parseBonusHtml(html, src.label, src.url);
        } catch (e) {
          console.warn(`Bonus source ${src.label} failed:`, e);
          return [] as ScrapedBonus[];
        }
      }),
    );

    const scraped = perSource.flat();
    if (scraped.length === 0) {
      return errorResponse("All transfer-bonus sources failed", 502);
    }

    // Cross-source reconciliation (TPG + NerdWallet).
    const reconciled = reconcile(scraped);

    const now = new Date();
    const maxEndsAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    let synced = 0;
    let skipped = 0;
    let rejected = 0;
    const keepIds: string[] = [];

    let needsReviewCount = 0;

    const validBonuses = reconciled.filter((b) => {
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
      // Conflicting sources -> keep inactive and flag for admin review.
      const isActive = !bonus.needsReview;
      if (bonus.needsReview) needsReviewCount++;

      const existing = await prisma.transferBonus.findFirst({
        where: {
          fromProgramId: fromProgram.id,
          toProgramId: toProgram.id,
          bonusPercent: bonus.bonusPercent,
          // Don't clobber a manual/admin override with scraped data.
          confidence: { not: "manual" },
        },
      });

      if (existing) {
        // Update end date / provenance in case it changed, and keep it active
        await prisma.transferBonus.update({
          where: { id: existing.id },
          data: {
            endsAt,
            sourceUrl: bonus.sourceUrl,
            sourceLabel: bonus.sourceLabel,
            confidence: bonus.confidence,
            needsReview: bonus.needsReview,
            isActive,
          },
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
          sourceUrl: bonus.sourceUrl,
          sourceLabel: bonus.sourceLabel,
          confidence: bonus.confidence,
          needsReview: bonus.needsReview,
          isActive,
        },
      });
      keepIds.push(created.id);
      synced++;
    }

    // Deactivate any bonuses no longer on the current source pages, or that are
    // expired / more than a year out. Manual/admin overrides are NEVER touched.
    const deactivated = await prisma.transferBonus.updateMany({
      where: {
        isActive: true,
        confidence: { not: "manual" },
        OR: [
          { id: { notIn: keepIds } },
          { endsAt: { lt: now } },
          { endsAt: { gt: maxEndsAt } },
        ],
      },
      data: { isActive: false },
    });

    const sourcesUsed = BONUS_SOURCES.map((s) => s.label).join(" + ");
    return json({
      success: true,
      scraped: scraped.length,
      reconciled: reconciled.length,
      validated: validBonuses.length,
      rejected,
      synced,
      skipped,
      needsReview: needsReviewCount,
      deactivated: deactivated.count,
      message: `Scraped ${scraped.length} rows from ${sourcesUsed} -> ${reconciled.length} reconciled (${rejected} rejected as past/>1yr, ${needsReviewCount} flagged for review). ${synced} new, ${skipped} updated, ${deactivated.count} stale removed.`,
    });
  } catch (error) {
    console.error("Transfer-bonus scrape error:", error);
    return errorResponse("Failed to scrape transfer bonuses", 500);
  }
}
