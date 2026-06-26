// ---------------------------------------------------------------------------
// Flight Search — SerpAPI (cash) + Seats.aero / AwardTool (award/points)
//
// Award results are filtered to programs the client can actually reach,
// either directly (airline loyalty balance) or via transfer from a bank
// program (Chase UR, Amex MR, etc.).
// ---------------------------------------------------------------------------

import { TRANSFER_PARTNERS } from "./itinerary-ai";

function getSerpApiKey() { return process.env.SERPAPI_KEY ?? ""; }
function getSeatsAeroKey() { return process.env.SEATS_AERO_API_KEY ?? ""; }
function getAwardToolKey() { return process.env.AWARDTOOL_API_KEY ?? ""; }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlightSearchParams {
  origin: string;
  destination: string;
  date: string;
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
  adults?: number;
  returnDate?: string;
}

export interface CashFlightResult {
  airline: string;
  airlineLogo?: string;
  flightNumber: string;
  departureAirport: string;
  departureTime: string;
  arrivalAirport: string;
  arrivalTime: string;
  duration: number;
  stops: number;
  layovers: { airport: string; durationMin: number }[];
  price: number;
  fareClass: string;
  cabin: string;
  bookingToken?: string;
  hasCarrierChange?: boolean;
  isRedeye?: boolean;
  score?: number;
}

export interface AwardFlightResult {
  source: string;
  origin: string;
  destination: string;
  date: string;
  cabin: "economy" | "premium_economy" | "business" | "first";
  milesRequired: number;
  taxes: number;
  seatsRemaining?: number;
  isDirect: boolean;
  airlines?: string;
  program: string;
  cppValue?: number;
  score?: number;
  transferSource?: string;
  // Flight details (when the award source exposes them — e.g. AwardTool).
  // Seats.aero's availability search does not return these.
  flightNumber?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: number;
  stops?: number;
}

export interface TravelerFlightGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  segments: FlightSegment[];
}

export interface FlightSegment {
  segmentLabel: string;
  origin: string;
  destination: string;
  date: string;
  cashOptions: CashFlightResult[];
  awardOptions: AwardFlightResult[];
}

// ---------------------------------------------------------------------------
// Cabin mapping helpers
// ---------------------------------------------------------------------------

const SERP_CABIN_MAP: Record<string, number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

const SEATS_CABIN_CODE: Record<string, string> = {
  economy: "Y",
  premium_economy: "W",
  business: "J",
  first: "F",
};

const AWARDTOOL_CABIN_MAP: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium Economy",
  business: "Business",
  first: "First",
};

const AWARDTOOL_DEFAULT_PROGRAMS = [
  "UA", "AA", "DL", "AS", "AC", "EK", "EY", "QR", "VS", "SQ",
  "TK", "AV", "AF", "QF", "B6", "BA",
];

const PROGRAM_NAMES: Record<string, string> = {
  united: "United MileagePlus",
  american: "American AAdvantage",
  delta: "Delta SkyMiles",
  alaska: "Alaska Mileage Plan",
  aeroplan: "Air Canada Aeroplan",
  emirates: "Emirates Skywards",
  etihad: "Etihad Guest",
  qatar: "Qatar Avios",
  virgin_atlantic: "Virgin Atlantic Flying Club",
  singapore: "Singapore KrisFlyer",
  turkish: "Turkish Miles&Smiles",
  lifemiles: "Avianca LifeMiles",
  flyingblue: "Air France/KLM Flying Blue",
  qantas: "Qantas Frequent Flyer",
  jetblue: "JetBlue TrueBlue",
  copaconnectmiles: "Copa ConnectMiles",
  aeromexico: "Aeromexico Club Premier",
  velocity: "Virgin Australia Velocity",
  smiles: "GOL Smiles",
  azul: "Azul TudoAzul",
  am_connect: "Aeromexico Punto",
  eurobonus: "SAS EuroBonus",
  avios: "British Airways Avios",
};

// ---------------------------------------------------------------------------
// Loyalty-aware program reachability
//
// Maps airline partner names (from TRANSFER_PARTNERS) to the identifiers
// used by AwardTool (IATA codes) and Seats.aero (source slugs).
// ---------------------------------------------------------------------------

const PARTNER_NAME_TO_CODES: Record<string, { iata: string; source: string }> = {
  "United MileagePlus": { iata: "UA", source: "united" },
  "Southwest Rapid Rewards": { iata: "WN", source: "southwest" },
  "JetBlue TrueBlue": { iata: "B6", source: "jetblue" },
  "Air Canada Aeroplan": { iata: "AC", source: "aeroplan" },
  "Air France-KLM Flying Blue": { iata: "AF", source: "flyingblue" },
  "British Airways Avios": { iata: "BA", source: "avios" },
  "Iberia Avios": { iata: "IB", source: "iberia" },
  "Aer Lingus AerClub": { iata: "EI", source: "aerlingus" },
  "Singapore Airlines KrisFlyer": { iata: "SQ", source: "singapore" },
  "Virgin Atlantic Flying Club": { iata: "VS", source: "virgin_atlantic" },
  "Delta SkyMiles": { iata: "DL", source: "delta" },
  "Cathay Pacific Asia Miles": { iata: "CX", source: "cathay" },
  "ANA Mileage Club": { iata: "NH", source: "ana" },
  "Emirates Skywards": { iata: "EK", source: "emirates" },
  "Etihad Guest": { iata: "EY", source: "etihad" },
  "Qantas Frequent Flyer": { iata: "QF", source: "qantas" },
  "Avianca LifeMiles": { iata: "AV", source: "lifemiles" },
  "American Airlines AAdvantage": { iata: "AA", source: "american" },
  "Qatar Airways Privilege Club": { iata: "QR", source: "qatar" },
  "Turkish Airlines Miles&Smiles": { iata: "TK", source: "turkish" },
  "Alaska Mileage Plan": { iata: "AS", source: "alaska" },
  "Finnair Plus": { iata: "AY", source: "finnair" },
  "TAP Miles&Go": { iata: "TP", source: "tap" },
  "Aeromexico Club Premier": { iata: "AM", source: "aeromexico" },
  "Japan Airlines Mileage Bank": { iata: "JL", source: "jal" },
};

const IATA_TO_SOURCE: Record<string, string> = {};
for (const [, { iata, source }] of Object.entries(PARTNER_NAME_TO_CODES)) {
  IATA_TO_SOURCE[iata] = source;
}

interface ReachablePrograms {
  awardToolCodes: string[];
  seatsAeroSources: Set<string>;
  /** IATA code → "Direct" or bank display name */
  annotations: Map<string, string>;
  /** source slug → "Direct" or bank display name */
  sourceAnnotations: Map<string, string>;
}

function findBankKey(programName: string, programCode: string): string | undefined {
  const nameLower = programName.toLowerCase();
  const codeLower = programCode.toLowerCase();

  for (const [key, bank] of Object.entries(TRANSFER_PARTNERS)) {
    if (bank.name.toLowerCase() === nameLower) return key;
  }

  if (codeLower.includes("chase") || codeLower === "ur" || codeLower === "chase_ur") return "chase";
  if (codeLower.includes("amex") || codeLower === "mr" || codeLower === "amex_mr") return "amex";
  if (codeLower.includes("citi") || codeLower === "typ" || codeLower === "citi_typ") return "citi";
  if (codeLower.includes("capital") || codeLower === "c1" || codeLower === "capitalone_miles") return "capitalone";
  if (codeLower.includes("bilt")) return "bilt";

  return undefined;
}

function findProgramCodes(
  programName: string,
  programCode: string,
): { iata: string; source: string } | undefined {
  if (PARTNER_NAME_TO_CODES[programName]) return PARTNER_NAME_TO_CODES[programName];

  const nameLower = programName.toLowerCase();
  for (const [name, codes] of Object.entries(PARTNER_NAME_TO_CODES)) {
    if (name.toLowerCase() === nameLower) return codes;
  }

  const codeLower = programCode.toLowerCase();
  for (const [source, displayName] of Object.entries(PROGRAM_NAMES)) {
    if (source === codeLower || displayName.toLowerCase() === nameLower) {
      for (const [, codes] of Object.entries(PARTNER_NAME_TO_CODES)) {
        if (codes.source === source) return codes;
      }
    }
  }

  return undefined;
}

/**
 * Determines which airline award programs a set of travelers can actually
 * reach — either via direct loyalty balances or by transferring from a
 * bank program.  Returns null when no loyalty data exists (skip awards).
 */
function computeReachablePrograms(
  balances: LoyaltyBalance[],
): ReachablePrograms | null {
  if (balances.length === 0) return null;

  const iataCodes = new Set<string>();
  const sources = new Set<string>();
  const annotations = new Map<string, string>();
  const sourceAnnotations = new Map<string, string>();

  for (const bal of balances) {
    const cat = bal.category?.toLowerCase() ?? "";

    if (cat === "airline") {
      const codes = findProgramCodes(bal.programName, bal.programCode);
      if (codes) {
        iataCodes.add(codes.iata);
        sources.add(codes.source);
        annotations.set(codes.iata, "Direct");
        sourceAnnotations.set(codes.source, "Direct");
      }
    } else if (cat === "transferable_bank") {
      const bankKey = findBankKey(bal.programName, bal.programCode);
      if (bankKey && TRANSFER_PARTNERS[bankKey]) {
        const bank = TRANSFER_PARTNERS[bankKey];
        for (const airlineName of Object.keys(bank.airlinePartners)) {
          const codes = PARTNER_NAME_TO_CODES[airlineName];
          if (codes) {
            iataCodes.add(codes.iata);
            sources.add(codes.source);
            if (!annotations.has(codes.iata)) {
              annotations.set(codes.iata, bank.name);
              sourceAnnotations.set(codes.source, bank.name);
            }
          }
        }
      }
    }
  }

  if (iataCodes.size === 0 && sources.size === 0) return null;

  return { awardToolCodes: Array.from(iataCodes), seatsAeroSources: sources, annotations, sourceAnnotations };
}

function filterAndAnnotateAwards(
  results: AwardFlightResult[],
  reachable: ReachablePrograms,
): AwardFlightResult[] {
  return results
    .filter((r) => {
      const src = r.source?.toLowerCase() ?? "";
      return reachable.seatsAeroSources.has(src) ||
        reachable.awardToolCodes.some((c) => IATA_TO_SOURCE[c]?.toLowerCase() === src) ||
        reachable.awardToolCodes.some((c) => c.toLowerCase() === src);
    })
    .map((r) => {
      const src = r.source?.toLowerCase() ?? "";
      let annotation = reachable.sourceAnnotations.get(src);
      if (!annotation) {
        for (const [iata, s] of Object.entries(IATA_TO_SOURCE)) {
          if (s === src && reachable.annotations.has(iata)) {
            annotation = reachable.annotations.get(iata);
            break;
          }
        }
      }
      return { ...r, transferSource: annotation };
    });
}

// ---------------------------------------------------------------------------
// Flight scoring — ported from backend optimization/pruning.py
//
// Multi-criteria scoring adapted from the MILP solver's objective functions:
//   OOP mode:  minimize(cash + surcharges + stop_penalty)
//   CPP mode:  maximize(points_value - quality_penalties)
//   Balanced:  value * time_factor * connection_factor * carrier_factor * redeye_factor
// ---------------------------------------------------------------------------

function detectRedeye(departureTime: string, arrivalTime: string): boolean {
  const depHour = parseHour(departureTime);
  if (depHour === -1) return false;
  return depHour >= 21 || depHour < 5;
}

function parseHour(timeStr: string): number {
  if (!timeStr) return -1;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1], 10);
}

/**
 * Multi-criteria score for cash flights.
 *
 * Mirrors backend pruning.py `_flight_combined_score` with weights adjusted
 * for the B2B context. When client preferences are available, they shift
 * weights toward nonstop, preferred airlines, and layover tolerance.
 *
 * Higher score = better flight.
 */
function scoreCashFlight(flight: CashFlightResult, prefs?: FlightPreferences): number {
  const cashScore = 1.0 - Math.min(1.0, flight.price / 5000);
  const timeScore = 1.0 - Math.min(1.0, flight.duration / (24 * 60));

  let nonstopBonus = flight.stops === 0 ? 0.3 : -0.15 * flight.stops;
  if (prefs?.prefersNonstop) {
    nonstopBonus = flight.stops === 0 ? 0.5 : -0.25 * flight.stops;
  }

  const carrierPenalty = flight.hasCarrierChange ? 0.1 : 0;
  const redeyePenalty = flight.isRedeye ? 0.15 : 0;

  let airlineBonus = 0;
  if (prefs?.preferredAirlines?.length) {
    const airlineLower = flight.airline.toLowerCase();
    if (prefs.preferredAirlines.some((a) => airlineLower.includes(a.toLowerCase()))) {
      airlineBonus = 0.2;
    }
  }
  if (prefs?.avoidedAirlines?.length) {
    const airlineLower = flight.airline.toLowerCase();
    if (prefs.avoidedAirlines.some((a) => airlineLower.includes(a.toLowerCase()))) {
      airlineBonus = -0.5;
    }
  }

  let layoverPenalty = 0;
  if (prefs?.maxLayoverMinutes && flight.layovers?.length) {
    for (const lay of flight.layovers) {
      if (lay.durationMin > prefs.maxLayoverMinutes) {
        layoverPenalty += 0.15;
      }
    }
  }

  let basicEconomyPenalty = 0;
  if (prefs?.avoidBasicEconomy && flight.fareClass?.toLowerCase().includes("basic")) {
    basicEconomyPenalty = 0.3;
  }

  const budgetWeight = prefs?.budgetSensitivity === "high" ? 0.45 : 0.35;
  const timeWeight = 1.0 - budgetWeight;

  return (
    budgetWeight * cashScore +
    timeWeight * timeScore +
    nonstopBonus +
    airlineBonus -
    carrierPenalty -
    redeyePenalty -
    layoverPenalty -
    basicEconomyPenalty
  );
}

/**
 * CPP-based score for award flights.
 *
 * Mirrors backend precompute.py `_precompute_flight_award_values` balanced
 * mode: value * connection_factor * availability_factor. When preferences
 * are supplied, nonstop preference and redemption style shift the score.
 */
function scoreAwardFlight(
  award: AwardFlightResult,
  bestCashPrice: number,
  prefs?: FlightPreferences,
): number {
  if (bestCashPrice <= 0 || award.milesRequired <= 0) return 0;

  const cpp = ((bestCashPrice - award.taxes) / award.milesRequired) * 100;
  if (cpp <= 0) return 0;

  let connectionFactor = award.isDirect
    ? 1.0
    : 1.0 / (1.0 + 1 * 0.20);

  if (prefs?.prefersNonstop) {
    connectionFactor = award.isDirect ? 1.15 : connectionFactor * 0.7;
  }

  const availabilityFactor =
    award.seatsRemaining != null && award.seatsRemaining < 3
      ? 1.0 - 0.30 * ((3 - award.seatsRemaining) / 3)
      : 1.0;

  let redemptionBoost = 1.0;
  if (prefs?.redemptionStyle === "maximize_points") redemptionBoost = 1.2;
  else if (prefs?.redemptionStyle === "minimize_cash") redemptionBoost = 1.1;

  return cpp * connectionFactor * availabilityFactor * redemptionBoost;
}

/**
 * Post-process flight results for a route: apply client preference constraints
 * as hard filters, re-rank by score, and return the top 5 per type.
 *
 * Constraint filtering keeps only flights the client would actually want.
 * If filtering leaves zero results, we fall back to the full list so the
 * advisor always sees some options.
 */
function rankRouteFlights(
  cash: CashFlightResult[],
  awards: AwardFlightResult[],
  prefs?: FlightPreferences,
): { cash: CashFlightResult[]; award: AwardFlightResult[] } {
  const filteredCash = applyConstraintsCash(cash, prefs);

  for (const r of filteredCash) {
    r.score = scoreCashFlight(r, prefs);
  }
  filteredCash.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const bestCashPrice =
    filteredCash.length > 0 ? Math.min(...filteredCash.map((c) => c.price)) : 0;

  const filteredAwards = applyConstraintsAward(awards, prefs);
  for (const a of filteredAwards) {
    const cpp =
      bestCashPrice > 0 && a.milesRequired > 0
        ? ((bestCashPrice - a.taxes) / a.milesRequired) * 100
        : 0;
    a.cppValue = Math.round(cpp * 100) / 100;
    a.score = scoreAwardFlight(a, bestCashPrice, prefs);
  }
  filteredAwards.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return {
    cash: filteredCash.slice(0, 5),
    award: filteredAwards.slice(0, 5),
  };
}

function applyConstraintsCash(
  flights: CashFlightResult[],
  prefs?: FlightPreferences,
): CashFlightResult[] {
  if (!prefs) return flights;

  let filtered = [...flights];

  if (prefs.avoidedAirlines?.length) {
    const avoided = prefs.avoidedAirlines.map((a) => a.toLowerCase());
    const pass = filtered.filter(
      (f) => !avoided.some((a) => f.airline.toLowerCase().includes(a)),
    );
    if (pass.length > 0) filtered = pass;
  }

  if (prefs.avoidBasicEconomy) {
    const pass = filtered.filter(
      (f) => !f.fareClass?.toLowerCase().includes("basic"),
    );
    if (pass.length > 0) filtered = pass;
  }

  if (prefs.maxLayoverMinutes) {
    const maxMin = prefs.maxLayoverMinutes;
    const pass = filtered.filter(
      (f) => !f.layovers?.some((l) => l.durationMin > maxMin),
    );
    if (pass.length > 0) filtered = pass;
  }

  if (prefs.prefersNonstop) {
    const nonstop = filtered.filter((f) => f.stops === 0);
    if (nonstop.length > 0) filtered = nonstop;
  }

  return filtered;
}

function applyConstraintsAward(
  awards: AwardFlightResult[],
  prefs?: FlightPreferences,
): AwardFlightResult[] {
  if (!prefs) return awards;

  let filtered = [...awards];

  if (prefs.prefersNonstop) {
    const direct = filtered.filter((a) => a.isDirect);
    if (direct.length > 0) filtered = direct;
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// SerpAPI — Google Flights (cash pricing)
// ---------------------------------------------------------------------------

interface SerpApiFlight {
  departure_airport: { name: string; id: string; time: string };
  arrival_airport: { name: string; id: string; time: string };
  duration: number;
  airplane?: string;
  airline: string;
  airline_logo?: string;
  travel_class: string;
  flight_number: string;
  legroom?: string;
}

interface SerpApiResult {
  flights: SerpApiFlight[];
  layovers?: { duration: number; name: string; id: string }[];
  price: number;
  type?: string;
  total_duration: number;
  booking_token?: string;
}

interface SerpApiResponse {
  best_flights?: SerpApiResult[];
  other_flights?: SerpApiResult[];
  error?: string;
}

export async function searchCashFlights(
  params: FlightSearchParams,
): Promise<CashFlightResult[]> {
  if (!getSerpApiKey()) {
    console.warn("SERPAPI_KEY not set — skipping cash flight search");
    return [];
  }

  const cabin = SERP_CABIN_MAP[params.cabinClass ?? "economy"] ?? 1;
  let results = await _fetchSerpFlights(params, cabin);

  // Single retry path: if the primary query came back empty, pick the most
  // likely fix (multi-airport fan-out OR cabin downgrade) but not both, to
  // keep the total budget bounded under Amplify's CloudFront timeout.
  if (results.length === 0) {
    const origins = params.origin.split(",").map((s) => s.trim()).filter(Boolean);
    const dests = params.destination.split(",").map((s) => s.trim()).filter(Boolean);
    if (origins.length > 1 || dests.length > 1) {
      results = await _fetchSerpFlights(
        { ...params, origin: origins[0], destination: dests[0] },
        cabin > 1 ? 1 : cabin,
      );
    } else if (cabin > 1) {
      results = await _fetchSerpFlights(params, 1);
    }
  }

  return results;
}

async function _fetchSerpFlights(
  params: FlightSearchParams,
  cabinCode: number,
): Promise<CashFlightResult[]> {
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("api_key", getSerpApiKey());
  url.searchParams.set("departure_id", params.origin);
  url.searchParams.set("arrival_id", params.destination);
  url.searchParams.set("outbound_date", params.date);
  url.searchParams.set("type", "2"); // one-way
  url.searchParams.set("travel_class", String(cabinCode));
  url.searchParams.set("adults", String(params.adults ?? 1));
  url.searchParams.set("currency", "USD");
  url.searchParams.set("hl", "en");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
    if (!res.ok) {
      console.error(`SerpAPI error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data: SerpApiResponse = await res.json();

    const allFlights = [
      ...(data.best_flights ?? []),
      ...(data.other_flights ?? []),
    ];

    if (allFlights.length === 0) {
      const errMsg = data.error || "no flights returned";
      console.warn(`SerpAPI: ${params.origin}->${params.destination} on ${params.date} cabin=${cabinCode}: ${errMsg}`);
      return [];
    }

    const results: CashFlightResult[] = [];

    for (const group of allFlights.slice(0, 15)) {
      const firstLeg = group.flights[0];
      const lastLeg = group.flights[group.flights.length - 1];
      if (!firstLeg || !lastLeg) continue;

      const hasCarrierChange = group.flights.length > 1 &&
        group.flights.some((f, i) => i > 0 && f.airline !== group.flights[i - 1].airline);

      const isRedeye = detectRedeye(
        firstLeg.departure_airport.time,
        lastLeg.arrival_airport.time,
      );

      results.push({
        airline: firstLeg.airline,
        airlineLogo: firstLeg.airline_logo,
        flightNumber: group.flights.map((f) => f.flight_number).join(", "),
        departureAirport: firstLeg.departure_airport.id,
        departureTime: firstLeg.departure_airport.time,
        arrivalAirport: lastLeg.arrival_airport.id,
        arrivalTime: lastLeg.arrival_airport.time,
        duration: group.total_duration,
        stops: group.flights.length - 1,
        layovers: (group.layovers ?? []).map((l) => ({
          airport: l.id,
          durationMin: l.duration,
        })),
        price: group.price,
        fareClass: firstLeg.travel_class,
        cabin: firstLeg.travel_class,
        bookingToken: group.booking_token,
        hasCarrierChange,
        isRedeye,
      });
    }

    return results.slice(0, 15);
  } catch (err) {
    console.error("SerpAPI fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Seats.aero — Award availability (points pricing)
// ---------------------------------------------------------------------------

interface SeatsAeroAvailability {
  ID: string;
  Route: { OriginAirport: string; DestinationAirport: string; Source: string };
  Date: string;
  YAvailable: boolean;
  YMileageCost: string;
  YDirect: boolean;
  YRemainingSeats?: number;
  YAirlines?: string;
  WAvailable: boolean;
  WMileageCost: string;
  WDirect: boolean;
  WRemainingSeats?: number;
  WAirlines?: string;
  JAvailable: boolean;
  JMileageCost: string;
  JDirect: boolean;
  JRemainingSeats?: number;
  JAirlines?: string;
  FAvailable: boolean;
  FMileageCost: string;
  FDirect: boolean;
  FRemainingSeats?: number;
  FAirlines?: string;
  // Taxes/surcharges per cabin, in minor units (cents) of TaxesCurrency.
  TaxesCurrency?: string | null;
  YTotalTaxes?: number;
  WTotalTaxes?: number;
  JTotalTaxes?: number;
  FTotalTaxes?: number;
  Source: string;
  // Populated only when the search is called with include_trips=true. Holds the
  // per-itinerary detail (flight numbers, times, duration) across all cabins.
  AvailabilityTrips?: SeatsAeroTrip[] | null;
}

// One concrete itinerary behind an availability (verified shape from the live
// Partner API). Trip-level fields are pre-aggregated; AvailabilitySegments holds
// the per-leg breakdown.
interface SeatsAeroTrip {
  Cabin?: string; // "economy" | "premium" | "business" | "first"
  MileageCost?: number;
  TotalDuration?: number; // minutes
  Stops?: number;
  RemainingSeats?: number;
  FlightNumbers?: string; // e.g. "AA4464, AA54"
  DepartsAt?: string; // ISO 8601
  ArrivesAt?: string; // ISO 8601
  Connections?: string[];
  Carriers?: string;
}

interface SeatsAeroResponse {
  data: SeatsAeroAvailability[];
  count?: number;
}

/**
 * Search for award flights, optionally filtering to programs the client can
 * actually use.
 *
 * @param reachable  undefined → search all programs (backward compat)
 *                   null      → client has no loyalty, skip award search
 *                   object    → filter to those programs only
 */
export async function searchAwardFlights(
  params: FlightSearchParams,
  reachable?: ReachablePrograms | null,
): Promise<AwardFlightResult[]> {
  if (reachable === null) return [];

  let results: AwardFlightResult[];

  if (getSeatsAeroKey()) {
    results = await searchAwardFlightsSeatsAero(params);
  } else if (getAwardToolKey()) {
    results = await searchAwardFlightsAwardTool(
      params,
      reachable?.awardToolCodes,
    );
  } else {
    console.warn("No award search key set (SEATS_AERO_API_KEY or AWARDTOOL_API_KEY) — skipping award search");
    return [];
  }

  if (reachable) {
    results = filterAndAnnotateAwards(results, reachable);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Seats.aero shared client — in-memory TTL cache + rate limiting + backoff
//
// The Partner API is tier-invariant: the same endpoints/auth work on a
// low-volume eval key and on an enterprise key — only quota and rate limits
// change. We build cost/rate discipline in here ONCE, so migrating from a
// preprod eval key to an enterprise key is a key swap with no code change.
//
// NOTE: this cache + limiter is per-process (per warm serverless instance).
// For production scale, back them with Redis so they are shared across
// instances; the call sites below would not need to change.
// ---------------------------------------------------------------------------

const SEATS_AERO_BASE = "https://seats.aero/partnerapi";

// Award space is volatile — keep TTLs short. Tune against observed churn/tier.
const SEATS_SEARCH_TTL_MS = 5 * 60_000; // cached availability list (with trips)

// Conservative defaults that stay under a low-volume eval key's limits.
// Safe to relax once on an enterprise quota; cheap insurance against bursts.
const SEATS_MIN_INTERVAL_MS = 250; // ~4 req/s ceiling
const SEATS_MAX_RETRIES = 3;
const SEATS_CACHE_CAP = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CacheEntry<T> = { value: T; expiresAt: number };
const seatsCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const hit = seatsCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    seatsCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (seatsCache.size >= SEATS_CACHE_CAP) {
    // Evict expired first; if still full, drop oldest insertions (Map keeps order).
    const now = Date.now();
    for (const [k, v] of seatsCache) {
      if (v.expiresAt < now) seatsCache.delete(k);
    }
    while (seatsCache.size >= SEATS_CACHE_CAP) {
      const oldest = seatsCache.keys().next().value;
      if (oldest === undefined) break;
      seatsCache.delete(oldest);
    }
  }
  seatsCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Serialize request *starts* at least SEATS_MIN_INTERVAL_MS apart so concurrent
// multi-traveler searches don't burst past the key's rate limit.
let seatsLastCallAt = 0;
let seatsGate: Promise<void> = Promise.resolve();
function rateLimitSlot(): Promise<void> {
  seatsGate = seatsGate.then(async () => {
    const wait = SEATS_MIN_INTERVAL_MS - (Date.now() - seatsLastCallAt);
    if (wait > 0) await sleep(wait);
    seatsLastCallAt = Date.now();
  });
  return seatsGate;
}

async function seatsAeroGet<T>(
  path: string,
  opts: { cacheKey?: string; ttlMs?: number } = {},
): Promise<T | null> {
  const key = getSeatsAeroKey();
  if (!key) return null;

  if (opts.cacheKey) {
    const cached = cacheGet<T>(opts.cacheKey);
    if (cached !== undefined) return cached;
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= SEATS_MAX_RETRIES; attempt++) {
    await rateLimitSlot();
    try {
      const res = await fetch(`${SEATS_AERO_BASE}${path}`, {
        headers: { "Partner-Authorization": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });

      // 429 (rate limited) and 5xx are retryable; honor Retry-After when present.
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1_000 * 2 ** attempt, 8_000);
        console.warn(
          `Seats.aero ${res.status} on ${path} — retry ${attempt + 1}/${SEATS_MAX_RETRIES} in ${backoff}ms`,
        );
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        console.error(`Seats.aero error: ${res.status} ${res.statusText} on ${path}`);
        return null;
      }

      const data = (await res.json()) as T;
      if (opts.cacheKey && opts.ttlMs) cacheSet(opts.cacheKey, data, opts.ttlMs);
      return data;
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(1_000 * 2 ** attempt, 8_000);
      console.warn(`Seats.aero fetch failed on ${path} (attempt ${attempt + 1}): ${err}`);
      await sleep(backoff);
    }
  }
  console.error(`Seats.aero giving up on ${path}:`, lastErr);
  return null;
}

// ---------------------------------------------------------------------------
// Seats.aero trip detail — "which flight is this award?"
//
// The /search response is aggregate-only, but passing include_trips=true makes
// it return AvailabilityTrips inline (all cabins/routings) in the SAME request.
// We pick the trip matching the displayed cabin + mileage and read its flight
// numbers/times off the trip-level fields. No extra per-availability calls.
// ---------------------------------------------------------------------------

const SEATS_CABIN_NAME: Record<string, string> = {
  Y: "economy",
  W: "premium",
  J: "business",
  F: "first",
};

/**
 * Real taxes/surcharges for a cabin in USD. Seats.aero reports these in minor
 * units (cents) of TaxesCurrency. We trust them only when USD — for any other
 * currency we'd need an FX rate, so we fall back to the estimate rather than
 * present a foreign-currency figure as dollars.
 */
function seatsTaxesUsd(
  avail: SeatsAeroAvailability,
  cabinCode: string,
  origin: string,
  destination: string,
): number {
  const currency = (avail.TaxesCurrency ?? "USD").toUpperCase();
  const cents = avail[`${cabinCode}TotalTaxes` as keyof SeatsAeroAvailability] as
    | number
    | undefined;
  if (currency === "USD" && typeof cents === "number" && Number.isFinite(cents) && cents >= 0) {
    return Math.round(cents / 100);
  }
  return estimateTaxes(origin, destination);
}

/**
 * From an availability's inline trips, pick the one that best represents the
 * option we're displaying (right cabin + mileage, prefer direct when the
 * availability is direct, then fastest) and return its flight detail.
 */
function tripDetailFromAvailability(
  avail: SeatsAeroAvailability,
  cabinCode: string,
  milesRequired: number,
  isDirect: boolean,
): Partial<AwardFlightResult> {
  const trips = avail.AvailabilityTrips ?? [];
  if (trips.length === 0) return {};

  const wantCabin = SEATS_CABIN_NAME[cabinCode];
  const inCabin = trips.filter(
    (t) => !wantCabin || (t.Cabin ?? "").toLowerCase().includes(wantCabin),
  );
  const pool = inCabin.length > 0 ? inCabin : trips;

  // Prefer trips priced at the displayed mileage; fall back to the whole pool.
  const priced = pool.filter((t) => t.MileageCost === milesRequired);
  const candidates = priced.length > 0 ? priced : pool;

  const score = (t: SeatsAeroTrip) => {
    const stops = t.Stops ?? (t.Connections?.length ?? 99);
    // When the option is sold as direct, strongly prefer a nonstop trip.
    const directPenalty = isDirect && stops > 0 ? 100_000 : 0;
    return directPenalty + stops * 10_000 + (t.TotalDuration ?? 99_999);
  };
  const trip = candidates.reduce((best, t) => (score(t) < score(best) ? t : best), candidates[0]);

  return {
    flightNumber: trip.FlightNumbers || undefined,
    departureTime: trip.DepartsAt,
    arrivalTime: trip.ArrivesAt,
    duration: trip.TotalDuration,
    stops: trip.Stops ?? trip.Connections?.length,
  };
}

async function searchAwardFlightsSeatsAero(
  params: FlightSearchParams,
): Promise<AwardFlightResult[]> {
  const cabinCode = SEATS_CABIN_CODE[params.cabinClass ?? "economy"] ?? "Y";

  // include_trips=true returns per-itinerary detail (flight numbers/times)
  // inline, so a single cached call serves the list AND the "which flight"
  // detail for every option. The payload covers all cabins; filter per cabin.
  const qs = new URLSearchParams({
    origin_airport: params.origin,
    destination_airport: params.destination,
    start_date: params.date,
    end_date: params.date,
    take: "20",
    include_trips: "true",
  }).toString();

  const data = await seatsAeroGet<SeatsAeroResponse>(`/search?${qs}`, {
    cacheKey: `search:${params.origin}:${params.destination}:${params.date}`,
    ttlMs: SEATS_SEARCH_TTL_MS,
  });
  if (!data) return [];

  const results: AwardFlightResult[] = [];

  for (const avail of data.data ?? []) {
    const available = avail[`${cabinCode}Available` as keyof SeatsAeroAvailability] as boolean;
    if (!available) continue;

    const miles = parseInt(
      avail[`${cabinCode}MileageCost` as keyof SeatsAeroAvailability] as string,
      10,
    );
    if (!miles || isNaN(miles)) continue;

    const isDirect = avail[`${cabinCode}Direct` as keyof SeatsAeroAvailability] as boolean;
    const seats = avail[`${cabinCode}RemainingSeats` as keyof SeatsAeroAvailability] as
      | number
      | undefined;
    const airlines = avail[`${cabinCode}Airlines` as keyof SeatsAeroAvailability] as
      | string
      | undefined;

    const source = avail.Source || avail.Route?.Source || "unknown";

    const detail = tripDetailFromAvailability(avail, cabinCode, miles, isDirect ?? false);

    results.push({
      source,
      origin: avail.Route?.OriginAirport ?? params.origin,
      destination: avail.Route?.DestinationAirport ?? params.destination,
      date: avail.Date,
      cabin: params.cabinClass ?? "economy",
      milesRequired: miles,
      taxes: seatsTaxesUsd(avail, cabinCode, params.origin, params.destination),
      seatsRemaining: seats,
      isDirect: isDirect ?? false,
      airlines,
      program: PROGRAM_NAMES[source] ?? source,
      // Flight detail from the inline trip; falls back to stops-only when the
      // availability is direct and no matching trip detail is present.
      stops: isDirect ? 0 : undefined,
      ...detail,
    });
  }

  results.sort((a, b) => a.milesRequired - b.milesRequired);
  return results.slice(0, 15);
}

// ---------------------------------------------------------------------------
// AwardTool — Award availability fallback (V1 API)
// ---------------------------------------------------------------------------

interface AwardToolItem {
  program_code?: string;
  airline_code?: string;
  award_points?: number;
  surcharge?: number;
  cabin_type?: string;
  cash_fare?: number;
  date?: string;
  departure_time?: string;
  arrival_time?: string;
  duration_minutes?: number;
  travel_minutes?: number;
  stops?: number;
  flight_numbers?: string[];
  fare?: {
    products?: {
      origin?: string;
      destination?: string;
      flight_number?: string;
      departure_time?: string;
      arrival_time?: string;
      travel_minutes?: number;
      cabin?: string;
    }[];
    travel_minutes_total?: number;
  };
}

interface AwardToolResponse {
  status?: number;
  data?: AwardToolItem[];
}

async function searchAwardFlightsAwardTool(
  params: FlightSearchParams,
  programCodes?: string[],
): Promise<AwardFlightResult[]> {
  const cabin = AWARDTOOL_CABIN_MAP[params.cabinClass ?? "economy"] ?? "Economy";
  const programs = programCodes && programCodes.length > 0
    ? programCodes
    : AWARDTOOL_DEFAULT_PROGRAMS;

  if (programs.length === 0) return [];

  const payload = {
    origin: params.origin.toUpperCase(),
    destination: params.destination.toUpperCase(),
    date: params.date,
    programs,
    cabins: [cabin],
    pax: String(params.adults ?? 1),
    api_key: getAwardToolKey(),
  };

  try {
    const res = await fetch("https://www.awardtool-api.com/search_real_time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error(`AwardTool error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data: AwardToolResponse = await res.json();
    const items = data.data ?? [];
    const results: AwardFlightResult[] = [];

    for (const item of items) {
      if (typeof item !== "object" || !item) continue;

      // V2 flat format (airline_code at top level)
      if (item.airline_code) {
        const prog = (item.airline_code ?? "").toUpperCase();
        const pts = item.award_points;
        if (!pts || pts <= 0) continue;
        const sur = item.surcharge != null && item.surcharge >= 0 ? item.surcharge : 0;

        const flightNums = (item.flight_numbers ?? []).filter(Boolean).join(", ");
        results.push({
          source: prog.toLowerCase(),
          origin: params.origin,
          destination: params.destination,
          date: item.date ?? params.date,
          cabin: params.cabinClass ?? "economy",
          milesRequired: pts,
          taxes: sur || estimateTaxes(params.origin, params.destination),
          isDirect: item.stops === 0,
          program: PROGRAM_NAMES[prog.toLowerCase()] ?? prog,
          flightNumber: flightNums || undefined,
          departureTime: item.departure_time,
          arrivalTime: item.arrival_time,
          duration: item.duration_minutes ?? item.travel_minutes,
          stops: item.stops,
        });
        continue;
      }

      // V1 nested format (fare.products)
      const fare = item.fare;
      const products = fare?.products ?? [];
      const prog = (item.program_code ?? "").toUpperCase();
      const pts = item.award_points;
      if (!pts || pts <= 0) continue;
      const sur = item.surcharge != null && item.surcharge >= 0 ? item.surcharge : 0;

      if (products.length > 0) {
        const first = products[0];
        const last = products[products.length - 1];
        const dep = (first.origin ?? "").toUpperCase();
        const arr = (last.destination ?? "").toUpperCase();
        if (dep && arr && dep !== params.origin.toUpperCase()) continue;

        const flightNums = products
          .map((p) => p.flight_number)
          .filter(Boolean)
          .join(", ");
        const durationTotal =
          fare?.travel_minutes_total ??
          (products.every((p) => p.travel_minutes != null)
            ? products.reduce((sum, p) => sum + (p.travel_minutes ?? 0), 0)
            : undefined);

        results.push({
          source: prog.toLowerCase(),
          origin: dep || params.origin,
          destination: arr || params.destination,
          date: params.date,
          cabin: params.cabinClass ?? "economy",
          milesRequired: pts,
          taxes: sur || estimateTaxes(params.origin, params.destination),
          isDirect: products.length <= 1,
          airlines: prog,
          program: PROGRAM_NAMES[prog.toLowerCase()] ?? prog,
          flightNumber: flightNums || undefined,
          departureTime: first.departure_time,
          arrivalTime: last.arrival_time,
          duration: durationTotal,
          stops: products.length - 1,
        });
      } else {
        results.push({
          source: prog.toLowerCase(),
          origin: params.origin,
          destination: params.destination,
          date: params.date,
          cabin: params.cabinClass ?? "economy",
          milesRequired: pts,
          taxes: sur || estimateTaxes(params.origin, params.destination),
          isDirect: false,
          program: PROGRAM_NAMES[prog.toLowerCase()] ?? prog,
        });
      }
    }

    console.log(`AwardTool: ${params.origin}->${params.destination} on ${params.date}: ${results.length} award options`);
    results.sort((a, b) => a.milesRequired - b.milesRequired);
    return results.slice(0, 15);
  } catch (err) {
    console.error("AwardTool fetch failed:", err);
    return [];
  }
}

function estimateTaxes(origin: string, destination: string): number {
  const intl =
    origin.length === 3 &&
    destination.length === 3 &&
    !isDomesticUS(origin, destination);
  return intl ? 150 : 6;
}

const US_AIRPORTS = new Set([
  "JFK", "LAX", "ORD", "SFO", "MIA", "ATL", "DFW", "DEN", "SEA", "BOS",
  "IAD", "IAH", "EWR", "LGA", "PHX", "LAS", "MSP", "DTW", "PHL", "CLT",
  "SLC", "SAN", "TPA", "MCO", "BWI", "DCA", "PDX", "STL", "HNL", "AUS",
  "RDU", "BNA", "IND", "MCI", "CLE", "PIT", "CMH", "OAK", "SJC", "SMF",
  "FLL", "RSW",
]);

function isDomesticUS(a: string, b: string) {
  return US_AIRPORTS.has(a) && US_AIRPORTS.has(b);
}

// ---------------------------------------------------------------------------
// Combined search — per-traveler
// ---------------------------------------------------------------------------

export interface LoyaltyBalance {
  programName: string;
  programCode: string;
  category: string;
  balance: number;
}

export interface FlightPreferences {
  prefersNonstop?: boolean;
  maxLayoverMinutes?: number;
  avoidBasicEconomy?: boolean;
  preferredAirlines?: string[];
  avoidedAirlines?: string[];
  willingToReposition?: boolean;
  redemptionStyle?: string;
  budgetSensitivity?: string;
  // Home airports the client regularly departs from. When the trip's origin
  // isn't pinned, these seed the search; when it is, they're a tiebreaker.
  preferredDepartureAirports?: string[];
  // Freeform notes the booking AI can fold into ranking prompts. These are
  // text fields, not structured constraints.
  loyaltyNotes?: string;
  budgetNotes?: string;
  travelPace?: string;
  dateFlexibility?: string;
}

export interface TravelerSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  originAirports: string[];
  destinationAirports: string[];
  departureDate?: string;
  returnDate?: string;
  cabinPreference?: string;
  loyaltyBalances?: LoyaltyBalance[];
}

export interface MultiCityLeg {
  leg: number;
  from: string[];
  to: string[];
  date: string;
}

export async function searchFlightsForTravelers(
  travelers: TravelerSearchInput[],
  departureDate: string,
  returnDate: string | undefined,
  cabinClass: string,
  preferences?: FlightPreferences,
  multiCityLegs?: MultiCityLeg[] | null,
): Promise<TravelerFlightGroup[]> {
  const tripCabin = normalizeCabin(cabinClass);

  if (multiCityLegs && multiCityLegs.length > 0) {
    return searchMultiCityFlights(
      travelers,
      multiCityLegs,
      tripCabin,
      preferences,
    );
  }

  // Build the union of all travelers' loyalty balances to determine which
  // airline award programs are reachable (directly or via bank transfer).
  // When no traveler has loyalty data the award search is skipped entirely.
  const allBalances = travelers.flatMap((t) => t.loyaltyBalances ?? []);
  const reachable = allBalances.length > 0
    ? computeReachablePrograms(allBalances)
    : null;

  // Deduplicate routes — travelers may share routes but can have different dates.
  // SerpAPI Google Flights supports comma-separated airport codes for multi-airport
  // search, so we join them. Award APIs only accept single codes, so we pick the
  // first major commercial airport (filtering out private/GA airports like LBG).
  const uniqueRoutes = new Map<string, {
    originCash: string; destCash: string;
    originAward: string; destAward: string;
    date: string; cabin: typeof tripCabin;
  }>();

  for (const traveler of travelers) {
    const origins = traveler.originAirports.filter(Boolean);
    const dests = traveler.destinationAirports.filter(Boolean);
    if (!origins.length || !dests.length) continue;

    const originCash = origins.join(",");
    const destCash = dests.join(",");
    const originAward = pickCommercialAirport(origins);
    const destAward = pickCommercialAirport(dests);

    const tDep = traveler.departureDate ?? departureDate;
    const tRet = traveler.returnDate ?? returnDate;
    const tCabin = traveler.cabinPreference ? normalizeCabin(traveler.cabinPreference) : tripCabin;

    const outKey = `${originCash}-${destCash}-${tDep}-${tCabin}`;
    if (!uniqueRoutes.has(outKey)) {
      uniqueRoutes.set(outKey, { originCash, destCash, originAward, destAward, date: tDep, cabin: tCabin });
    }

    if (tRet) {
      const retKey = `${destCash}-${originCash}-${tRet}-${tCabin}`;
      if (!uniqueRoutes.has(retKey)) {
        uniqueRoutes.set(retKey, {
          originCash: destCash, destCash: originCash,
          originAward: destAward, destAward: originAward,
          date: tRet, cabin: tCabin,
        });
      }
    }
  }

  // Fire ALL route searches in parallel (cash + award per route)
  const routeEntries = Array.from(uniqueRoutes.entries());
  const routeResults = await Promise.all(
    routeEntries.map(async ([key, { originCash, destCash, originAward, destAward, date, cabin }]) => {
      const [cash, award] = await Promise.all([
        searchCashFlights({ origin: originCash, destination: destCash, date, cabinClass: cabin }),
        searchAwardFlights({ origin: originAward, destination: destAward, date, cabinClass: cabin }, reachable),
      ]);
      const ranked = rankRouteFlights(cash, award, preferences);
      return [key, { cash: ranked.cash, award: ranked.award }] as const;
    }),
  );

  const routeCache = new Map(routeResults);

  // Assemble results per traveler using their specific dates
  const groups: TravelerFlightGroup[] = [];

  for (const traveler of travelers) {
    const origins = traveler.originAirports.filter(Boolean);
    const dests = traveler.destinationAirports.filter(Boolean);
    if (!origins.length || !dests.length) continue;

    const originCash = origins.join(",");
    const destCash = dests.join(",");

    const tDep = traveler.departureDate ?? departureDate;
    const tRet = traveler.returnDate ?? returnDate;
    const tCabin = traveler.cabinPreference ? normalizeCabin(traveler.cabinPreference) : tripCabin;

    const segments: FlightSegment[] = [];
    const primaryOrigin = pickCommercialAirport(origins);
    const primaryDest = pickCommercialAirport(dests);

    const outKey = `${originCash}-${destCash}-${tDep}-${tCabin}`;
    const outData = routeCache.get(outKey);
    if (outData) {
      segments.push({
        segmentLabel: "Outbound",
        origin: primaryOrigin,
        destination: primaryDest,
        date: tDep,
        cashOptions: outData.cash,
        awardOptions: outData.award,
      });
    }

    if (tRet) {
      const retKey = `${destCash}-${originCash}-${tRet}-${tCabin}`;
      const retData = routeCache.get(retKey);
      if (retData) {
        segments.push({
          segmentLabel: "Return",
          origin: primaryDest,
          destination: primaryOrigin,
          date: tRet,
          cashOptions: retData.cash,
          awardOptions: retData.award,
        });
      }
    }

    groups.push({
      travelerId: traveler.travelerId,
      travelerName: traveler.travelerName,
      clientId: traveler.clientId,
      segments,
    });
  }

  return groups;
}

async function searchMultiCityFlights(
  travelers: TravelerSearchInput[],
  legs: MultiCityLeg[],
  tripCabin: "economy" | "premium_economy" | "business" | "first",
  preferences?: FlightPreferences,
): Promise<TravelerFlightGroup[]> {
  const allBalances = travelers.flatMap((t) => t.loyaltyBalances ?? []);
  const reachable = allBalances.length > 0
    ? computeReachablePrograms(allBalances)
    : null;

  const legSearches = await Promise.all(
    legs.map(async (leg) => {
      const from = (leg.from ?? []).filter(Boolean);
      const to = (leg.to ?? []).filter(Boolean);
      if (!from.length || !to.length) {
        return { leg, cash: [], award: [] };
      }
      const originCash = from.join(",");
      const destCash = to.join(",");
      const originAward = pickCommercialAirport(from);
      const destAward = pickCommercialAirport(to);
      const [cash, award] = await Promise.all([
        searchCashFlights({ origin: originCash, destination: destCash, date: leg.date, cabinClass: tripCabin }),
        searchAwardFlights({ origin: originAward, destination: destAward, date: leg.date, cabinClass: tripCabin }, reachable),
      ]);
      const ranked = rankRouteFlights(cash, award, preferences);
      return { leg, cash: ranked.cash, award: ranked.award, originAward, destAward };
    }),
  );

  const segments: FlightSegment[] = legSearches.map(({ leg, cash, award, originAward, destAward }) => ({
    segmentLabel: `Leg ${leg.leg}: ${(leg.from ?? []).join("/")} → ${(leg.to ?? []).join("/")}`,
    origin: originAward ?? (leg.from?.[0] ?? ""),
    destination: destAward ?? (leg.to?.[0] ?? ""),
    date: leg.date,
    cashOptions: cash,
    awardOptions: award,
  }));

  return travelers.map((traveler) => ({
    travelerId: traveler.travelerId,
    travelerName: traveler.travelerName,
    clientId: traveler.clientId,
    segments,
  }));
}

// Private/GA airports that lack commercial service on Google Flights / award APIs
const NON_COMMERCIAL_AIRPORTS = new Set([
  "LBG", "VNY", "TEB", "SDL", "HPN", "BED", "FRG", "APC", "CRQ", "OPF",
  "MMU", "SUS", "PWK", "DAL", "FTW", "ADS",
]);

function pickCommercialAirport(codes: string[]): string {
  const commercial = codes.filter((c) => !NON_COMMERCIAL_AIRPORTS.has(c.toUpperCase()));
  return commercial[0] ?? codes[0] ?? "";
}

function normalizeCabin(
  cabin: string,
): "economy" | "premium_economy" | "business" | "first" {
  const c = cabin?.toLowerCase().replace(/[\s_-]+/g, "") ?? "economy";
  if (c.includes("first")) return "first";
  if (c.includes("business")) return "business";
  if (c.includes("premium")) return "premium_economy";
  return "economy";
}
