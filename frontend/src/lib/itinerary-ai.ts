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
// Shared context builders — each call gets ONLY the context it needs
// ---------------------------------------------------------------------------

function buildTripHeader(input: ItineraryInput): string {
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

  return `Route: ${routeBlock.trim()}
Departure: ${input.departureDate}${input.returnDate ? ` | Return: ${input.returnDate}` : " (one-way)"}${tripDuration ? ` | ${tripDuration} days` : ""}
Travelers: ${input.travelerCount} | Cabin: ${input.cabinPreference || "any"}${input.budgetCash ? ` | Budget: $${input.budgetCash.toLocaleString()}` : ""}${input.notes ? `\nNotes: ${input.notes}` : ""}`;
}

function buildLoyaltyBlock(input: ItineraryInput): string {
  return input.loyaltyBalances?.length
    ? input.loyaltyBalances
      .map((b) => `${b.programName}: ${b.balance.toLocaleString()} pts`)
      .join(", ")
    : "None";
}

function buildBonusBlock(input: ItineraryInput): string {
  return input.transferBonuses?.length
    ? input.transferBonuses
      .map((b) => `${b.fromProgram}→${b.toProgram}: +${b.bonusPercent}% (exp ${b.endsAt})`)
      .join("; ")
    : "None";
}

// Only flights & hotels need this heavy block
function buildTransferContext(input: ItineraryInput): string {
  return `TRANSFER PARTNERS (authoritative):
${buildTransferPartnerBlock()}

TRANSFER BONUSES: ${buildBonusBlock(input)}

RULES: Only suggest transfers listed above. Chase≠Delta/AA/Emirates/ANA/Turkish/Qatar/Etihad/Cathay/Alaska. Amex≠United/AA/Southwest/Alaska. Citi≠Delta/United/Southwest/Alaska. CapOne≠Delta/United/AA/Southwest/Alaska/JetBlue. Bilt≠Delta/AA/Alaska. Include transfer ratio in transferFrom field.`;
}

// ---------------------------------------------------------------------------
// 8 parallel micro-generators — each produces one section
// ---------------------------------------------------------------------------

function aiCall(prompt: string, maxTokens: number): Promise<string> {
  return openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Respond with valid JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_tokens: maxTokens,
  }).then((r) => r.choices[0]?.message?.content || "{}");
}

async function genFlights(input: ItineraryInput, header: string): Promise<FlightRecommendation[]> {
  const prefs = input.preferences ? buildPreferencesBlock(input.preferences) : "";
  const prompt = `Travel advisor: recommend flights as JSON.

${header}
${prefs ? `Preferences: ${prefs}` : ""}
Loyalty: ${buildLoyaltyBlock(input)}
${buildTransferContext(input)}

Return {"flights":[...]} where each has: segment, airline, flightExample, cabin, departureTime, arrivalTime, duration, stops, pointsOption:{program,pointsRequired,transferFrom,transferBonus,taxes}, cashOption:{estimatedPrice,fareClass}, recommendation("points"/"cash"), whyThisFlight. Use 2024-2025 pricing. Prioritize points >1.5cpp.`;

  const parsed = JSON.parse(await aiCall(prompt, 1024));
  return (parsed.flights || []).map(normalizeFlightRec);
}

async function genHotels(input: ItineraryInput, header: string): Promise<HotelRecommendation[]> {
  const prefs = input.preferences ? buildPreferencesBlock(input.preferences) : "";
  const prompt = `Travel advisor: recommend hotels as JSON.

${header}
${prefs ? `Preferences: ${prefs}` : ""}
Loyalty: ${buildLoyaltyBlock(input)}
${buildTransferContext(input)}

Return {"hotels":[...]} where each has: destination, hotelName, hotelType, starRating(1-5), neighborhood, checkIn, checkOut, nightCount, pointsOption:{program,pointsPerNight,totalPoints,transferFrom}, cashOption:{estimatedPerNight,estimatedTotal}, highlights(3-4), whyThisHotel. Use 2024-2025 pricing. Prioritize points >0.7cpp.`;

  const parsed = JSON.parse(await aiCall(prompt, 1024));
  return (parsed.hotels || []).map(normalizeHotelRec);
}

async function genPointsStrategy(input: ItineraryInput, header: string): Promise<string> {
  const prompt = `Travel advisor: write a points/transfer strategy for this trip.

${header}
Loyalty: ${buildLoyaltyBlock(input)}
${buildTransferContext(input)}

Return {"pointsStrategy":"..."} — 2-3 sentences on which programs to transfer from, ratios, and any active bonuses.`;

  const parsed = JSON.parse(await aiCall(prompt, 256));
  return parsed.pointsStrategy || parsed.points_strategy || "";
}

async function genTransportation(input: ItineraryInput, header: string): Promise<TransportationRecommendation[]> {
  const prompt = `Travel advisor: recommend ground transportation as JSON.

${header}

Return {"transportation":[...]} where each has: type("airport_transfer"/"car_rental"/"ride_service"/"train"/"private_car"/"shuttle"), provider, route, estimatedCost(USD), duration, notes, bookingTip. Use 2024-2025 pricing.`;

  const parsed = JSON.parse(await aiCall(prompt, 512));
  return (parsed.transportation || []).map(normalizeTransportRec);
}

async function genDailyItinerary(input: ItineraryInput, header: string): Promise<DayPlan[]> {
  const prefs = input.preferences ? buildPreferencesBlock(input.preferences) : "";
  const prompt = `Travel advisor: create a day-by-day itinerary as JSON.

${header}
${prefs ? `Preferences: ${prefs}` : ""}

Return {"dailyItinerary":[...]} where each day has: day(number), date, location, theme, morning, afternoon, evening, diningRecommendation, tips. Personalize for client preferences.`;

  const parsed = JSON.parse(await aiCall(prompt, 1536));
  return (parsed.dailyItinerary || parsed.daily_itinerary || []).map(normalizeDayPlan);
}

async function genTips(input: ItineraryInput, header: string): Promise<string[]> {
  const prompt = `Travel advisor: give 4-6 practical travel tips for this trip (visa, weather, packing, customs, transport).

${header}

Return {"tips":["...", ...]}`;

  const parsed = JSON.parse(await aiCall(prompt, 256));
  return parsed.tips || [];
}

async function genSummary(input: ItineraryInput, header: string): Promise<string> {
  const hasPoints = input.loyaltyBalances && input.loyaltyBalances.length > 0;
  const prompt = `Travel advisor: write a 3-4 sentence executive trip summary.

${header}
${hasPoints ? `Loyalty: ${buildLoyaltyBlock(input)}` : ""}

Return {"summary":"..."} mentioning key highlights and travel strategy.`;

  const parsed = JSON.parse(await aiCall(prompt, 256));
  return parsed.summary || "";
}

async function genBudget(input: ItineraryInput, header: string): Promise<BudgetBreakdown> {
  const prompt = `Travel advisor: estimate a budget breakdown as JSON.

${header}
Loyalty: ${buildLoyaltyBlock(input)}
Transfer Bonuses: ${buildBonusBlock(input)}

Return {"budgetBreakdown":{totalEstimatedCash, totalPointsUsed:[{program,points}], flightsCash, flightsPoints(string), hotelsCash, hotelsPoints(string), transportationCash, activitiesAndDining, savings(string)}}. Use 2024-2025 pricing.`;

  const parsed = JSON.parse(await aiCall(prompt, 512));
  return normalizeBudget(parsed.budgetBreakdown || parsed.budget_breakdown || {});
}

// ---------------------------------------------------------------------------
// Main generation — fires 8 independent AI calls in parallel
// ---------------------------------------------------------------------------

export async function generateItinerary(
  input: ItineraryInput,
): Promise<GeneratedItinerary> {
  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackItinerary(input);
  }

  const header = buildTripHeader(input);

  const [flights, hotels, pointsStrategy, transportation, dailyItinerary, tips, summary, budgetBreakdown] =
    await Promise.all([
      genFlights(input, header),
      genHotels(input, header),
      genPointsStrategy(input, header),
      genTransportation(input, header),
      genDailyItinerary(input, header),
      genTips(input, header),
      genSummary(input, header),
      genBudget(input, header),
    ]);

  return { summary, flights, hotels, transportation, dailyItinerary, budgetBreakdown, pointsStrategy, tips };
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
