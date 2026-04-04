// Preference Confidence Engine
// Scores how well Tripy understands a client's needs for a trip request.
// Each dimension contributes up to 10 points for a max score of 100.

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type DimensionStatus = 'resolved' | 'ambiguous' | 'missing';

export interface ConfidenceDimension {
  key: string;
  label: string;
  weight: number;
  score: number;
  maxScore: number;
  status: DimensionStatus;
  detail: string;
  suggestedQuestion?: string;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  dimensions: ConfidenceDimension[];
  missingFields: ConfidenceDimension[];
  ambiguousFields: ConfidenceDimension[];
  resolvedFields: ConfidenceDimension[];
  suggestedQuestions: { dimension: string; question: string }[];
}

export interface TripRequestInput {
  title: string;
  originAirports: unknown;
  destinationAirports: unknown;
  departureDate: string | Date | null;
  returnDate?: string | Date | null;
  travelerCount: number;
  cabinPreference?: string | null;
  flexibilityDays?: number | null;
  budgetCash?: number | null;
  notes?: string | null;
}

export interface ClientPreferenceInput {
  preferredCabin?: string | null;
  prefersNonstop?: boolean | null;
  maxLayoverMinutes?: number | null;
  willingToReposition?: boolean | null;
  redemptionStyle?: string | null;
  avoidBasicEconomy?: boolean | null;
  preferredAirlines?: unknown;
  avoidedAirlines?: unknown;
  notes?: string | null;
}

export interface ClientInput {
  firstName: string;
  lastName: string;
  notes?: string | null;
}

export interface ConfidenceInput {
  tripRequest: TripRequestInput;
  clientPreferences: ClientPreferenceInput | null;
  client: ClientInput | null;
  hasLoyaltyBalances: boolean;
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v) => typeof v === 'string' && v.trim());
  return [];
}

const HOTEL_KEYWORDS = [
  'hotel', 'resort', 'boutique', 'airbnb', 'hostel', 'villa',
  'all-inclusive', 'bed and breakfast', 'b&b', 'accommodation',
  'hyatt', 'marriott', 'hilton', 'ritz', 'four seasons', 'aman',
];

const EXPERIENCE_KEYWORDS = [
  'beach', 'adventure', 'relaxation', 'culture', 'food', 'wine',
  'hiking', 'diving', 'snorkeling', 'safari', 'museum', 'nightlife',
  'shopping', 'spa', 'romantic', 'honeymoon', 'anniversary', 'family',
  'kid-friendly', 'adults-only', 'sightseeing', 'photography', 'ski',
  'surfing', 'yoga', 'wellness', 'history', 'architecture',
];

const DEALBREAKER_KEYWORDS = [
  'no ', 'never', 'avoid', 'hate', 'can\'t', 'cannot', 'won\'t',
  'refuse', 'allergic', 'afraid', 'phobia', 'disability', 'wheelchair',
  'dietary', 'vegan', 'vegetarian', 'kosher', 'halal',
];

function textContainsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function scoreDimension(
  key: string,
  label: string,
  score: number,
  maxScore: number,
  detail: string,
  suggestedQuestion?: string,
): ConfidenceDimension {
  let status: DimensionStatus;
  if (score >= maxScore * 0.8) {
    status = 'resolved';
  } else if (score > 0) {
    status = 'ambiguous';
  } else {
    status = 'missing';
  }

  return { key, label, weight: maxScore, score, maxScore, status, detail, suggestedQuestion };
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { tripRequest, clientPreferences, client } = input;
  const dimensions: ConfidenceDimension[] = [];
  const allNotes = [tripRequest.notes, clientPreferences?.notes, client?.notes]
    .filter(Boolean)
    .join(' ');

  const destinations = toStringArray(tripRequest.destinationAirports);
  const origins = toStringArray(tripRequest.originAirports);
  const clientName = client ? `${client.firstName}` : 'the client';

  // 1. Destination clarity
  {
    let score = 0;
    let detail = 'No destination specified.';
    let question: string | undefined =
      `Where would ${clientName} like to travel? Any specific cities, regions, or countries in mind?`;

    if (destinations.length > 0 && origins.length > 0) {
      score = 10;
      detail = `Route defined: ${origins.join('/')} to ${destinations.join('/')}.`;
      question = undefined;
    } else if (destinations.length > 0) {
      score = 7;
      detail = `Destination set (${destinations.join(', ')}) but origin airports not specified.`;
      question = `Which airport(s) will ${clientName} be departing from?`;
    } else if (origins.length > 0) {
      score = 3;
      detail = 'Origin set but no destination specified.';
    }

    dimensions.push(scoreDimension('destination', 'Destination Clarity', score, 10, detail, question));
  }

  // 2. Budget clarity
  {
    let score = 0;
    let detail = 'No budget specified.';
    let question: string | undefined =
      `Does ${clientName} have a budget in mind for this trip? A rough range is fine — it helps narrow the best options.`;

    if (tripRequest.budgetCash && tripRequest.budgetCash > 0) {
      score = 10;
      detail = `Budget set at $${tripRequest.budgetCash.toLocaleString()}.`;
      question = undefined;
    } else if (allNotes && textContainsAny(allNotes, ['budget', 'spend', 'cost', 'cheap', 'afford', 'price', 'expensive'])) {
      score = 4;
      detail = 'Budget mentioned in notes but no specific amount set.';
      question = `${clientName} mentioned budget considerations — could we pin down a specific dollar range?`;
    }

    dimensions.push(scoreDimension('budget', 'Budget Clarity', score, 10, detail, question));
  }

  // 3. Date flexibility
  {
    let score = 0;
    let detail = 'No travel dates specified.';
    let question: string | undefined =
      `When is ${clientName} looking to travel? Are dates fixed or flexible?`;

    const hasDeparture = !!tripRequest.departureDate;
    const hasReturn = !!tripRequest.returnDate;
    const hasFlex = tripRequest.flexibilityDays != null && tripRequest.flexibilityDays > 0;

    if (hasDeparture && hasReturn && hasFlex) {
      score = 10;
      detail = `Dates and flexibility (±${tripRequest.flexibilityDays}d) fully specified.`;
      question = undefined;
    } else if (hasDeparture && hasReturn) {
      score = 7;
      detail = 'Travel dates set but date flexibility not specified.';
      question = `Are ${clientName}'s dates firm, or is there flexibility to shift by a few days for better award availability?`;
    } else if (hasDeparture) {
      score = 4;
      detail = 'Departure date set but return date missing.';
      question = `When does ${clientName} plan to return? Is this a one-way trip?`;
    }

    dimensions.push(scoreDimension('dates', 'Date Flexibility', score, 10, detail, question));
  }

  // 4. Cabin preference
  {
    let score = 0;
    let detail = 'No cabin preference specified.';
    let question: string | undefined =
      `What cabin class is ${clientName} targeting — economy, premium economy, business, or first? Is there flexibility between classes?`;

    const tripCabin = tripRequest.cabinPreference;
    const clientCabin = clientPreferences?.preferredCabin;

    if (tripCabin && tripCabin !== 'economy' && tripCabin !== 'flexible') {
      score = 10;
      detail = `Trip cabin preference: ${tripCabin.replace('_', ' ')}.`;
      question = undefined;
    } else if (tripCabin === 'flexible') {
      score = 8;
      detail = 'Cabin preference set to flexible — open to multiple classes.';
      question = undefined;
    } else if (tripCabin === 'economy') {
      score = 8;
      detail = 'Cabin preference set to economy.';
      question = undefined;
    } else if (clientCabin && clientCabin !== 'economy') {
      score = 6;
      detail = `Client default cabin (${clientCabin.replace('_', ' ')}) applies; no trip-specific override.`;
      question = `Should we use ${clientName}'s usual preference of ${clientCabin.replace('_', ' ')} for this trip, or something different?`;
    } else if (clientCabin === 'economy') {
      score = 6;
      detail = 'Client default cabin is economy; no trip-specific override.';
      question = undefined;
    }

    dimensions.push(scoreDimension('cabin', 'Cabin Preference', score, 10, detail, question));
  }

  // 5. Nonstop / layover preference
  {
    let score = 0;
    let detail = 'No nonstop/layover preference specified.';
    let question: string | undefined =
      `Does ${clientName} prefer nonstop flights, or are layovers acceptable? Any maximum connection time?`;

    if (clientPreferences) {
      const hasNonstop = clientPreferences.prefersNonstop === true;
      const hasLayover = clientPreferences.maxLayoverMinutes != null && clientPreferences.maxLayoverMinutes > 0;

      if (hasNonstop || hasLayover) {
        score = 10;
        const parts: string[] = [];
        if (hasNonstop) parts.push('prefers nonstop');
        if (hasLayover) parts.push(`max layover: ${clientPreferences.maxLayoverMinutes}min`);
        detail = `Flight routing preference set: ${parts.join(', ')}.`;
        question = undefined;
      } else if (clientPreferences.prefersNonstop === false) {
        score = 6;
        detail = 'Nonstop not required — but no max layover time specified.';
        question = `${clientName} is open to connections — is there a maximum layover duration they'd accept?`;
      }
    }

    dimensions.push(scoreDimension('nonstop', 'Nonstop / Layover Preference', score, 10, detail, question));
  }

  // 6. Hotel style preference
  {
    let score = 0;
    let detail = 'No hotel or accommodation preferences mentioned.';
    let question: string | undefined =
      `What type of accommodations does ${clientName} prefer — hotels, resorts, boutique properties, vacation rentals? Any hotel loyalty programs?`;

    if (allNotes) {
      const matches = countMatches(allNotes, HOTEL_KEYWORDS);
      if (matches >= 2) {
        score = 8;
        detail = 'Multiple hotel/accommodation preferences found in notes.';
        question = undefined;
      } else if (matches === 1) {
        score = 4;
        detail = 'Brief hotel/accommodation mention in notes — could be more specific.';
        question = `${clientName} mentioned accommodation preferences — could we get more detail on hotel style, brand preferences, or star level?`;
      }
    }

    dimensions.push(scoreDimension('hotel', 'Hotel Style Preference', score, 10, detail, question));
  }

  // 7. Luxury vs value (redemption style)
  {
    let score = 0;
    let detail = 'No luxury-vs-value preference set.';
    let question: string | undefined =
      `When using points, does ${clientName} prefer to maximize the travel experience (luxury redemptions) or save points where possible (value-focused)?`;

    const style = clientPreferences?.redemptionStyle;
    if (style === 'maximize_experience' || style === 'save_points') {
      score = 10;
      detail = `Redemption style: ${style.replace('_', ' ')}.`;
      question = undefined;
    } else if (style === 'balanced') {
      score = 7;
      detail = 'Redemption style is balanced — no strong lean toward luxury or value.';
      question = `${clientName}'s style is balanced. For this specific trip, should we lean toward maximizing comfort or saving points?`;
    }

    dimensions.push(scoreDimension('luxury_value', 'Luxury vs Value', score, 10, detail, question));
  }

  // 8. Experience goals
  {
    let score = 0;
    let detail = 'No experience goals or trip purpose mentioned.';
    let question: string | undefined =
      `What does ${clientName} want to get out of this trip — relaxation, adventure, culture, food, or something else? Any must-do activities?`;

    if (allNotes) {
      const matches = countMatches(allNotes, EXPERIENCE_KEYWORDS);
      if (matches >= 3) {
        score = 10;
        detail = 'Rich experience goals described in notes.';
        question = undefined;
      } else if (matches >= 1) {
        score = 5;
        detail = 'Some experience goals mentioned, but could be more detailed.';
        question = `${clientName} mentioned a few interests — are there any must-do activities or experiences for this trip?`;
      }
    }

    dimensions.push(scoreDimension('experience', 'Experience Goals', score, 10, detail, question));
  }

  // 9. Dealbreakers
  {
    let score = 0;
    let detail = 'No dealbreakers or hard constraints specified.';
    let question: string | undefined =
      `Are there any absolute dealbreakers for ${clientName} — airlines to avoid, dietary restrictions, accessibility needs, things they'd refuse to do?`;

    const avoided = toStringArray(clientPreferences?.avoidedAirlines);
    const avoidBasic = clientPreferences?.avoidBasicEconomy === true;
    const hasNotesDealbreakers = allNotes && textContainsAny(allNotes, DEALBREAKER_KEYWORDS);
    const signals = (avoided.length > 0 ? 1 : 0) + (avoidBasic ? 1 : 0) + (hasNotesDealbreakers ? 1 : 0);

    if (signals >= 2) {
      score = 10;
      detail = 'Multiple dealbreakers/constraints captured.';
      question = undefined;
    } else if (signals === 1) {
      score = 6;
      const parts: string[] = [];
      if (avoided.length > 0) parts.push(`avoids ${avoided.join(', ')}`);
      if (avoidBasic) parts.push('avoids basic economy');
      if (hasNotesDealbreakers) parts.push('constraints mentioned in notes');
      detail = `Partial dealbreakers: ${parts.join('; ')}.`;
      question = `We have some constraints noted — are there any other dealbreakers ${clientName} wants us to know about?`;
    }

    dimensions.push(scoreDimension('dealbreakers', 'Dealbreakers', score, 10, detail, question));
  }

  // 10. Points strategy
  {
    let score = 0;
    let detail = 'No points strategy information available.';
    let question: string | undefined =
      `Does ${clientName} want to use points for this trip? If so, which programs should we prioritize? Are there any balances they want to preserve?`;

    const hasStyle = clientPreferences?.redemptionStyle != null;
    const hasAirlines = toStringArray(clientPreferences?.preferredAirlines).length > 0;
    const hasBalances = input.hasLoyaltyBalances;
    const signals = (hasStyle ? 1 : 0) + (hasAirlines ? 1 : 0) + (hasBalances ? 1 : 0);

    if (signals >= 3) {
      score = 10;
      detail = 'Full points strategy available: redemption style, preferred programs, and balances on file.';
      question = undefined;
    } else if (signals === 2) {
      score = 7;
      const missing: string[] = [];
      if (!hasStyle) missing.push('redemption style');
      if (!hasAirlines) missing.push('preferred airlines/programs');
      if (!hasBalances) missing.push('loyalty balances');
      detail = `Partial points strategy. Missing: ${missing.join(', ')}.`;
      question = `We're missing ${missing.join(' and ')} for ${clientName} — can we fill those in to optimize the points strategy?`;
    } else if (signals === 1) {
      score = 4;
      detail = 'Minimal points strategy information available.';
    }

    dimensions.push(scoreDimension('points_strategy', 'Points Strategy', score, 10, detail, question));
  }

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxTotal = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const normalized = Math.round((totalScore / maxTotal) * 100);

  let level: ConfidenceLevel;
  if (normalized >= 70) level = 'high';
  else if (normalized >= 40) level = 'medium';
  else level = 'low';

  const missingFields = dimensions.filter((d) => d.status === 'missing');
  const ambiguousFields = dimensions.filter((d) => d.status === 'ambiguous');
  const resolvedFields = dimensions.filter((d) => d.status === 'resolved');

  const suggestedQuestions = dimensions
    .filter((d) => d.suggestedQuestion)
    .map((d) => ({ dimension: d.label, question: d.suggestedQuestion! }));

  return {
    score: normalized,
    level,
    dimensions,
    missingFields,
    ambiguousFields,
    resolvedFields,
    suggestedQuestions,
  };
}
