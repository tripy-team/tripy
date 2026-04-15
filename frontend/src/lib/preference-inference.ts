import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import type {
  InferenceCategory,
  InferenceStatus,
  CabinPreference,
} from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TripSignals {
  id: string;
  cabinPreference: CabinPreference;
  originAirports: string[];
  destinationAirports: string[];
  budgetCash: number | null;
  status: string;
  departureDate: Date;
  travelerCount: number;
  notes: string | null;
  recommendations: {
    strategyType: string;
    totalCashCost: number;
    totalPointsUsed: unknown;
    isRecommended: boolean;
  }[];
}

interface InferenceCandidate {
  category: InferenceCategory;
  label: string;
  description: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

// Minimum trips needed before we attempt inference
const MIN_TRIPS_FOR_INFERENCE = 2;

// Confidence thresholds for surfacing inferences
const MIN_CONFIDENCE = 0.4;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyzes a client's historical trip data and generates inferred preference
 * candidates. These are surfaced as *suggestions* to the advisor, never
 * silently applied.
 */
export async function generateInferences(
  clientId: string,
): Promise<InferenceCandidate[]> {
  const trips = await fetchTripSignals(clientId);

  if (trips.length < MIN_TRIPS_FOR_INFERENCE) {
    return [];
  }

  const candidates: InferenceCandidate[] = [];

  candidates.push(...inferCabinPreference(trips));
  candidates.push(...inferNonstopPreference(trips));
  candidates.push(...inferAirlinePreference(trips));
  candidates.push(...inferDestinationPatterns(trips));
  candidates.push(...inferBudgetBehavior(trips));
  candidates.push(...inferPaymentStyle(trips));
  candidates.push(...inferTripStyle(trips));

  return candidates.filter((c) => c.confidence >= MIN_CONFIDENCE);
}

/**
 * Runs inference and persists new results, skipping categories that already
 * have a pending or accepted inference for this client.
 */
export async function runAndPersistInferences(clientId: string): Promise<number> {
  const candidates = await generateInferences(clientId);

  if (candidates.length === 0) return 0;

  const existing = await prisma.inferredPreference.findMany({
    where: {
      clientId,
      status: { in: ["pending", "accepted"] as InferenceStatus[] },
    },
    select: { category: true },
  });

  const existingCategories = new Set(existing.map((e) => e.category));

  const newCandidates = candidates.filter(
    (c) => !existingCategories.has(c.category),
  );

  if (newCandidates.length === 0) return 0;

  const created = await prisma.inferredPreference.createMany({
    data: newCandidates.map((c) => ({
      clientId,
      category: c.category,
      label: c.label,
      description: c.description,
      confidence: c.confidence,
      evidence: c.evidence as Prisma.InputJsonValue,
      source: "trip_history",
    })),
  });

  return created.count;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchTripSignals(clientId: string): Promise<TripSignals[]> {
  const trips = await prisma.tripRequest.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cabinPreference: true,
      originAirports: true,
      destinationAirports: true,
      budgetCash: true,
      status: true,
      departureDate: true,
      travelerCount: true,
      notes: true,
      recommendationRuns: {
        where: { status: "complete" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          options: {
            select: {
              strategyType: true,
              totalCashCost: true,
              totalPointsUsed: true,
              isRecommended: true,
            },
          },
        },
      },
    },
  });

  return trips.map((t) => ({
    id: t.id,
    cabinPreference: t.cabinPreference,
    originAirports: t.originAirports as string[],
    destinationAirports: t.destinationAirports as string[],
    budgetCash: t.budgetCash,
    status: t.status,
    departureDate: t.departureDate,
    travelerCount: t.travelerCount,
    notes: t.notes,
    recommendations:
      t.recommendationRuns[0]?.options.map((o) => ({
        strategyType: o.strategyType,
        totalCashCost: o.totalCashCost,
        totalPointsUsed: o.totalPointsUsed,
        isRecommended: o.isRecommended,
      })) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Inference detectors
// ---------------------------------------------------------------------------

function inferCabinPreference(trips: TripSignals[]): InferenceCandidate[] {
  const counts: Record<string, number> = {};
  for (const t of trips) {
    counts[t.cabinPreference] = (counts[t.cabinPreference] || 0) + 1;
  }

  const total = trips.length;
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const [topCabin, topCount] = sorted[0];

  if (topCabin === "economy" || topCabin === "flexible") return [];

  const ratio = topCount / total;
  if (ratio < 0.5) return [];

  const cabinLabel = formatCabin(topCabin);
  return [
    {
      category: "cabin_choice" as InferenceCategory,
      label: `Prefers ${cabinLabel}`,
      description: `Selected ${cabinLabel} in ${topCount} of ${total} trip${total !== 1 ? "s" : ""}`,
      confidence: Math.min(ratio, 0.95),
      evidence: { cabinCounts: counts, totalTrips: total },
    },
  ];
}

function inferNonstopPreference(trips: TripSignals[]): InferenceCandidate[] {
  const nonstopMentions = trips.filter((t) => {
    const notes = (t.notes || "").toLowerCase();
    return (
      notes.includes("nonstop") ||
      notes.includes("non-stop") ||
      notes.includes("direct flight") ||
      notes.includes("no layover") ||
      notes.includes("no stops")
    );
  });

  if (nonstopMentions.length === 0) return [];

  const ratio = nonstopMentions.length / trips.length;
  if (ratio < 0.3) return [];

  return [
    {
      category: "nonstop_preference" as InferenceCategory,
      label: "Prefers nonstop flights",
      description: `Mentioned nonstop/direct flights in ${nonstopMentions.length} of ${trips.length} trip${trips.length !== 1 ? "s" : ""}`,
      confidence: Math.min(ratio + 0.1, 0.9),
      evidence: {
        mentionCount: nonstopMentions.length,
        totalTrips: trips.length,
      },
    },
  ];
}

function inferAirlinePreference(trips: TripSignals[]): InferenceCandidate[] {
  const airlineMentions: Record<string, number> = {};
  const airlineKeywords = [
    "united",
    "delta",
    "american",
    "alaska",
    "southwest",
    "jetblue",
    "spirit",
    "frontier",
    "hawaiian",
    "emirates",
    "singapore",
    "cathay",
    "qatar",
    "ana",
    "jal",
    "lufthansa",
    "british airways",
    "air france",
    "klm",
    "virgin atlantic",
  ];

  for (const t of trips) {
    const notes = (t.notes || "").toLowerCase();
    for (const airline of airlineKeywords) {
      if (notes.includes(airline)) {
        airlineMentions[airline] = (airlineMentions[airline] || 0) + 1;
      }
    }
  }

  const results: InferenceCandidate[] = [];
  for (const [airline, count] of Object.entries(airlineMentions)) {
    const ratio = count / trips.length;
    if (count >= 2 && ratio >= 0.3) {
      const name = airline
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      results.push({
        category: "airline_preference" as InferenceCategory,
        label: `Prefers ${name}`,
        description: `${name} mentioned in ${count} of ${trips.length} trip${trips.length !== 1 ? "s" : ""}`,
        confidence: Math.min(ratio + 0.1, 0.85),
        evidence: { airline, mentionCount: count, totalTrips: trips.length },
      });
    }
  }

  return results.slice(0, 1);
}

function inferDestinationPatterns(
  trips: TripSignals[],
): InferenceCandidate[] {
  const destCounts: Record<string, number> = {};
  for (const t of trips) {
    for (const dest of t.destinationAirports) {
      const code = typeof dest === "string" ? dest.toUpperCase() : String(dest);
      destCounts[code] = (destCounts[code] || 0) + 1;
    }
  }

  const results: InferenceCandidate[] = [];
  const sorted = Object.entries(destCounts).sort(([, a], [, b]) => b - a);

  for (const [code, count] of sorted.slice(0, 2)) {
    if (count >= 2) {
      const ratio = count / trips.length;
      results.push({
        category: "destination_pattern" as InferenceCategory,
        label: `Frequent destination: ${code}`,
        description: `Traveled to ${code} in ${count} of ${trips.length} trip${trips.length !== 1 ? "s" : ""}`,
        confidence: Math.min(ratio, 0.8),
        evidence: { destinationCode: code, count, totalTrips: trips.length },
      });
    }
  }

  return results.slice(0, 1);
}

function inferBudgetBehavior(trips: TripSignals[]): InferenceCandidate[] {
  const withBudget = trips.filter((t) => t.budgetCash != null && t.budgetCash > 0);
  if (withBudget.length < 2) return [];

  const perPerson = withBudget.map(
    (t) => (t.budgetCash as number) / Math.max(t.travelerCount, 1),
  );
  const avg = perPerson.reduce((s, v) => s + v, 0) / perPerson.length;

  const premiumCabinTrips = trips.filter(
    (t) => t.cabinPreference === "business" || t.cabinPreference === "first",
  );

  if (avg > 3000 && premiumCabinTrips.length / trips.length >= 0.4) {
    return [
      {
        category: "budget_behavior" as InferenceCategory,
        label: "Luxury-leaning budget",
        description: `Average budget of $${Math.round(avg).toLocaleString()} per person across ${withBudget.length} trips, with ${premiumCabinTrips.length} premium cabin selections`,
        confidence: Math.min(0.5 + premiumCabinTrips.length / trips.length * 0.3, 0.85),
        evidence: {
          averageBudgetPerPerson: Math.round(avg),
          premiumCabinTrips: premiumCabinTrips.length,
          totalTrips: trips.length,
        },
      },
    ];
  }

  if (avg < 800) {
    return [
      {
        category: "budget_behavior" as InferenceCategory,
        label: "Budget-conscious traveler",
        description: `Average budget of $${Math.round(avg).toLocaleString()} per person across ${withBudget.length} trips`,
        confidence: Math.min(0.5 + (800 - avg) / 800 * 0.3, 0.85),
        evidence: {
          averageBudgetPerPerson: Math.round(avg),
          totalTripsWithBudget: withBudget.length,
          totalTrips: trips.length,
        },
      },
    ];
  }

  return [];
}

function inferPaymentStyle(trips: TripSignals[]): InferenceCandidate[] {
  const tripsWithRecs = trips.filter((t) => t.recommendations.length > 0);
  if (tripsWithRecs.length < 2) return [];

  let pointsHeavy = 0;
  let cashHeavy = 0;

  for (const t of tripsWithRecs) {
    const recommended = t.recommendations.find((r) => r.isRecommended);
    if (!recommended) continue;

    if (recommended.strategyType === "points_only") pointsHeavy++;
    else if (recommended.strategyType === "cash_only") cashHeavy++;
  }

  const total = tripsWithRecs.length;

  if (pointsHeavy / total >= 0.6) {
    return [
      {
        category: "payment_style" as InferenceCategory,
        label: "Points-heavy booking style",
        description: `Points-only strategy recommended in ${pointsHeavy} of ${total} analyzed trips`,
        confidence: Math.min(pointsHeavy / total, 0.9),
        evidence: {
          pointsOnlyCount: pointsHeavy,
          cashOnlyCount: cashHeavy,
          totalAnalyzed: total,
        },
      },
    ];
  }

  if (cashHeavy / total >= 0.6) {
    return [
      {
        category: "payment_style" as InferenceCategory,
        label: "Cash-heavy booking style",
        description: `Cash-only strategy recommended in ${cashHeavy} of ${total} analyzed trips`,
        confidence: Math.min(cashHeavy / total, 0.9),
        evidence: {
          pointsOnlyCount: pointsHeavy,
          cashOnlyCount: cashHeavy,
          totalAnalyzed: total,
        },
      },
    ];
  }

  return [];
}

function inferTripStyle(trips: TripSignals[]): InferenceCandidate[] {
  const luxuryKeywords = ["luxury", "five star", "5-star", "suite", "premium", "first class", "vip"];
  const budgetKeywords = ["budget", "cheap", "affordable", "hostel", "backpack", "economy"];
  const familyKeywords = ["family", "kids", "children", "child-friendly", "family-friendly"];

  let luxuryScore = 0;
  let budgetScore = 0;
  let familyScore = 0;

  for (const t of trips) {
    const notes = (t.notes || "").toLowerCase();
    if (luxuryKeywords.some((k) => notes.includes(k))) luxuryScore++;
    if (budgetKeywords.some((k) => notes.includes(k))) budgetScore++;
    if (familyKeywords.some((k) => notes.includes(k))) familyScore++;
    if (t.travelerCount >= 3) familyScore += 0.5;
  }

  const total = trips.length;
  const results: InferenceCandidate[] = [];

  if (luxuryScore / total >= 0.4) {
    results.push({
      category: "trip_style" as InferenceCategory,
      label: "Luxury travel style",
      description: `Luxury-related preferences detected in ${Math.round(luxuryScore)} of ${total} trips`,
      confidence: Math.min(luxuryScore / total, 0.85),
      evidence: { luxuryScore, totalTrips: total },
    });
  } else if (familyScore / total >= 0.4) {
    results.push({
      category: "trip_style" as InferenceCategory,
      label: "Family-oriented traveler",
      description: `Family travel patterns detected in ${Math.round(familyScore)} of ${total} trips`,
      confidence: Math.min(familyScore / total, 0.85),
      evidence: { familyScore, totalTrips: total },
    });
  } else if (budgetScore / total >= 0.4) {
    results.push({
      category: "trip_style" as InferenceCategory,
      label: "Budget-focused travel style",
      description: `Budget-conscious patterns detected in ${Math.round(budgetScore)} of ${total} trips`,
      confidence: Math.min(budgetScore / total, 0.85),
      evidence: { budgetScore, totalTrips: total },
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCabin(cabin: string): string {
  const labels: Record<string, string> = {
    economy: "Economy",
    premium_economy: "Premium Economy",
    business: "Business Class",
    first: "First Class",
    flexible: "Flexible",
  };
  return labels[cabin] ?? cabin;
}

// ---------------------------------------------------------------------------
// Apply accepted inference to client preference profile
// ---------------------------------------------------------------------------

export async function applyInferenceToProfile(
  inferenceId: string,
): Promise<boolean> {
  const inference = await prisma.inferredPreference.findUnique({
    where: { id: inferenceId },
  });

  if (!inference || inference.status !== "accepted") return false;
  if (inference.appliedToProfile) return false;

  const updates: Record<string, unknown> = {};
  const evidence = inference.evidence as Record<string, unknown>;

  switch (inference.category) {
    case "cabin_choice": {
      const counts = evidence.cabinCounts as Record<string, number>;
      const topCabin = Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0];
      if (topCabin) updates.preferredCabin = topCabin;
      break;
    }
    case "nonstop_preference":
      updates.prefersNonstop = true;
      break;
    case "airline_preference": {
      const airline = evidence.airline as string;
      if (airline) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { preferredAirlines: true },
        });
        const current = (existing?.preferredAirlines as string[] | null) ?? [];
        const name =
          airline
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        if (!current.includes(name)) {
          updates.preferredAirlines = [...current, name];
        }
      }
      break;
    }
    case "payment_style": {
      const label = inference.label.toLowerCase();
      if (label.includes("points")) updates.redemptionStyle = "maximize_experience";
      else if (label.includes("cash")) updates.redemptionStyle = "save_points";
      break;
    }
    case "dining_preference": {
      const tokens = (evidence.tokens as string[]) ?? [];
      if (tokens.length > 0) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { foodPreferences: true },
        });
        const current = (existing?.foodPreferences as string[] | null) ?? [];
        const merged = Array.from(new Set([...current, ...tokens]));
        updates.foodPreferences = merged;
      }
      break;
    }
    case "dietary_restriction": {
      const tokens = (evidence.tokens as string[]) ?? [];
      if (tokens.length > 0) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { foodPreferences: true },
        });
        const current = (existing?.foodPreferences as string[] | null) ?? [];
        const merged = Array.from(new Set([...current, ...tokens]));
        updates.foodPreferences = merged;
      }
      break;
    }
    case "experience_interest": {
      const tokens = (evidence.tokens as string[]) ?? [];
      if (tokens.length > 0) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { activityPreferences: true },
        });
        const current = (existing?.activityPreferences as string[] | null) ?? [];
        const merged = Array.from(new Set([...current, ...tokens]));
        updates.activityPreferences = merged;
      }
      break;
    }
    case "accessibility_need": {
      const tokens = (evidence.tokens as string[]) ?? [];
      if (tokens.length > 0) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { accessibilityNeeds: true },
        });
        const current = (existing?.accessibilityNeeds as string[] | null) ?? [];
        const merged = Array.from(new Set([...current, ...tokens]));
        updates.accessibilityNeeds = merged;
      }
      break;
    }
    case "accommodation_preference": {
      const tokens = (evidence.tokens as string[]) ?? [];
      if (tokens.length > 0) {
        const existing = await prisma.clientPreference.findUnique({
          where: { clientId: inference.clientId },
          select: { preferredHotelTypes: true },
        });
        const current = (existing?.preferredHotelTypes as string[] | null) ?? [];
        const merged = Array.from(new Set([...current, ...tokens]));
        updates.preferredHotelTypes = merged;
      }
      break;
    }
    default:
      break;
  }

  if (Object.keys(updates).length > 0) {
    await prisma.clientPreference.upsert({
      where: { clientId: inference.clientId },
      create: {
        clientId: inference.clientId,
        ...updates,
      } as never,
      update: updates,
    });
  }

  await prisma.inferredPreference.update({
    where: { id: inferenceId },
    data: { appliedToProfile: true },
  });

  return true;
}
