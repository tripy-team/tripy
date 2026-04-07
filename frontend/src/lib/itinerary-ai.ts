// ---------------------------------------------------------------------------
// Transfer partner reference (mirrors backend/src/config/programs.yml)
// ---------------------------------------------------------------------------

interface TransferPartner {
  ratio: number;
  transferTime: string;
}

export interface BankTransferPartners {
  name: string;
  airlinePartners: Record<string, TransferPartner>;
  hotelPartners: Record<string, TransferPartner>;
}

export const TRANSFER_PARTNERS: Record<string, BankTransferPartners> = {
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

export interface BudgetBreakdown {
  totalEstimatedCash: number;
  totalPointsUsed: { program: string; points: number }[];
  flightsCash: number;
  flightsPoints: string;
  hotelsCash: number;
  hotelsPoints: string;
  savings: string;
}

export interface GeneratedItinerary {
  summary: string;
  flights: FlightRecommendation[];
  hotels: HotelRecommendation[];
  budgetBreakdown: BudgetBreakdown;
  pointsStrategy: string;
  tips: string[];
  travelerFlights?: import("./flight-search").TravelerFlightGroup[];
  travelerHotels?: import("./hotel-search").TravelerHotelGroup[];
}

// ---------------------------------------------------------------------------
// Main generation — AI-powered personalized trip summary + strategy.
// Flights and hotels come from live search algorithms in parallel.
// ---------------------------------------------------------------------------

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export async function generateItinerary(
  input: ItineraryInput,
): Promise<GeneratedItinerary> {
  const origin = input.originAirports.join("/");
  const dest = input.destinationAirports.join("/");
  const tripDays = input.returnDate
    ? Math.ceil(
        (new Date(input.returnDate).getTime() - new Date(input.departureDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackItinerary(input, origin, dest, tripDays);
  }

  try {
    return await generateWithAI(input, origin, dest, tripDays);
  } catch (err) {
    console.error("AI itinerary generation failed, using fallback:", err);
    return buildFallbackItinerary(input, origin, dest, tripDays);
  }
}

async function generateWithAI(
  input: ItineraryInput,
  origin: string,
  dest: string,
  tripDays: number | null,
): Promise<GeneratedItinerary> {
  const prefs = input.preferences;
  const balances = input.loyaltyBalances ?? [];
  const bonuses = input.transferBonuses ?? [];

  const loyaltyBlock = balances.length > 0
    ? balances.map((b) => `  ${b.programName} (${b.category}): ${b.balance.toLocaleString()} pts`).join("\n")
    : "  None";

  const bonusBlock = bonuses.length > 0
    ? bonuses.map((b) => `  ${b.fromProgram} → ${b.toProgram}: +${b.bonusPercent}% (exp ${b.endsAt})`).join("\n")
    : "  None";

  const prefsBlock = prefs
    ? [
        prefs.preferredCabin ? `Cabin: ${prefs.preferredCabin}` : null,
        prefs.prefersNonstop ? "Prefers nonstop flights" : null,
        prefs.preferredAirlines?.length ? `Preferred airlines: ${prefs.preferredAirlines.join(", ")}` : null,
        prefs.avoidedAirlines?.length ? `Avoid airlines: ${prefs.avoidedAirlines.join(", ")}` : null,
        prefs.avoidBasicEconomy ? "Avoid basic economy" : null,
        prefs.maxLayoverMinutes ? `Max layover: ${prefs.maxLayoverMinutes} min` : null,
        prefs.preferredHotelTypes?.length ? `Hotel types: ${prefs.preferredHotelTypes.join(", ")}` : null,
        prefs.roomPreferences?.length ? `Room prefs: ${prefs.roomPreferences.join(", ")}` : null,
        prefs.locationPreferences ? `Location: ${prefs.locationPreferences}` : null,
        prefs.redemptionStyle ? `Redemption style: ${prefs.redemptionStyle}` : null,
        prefs.budgetSensitivity ? `Budget sensitivity: ${prefs.budgetSensitivity}` : null,
        prefs.pointsVsCash ? `Points vs cash: ${prefs.pointsVsCash}` : null,
        prefs.foodPreferences?.length ? `Food: ${prefs.foodPreferences.join(", ")}` : null,
        prefs.activityPreferences?.length ? `Activities: ${prefs.activityPreferences.join(", ")}` : null,
        prefs.familyConsiderations ? `Family: ${prefs.familyConsiderations}` : null,
        prefs.specialOccasions?.length ? `Occasions: ${prefs.specialOccasions.join(", ")}` : null,
        prefs.dislikes?.length ? `Dislikes: ${prefs.dislikes.join(", ")}` : null,
        prefs.dealbreakers?.length ? `Dealbreakers: ${prefs.dealbreakers.join(", ")}` : null,
        prefs.notes ? `Notes: ${prefs.notes}` : null,
      ]
        .filter(Boolean)
        .map((l) => `  ${l}`)
        .join("\n") || "  No preferences recorded"
    : "  No preferences recorded";

  const transferPartnersBlock = Object.entries(TRANSFER_PARTNERS)
    .map(([, bank]) => {
      const airlines = Object.entries(bank.airlinePartners)
        .map(([name, p]) => `${name} (${p.ratio}:1)`)
        .join(", ");
      return `  ${bank.name}: ${airlines}`;
    })
    .join("\n");

  const prompt = `You are an expert luxury travel advisor creating a personalized trip plan.

TRIP:
- Client: ${input.clientName ?? "Guest"}
- Title: ${input.tripTitle}
- From: ${origin} → ${dest}
- Dates: ${input.departureDate}${input.returnDate ? ` to ${input.returnDate}` : " (one-way)"}${tripDays ? ` (${tripDays} days)` : ""}
- Travelers: ${input.travelerCount}${input.cabinPreference ? `\n- Cabin preference: ${input.cabinPreference}` : ""}${input.budgetCash ? `\n- Budget: $${input.budgetCash.toLocaleString()}` : ""}${input.notes ? `\n- Notes: ${input.notes}` : ""}

CLIENT PREFERENCES:
${prefsBlock}

LOYALTY PORTFOLIO:
${loyaltyBlock}

TRANSFER PARTNERS:
${transferPartnersBlock}

ACTIVE TRANSFER BONUSES:
${bonusBlock}

Generate a JSON response with this structure:
{
  "summary": "2-4 sentence personalized trip overview referencing the client's preferences, loyalty portfolio, and best strategies",
  "pointsStrategy": "2-3 sentence strategy explaining the best way to use their points/miles for this trip, including specific transfer partner recommendations",
  "tips": ["3-5 actionable, personalized tips for this specific trip and client"]
}

Be specific. Reference their actual loyalty programs, preferences, and any active bonuses. If they have preferences for nonstop flights, mention that. If they have strong airline preferences, factor those in. The summary should feel like it was written by their personal travel advisor who knows them well.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Respond with valid JSON only. Be concise but specific." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
    max_tokens: 1024,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);

  return {
    summary: parsed.summary || `A ${tripDays ?? "multi"}-day trip from ${origin} to ${dest}.`,
    flights: [],
    hotels: [],
    budgetBreakdown: {
      totalEstimatedCash: 0,
      totalPointsUsed: [],
      flightsCash: 0,
      flightsPoints: "See Flights tab for live pricing",
      hotelsCash: 0,
      hotelsPoints: "See Hotels tab for live pricing",
      savings: "",
    },
    pointsStrategy: parsed.pointsStrategy || "",
    tips: parsed.tips || [],
  };
}

function buildFallbackItinerary(
  input: ItineraryInput,
  origin: string,
  dest: string,
  tripDays: number | null,
): GeneratedItinerary {
  const prefs = input.preferences;
  const balances = input.loyaltyBalances ?? [];
  const tips: string[] = [];

  let summary = `A ${tripDays ?? "multi"}-day trip from ${origin} to ${dest} for ${input.travelerCount} traveler${input.travelerCount > 1 ? "s" : ""}.`;
  if (prefs?.preferredCabin) {
    summary += ` ${prefs.preferredCabin.charAt(0).toUpperCase() + prefs.preferredCabin.slice(1)} cabin preferred.`;
  }
  if (prefs?.prefersNonstop) {
    summary += " Nonstop flights prioritized.";
  }
  summary += " Flight and hotel options sourced from live pricing data.";

  if (prefs?.prefersNonstop) tips.push("Nonstop flights have been prioritized in search results per your preference.");
  if (prefs?.preferredAirlines?.length) tips.push(`Results ranked to favor ${prefs.preferredAirlines.join(", ")}.`);
  if (prefs?.avoidedAirlines?.length) tips.push(`Flights on ${prefs.avoidedAirlines.join(", ")} have been deprioritized.`);

  const bankBalances = balances.filter((b) => b.category?.toLowerCase() === "transferable_bank");
  if (bankBalances.length > 0) {
    tips.push(`Check transfer partner rates for ${bankBalances.map((b) => b.programName).join(", ")} — award flights may offer excellent value.`);
  }

  const bonuses = input.transferBonuses ?? [];
  if (bonuses.length > 0) {
    tips.push(`Active transfer bonus: ${bonuses[0].fromProgram} → ${bonuses[0].toProgram} +${bonuses[0].bonusPercent}% (expires ${bonuses[0].endsAt}).`);
  }

  if (tips.length === 0) tips.push("Compare cash and award pricing in the Flights tab for the best deal.");

  let pointsStrategy = "";
  if (balances.length > 0) {
    const topBalance = [...balances].sort((a, b) => b.balance - a.balance)[0];
    pointsStrategy = `Your largest balance is ${topBalance.programName} with ${topBalance.balance.toLocaleString()} points. Check the Flights and Hotels tabs for award redemption options.`;
  }

  return {
    summary,
    flights: [],
    hotels: [],
    budgetBreakdown: {
      totalEstimatedCash: 0,
      totalPointsUsed: [],
      flightsCash: 0,
      flightsPoints: "See Flights tab for live pricing",
      hotelsCash: 0,
      hotelsPoints: "See Hotels tab for live pricing",
      savings: "",
    },
    pointsStrategy,
    tips,
  };
}

