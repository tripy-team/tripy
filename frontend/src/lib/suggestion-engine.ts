/**
 * Follow-Up Suggestion Engine
 *
 * Pure-function rule engine that produces follow-up question suggestions
 * from a client's intake/profile state. Each rule inspects a slice of the
 * client data and optionally emits one or more suggestions.
 *
 * Designed so individual rules can later be swapped for AI-generated ones
 * without changing the calling code.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type SuggestionPriority = "high" | "medium" | "low";

export type SuggestionCategory =
  | "missing_intake"
  | "ambiguous_preference"
  | "conflicting_constraint"
  | "budget_luxury_mismatch"
  | "points_convenience_mismatch"
  | "destination_flexibility"
  | "group_traveler_difference";

export interface RawSuggestion {
  category: SuggestionCategory;
  priority: SuggestionPriority;
  questionText: string;
  reason: string;
  /** Stable key so we can deduplicate across regenerations */
  ruleKey: string;
}

export interface ClientSnapshot {
  client: {
    id: string;
    firstName: string;
    lastName: string;
    clientType: string;
  };
  intake: IntakeSnapshot | null;
  preferences: PreferencesSnapshot | null;
  balances: BalanceSnapshot[];
  familyMembers: FamilySnapshot[];
  trips: TripSnapshot[];
}

export interface IntakeSnapshot {
  id: string;
  status: string;
  tripType: string | null;
  destinations: unknown;
  departureAirports: unknown;
  dateFlexibility: string | null;
  earliestDeparture: string | null;
  latestReturn: string | null;
  tripDurationDays: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetNotes: string | null;
  cabinPreference: string | null;
  hotelStyles: unknown;
  luxuryPreference: string | null;
  travelPace: string | null;
  layoverTolerance: string | null;
  travelerCount: number | null;
  childrenCount: number | null;
  childrenAges: unknown;
  familyFriendly: boolean | null;
  desiredExperiences: unknown;
  dealbreakers: unknown;
  preferredAirlines: unknown;
  avoidedAirlines: unknown;
  accessibilityNeeds: string | null;
  dietaryNeeds: string | null;
  notes: string | null;
}

export interface PreferencesSnapshot {
  preferredCabin: string | null;
  prefersNonstop: boolean;
  redemptionStyle: string | null;
  budgetSensitivity: string | null;
  pointsVsCash: string | null;
  preferredAirlines: unknown;
  avoidedAirlines: unknown;
  dealbreakers: unknown;
}

export interface BalanceSnapshot {
  programName: string;
  balance: number;
  expirationDate: string | null;
}

export interface FamilySnapshot {
  name: string;
  relationship: string;
  dateOfBirth: string | null;
}

export interface TripSnapshot {
  travelerCount: number;
  cabinPreference: string | null;
  budgetCash: number | null;
}

// ─── Rule type ──────────────────────────────────────────────────────────────

type Rule = (snap: ClientSnapshot) => RawSuggestion[];

// ─── Rule implementations ───────────────────────────────────────────────────

const missingDestination: Rule = ({ intake }) => {
  if (!intake) return [];
  const dests = intake.destinations;
  if (!dests || (Array.isArray(dests) && dests.length === 0)) {
    return [
      {
        category: "missing_intake",
        priority: "high",
        ruleKey: "missing_destination",
        questionText:
          "Do you have specific destinations in mind, or would you like recommendations based on your preferences?",
        reason:
          "No destination has been specified. This is essential for narrowing flight and hotel options.",
      },
    ];
  }
  return [];
};

const missingDates: Rule = ({ intake }) => {
  if (!intake) return [];
  if (!intake.earliestDeparture && !intake.latestReturn && !intake.tripDurationDays) {
    return [
      {
        category: "missing_intake",
        priority: "high",
        ruleKey: "missing_dates",
        questionText:
          "When are you hoping to travel? Even a rough window helps us find better availability and pricing.",
        reason:
          "No travel dates or duration have been provided. Date ranges dramatically affect award availability.",
      },
    ];
  }
  return [];
};

const missingBudget: Rule = ({ intake }) => {
  if (!intake) return [];
  if (intake.budgetMin == null && intake.budgetMax == null) {
    return [
      {
        category: "missing_intake",
        priority: "medium",
        ruleKey: "missing_budget",
        questionText:
          "Do you have a budget range in mind for this trip, including flights and accommodations?",
        reason:
          "No budget has been set. Understanding spending limits helps balance points vs. cash strategies.",
      },
    ];
  }
  return [];
};

const missingCabinPreference: Rule = ({ intake, preferences }) => {
  if (intake?.cabinPreference || preferences?.preferredCabin) return [];
  if (!intake) return [];
  return [
    {
      category: "missing_intake",
      priority: "medium",
      ruleKey: "missing_cabin",
      questionText:
        "What cabin class are you targeting — economy, premium economy, business, or first?",
      reason:
        "Cabin preference significantly affects which loyalty programs offer the best value and availability.",
    },
  ];
};

const missingTravelerDetails: Rule = ({ intake, familyMembers }) => {
  if (!intake) return [];
  const results: RawSuggestion[] = [];

  if (intake.travelerCount && intake.travelerCount > 1 && familyMembers.length === 0) {
    results.push({
      category: "missing_intake",
      priority: "medium",
      ruleKey: "missing_traveler_profiles",
      questionText: `You mentioned ${intake.travelerCount} travelers. Can you share who will be joining so we can check loyalty balances and preferences for each?`,
      reason:
        "Multiple travelers are indicated but no family/companion profiles exist. Individual loyalty balances may open up different routing options.",
    });
  }

  if (
    intake.travelerCount &&
    intake.travelerCount > 1 &&
    intake.childrenCount == null
  ) {
    results.push({
      category: "missing_intake",
      priority: "medium",
      ruleKey: "missing_children_info",
      questionText:
        "Will any children be traveling? If so, what are their ages? Some programs and hotels have specific child policies.",
      reason:
        "Knowing if children are part of the group affects cabin configuration, hotel choices, and award booking rules.",
    });
  }

  return results;
};

const budgetLuxuryMismatch: Rule = ({ intake, preferences }) => {
  if (!intake) return [];
  const results: RawSuggestion[] = [];

  const lux = intake.luxuryPreference || preferences?.budgetSensitivity;
  const wantsLuxury =
    lux === "luxury" || lux === "upscale" || lux === "comfort_first";
  const hasBudgetCap = intake.budgetMax != null && intake.budgetMax > 0;

  if (wantsLuxury && hasBudgetCap && intake.budgetMax! < 5000) {
    results.push({
      category: "budget_luxury_mismatch",
      priority: "high",
      ruleKey: "budget_vs_luxury",
      questionText:
        "You've indicated a preference for luxury/upscale travel but a relatively modest cash budget. Would you be open to using more points to bridge the gap, or should we adjust the experience tier?",
      reason:
        "There's a tension between the luxury preference and the stated cash budget. Clarifying this prevents us from recommending options the client can't or won't pay for.",
    });
  }

  const cabin = intake.cabinPreference || preferences?.preferredCabin;
  const wantsPremiumCabin = cabin === "business" || cabin === "first";
  const budgetSensitive =
    lux === "value" || lux === "budget" || lux === "price_conscious";

  if (wantsPremiumCabin && budgetSensitive) {
    results.push({
      category: "budget_luxury_mismatch",
      priority: "high",
      ruleKey: "premium_cabin_budget_sensitive",
      questionText:
        "You've selected a premium cabin but also indicated you're budget-conscious. Would you consider premium economy as a middle ground, or is business/first a must-have worth spending points on?",
      reason:
        "Premium cabins are expensive in cash. A budget-sensitive client may prefer to use points strategically or compromise on cabin class.",
    });
  }

  return results;
};

const pointsConvenienceMismatch: Rule = ({ intake, preferences, balances }) => {
  if (!intake && !preferences) return [];
  const results: RawSuggestion[] = [];

  const style = preferences?.redemptionStyle || "balanced";
  const prefersNonstop = preferences?.prefersNonstop ?? false;
  const totalPoints = balances.reduce((sum, b) => sum + b.balance, 0);

  if (style === "save_points" && prefersNonstop && totalPoints > 50000) {
    results.push({
      category: "points_convenience_mismatch",
      priority: "medium",
      ruleKey: "save_points_vs_nonstop",
      questionText:
        "You prefer to save points but also want nonstop flights. Nonstop award tickets often cost more points. Which is more important — conserving your balance or avoiding layovers?",
      reason:
        "Nonstop award flights typically require a premium in points. Understanding the trade-off helps us optimize the recommendation.",
    });
  }

  const layover = intake?.layoverTolerance;
  if (
    style === "maximize_experience" &&
    (layover === "layovers_ok" || layover === "no_preference")
  ) {
    results.push({
      category: "points_convenience_mismatch",
      priority: "low",
      ruleKey: "maximize_exp_layover_ok",
      questionText:
        "You want to maximize the travel experience but are flexible on layovers. Would you prefer a longer layover in an interesting city (e.g., a stopover program) rather than a quick connection?",
      reason:
        "Some airline stopover programs let travelers add a free mini-trip, which aligns with maximizing the experience.",
    });
  }

  return results;
};

const destinationFlexibility: Rule = ({ intake }) => {
  if (!intake) return [];
  const results: RawSuggestion[] = [];

  const dests = intake.destinations;
  if (Array.isArray(dests) && dests.length >= 3) {
    results.push({
      category: "destination_flexibility",
      priority: "medium",
      ruleKey: "many_destinations",
      questionText:
        "You've listed several destinations. Are these in priority order, or are you equally open to all of them? This helps us focus the search.",
      reason:
        "Multiple destinations can mean the client is flexible or indecisive. Knowing the ranking saves time.",
    });
  }

  if (intake.dateFlexibility === "fully_flexible" && (!dests || (Array.isArray(dests) && dests.length <= 1))) {
    results.push({
      category: "destination_flexibility",
      priority: "medium",
      ruleKey: "flexible_dates_single_dest",
      questionText:
        "Since your dates are fully flexible, would you consider alternative destinations where award availability is better during off-peak times?",
      reason:
        "Fully flexible dates paired with a single destination may miss great deals at alternative locations.",
    });
  }

  return results;
};

const groupTravelerDifferences: Rule = ({ intake, familyMembers, preferences }) => {
  if (!intake) return [];
  const results: RawSuggestion[] = [];

  const hasChildren = familyMembers.some((m) => m.relationship === "child");
  const hasPartner = familyMembers.some(
    (m) => m.relationship === "spouse" || m.relationship === "partner",
  );

  if (hasChildren && (intake.cabinPreference === "business" || intake.cabinPreference === "first")) {
    results.push({
      category: "group_traveler_difference",
      priority: "high",
      ruleKey: "children_premium_cabin",
      questionText:
        "You're traveling with children and want a premium cabin. Should the children also fly in the same cabin, or would economy for kids and business/first for adults work?",
      reason:
        "Splitting cabin classes between adults and children can significantly reduce points or cash spend.",
    });
  }

  if (
    hasPartner &&
    intake.travelerCount &&
    intake.travelerCount > 2 &&
    !intake.familyFriendly
  ) {
    results.push({
      category: "group_traveler_difference",
      priority: "low",
      ruleKey: "family_friendly_not_set",
      questionText:
        "You're traveling as a group with a partner. Do you need family-friendly accommodations (connecting rooms, kid amenities, etc.)?",
      reason:
        "Family-friendly hotel features aren't flagged. This affects hotel recommendations significantly.",
    });
  }

  if (intake.travelerCount && intake.travelerCount >= 4) {
    results.push({
      category: "group_traveler_difference",
      priority: "medium",
      ruleKey: "large_group_seating",
      questionText:
        "With a group of this size, is it important that everyone sits together on the flight, or is being on the same flight sufficient?",
      reason:
        "Large-group award bookings are harder to find with adjacent seats. Knowing the priority helps manage expectations.",
    });
  }

  return results;
};

const ambiguousPreferences: Rule = ({ intake, preferences }) => {
  if (!intake && !preferences) return [];
  const results: RawSuggestion[] = [];

  const prefAirlines = intake?.preferredAirlines ?? preferences?.preferredAirlines;
  const avoidAirlines = intake?.avoidedAirlines ?? preferences?.avoidedAirlines;

  if (
    Array.isArray(prefAirlines) &&
    Array.isArray(avoidAirlines) &&
    prefAirlines.length > 0 &&
    avoidAirlines.length > 0
  ) {
    const overlap = prefAirlines.filter((a: string) =>
      avoidAirlines.some((b: string) => a.toLowerCase() === b.toLowerCase()),
    );
    if (overlap.length > 0) {
      results.push({
        category: "conflicting_constraint",
        priority: "high",
        ruleKey: "airline_prefer_avoid_overlap",
        questionText: `${overlap.join(", ")} appear in both your preferred and avoided airline lists. Can you clarify your feeling about ${overlap.length === 1 ? "this airline" : "these airlines"}?`,
        reason:
          "Contradictory airline preferences will produce conflicting recommendations.",
      });
    }
  }

  if (intake?.travelPace === "packed" && intake?.luxuryPreference === "luxury") {
    results.push({
      category: "ambiguous_preference",
      priority: "medium",
      ruleKey: "packed_pace_luxury",
      questionText:
        "You want a packed itinerary but also a luxury experience. Luxury travel often favors a slower pace. Would you like a balance — some high-energy days and some leisurely resort days?",
      reason:
        "A packed pace can conflict with the relaxation expected in luxury travel. Resolving this shapes the itinerary.",
    });
  }

  return results;
};

const noIntakeAtAll: Rule = ({ intake }) => {
  if (intake) return [];
  return [
    {
      category: "missing_intake",
      priority: "high",
      ruleKey: "no_intake",
      questionText:
        "Let's start building your travel profile. Where have you been dreaming of going, and when would you like to travel?",
      reason:
        "No intake form has been started for this client. Beginning the conversation helps populate all downstream recommendations.",
    },
  ];
};

// ─── Rule registry ──────────────────────────────────────────────────────────

const RULES: Rule[] = [
  noIntakeAtAll,
  missingDestination,
  missingDates,
  missingBudget,
  missingCabinPreference,
  missingTravelerDetails,
  budgetLuxuryMismatch,
  pointsConvenienceMismatch,
  destinationFlexibility,
  groupTravelerDifferences,
  ambiguousPreferences,
];

// ─── Public API ─────────────────────────────────────────────────────────────

export function generateSuggestions(snapshot: ClientSnapshot): RawSuggestion[] {
  const all: RawSuggestion[] = [];
  for (const rule of RULES) {
    all.push(...rule(snapshot));
  }

  const seen = new Set<string>();
  const deduped: RawSuggestion[] = [];
  for (const s of all) {
    if (!seen.has(s.ruleKey)) {
      seen.add(s.ruleKey);
      deduped.push(s);
    }
  }

  const priorityOrder: Record<SuggestionPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  deduped.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return deduped;
}
