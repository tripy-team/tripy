// ---------------------------------------------------------------------------
// Multi-Modal Transport Search — Rome2Rio (scraped) + Google Routes + SerpAPI
// ---------------------------------------------------------------------------

import { searchCashFlights, type CashFlightResult } from "./flight-search";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const SERPAPI_KEY = process.env.SERPAPI_KEY ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransportMode =
  | "flight"
  | "train"
  | "bus"
  | "ferry"
  | "rideshare"
  | "driving"
  | "shuttle"
  | "walk";

export interface TransportOption {
  mode: TransportMode;
  provider: string;
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes: number;
  price: number;
  priceRange?: { low: number; high: number };
  stops: number;
  co2Kg?: number;
  bookingUrl?: string;
  source: "serpapi" | "rome2rio" | "google_routes" | "ai_estimate";
  rawData?: unknown;
}

export interface ScoredTransportOption extends TransportOption {
  compositeScore: number;
  costScore: number;
  timeScore: number;
  comfortScore: number;
  convenienceScore: number;
  rationale: string;
  recommendation: "best_value" | "fastest" | "most_comfortable" | "budget" | null;
}

export interface TransportSegment {
  segmentLabel: string;
  origin: string;
  destination: string;
  date: string;
  options: ScoredTransportOption[];
  bestOverall: ScoredTransportOption | null;
  bestBudget: ScoredTransportOption | null;
  fastest: ScoredTransportOption | null;
}

export interface TravelerTransportGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  segments: TransportSegment[];
}

export interface TransportSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  originAirports: string[];
  destinationAirports: string[];
}

export interface TransportLeg {
  origin: string;
  destination: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Rome2Rio — scraped via SerpAPI Google search (no API key required)
//
// Rome2Rio is behind Cloudflare, so direct HTTP scraping is not viable.
// Instead we use SerpAPI (already configured for flights) to search Google
// for Rome2Rio results. Google indexes Rome2Rio pages with rich snippets
// containing transport mode, duration, price, and provider data.
// ---------------------------------------------------------------------------

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  snippet_highlighted_words?: string[];
  rich_snippet?: { top?: { extensions?: string[] } };
}

interface SerpApiGoogleResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

const MODE_KEYWORDS: { pattern: RegExp; mode: TransportMode }[] = [
  { pattern: /\bfl(?:y|ight|ying)\b/i, mode: "flight" },
  { pattern: /\btrain\b/i, mode: "train" },
  { pattern: /\bcaltrain\b/i, mode: "train" },
  { pattern: /\bamtrak\b/i, mode: "train" },
  { pattern: /\brail\b/i, mode: "train" },
  { pattern: /\bbus\b/i, mode: "bus" },
  { pattern: /\bgreyhound\b/i, mode: "bus" },
  { pattern: /\bflixbus\b/i, mode: "bus" },
  { pattern: /\bferry\b/i, mode: "ferry" },
  { pattern: /\bdrive\b/i, mode: "driving" },
  { pattern: /\btaxi\b/i, mode: "rideshare" },
  { pattern: /\buber\b/i, mode: "rideshare" },
  { pattern: /\blyft\b/i, mode: "rideshare" },
  { pattern: /\bshuttle\b/i, mode: "shuttle" },
  { pattern: /\bBART\b/, mode: "train" },
  { pattern: /\btram\b/i, mode: "train" },
  { pattern: /\bsubway\b/i, mode: "train" },
];

function detectModeFromText(text: string): TransportMode {
  for (const { pattern, mode } of MODE_KEYWORDS) {
    if (pattern.test(text)) return mode;
  }
  return "driving";
}

function parseDurationFromSnippet(text: string): number {
  // "takes 8h 15m", "takes just 2h 52m", "takes just 3¾ hours"
  const hm = text.match(/(\d+)h\s*(\d+)m/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);

  const hOnly = text.match(/(\d+)h(?:\b|$)/);
  if (hOnly) return parseInt(hOnly[1], 10) * 60;

  // "3¾ hours" or "3½ hours" or "3¼ hours"
  const frac = text.match(/(\d+)([¼½¾])\s*hours?/);
  if (frac) {
    const base = parseInt(frac[1], 10);
    const fracs: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75 };
    return Math.round((base + (fracs[frac[2]] ?? 0)) * 60);
  }

  const mOnly = text.match(/(\d+)\s*min/);
  if (mOnly) return parseInt(mOnly[1], 10);

  return 0;
}

function parsePriceFromSnippet(text: string): { price: number; low?: number; high?: number } | null {
  // "$55 - $80" or "$55–$80" or "€60 - €210"
  const range = text.match(/[\$€£](\d+)\s*[-–]\s*[\$€£]?(\d+)/);
  if (range) {
    const low = parseInt(range[1], 10);
    const high = parseInt(range[2], 10);
    return { price: Math.round((low + high) / 2), low, high };
  }

  // "start at $128" or "costs only $60" or "from $32"
  const single = text.match(/(?:start at|costs? (?:only )?|from )[\$€£](\d+)/);
  if (single) {
    const p = parseInt(single[1], 10);
    return { price: p };
  }

  // "$65–130" (no currency on second number)
  const rangePlain = text.match(/[\$€£](\d+)[–-](\d+)/);
  if (rangePlain) {
    const low = parseInt(rangePlain[1], 10);
    const high = parseInt(rangePlain[2], 10);
    return { price: Math.round((low + high) / 2), low, high };
  }

  return null;
}

function parseProviderFromText(text: string): string {
  const providers: string[] = [];
  const knownProviders = [
    "Amtrak", "Caltrain", "BART", "Greyhound", "Flixbus", "Megabus",
    "BoltBus", "Eurostar", "TGV", "SNCF", "Trenitalia", "DB",
    "Renfe", "FlixTrain", "National Express", "Southwest Airlines",
    "United Airlines", "American Airlines", "Delta", "JetBlue",
    "Ryanair", "easyJet", "Vueling", "Uber", "Lyft",
  ];
  for (const p of knownProviders) {
    if (text.includes(p)) providers.push(p);
  }
  return providers.join(" + ") || "Rome2Rio";
}

export async function scrapeRome2Rio(
  origin: string,
  destination: string,
): Promise<TransportOption[]> {
  if (!SERPAPI_KEY) {
    console.warn("SERPAPI_KEY not set — skipping Rome2Rio scrape");
    return [];
  }

  const originSlug = origin.replace(/\s+/g, "-");
  const destSlug = destination.replace(/\s+/g, "-");

  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("api_key", SERPAPI_KEY);
  url.searchParams.set("q", `site:rome2rio.com ${origin} to ${destination}`);
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("num", "10");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`SerpAPI Google search error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data: SerpApiGoogleResponse = await res.json();
    if (data.error) {
      console.error("SerpAPI Google search error:", data.error);
      return [];
    }

    const results: TransportOption[] = [];
    const seenModes = new Set<string>();

    for (const result of data.organic_results ?? []) {
      const link = result.link ?? "";
      if (!link.includes("rome2rio.com")) continue;

      const snippet = result.snippet ?? "";
      const title = result.title ?? "";
      const combined = `${title} ${snippet}`;

      const duration = parseDurationFromSnippet(combined);
      const priceInfo = parsePriceFromSnippet(combined);

      if (!duration && !priceInfo) continue;

      // Determine mode: check URL path for /Train/, /Bus/, etc., then snippet text
      let mode: TransportMode;
      if (link.includes("/Train/")) mode = "train";
      else if (link.includes("/Bus/")) mode = "bus";
      else if (link.includes("/Ferry/")) mode = "ferry";
      else if (link.includes("/Drive/") || link.includes("/Car/")) mode = "driving";
      else mode = detectModeFromText(combined);

      const modeKey = `${mode}-${duration}-${priceInfo?.price ?? 0}`;
      if (seenModes.has(modeKey)) continue;
      seenModes.add(modeKey);

      const provider = parseProviderFromText(combined);
      const r2rUrl = link.startsWith("http") ? link : undefined;

      results.push({
        mode,
        provider,
        origin,
        destination,
        durationMinutes: duration,
        price: priceInfo?.price ?? 0,
        priceRange: priceInfo?.low != null && priceInfo?.high != null
          ? { low: priceInfo.low, high: priceInfo.high }
          : undefined,
        stops: 0,
        bookingUrl: r2rUrl,
        source: "rome2rio",
      });
    }

    return results;
  } catch (err) {
    console.error("Rome2Rio scrape failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Google Routes API — driving + transit estimates
// https://developers.google.com/maps/documentation/routes
// ---------------------------------------------------------------------------

interface GoogleRouteLeg {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
}

interface GoogleRoute {
  legs?: GoogleRouteLeg[];
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  travelAdvisory?: unknown;
}

interface GoogleRoutesResponse {
  routes?: GoogleRoute[];
  error?: { message?: string };
}

function parseDurationSeconds(d: string | undefined): number {
  if (!d) return 0;
  const match = d.match(/(\d+)s/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function searchGoogleRoutes(
  origin: string,
  destination: string,
  mode: "DRIVE" | "TRANSIT" = "DRIVE",
): Promise<TransportOption[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn("GOOGLE_MAPS_API_KEY not set — skipping Google Routes search");
    return [];
  }

  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: mode,
    routingPreference: mode === "DRIVE" ? "TRAFFIC_AWARE" : undefined,
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "IMPERIAL",
  };

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.staticDuration,routes.legs.distanceMeters,routes.legs.duration",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`Google Routes error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data: GoogleRoutesResponse = await res.json();
    if (data.error) {
      console.error("Google Routes error:", data.error.message);
      return [];
    }

    const results: TransportOption[] = [];
    for (const route of data.routes ?? []) {
      const durSec = parseDurationSeconds(route.duration ?? route.staticDuration);
      const distM = route.distanceMeters ?? 0;
      const distMiles = distM / 1609.34;

      if (mode === "DRIVE") {
        const fuelCostPerMile = 0.15;
        const drivingCost = Math.round(distMiles * fuelCostPerMile * 100) / 100;
        results.push({
          mode: "driving",
          provider: "Self-drive",
          origin,
          destination,
          durationMinutes: Math.round(durSec / 60),
          price: drivingCost,
          stops: 0,
          source: "google_routes",
        });

        const uberPerMile = 2.0;
        const uberBase = 5;
        const uberPrice = Math.round((uberBase + distMiles * uberPerMile) * 100) / 100;
        results.push({
          mode: "rideshare",
          provider: "Uber / Lyft (est.)",
          origin,
          destination,
          durationMinutes: Math.round(durSec / 60),
          price: uberPrice,
          priceRange: {
            low: Math.round(uberPrice * 0.75 * 100) / 100,
            high: Math.round(uberPrice * 1.5 * 100) / 100,
          },
          stops: 0,
          source: "google_routes",
        });
      } else {
        results.push({
          mode: "train",
          provider: "Public Transit",
          origin,
          destination,
          durationMinutes: Math.round(durSec / 60),
          price: 0,
          stops: 0,
          source: "google_routes",
        });
      }
    }

    return results;
  } catch (err) {
    console.error("Google Routes fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// SerpAPI Flights — reuses existing cash flight search for accurate pricing
// ---------------------------------------------------------------------------

function flightToTransportOption(
  flight: CashFlightResult,
  origin: string,
  destination: string,
): TransportOption {
  return {
    mode: "flight",
    provider: flight.airline,
    origin,
    destination,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    durationMinutes: flight.duration,
    price: flight.price,
    stops: flight.stops,
    bookingUrl: undefined,
    source: "serpapi",
  };
}

// ---------------------------------------------------------------------------
// Merge + Deduplicate
// ---------------------------------------------------------------------------

export function mergeTransportOptions(
  rome2rio: TransportOption[],
  googleRoutes: TransportOption[],
  serpApiFlights: TransportOption[],
): TransportOption[] {
  const all: TransportOption[] = [];

  all.push(...serpApiFlights);

  for (const opt of rome2rio) {
    if (opt.mode === "flight" && serpApiFlights.length > 0) continue;
    all.push(opt);
  }

  for (const opt of googleRoutes) {
    const dup = all.some(
      (a) => a.mode === opt.mode && a.source !== "google_routes" && Math.abs(a.price - opt.price) < opt.price * 0.3,
    );
    if (!dup) all.push(opt);
  }

  return all;
}

// ---------------------------------------------------------------------------
// Derive transport legs from trip airports + dates
// ---------------------------------------------------------------------------

export function deriveTransportLegs(
  origins: string[],
  destinations: string[],
  departureDate: string,
  returnDate?: string,
): TransportLeg[] {
  const legs: TransportLeg[] = [];
  const origin = origins[0] ?? "";
  const dest = destinations[0] ?? "";
  if (!origin || !dest) return legs;

  legs.push({ origin, destination: dest, date: departureDate });

  if (destinations.length > 1) {
    for (let i = 0; i < destinations.length - 1; i++) {
      const midDate = computeMidDate(departureDate, returnDate, i + 1, destinations.length);
      legs.push({
        origin: destinations[i],
        destination: destinations[i + 1],
        date: midDate,
      });
    }
  }

  if (returnDate) {
    const lastDest = destinations[destinations.length - 1] ?? dest;
    legs.push({ origin: lastDest, destination: origin, date: returnDate });
  }

  return legs;
}

function computeMidDate(
  start: string,
  end: string | undefined,
  legIndex: number,
  totalLegs: number,
): string {
  const startDate = new Date(start + "T12:00:00Z");
  const endDate = end ? new Date(end + "T12:00:00Z") : new Date(startDate.getTime() + 7 * 86_400_000);
  const totalMs = endDate.getTime() - startDate.getTime();
  const msPerLeg = totalMs / totalLegs;
  const mid = new Date(startDate.getTime() + msPerLeg * legIndex);
  return mid.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Per-leg search: parallel fetch across all sources
// ---------------------------------------------------------------------------

export async function searchTransportForLeg(
  leg: TransportLeg,
  cabinClass?: string,
): Promise<TransportOption[]> {
  const fetches: Promise<TransportOption[]>[] = [];

  fetches.push(
    scrapeRome2Rio(leg.origin, leg.destination).catch((err) => {
      console.error("Rome2Rio scrape failed (non-fatal):", err);
      return [] as TransportOption[];
    }),
  );

  fetches.push(
    searchGoogleRoutes(leg.origin, leg.destination, "DRIVE").catch((err) => {
      console.error("Google Routes DRIVE failed (non-fatal):", err);
      return [] as TransportOption[];
    }),
  );

  fetches.push(
    searchGoogleRoutes(leg.origin, leg.destination, "TRANSIT").catch((err) => {
      console.error("Google Routes TRANSIT failed (non-fatal):", err);
      return [] as TransportOption[];
    }),
  );

  if (SERPAPI_KEY) {
    fetches.push(
      searchCashFlights({
        origin: leg.origin,
        destination: leg.destination,
        date: leg.date,
        cabinClass: (cabinClass as "economy" | "premium_economy" | "business" | "first") ?? "economy",
      })
        .then((flights) =>
          flights.slice(0, 3).map((f) => flightToTransportOption(f, leg.origin, leg.destination)),
        )
        .catch((err) => {
          console.error("SerpAPI flights failed (non-fatal):", err);
          return [] as TransportOption[];
        }),
    );
  }

  const [rome2rio, googleDrive, googleTransit, serpFlights = []] = await Promise.all(fetches);

  return mergeTransportOptions(
    rome2rio,
    [...googleDrive, ...googleTransit],
    serpFlights,
  );
}

// ---------------------------------------------------------------------------
// Top-level: search all legs for all travelers
// ---------------------------------------------------------------------------

export async function searchTransportForTravelers(
  travelers: TransportSearchInput[],
  departureDate: string,
  returnDate: string | undefined,
  cabinClass?: string,
): Promise<{ legs: TransportLeg[]; optionsByLeg: TransportOption[][] }> {
  if (travelers.length === 0) return { legs: [], optionsByLeg: [] };

  const leader = travelers[0];
  const legs = deriveTransportLegs(
    leader.originAirports,
    leader.destinationAirports,
    departureDate,
    returnDate,
  );

  if (legs.length === 0) return { legs: [], optionsByLeg: [] };

  const dedupedLegs = new Map<string, TransportLeg>();
  for (const leg of legs) {
    const key = `${leg.origin}-${leg.destination}-${leg.date}`;
    if (!dedupedLegs.has(key)) dedupedLegs.set(key, leg);
  }

  const uniqueLegs = Array.from(dedupedLegs.values());
  const results = await Promise.all(
    uniqueLegs.map((leg) => searchTransportForLeg(leg, cabinClass)),
  );

  return { legs: uniqueLegs, optionsByLeg: results };
}
