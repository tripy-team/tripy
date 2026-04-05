import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// ---------------------------------------------------------------------------
// Transfer partner reference (mirrors backend/src/config/programs.yml)
// ---------------------------------------------------------------------------

interface TransferPartner {
  ratio: number;
  transferTime: string;
}

interface BankTransferPartners {
  name: string;
  airlinePartners: Record<string, TransferPartner>;
  hotelPartners: Record<string, TransferPartner>;
}

const TRANSFER_PARTNERS: Record<string, BankTransferPartners> = {
  chase: {
    name: "Chase Ultimate Rewards",
    airlinePartners: {
      "United MileagePlus": { ratio: 1.0, transferTime: "Instant" },
      "Southwest Rapid Rewards": { ratio: 1.0, transferTime: "Instant" },
      "JetBlue TrueBlue": { ratio: 1.0, transferTime: "Instant" },
      "Air Canada Aeroplan": { ratio: 1.0, transferTime: "Instant" },
      "Air France-KLM Flying Blue": { ratio: 1.0, transferTime: "Instant" },
      "British Airways Avios": { ratio: 1.0, transferTime: "Instant" },
      "Iberia Avios": { ratio: 1.0, transferTime: "Instant" },
      "Aer Lingus AerClub": { ratio: 1.0, transferTime: "Instant" },
      "Singapore Airlines KrisFlyer": { ratio: 1.0, transferTime: "Instant" },
      "Virgin Atlantic Flying Club": { ratio: 1.0, transferTime: "Instant" },
    },
    hotelPartners: {
      "World of Hyatt": { ratio: 1.0, transferTime: "Instant" },
      "Marriott Bonvoy": { ratio: 1.0, transferTime: "1-2 days" },
      "IHG One Rewards": { ratio: 1.0, transferTime: "Instant" },
    },
  },
  amex: {
    name: "Amex Membership Rewards",
    airlinePartners: {
      "Delta SkyMiles": { ratio: 1.0, transferTime: "1-2 days" },
      "JetBlue TrueBlue": { ratio: 1.0, transferTime: "1-2 days" },
      "Air France-KLM Flying Blue": { ratio: 1.0, transferTime: "Instant-2 days" },
      "British Airways Avios": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Iberia Avios": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Singapore Airlines KrisFlyer": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Cathay Pacific Asia Miles": { ratio: 1.0, transferTime: "1-3 days" },
      "ANA Mileage Club": { ratio: 1.0, transferTime: "1-3 days" },
      "Emirates Skywards": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Etihad Guest": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Virgin Atlantic Flying Club": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Qantas Frequent Flyer": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Avianca LifeMiles": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Air Canada Aeroplan": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Aer Lingus AerClub": { ratio: 1.0, transferTime: "Instant-2 days" },
    },
    hotelPartners: {
      "Hilton Honors": { ratio: 2.0, transferTime: "1-2 days" },
      "Marriott Bonvoy": { ratio: 1.0, transferTime: "1-2 days" },
    },
  },
  citi: {
    name: "Citi ThankYou Points",
    airlinePartners: {
      "American Airlines AAdvantage": { ratio: 1.0, transferTime: "Instant" },
      "JetBlue TrueBlue": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Singapore Airlines KrisFlyer": { ratio: 1.0, transferTime: "1-2 days" },
      "Cathay Pacific Asia Miles": { ratio: 1.0, transferTime: "1-2 days" },
      "Qatar Airways Privilege Club": { ratio: 1.0, transferTime: "1-2 days" },
      "Emirates Skywards": { ratio: 0.8, transferTime: "1-2 days" },
      "Etihad Guest": { ratio: 1.0, transferTime: "1-2 days" },
      "Turkish Airlines Miles&Smiles": { ratio: 1.0, transferTime: "1-2 days" },
      "Avianca LifeMiles": { ratio: 1.0, transferTime: "1-2 days" },
      "Virgin Atlantic Flying Club": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Air France-KLM Flying Blue": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Qantas Frequent Flyer": { ratio: 1.0, transferTime: "1-2 days" },
    },
    hotelPartners: {
      "Accor Live Limitless": { ratio: 0.5, transferTime: "1-2 days" },
      "Choice Privileges": { ratio: 1.0, transferTime: "1-2 days" },
      "Wyndham Rewards": { ratio: 1.0, transferTime: "1-2 days" },
    },
  },
  capitalone: {
    name: "Capital One Miles",
    airlinePartners: {
      "Air Canada Aeroplan": { ratio: 1.0, transferTime: "Instant" },
      "Air France-KLM Flying Blue": { ratio: 1.0, transferTime: "Instant" },
      "British Airways Avios": { ratio: 1.0, transferTime: "Instant" },
      "Cathay Pacific Asia Miles": { ratio: 1.0, transferTime: "Instant-24h" },
      "Etihad Guest": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Finnair Plus": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Singapore Airlines KrisFlyer": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Turkish Airlines Miles&Smiles": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Avianca LifeMiles": { ratio: 1.0, transferTime: "Instant" },
      "Qantas Frequent Flyer": { ratio: 1.0, transferTime: "Instant-2 days" },
      "TAP Miles&Go": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Qatar Airways Privilege Club": { ratio: 1.0, transferTime: "Instant-2 days" },
      "Aeromexico Club Premier": { ratio: 1.0, transferTime: "Instant-2 days" },
    },
    hotelPartners: {
      "Accor Live Limitless": { ratio: 0.5, transferTime: "1-2 days" },
      "Choice Privileges": { ratio: 1.0, transferTime: "1-2 days" },
    },
  },
  bilt: {
    name: "Bilt Rewards",
    airlinePartners: {
      "United MileagePlus": { ratio: 1.0, transferTime: "Instant-48h" },
      "Avianca LifeMiles": { ratio: 1.0, transferTime: "Instant-48h" },
      "Air France-KLM Flying Blue": { ratio: 1.0, transferTime: "Instant-48h" },
      "Virgin Atlantic Flying Club": { ratio: 1.0, transferTime: "Instant-48h" },
      "Emirates Skywards": { ratio: 1.0, transferTime: "Instant-48h" },
      "British Airways Avios": { ratio: 1.0, transferTime: "Instant-48h" },
      "Cathay Pacific Asia Miles": { ratio: 1.0, transferTime: "Instant-48h" },
      "Turkish Airlines Miles&Smiles": { ratio: 1.0, transferTime: "Instant-48h" },
      "Aer Lingus AerClub": { ratio: 1.0, transferTime: "Instant-48h" },
      "Iberia Avios": { ratio: 1.0, transferTime: "Instant-48h" },
      "Air Canada Aeroplan": { ratio: 1.0, transferTime: "Instant-48h" },
      "TAP Miles&Go": { ratio: 1.0, transferTime: "Instant-48h" },
      "Southwest Rapid Rewards": { ratio: 1.0, transferTime: "Up to 72h" },
      "Japan Airlines Mileage Bank": { ratio: 1.0, transferTime: "Instant-48h" },
      "Qatar Airways Privilege Club": { ratio: 1.0, transferTime: "Instant-48h" },
      "Etihad Guest": { ratio: 1.0, transferTime: "Instant-48h" },
    },
    hotelPartners: {
      "Hilton Honors": { ratio: 1.0, transferTime: "Instant-48h" },
      "Marriott Bonvoy": { ratio: 1.0, transferTime: "Instant-48h" },
      "World of Hyatt": { ratio: 1.0, transferTime: "Instant-48h" },
      "IHG One Rewards": { ratio: 1.0, transferTime: "Instant-48h" },
      "Accor Live Limitless": { ratio: 0.667, transferTime: "Instant-48h" },
    },
  },
};

function buildTransferPartnerBlock(): string {
  const lines: string[] = [];
  for (const [, bank] of Object.entries(TRANSFER_PARTNERS)) {
    lines.push(`\n${bank.name}:`);
    const airlineNames = Object.entries(bank.airlinePartners)
      .map(([name, p]) => `${name} (${p.ratio}:1, ${p.transferTime})`)
      .join(", ");
    lines.push(`  Airlines: ${airlineNames}`);
    const hotelNames = Object.entries(bank.hotelPartners)
      .map(([name, p]) => `${name} (${p.ratio}:1, ${p.transferTime})`)
      .join(", ");
    lines.push(`  Hotels: ${hotelNames}`);
  }
  lines.push(`\nNON-TRANSFERABLE PROGRAMS (cannot transfer to partners):`);
  lines.push(`  Discover Miles, Bank of America Points, Wells Fargo Points, US Bank Rewards — portal/statement credit only`);
  lines.push(`\nKEY EXCLUSIONS (common mistakes to avoid):`);
  lines.push(`  - Chase CANNOT transfer to Delta, American, Emirates, Cathay Pacific, ANA, Turkish, Qatar, Etihad`);
  lines.push(`  - Amex CANNOT transfer to United, American, Southwest, Alaska`);
  lines.push(`  - Citi CANNOT transfer to Delta, United, Southwest, Alaska, British Airways`);
  lines.push(`  - Capital One CANNOT transfer to Delta, United, American, Southwest, Alaska, JetBlue`);
  lines.push(`  - Bilt CANNOT transfer to Delta, American, Alaska`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItineraryInput {
  tripTitle: string;
  originAirports: string[];
  destinationAirports: string[];
  departureDate: string;
  returnDate?: string;
  travelerCount: number;
  cabinPreference?: string;
  budgetCash?: number;
  flexibilityDays?: number;
  notes?: string;
  clientName?: string;
  preferences?: {
    preferredCabin?: string;
    prefersNonstop?: boolean;
    maxLayoverMinutes?: number;
    willingToReposition?: boolean;
    avoidBasicEconomy?: boolean;
    preferredAirlines?: string[];
    avoidedAirlines?: string[];
    preferredHotelTypes?: string[];
    roomPreferences?: string[];
    locationPreferences?: string;
    redemptionStyle?: string;
    budgetSensitivity?: string;
    pointsVsCash?: string;
    foodPreferences?: string[];
    activityPreferences?: string[];
    familyConsiderations?: string;
    specialOccasions?: string[];
    dislikes?: string[];
    dealbreakers?: string[];
    notes?: string;
  };
  loyaltyBalances?: {
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
  multiCityLegs?: { leg: number; from: string[]; to: string[]; date: string }[];
}

export interface FlightRecommendation {
  segment: string;
  airline: string;
  flightExample: string;
  cabin: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  pointsOption?: {
    program: string;
    pointsRequired: number;
    transferFrom?: string;
    transferBonus?: string;
    taxes: number;
  };
  cashOption?: {
    estimatedPrice: number;
    fareClass: string;
  };
  recommendation: string;
  whyThisFlight: string;
}

export interface HotelRecommendation {
  destination: string;
  hotelName: string;
  hotelType: string;
  starRating: number;
  neighborhood: string;
  checkIn: string;
  checkOut: string;
  nightCount: number;
  pointsOption?: {
    program: string;
    pointsPerNight: number;
    totalPoints: number;
    transferFrom?: string;
  };
  cashOption?: {
    estimatedPerNight: number;
    estimatedTotal: number;
  };
  highlights: string[];
  whyThisHotel: string;
}

export interface DayPlan {
  day: number;
  date: string;
  location: string;
  theme: string;
  morning: string;
  afternoon: string;
  evening: string;
  diningRecommendation?: string;
  tips?: string;
}

export interface TransportationRecommendation {
  type: string;
  provider: string;
  route: string;
  estimatedCost: number;
  duration: string;
  notes: string;
  bookingTip?: string;
}

export interface BudgetBreakdown {
  totalEstimatedCash: number;
  totalPointsUsed: { program: string; points: number }[];
  flightsCash: number;
  flightsPoints: string;
  hotelsCash: number;
  hotelsPoints: string;
  transportationCash: number;
  activitiesAndDining: number;
  savings: string;
}

export interface GeneratedItinerary {
  summary: string;
  flights: FlightRecommendation[];
  hotels: HotelRecommendation[];
  transportation: TransportationRecommendation[];
  dailyItinerary: DayPlan[];
  budgetBreakdown: BudgetBreakdown;
  pointsStrategy: string;
  tips: string[];
  travelerFlights?: import("./flight-search").TravelerFlightGroup[];
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

export async function generateItinerary(
  input: ItineraryInput,
): Promise<GeneratedItinerary> {
  const prefsBlock = input.preferences
    ? buildPreferencesBlock(input.preferences)
    : "No preferences on file.";

  const balancesBlock = input.loyaltyBalances?.length
    ? input.loyaltyBalances
      .map(
        (b) =>
          `- ${b.programName} (${b.programCode}, ${b.category}): ${b.balance.toLocaleString()} pts`,
      )
      .join("\n")
    : "No loyalty balances on file.";

  const transferPartnersBlock = buildTransferPartnerBlock();

  const bonusesBlock = input.transferBonuses?.length
    ? input.transferBonuses
      .map(
        (b) =>
          `- ${b.fromProgram} → ${b.toProgram}: +${b.bonusPercent}% bonus (expires ${b.endsAt})`,
      )
      .join("\n")
    : "No active transfer bonuses.";

  const routeBlock = input.multiCityLegs?.length
    ? input.multiCityLegs
      .map((l) => `  Leg ${l.leg}: ${l.from.join("/")} → ${l.to.join("/")} on ${l.date}`)
      .join("\n")
    : `  ${input.originAirports.join("/")} → ${input.destinationAirports.join("/")}`;

  const tripDuration = input.returnDate
    ? Math.ceil(
      (new Date(input.returnDate).getTime() - new Date(input.departureDate).getTime()) /
      (1000 * 60 * 60 * 24),
    )
    : null;

  const prompt = `You are an elite luxury travel advisor AI. Generate a comprehensive, personalized trip itinerary based on the following trip request and client profile.

TRIP DETAILS:
- Title: ${input.tripTitle}
- Route:
${routeBlock}
- Departure: ${input.departureDate}${input.returnDate ? ` | Return: ${input.returnDate}` : " (one-way)"}${tripDuration ? ` | Duration: ${tripDuration} days` : ""}
- Travelers: ${input.travelerCount}
- Cabin Preference: ${input.cabinPreference || "any"}
${input.budgetCash ? `- Budget: $${input.budgetCash.toLocaleString()}` : ""}
${input.flexibilityDays ? `- Date Flexibility: ±${input.flexibilityDays} days` : ""}
${input.notes ? `- Notes: ${input.notes}` : ""}
${input.clientName ? `- Client: ${input.clientName}` : ""}

CLIENT PREFERENCES:
${prefsBlock}

LOYALTY BALANCES:
${balancesBlock}

CREDIT CARD TRANSFER PARTNERS (authoritative — only these transfers are possible):
${transferPartnersBlock}

ACTIVE TRANSFER BONUSES:
${bonusesBlock}

INSTRUCTIONS:
Generate a detailed itinerary as a JSON object with these sections:

1. **summary**: 3-4 sentence executive summary of the trip plan, mentioning key highlights and the overall travel strategy (points vs cash).

2. **flights**: Array of flight recommendations. For each flight segment:
   - segment: "Outbound" / "Return" / "Leg 1" etc.
   - airline: Recommended airline
   - flightExample: Example flight number or route description
   - cabin: Cabin class recommendation
   - departureTime: Approximate departure time
   - arrivalTime: Approximate arrival time
   - duration: Flight duration
   - stops: Number of stops (0 = nonstop)
   - pointsOption: If loyalty balances support it, include { program, pointsRequired, transferFrom (if transfer partner), transferBonus (e.g. "+30% bonus through June"), taxes (estimated in USD) }. Only suggest this if the client has enough points or can transfer.
   - cashOption: { estimatedPrice (USD), fareClass }
   - recommendation: "points" or "cash" — which is the better value
   - whyThisFlight: 1-2 sentences on why this flight suits this traveler

3. **hotels**: Array of hotel recommendations for each destination/stop:
   - destination, hotelName, hotelType (boutique/resort/luxury chain/etc.), starRating (1-5)
   - neighborhood: Area description
   - checkIn, checkOut dates, nightCount
   - pointsOption: If applicable, { program, pointsPerNight, totalPoints, transferFrom }
   - cashOption: { estimatedPerNight, estimatedTotal } in USD
   - highlights: 3-4 feature highlights
   - whyThisHotel: 1-2 sentences on why this hotel matches the client

4. **transportation**: Array of ground transportation recommendations (airport transfers, car rentals, trains, ride services, etc.):
   - type: "airport_transfer" / "car_rental" / "ride_service" / "train" / "private_car" / "shuttle"
   - provider: Specific provider name (e.g., "Uber Black", "Hertz", "Amtrak")
   - route: Description of the route (e.g., "JFK Airport → Manhattan Hotel")
   - estimatedCost: Cost in USD
   - duration: Estimated travel time
   - notes: Why this option is recommended
   - bookingTip: Optional booking tip (promo codes, timing advice, etc.)

5. **dailyItinerary**: Array of day-by-day plans:
   - day (number), date, location, theme (e.g., "Arrival & Exploration")
   - morning, afternoon, evening: Activity descriptions
   - diningRecommendation: Restaurant or cuisine suggestion
   - tips: Practical tips for that day

6. **budgetBreakdown**: Overall budget summary:
   - totalEstimatedCash: Total out-of-pocket in USD
   - totalPointsUsed: Array of { program, points } used
   - flightsCash, flightsPoints (summary string), hotelsCash, hotelsPoints (summary string)
   - transportationCash: Total ground transportation estimate
   - activitiesAndDining: Estimated daily activities/food budget
   - savings: Description of savings from points usage

7. **pointsStrategy**: 2-3 sentences explaining the points/transfer strategy, including which programs to transfer from, the transfer ratios, and any current transfer bonuses to take advantage of. Mention specific transfer partnerships used.

8. **tips**: Array of 4-6 practical travel tips specific to this trip (visa requirements, weather, packing, local customs, transportation, etc.)

CRITICAL TRANSFER RULES — YOU MUST FOLLOW THESE:
- ONLY suggest transfers that appear in the CREDIT CARD TRANSFER PARTNERS list above. If a bank→airline or bank→hotel path is not listed, it does NOT exist.
- Chase CANNOT transfer to Delta, American, Emirates, ANA, Turkish, Qatar, Etihad, Cathay Pacific, or Alaska.
- Amex CANNOT transfer to United, American, Southwest, or Alaska.
- Citi CANNOT transfer to Delta, United, Southwest, or Alaska.
- Capital One CANNOT transfer to Delta, United, American, Southwest, Alaska, or JetBlue.
- Bilt CANNOT transfer to Delta, American, or Alaska.
- When a transfer bonus is active, factor it into the value calculation (e.g., a 30% bonus means 100k points become 130k miles).
- Include the transfer ratio in pointsOption.transferFrom (e.g., "Chase Ultimate Rewards (1:1)").
- If the best airline for a route is not a transfer partner of the client's bank, recommend the best available partner airline or suggest paying cash.

ADDITIONAL RULES:
- Be realistic with pricing estimates (as of 2024-2025 market rates)
- If the client has loyalty points, prioritize using them where they get the best value (aim for >1.5 cpp on flights, >0.7 cpp on hotels)
- Respect all client preferences and dealbreakers
- Match the cabin class to the client's preference or stored preference
- If client prefers nonstop, prioritize direct flights
- Personalize activities based on activityPreferences, foodPreferences, and dislikes
- Account for familyConsiderations and specialOccasions if present
- For multi-city trips, plan logistics between cities

Return ONLY a valid JSON object matching the structure above.`;

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackItinerary(input);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  const parsed = JSON.parse(content);

  return {
    summary: parsed.summary || "",
    flights: (parsed.flights || []).map(normalizeFlightRec),
    hotels: (parsed.hotels || []).map(normalizeHotelRec),
    transportation: (parsed.transportation || []).map(normalizeTransportRec),
    dailyItinerary: (parsed.dailyItinerary || parsed.daily_itinerary || []).map(normalizeDayPlan),
    budgetBreakdown: normalizeBudget(parsed.budgetBreakdown || parsed.budget_breakdown || {}),
    pointsStrategy: parsed.pointsStrategy || parsed.points_strategy || "",
    tips: parsed.tips || [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPreferencesBlock(prefs: NonNullable<ItineraryInput["preferences"]>): string {
  const lines: string[] = [];

  if (prefs.preferredCabin) lines.push(`Preferred Cabin: ${prefs.preferredCabin}`);
  if (prefs.prefersNonstop != null) lines.push(`Prefers Nonstop: ${prefs.prefersNonstop ? "Yes" : "No"}`);
  if (prefs.maxLayoverMinutes) lines.push(`Max Layover: ${prefs.maxLayoverMinutes} min`);
  if (prefs.avoidBasicEconomy) lines.push(`Avoid Basic Economy: Yes`);
  if (prefs.preferredAirlines?.length) lines.push(`Preferred Airlines: ${prefs.preferredAirlines.join(", ")}`);
  if (prefs.avoidedAirlines?.length) lines.push(`Avoided Airlines: ${prefs.avoidedAirlines.join(", ")}`);
  if (prefs.preferredHotelTypes?.length) lines.push(`Hotel Types: ${prefs.preferredHotelTypes.join(", ")}`);
  if (prefs.roomPreferences?.length) lines.push(`Room Preferences: ${prefs.roomPreferences.join(", ")}`);
  if (prefs.locationPreferences) lines.push(`Location Preference: ${prefs.locationPreferences}`);
  if (prefs.redemptionStyle) lines.push(`Redemption Style: ${prefs.redemptionStyle}`);
  if (prefs.budgetSensitivity) lines.push(`Budget Sensitivity: ${prefs.budgetSensitivity}`);
  if (prefs.pointsVsCash) lines.push(`Points vs Cash: ${prefs.pointsVsCash}`);
  if (prefs.foodPreferences?.length) lines.push(`Food: ${prefs.foodPreferences.join(", ")}`);
  if (prefs.activityPreferences?.length) lines.push(`Activities: ${prefs.activityPreferences.join(", ")}`);
  if (prefs.familyConsiderations) lines.push(`Family: ${prefs.familyConsiderations}`);
  if (prefs.specialOccasions?.length) lines.push(`Occasions: ${prefs.specialOccasions.join(", ")}`);
  if (prefs.dislikes?.length) lines.push(`Dislikes: ${prefs.dislikes.join(", ")}`);
  if (prefs.dealbreakers?.length) lines.push(`Dealbreakers: ${prefs.dealbreakers.join(", ")}`);
  if (prefs.notes) lines.push(`Notes: ${prefs.notes}`);

  return lines.length > 0 ? lines.join("\n") : "No preferences on file.";
}

function normalizeFlightRec(f: Record<string, unknown>): FlightRecommendation {
  return {
    segment: (f.segment as string) || "",
    airline: (f.airline as string) || "",
    flightExample: (f.flightExample as string) || (f.flight_example as string) || "",
    cabin: (f.cabin as string) || "",
    departureTime: (f.departureTime as string) || (f.departure_time as string) || "",
    arrivalTime: (f.arrivalTime as string) || (f.arrival_time as string) || "",
    duration: (f.duration as string) || "",
    stops: (f.stops as number) ?? 0,
    pointsOption: f.pointsOption as FlightRecommendation["pointsOption"] ?? f.points_option as FlightRecommendation["pointsOption"] ?? undefined,
    cashOption: f.cashOption as FlightRecommendation["cashOption"] ?? f.cash_option as FlightRecommendation["cashOption"] ?? undefined,
    recommendation: (f.recommendation as string) || "cash",
    whyThisFlight: (f.whyThisFlight as string) || (f.why_this_flight as string) || "",
  };
}

function normalizeHotelRec(h: Record<string, unknown>): HotelRecommendation {
  return {
    destination: (h.destination as string) || "",
    hotelName: (h.hotelName as string) || (h.hotel_name as string) || "",
    hotelType: (h.hotelType as string) || (h.hotel_type as string) || "",
    starRating: (h.starRating as number) ?? (h.star_rating as number) ?? 4,
    neighborhood: (h.neighborhood as string) || "",
    checkIn: (h.checkIn as string) || (h.check_in as string) || "",
    checkOut: (h.checkOut as string) || (h.check_out as string) || "",
    nightCount: (h.nightCount as number) ?? (h.night_count as number) ?? 1,
    pointsOption: h.pointsOption as HotelRecommendation["pointsOption"] ?? h.points_option as HotelRecommendation["pointsOption"] ?? undefined,
    cashOption: h.cashOption as HotelRecommendation["cashOption"] ?? h.cash_option as HotelRecommendation["cashOption"] ?? undefined,
    highlights: (h.highlights as string[]) || [],
    whyThisHotel: (h.whyThisHotel as string) || (h.why_this_hotel as string) || "",
  };
}

function normalizeTransportRec(t: Record<string, unknown>): TransportationRecommendation {
  return {
    type: (t.type as string) || "car_rental",
    provider: (t.provider as string) || "",
    route: (t.route as string) || "",
    estimatedCost: (t.estimatedCost as number) ?? (t.estimated_cost as number) ?? 0,
    duration: (t.duration as string) || "",
    notes: (t.notes as string) || "",
    bookingTip: (t.bookingTip as string) || (t.booking_tip as string) || undefined,
  };
}

function normalizeDayPlan(d: Record<string, unknown>): DayPlan {
  return {
    day: (d.day as number) ?? 1,
    date: (d.date as string) || "",
    location: (d.location as string) || "",
    theme: (d.theme as string) || "",
    morning: (d.morning as string) || "",
    afternoon: (d.afternoon as string) || "",
    evening: (d.evening as string) || "",
    diningRecommendation: (d.diningRecommendation as string) || (d.dining_recommendation as string) || undefined,
    tips: (d.tips as string) || undefined,
  };
}

function normalizeBudget(b: Record<string, unknown>): BudgetBreakdown {
  return {
    totalEstimatedCash: (b.totalEstimatedCash as number) ?? (b.total_estimated_cash as number) ?? 0,
    totalPointsUsed: (b.totalPointsUsed as BudgetBreakdown["totalPointsUsed"]) ?? (b.total_points_used as BudgetBreakdown["totalPointsUsed"]) ?? [],
    flightsCash: (b.flightsCash as number) ?? (b.flights_cash as number) ?? 0,
    flightsPoints: (b.flightsPoints as string) ?? (b.flights_points as string) ?? "",
    hotelsCash: (b.hotelsCash as number) ?? (b.hotels_cash as number) ?? 0,
    hotelsPoints: (b.hotelsPoints as string) ?? (b.hotels_points as string) ?? "",
    transportationCash: (b.transportationCash as number) ?? (b.transportation_cash as number) ?? 0,
    activitiesAndDining: (b.activitiesAndDining as number) ?? (b.activities_and_dining as number) ?? 0,
    savings: (b.savings as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// Fallback (no OpenAI key)
// ---------------------------------------------------------------------------

function generateFallbackItinerary(input: ItineraryInput): GeneratedItinerary {
  const origin = input.originAirports.join("/");
  const dest = input.destinationAirports.join("/");
  const cabin = input.cabinPreference || input.preferences?.preferredCabin || "economy";
  const tripDays = input.returnDate
    ? Math.ceil(
      (new Date(input.returnDate).getTime() - new Date(input.departureDate).getTime()) /
      (1000 * 60 * 60 * 24),
    )
    : 3;

  const dailyPlans: DayPlan[] = [];
  for (let i = 0; i < tripDays; i++) {
    const date = new Date(input.departureDate);
    date.setDate(date.getDate() + i);
    dailyPlans.push({
      day: i + 1,
      date: date.toISOString().split("T")[0],
      location: dest,
      theme: i === 0 ? "Arrival & Settle In" : i === tripDays - 1 ? "Departure Day" : "Exploration Day",
      morning: i === 0 ? "Arrive and check into hotel. Freshen up and get oriented." : "Explore local sights and attractions.",
      afternoon: i === 0 ? "Light neighborhood walk to acclimate. Visit a nearby café." : "Guided tour or cultural experience.",
      evening: "Dinner at a recommended local restaurant.",
      diningRecommendation: "Ask your concierge for current top-rated restaurants in the area.",
      tips: i === 0 ? "Keep your first day light to adjust to the time zone." : undefined,
    });
  }

  const hasPoints = input.loyaltyBalances && input.loyaltyBalances.length > 0;

  return {
    summary: `A ${tripDays}-day trip from ${origin} to ${dest} for ${input.travelerCount} traveler${input.travelerCount > 1 ? "s" : ""} in ${cabin} class. ${hasPoints ? "Points redemption opportunities available from your loyalty accounts." : "Cash bookings recommended."} Set up your OpenAI API key for detailed, personalized recommendations.`,
    flights: [
      {
        segment: "Outbound",
        airline: "Major carrier on this route",
        flightExample: `${origin} → ${dest}`,
        cabin: cabin.replace("_", " "),
        departureTime: "Morning departure recommended",
        arrivalTime: "Check specific flight schedules",
        duration: "Varies by route",
        stops: 0,
        cashOption: { estimatedPrice: 0, fareClass: cabin },
        recommendation: "cash",
        whyThisFlight: "Connect your OpenAI API key for specific flight recommendations with pricing.",
      },
      ...(input.returnDate
        ? [
          {
            segment: "Return" as const,
            airline: "Major carrier on this route",
            flightExample: `${dest} → ${origin}`,
            cabin: cabin.replace("_", " "),
            departureTime: "Afternoon departure recommended",
            arrivalTime: "Check specific flight schedules",
            duration: "Varies by route",
            stops: 0,
            cashOption: { estimatedPrice: 0, fareClass: cabin },
            recommendation: "cash" as const,
            whyThisFlight: "Connect your OpenAI API key for specific flight recommendations with pricing.",
          },
        ]
        : []),
    ],
    hotels: [
      {
        destination: dest,
        hotelName: "Top-rated hotel in destination",
        hotelType: input.preferences?.preferredHotelTypes?.[0] || "luxury",
        starRating: 4,
        neighborhood: "Central location recommended",
        checkIn: input.departureDate,
        checkOut: input.returnDate || input.departureDate,
        nightCount: Math.max(1, tripDays - 1),
        cashOption: { estimatedPerNight: 0, estimatedTotal: 0 },
        highlights: ["Central location", "Highly rated", "Matches your style preferences"],
        whyThisHotel: "Connect your OpenAI API key for specific hotel recommendations with pricing.",
      },
    ],
    transportation: [
      {
        type: "airport_transfer",
        provider: "Recommended car service",
        route: `${dest} Airport → Hotel`,
        estimatedCost: 0,
        duration: "Varies",
        notes: "Connect your OpenAI API key for specific transportation recommendations.",
      },
    ],
    dailyItinerary: dailyPlans,
    budgetBreakdown: {
      totalEstimatedCash: 0,
      totalPointsUsed: [],
      flightsCash: 0,
      flightsPoints: "Connect OpenAI for points analysis",
      hotelsCash: 0,
      hotelsPoints: "Connect OpenAI for points analysis",
      transportationCash: 0,
      activitiesAndDining: 0,
      savings: "Connect your OpenAI API key for detailed budget analysis",
    },
    pointsStrategy: hasPoints
      ? `You have loyalty balances that could be used for this trip. Connect your OpenAI API key for a detailed points optimization strategy.`
      : "No loyalty balances found. Cash bookings will be recommended.",
    tips: [
      "Check passport validity — many countries require 6 months remaining.",
      "Research visa requirements for your destination well in advance.",
      "Consider travel insurance for trip protection.",
      "Download offline maps for your destination.",
      "Connect your OpenAI API key for personalized, destination-specific tips.",
    ],
  };
}
