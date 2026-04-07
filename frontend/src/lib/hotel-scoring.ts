// ---------------------------------------------------------------------------
// Hotel Scoring — AI batch scoring + heuristic fallback
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import type {
  MergedHotelResult,
  ScoredHotel,
  HotelStayGroup,
  TravelerHotelGroup,
  TravelerHotelSearchInput,
  StayWindow,
} from "./hotel-search";
import {
  searchHotelsForTravelers,
  mergeHotelOptions,
} from "./hotel-search";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Scoring Context
// ---------------------------------------------------------------------------

export interface HotelScoringContext {
  clientName: string;
  tripTitle: string;
  travelerCount: number;
  budgetCash?: number;

  preferences: {
    preferredHotelTypes?: string[];
    roomPreferences?: string[];
    locationPreferences?: string;
    budgetSensitivity?: string;
    redemptionStyle?: string;
  };

  loyaltyBalances: {
    programName: string;
    programCode: string;
    category: string;
    balance: number;
  }[];

  transferBonuses?: {
    fromProgram: string;
    toProgram: string;
    bonusPercent: number;
    endsAt: string;
  }[];

  transferPartners: Record<
    string,
    {
      name: string;
      hotelPartners: Record<string, { ratio: number; transferTime: string }>;
    }
  >;
}

// ---------------------------------------------------------------------------
// Scoring Weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  value: 0.25,
  location: 0.20,
  loyalty: 0.20,
  preference: 0.20,
  quality: 0.15,
} as const;

// ---------------------------------------------------------------------------
// AI Batch Scoring
// ---------------------------------------------------------------------------

interface AIScoringResult {
  hotelId: string;
  compositeScore: number;
  valueScore: number;
  locationScore: number;
  loyaltyScore: number;
  preferenceScore: number;
  qualityScore: number;
  rationale: string;
  paymentRecommendation: "points" | "cash" | "mixed";
  highlights: string[];
}

export async function scoreHotelsAI(
  hotels: MergedHotelResult[],
  context: HotelScoringContext,
  stayWindow: StayWindow,
): Promise<ScoredHotel[]> {
  if (!process.env.OPENAI_API_KEY || hotels.length === 0) {
    return scoreHotelsHeuristic(hotels, context);
  }

  const hotelSummaries = hotels.map((h, i) => ({
    index: i,
    hotelId: h.hotelId,
    name: h.name,
    cashPerNight: h.cashPerNight,
    cashTotal: h.cashTotal,
    starRating: h.starRating ?? "unknown",
    overallRating: h.overallRating ?? "unknown",
    neighborhood: h.neighborhood ?? "unknown",
    amenities: h.amenities.slice(0, 8),
    hasAward: !!h.awardOption,
    awardProgram: h.awardOption?.programDisplayName ?? null,
    pointsPerNight: h.awardOption?.pointsPerNight ?? null,
    pointsTotal: h.awardOption?.pointsTotal ?? null,
    surcharge: h.awardOption?.surcharge ?? null,
    cppValue: h.cppValue ?? null,
    transferSources: h.awardOption?.transferSources.map((s) => s.bankDisplayName) ?? [],
  }));

  const loyaltyBlock = context.loyaltyBalances.length > 0
    ? context.loyaltyBalances
        .map((b) => `${b.programName} (${b.programCode}): ${b.balance.toLocaleString()} pts`)
        .join("\n")
    : "None";

  const transferBlock = Object.entries(context.transferPartners)
    .map(([, bank]) => {
      const hotels = Object.entries(bank.hotelPartners)
        .map(([name, p]) => `${name} (${p.ratio}:1, ${p.transferTime})`)
        .join(", ");
      return `${bank.name}: ${hotels}`;
    })
    .join("\n");

  const bonusBlock = context.transferBonuses?.length
    ? context.transferBonuses
        .map((b) => `${b.fromProgram}→${b.toProgram}: +${b.bonusPercent}% (exp ${b.endsAt})`)
        .join("; ")
    : "None";

  const budgetPerNight = context.budgetCash && stayWindow.nights > 0
    ? Math.round(context.budgetCash / stayWindow.nights / context.travelerCount)
    : null;

  const prompt = `You are a luxury travel advisor scoring hotel options for a client.

TRIP CONTEXT:
- Client: ${context.clientName}
- Trip: ${context.tripTitle}
- Destination: ${stayWindow.destination}
- Dates: ${stayWindow.checkIn} to ${stayWindow.checkOut} (${stayWindow.nights} nights)
- Travelers: ${context.travelerCount}${context.budgetCash ? `\n- Budget: $${context.budgetCash.toLocaleString()} total` : ""}${budgetPerNight ? ` / ~$${budgetPerNight}/night` : ""}

CLIENT PREFERENCES:
- Hotel types: ${context.preferences.preferredHotelTypes?.join(", ") || "No preference"}
- Room preferences: ${context.preferences.roomPreferences?.join(", ") || "Standard"}
- Location preference: ${context.preferences.locationPreferences || "No preference"}
- Redemption style: ${context.preferences.redemptionStyle || "Balanced"}
- Budget sensitivity: ${context.preferences.budgetSensitivity || "Moderate"}

LOYALTY PORTFOLIO:
${loyaltyBlock}

TRANSFER PARTNERS:
${transferBlock}

ACTIVE TRANSFER BONUSES: ${bonusBlock}

HOTEL OPTIONS TO SCORE (${hotelSummaries.length} hotels):
${JSON.stringify(hotelSummaries, null, 1)}

SCORING DIMENSIONS (each 0-100):
- valueScore: Price vs. market average, CPP for awards (weight ${WEIGHTS.value})
- locationScore: Proximity to trip activities, neighborhood quality (weight ${WEIGHTS.location})
- loyaltyScore: Points value/CPP, transfer partner availability, elite benefits (weight ${WEIGHTS.loyalty})
- preferenceScore: Hotel type match, room/brand affinity (weight ${WEIGHTS.preference})
- qualityScore: Star rating, guest reviews, amenities (weight ${WEIGHTS.quality})

For each hotel, compute compositeScore = weighted average of the 5 sub-scores.

Return {"scoredHotels":[...]} where each element has: hotelId, compositeScore(0-100), valueScore(0-100), locationScore(0-100), loyaltyScore(0-100), preferenceScore(0-100), qualityScore(0-100), rationale(1-2 sentences), paymentRecommendation("points"|"cash"|"mixed"), highlights(2-3 key selling points as strings).`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 3072,
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const repaired = response.choices[0]?.finish_reason === "length" ? repairJson(raw) : raw;
    const parsed = JSON.parse(repaired);
    const aiResults: AIScoringResult[] = parsed.scoredHotels ?? [];

    const scoreMap = new Map<string, AIScoringResult>();
    for (const r of aiResults) {
      scoreMap.set(r.hotelId, r);
    }

    return hotels.map((hotel) => {
      const ai = scoreMap.get(hotel.hotelId);
      if (ai) {
        return {
          hotel,
          compositeScore: clampScore(ai.compositeScore),
          valueScore: clampScore(ai.valueScore),
          locationScore: clampScore(ai.locationScore),
          loyaltyScore: clampScore(ai.loyaltyScore),
          preferenceScore: clampScore(ai.preferenceScore),
          qualityScore: clampScore(ai.qualityScore),
          rationale: ai.rationale || "",
          paymentRecommendation: ai.paymentRecommendation || "cash",
          highlights: ai.highlights || [],
          cppValue: hotel.cppValue,
          estimatedSavings: computeSavings(hotel),
        };
      }
      return heuristicScoreSingle(hotel, context);
    });
  } catch (err) {
    console.error("AI hotel scoring failed, falling back to heuristic:", err);
    return scoreHotelsHeuristic(hotels, context);
  }
}

// ---------------------------------------------------------------------------
// Heuristic Scoring Fallback
// ---------------------------------------------------------------------------

export function scoreHotelsHeuristic(
  hotels: MergedHotelResult[],
  context: HotelScoringContext,
): ScoredHotel[] {
  return hotels.map((h) => heuristicScoreSingle(h, context));
}

function heuristicScoreSingle(
  hotel: MergedHotelResult,
  context: HotelScoringContext,
): ScoredHotel {
  // Value score: lower price relative to market = higher score
  const allPrices = [hotel.cashPerNight ?? 0];
  const avgPrice = hotel.cashPerNight ?? 200;
  let valueScore = 50;
  if (hotel.cashPerNight != null) {
    if (hotel.cashPerNight < avgPrice * 0.8) valueScore = 75;
    else if (hotel.cashPerNight < avgPrice) valueScore = 62;
    else if (hotel.cashPerNight > avgPrice * 1.5) valueScore = 30;
    else valueScore = 45;
  }
  if (hotel.cppValue && hotel.cppValue >= 1.5) valueScore = Math.min(100, valueScore + 15);
  else if (hotel.cppValue && hotel.cppValue >= 1.0) valueScore = Math.min(100, valueScore + 8);

  // Location score: based on neighborhood presence
  let locationScore = 50;
  if (hotel.neighborhood) locationScore = 60;

  // Loyalty score
  let loyaltyScore = 30;
  if (hotel.awardOption) {
    loyaltyScore = 55;
    const clientHasBalance = context.loyaltyBalances.some(
      (b) =>
        b.programName.toLowerCase().includes(hotel.awardOption!.program.toLowerCase()) ||
        hotel.awardOption!.programDisplayName.toLowerCase().includes(b.programName.toLowerCase()),
    );
    if (clientHasBalance) loyaltyScore = 75;
    if (hotel.cppValue && hotel.cppValue >= 1.5) loyaltyScore = Math.min(100, loyaltyScore + 15);
    if (hotel.awardOption.transferSources.length > 0) loyaltyScore = Math.min(100, loyaltyScore + 8);
  }

  // Preference score
  let preferenceScore = 50;
  const prefTypes = context.preferences.preferredHotelTypes?.map((t) => t.toLowerCase()) ?? [];
  const hotelNameLower = hotel.name.toLowerCase();
  for (const pt of prefTypes) {
    if (hotelNameLower.includes(pt) || pt.includes("luxury") && (hotel.starRating ?? 0) >= 5) {
      preferenceScore = 75;
      break;
    }
    if (pt.includes("boutique") && (hotel.starRating ?? 0) >= 4) {
      preferenceScore = 70;
      break;
    }
  }

  // Quality score
  let qualityScore = 50;
  if (hotel.starRating != null) {
    if (hotel.starRating >= 5) qualityScore = 85;
    else if (hotel.starRating >= 4) qualityScore = 70;
    else if (hotel.starRating >= 3) qualityScore = 55;
    else qualityScore = 35;
  }
  if (hotel.overallRating != null) {
    if (hotel.overallRating >= 4.5) qualityScore = Math.min(100, qualityScore + 12);
    else if (hotel.overallRating >= 4.0) qualityScore = Math.min(100, qualityScore + 6);
    else if (hotel.overallRating < 3.5) qualityScore = Math.max(0, qualityScore - 10);
  }

  const compositeScore = Math.round(
    WEIGHTS.value * valueScore +
    WEIGHTS.location * locationScore +
    WEIGHTS.loyalty * loyaltyScore +
    WEIGHTS.preference * preferenceScore +
    WEIGHTS.quality * qualityScore,
  );

  // Build rationale
  const highlights: string[] = [];
  if (hotel.starRating && hotel.starRating >= 4) highlights.push(`${hotel.starRating}-star property`);
  if (hotel.overallRating && hotel.overallRating >= 4.0) highlights.push(`${hotel.overallRating} guest rating`);
  if (hotel.cppValue && hotel.cppValue >= 1.0) highlights.push(`${hotel.cppValue.toFixed(1)} cpp award value`);
  if (hotel.neighborhood) highlights.push(hotel.neighborhood);
  if (hotel.amenities.length > 0) highlights.push(hotel.amenities.slice(0, 2).join(", "));

  let paymentRec: ScoredHotel["paymentRecommendation"] = "cash";
  if (hotel.awardOption && hotel.cppValue && hotel.cppValue >= 1.2) paymentRec = "points";
  else if (hotel.awardOption) paymentRec = "mixed";

  const rationale = buildHeuristicRationale(hotel, compositeScore, paymentRec);

  return {
    hotel,
    compositeScore: clampScore(compositeScore),
    valueScore: clampScore(valueScore),
    locationScore: clampScore(locationScore),
    loyaltyScore: clampScore(loyaltyScore),
    preferenceScore: clampScore(preferenceScore),
    qualityScore: clampScore(qualityScore),
    rationale,
    paymentRecommendation: paymentRec,
    highlights: highlights.slice(0, 3),
    cppValue: hotel.cppValue,
    estimatedSavings: computeSavings(hotel),
  };
}

function buildHeuristicRationale(
  hotel: MergedHotelResult,
  score: number,
  payRec: ScoredHotel["paymentRecommendation"],
): string {
  const parts: string[] = [];

  if (score >= 75) parts.push(`${hotel.name} is an excellent match`);
  else if (score >= 60) parts.push(`${hotel.name} is a solid option`);
  else parts.push(`${hotel.name} is worth considering`);

  if (hotel.starRating && hotel.starRating >= 4) {
    parts.push(`with ${hotel.starRating}-star quality`);
  }

  if (payRec === "points" && hotel.cppValue) {
    parts.push(`— book with points for ${hotel.cppValue.toFixed(1)} cpp value`);
  } else if (hotel.cashPerNight) {
    parts.push(`at $${hotel.cashPerNight}/night`);
  }

  return parts.join(" ") + ".";
}

// ---------------------------------------------------------------------------
// Top-level Orchestrator
// ---------------------------------------------------------------------------

export async function searchAndScoreHotelsForTravelers(
  travelers: TravelerHotelSearchInput[],
  context: HotelScoringContext,
): Promise<TravelerHotelGroup[]> {
  const rawGroups = await searchHotelsForTravelers(travelers);

  for (const group of rawGroups) {
    for (const stay of group.stays) {
      const stayWindow: StayWindow = {
        destination: stay.destination,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: stay.nights,
      };

      const merged = mergeHotelOptions(
        stay.cashOptions,
        stay.awardOptions,
        stayWindow,
        context.transferPartners,
      );

      if (merged.length === 0) continue;

      const scored = await scoreHotelsAI(merged, context, stayWindow);
      const sorted = scored.sort((a, b) => b.compositeScore - a.compositeScore);
      stay.scoredOptions = sorted.slice(0, 5);
    }
  }

  return rawGroups;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

function computeSavings(hotel: MergedHotelResult): number | undefined {
  if (!hotel.awardOption || !hotel.cashTotal) return undefined;
  const awardCash = hotel.awardOption.surcharge;
  return Math.max(0, hotel.cashTotal - awardCash);
}

function repairJson(raw: string): string {
  let s = raw.trim();
  if (!s) return "{}";

  const openBraces = (s.match(/{/g) || []).length;
  const closeBraces = (s.match(/}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/]/g) || []).length;

  if ((s.match(/"/g) || []).length % 2 !== 0) s += '"';

  const tail = s.slice(-1);
  if (tail === ":" || tail === ",") s += '""';

  for (let i = 0; i < openBrackets - closeBrackets; i++) s += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) s += "}";

  return s;
}
