// ---------------------------------------------------------------------------
// Transport Scoring — AI batch scoring + heuristic fallback
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import type {
  TransportOption,
  ScoredTransportOption,
  TransportSegment,
  TransportLeg,
  TravelerTransportGroup,
  TransportSearchInput,
} from "./transport-search";
import { searchTransportForTravelers } from "./transport-search";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Scoring Context
// ---------------------------------------------------------------------------

export interface TransportScoringContext {
  clientName: string;
  tripTitle: string;
  travelerCount: number;
  budgetCash?: number;
  preferences?: {
    budgetSensitivity?: string;
    redemptionStyle?: string;
    notes?: string;
  };
}

// ---------------------------------------------------------------------------
// Scoring Weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  cost: 0.30,
  time: 0.25,
  comfort: 0.20,
  convenience: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Comfort factor by mode (used in heuristic fallback)
// ---------------------------------------------------------------------------

const MODE_COMFORT: Record<string, number> = {
  flight: 70,
  train: 80,
  ferry: 65,
  bus: 40,
  rideshare: 60,
  driving: 55,
  shuttle: 50,
  walk: 30,
};

// ---------------------------------------------------------------------------
// AI Batch Scoring
// ---------------------------------------------------------------------------

interface AITransportScore {
  index: number;
  compositeScore: number;
  costScore: number;
  timeScore: number;
  comfortScore: number;
  convenienceScore: number;
  rationale: string;
  recommendation: "best_value" | "fastest" | "most_comfortable" | "budget" | null;
}

async function scoreOptionsAI(
  options: TransportOption[],
  leg: TransportLeg,
  context: TransportScoringContext,
): Promise<ScoredTransportOption[]> {
  if (!process.env.OPENAI_API_KEY || options.length === 0) {
    return scoreOptionsHeuristic(options);
  }

  const optionSummaries = options.map((o, i) => ({
    index: i,
    mode: o.mode,
    provider: o.provider,
    durationMinutes: o.durationMinutes,
    price: o.price,
    priceRange: o.priceRange ?? null,
    stops: o.stops,
    co2Kg: o.co2Kg ?? null,
    source: o.source,
  }));

  const prompt = `You are a travel advisor scoring transportation options for the best way to travel between two destinations. Consider total cost, travel time, comfort, and convenience.

TRIP CONTEXT:
- Client: ${context.clientName}
- Trip: ${context.tripTitle}
- Leg: ${leg.origin} → ${leg.destination} on ${leg.date}
- Travelers: ${context.travelerCount}${context.budgetCash ? `\n- Total trip budget: $${context.budgetCash.toLocaleString()}` : ""}${context.preferences?.budgetSensitivity ? `\n- Budget sensitivity: ${context.preferences.budgetSensitivity}` : ""}${context.preferences?.notes ? `\n- Notes: ${context.preferences.notes}` : ""}

TRANSPORT OPTIONS (${optionSummaries.length}):
${JSON.stringify(optionSummaries, null, 1)}

SCORING DIMENSIONS (each 0-100):
- costScore: Lower price = higher score, consider value for money (weight ${WEIGHTS.cost})
- timeScore: Shorter total travel time = higher score (weight ${WEIGHTS.time})
- comfortScore: Mode quality (first-class train > bus), fewer stops = more comfort (weight ${WEIGHTS.comfort})
- convenienceScore: Ease of booking, flexibility, luggage, door-to-door convenience (weight ${WEIGHTS.convenience})

For each option, compute compositeScore = weighted average of the 4 sub-scores.
Also assign a recommendation tag to the single best option in each category: "best_value" (best price-to-quality), "fastest", "most_comfortable", "budget" (cheapest). Only one option per tag. All others get null.

Return {"scoredOptions":[...]} where each element has: index(number matching input), compositeScore(0-100), costScore(0-100), timeScore(0-100), comfortScore(0-100), convenienceScore(0-100), rationale(1-2 sentences explaining why this option stands out or falls short), recommendation("best_value"|"fastest"|"most_comfortable"|"budget"|null).`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 2048,
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const repaired = response.choices[0]?.finish_reason === "length" ? repairJson(raw) : raw;
    const parsed = JSON.parse(repaired);
    const aiResults: AITransportScore[] = parsed.scoredOptions ?? [];

    const scoreMap = new Map<number, AITransportScore>();
    for (const r of aiResults) {
      scoreMap.set(r.index, r);
    }

    return options.map((opt, i) => {
      const ai = scoreMap.get(i);
      if (ai) {
        return {
          ...opt,
          compositeScore: clampScore(ai.compositeScore),
          costScore: clampScore(ai.costScore),
          timeScore: clampScore(ai.timeScore),
          comfortScore: clampScore(ai.comfortScore),
          convenienceScore: clampScore(ai.convenienceScore),
          rationale: ai.rationale || "",
          recommendation: ai.recommendation,
        };
      }
      return heuristicScoreSingle(opt, options);
    });
  } catch (err) {
    console.error("AI transport scoring failed, falling back to heuristic:", err);
    return scoreOptionsHeuristic(options);
  }
}

// ---------------------------------------------------------------------------
// Heuristic Scoring Fallback
// ---------------------------------------------------------------------------

function scoreOptionsHeuristic(options: TransportOption[]): ScoredTransportOption[] {
  const scored = options.map((opt) => heuristicScoreSingle(opt, options));
  assignRecommendationTags(scored);
  return scored;
}

function heuristicScoreSingle(
  opt: TransportOption,
  allOptions: TransportOption[],
): ScoredTransportOption {
  const prices = allOptions.filter((o) => o.price > 0).map((o) => o.price);
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 1;
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;

  const durations = allOptions.filter((o) => o.durationMinutes > 0).map((o) => o.durationMinutes);
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 1;

  let costScore = 50;
  if (opt.price > 0 && maxPrice > minPrice) {
    costScore = Math.round((1 - (opt.price - minPrice) / (maxPrice - minPrice)) * 80 + 10);
  } else if (opt.price === 0) {
    costScore = 90;
  }

  let timeScore = 50;
  if (opt.durationMinutes > 0 && maxDuration > 0) {
    timeScore = Math.round((1 - opt.durationMinutes / maxDuration) * 80 + 10);
  }

  const comfortScore = MODE_COMFORT[opt.mode] ?? 50;

  let convenienceScore = 60;
  if (opt.stops === 0) convenienceScore += 15;
  else convenienceScore -= opt.stops * 8;
  if (opt.mode === "rideshare" || opt.mode === "driving") convenienceScore += 10;
  if (opt.bookingUrl) convenienceScore += 5;
  convenienceScore = Math.min(100, Math.max(0, convenienceScore));

  const compositeScore = Math.round(
    WEIGHTS.cost * costScore +
    WEIGHTS.time * timeScore +
    WEIGHTS.comfort * comfortScore +
    WEIGHTS.convenience * convenienceScore,
  );

  const rationale = buildHeuristicRationale(opt, compositeScore);

  return {
    ...opt,
    compositeScore: clampScore(compositeScore),
    costScore: clampScore(costScore),
    timeScore: clampScore(timeScore),
    comfortScore: clampScore(comfortScore),
    convenienceScore: clampScore(convenienceScore),
    rationale,
    recommendation: null,
  };
}

function assignRecommendationTags(scored: ScoredTransportOption[]): void {
  if (scored.length === 0) return;

  const usedIndices = new Set<number>();

  const cheapest = scored.reduce((best, s, i) =>
    s.price > 0 && (best === -1 || s.price < scored[best].price) ? i : best, -1);
  if (cheapest >= 0) {
    scored[cheapest].recommendation = "budget";
    usedIndices.add(cheapest);
  }

  const fastest = scored.reduce((best, s, i) =>
    !usedIndices.has(i) && s.durationMinutes > 0 &&
    (best === -1 || s.durationMinutes < scored[best].durationMinutes) ? i : best, -1);
  if (fastest >= 0) {
    scored[fastest].recommendation = "fastest";
    usedIndices.add(fastest);
  }

  const mostComfy = scored.reduce((best, s, i) =>
    !usedIndices.has(i) && (best === -1 || s.comfortScore > scored[best].comfortScore) ? i : best, -1);
  if (mostComfy >= 0) {
    scored[mostComfy].recommendation = "most_comfortable";
    usedIndices.add(mostComfy);
  }

  const bestValue = scored.reduce((best, s, i) =>
    !usedIndices.has(i) && (best === -1 || s.compositeScore > scored[best].compositeScore) ? i : best, -1);
  if (bestValue >= 0) {
    scored[bestValue].recommendation = "best_value";
  }
}

function buildHeuristicRationale(opt: TransportOption, score: number): string {
  const parts: string[] = [];
  const modeLabel = opt.mode.charAt(0).toUpperCase() + opt.mode.slice(1);

  if (score >= 70) parts.push(`${modeLabel} via ${opt.provider} is a strong option`);
  else if (score >= 50) parts.push(`${modeLabel} via ${opt.provider} is a reasonable choice`);
  else parts.push(`${modeLabel} via ${opt.provider} is available`);

  if (opt.price > 0) parts.push(`at ~$${opt.price.toLocaleString()}`);

  if (opt.durationMinutes > 0) {
    const hrs = Math.floor(opt.durationMinutes / 60);
    const mins = opt.durationMinutes % 60;
    const timeStr = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ""}` : `${mins}m`;
    parts.push(`(${timeStr})`);
  }

  return parts.join(" ") + ".";
}

// ---------------------------------------------------------------------------
// Top-level Orchestrator: search + score all transport for a trip
// ---------------------------------------------------------------------------

export async function searchAndScoreTransportForTravelers(
  travelers: TransportSearchInput[],
  departureDate: string,
  returnDate: string | undefined,
  context: TransportScoringContext,
  cabinClass?: string,
): Promise<TravelerTransportGroup[]> {
  const { legs, optionsByLeg } = await searchTransportForTravelers(
    travelers,
    departureDate,
    returnDate,
    cabinClass,
  );

  if (legs.length === 0) return [];

  const scoredByLeg: ScoredTransportOption[][] = await Promise.all(
    legs.map((leg, i) =>
      scoreOptionsAI(optionsByLeg[i] ?? [], leg, context).catch((err) => {
        console.error(`Scoring failed for leg ${leg.origin}→${leg.destination}:`, err);
        return scoreOptionsHeuristic(optionsByLeg[i] ?? []);
      }),
    ),
  );

  const segments: TransportSegment[] = legs.map((leg, i) => {
    const options = (scoredByLeg[i] ?? []).sort((a, b) => b.compositeScore - a.compositeScore);
    return {
      segmentLabel: `${leg.origin} to ${leg.destination}`,
      origin: leg.origin,
      destination: leg.destination,
      date: leg.date,
      options,
      bestOverall: options[0] ?? null,
      bestBudget: options.find((o) => o.recommendation === "budget") ?? null,
      fastest: options.find((o) => o.recommendation === "fastest") ?? null,
    };
  });

  return travelers.map((t) => ({
    travelerId: t.travelerId,
    travelerName: t.travelerName,
    clientId: t.clientId,
    segments,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
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
