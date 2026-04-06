// ---------------------------------------------------------------------------
// Flight Search — SerpAPI (cash) + Seats.aero (award/points)
// ---------------------------------------------------------------------------

const SERPAPI_KEY = process.env.SERPAPI_KEY ?? "";
const SEATS_AERO_KEY = process.env.SEATS_AERO_API_KEY ?? "";

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
  if (!SERPAPI_KEY) {
    console.warn("SERPAPI_KEY not set — skipping cash flight search");
    return [];
  }

  const cabin = SERP_CABIN_MAP[params.cabinClass ?? "economy"] ?? 1;

  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("api_key", SERPAPI_KEY);
  url.searchParams.set("departure_id", params.origin);
  url.searchParams.set("arrival_id", params.destination);
  url.searchParams.set("outbound_date", params.date);
  url.searchParams.set("type", "2"); // one-way
  url.searchParams.set("travel_class", String(cabin));
  url.searchParams.set("adults", String(params.adults ?? 1));
  url.searchParams.set("currency", "USD");
  url.searchParams.set("hl", "en");

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`SerpAPI error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data: SerpApiResponse = await res.json();
    if (data.error) {
      console.error("SerpAPI error:", data.error);
      return [];
    }

    const results: CashFlightResult[] = [];
    const allFlights = [
      ...(data.best_flights ?? []),
      ...(data.other_flights ?? []),
    ];

    for (const group of allFlights.slice(0, 8)) {
      const firstLeg = group.flights[0];
      const lastLeg = group.flights[group.flights.length - 1];
      if (!firstLeg || !lastLeg) continue;

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
      });
    }

    return results;
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
  Source: string;
}

interface SeatsAeroResponse {
  data: SeatsAeroAvailability[];
  count?: number;
}

export async function searchAwardFlights(
  params: FlightSearchParams,
): Promise<AwardFlightResult[]> {
  if (!SEATS_AERO_KEY) {
    console.warn("SEATS_AERO_API_KEY not set — skipping award search");
    return [];
  }

  const url = new URL("https://seats.aero/partnerapi/search");
  url.searchParams.set("origin_airport", params.origin);
  url.searchParams.set("destination_airport", params.destination);
  url.searchParams.set("start_date", params.date);
  url.searchParams.set("end_date", params.date);
  url.searchParams.set("take", "20");

  try {
    const res = await fetch(url.toString(), {
      headers: { "Partner-Authorization": SEATS_AERO_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`Seats.aero error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data: SeatsAeroResponse = await res.json();

    const cabinCode = SEATS_CABIN_CODE[params.cabinClass ?? "economy"] ?? "Y";
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

      results.push({
        source,
        origin: avail.Route?.OriginAirport ?? params.origin,
        destination: avail.Route?.DestinationAirport ?? params.destination,
        date: avail.Date,
        cabin: params.cabinClass ?? "economy",
        milesRequired: miles,
        taxes: estimateTaxes(params.origin, params.destination),
        seatsRemaining: seats,
        isDirect: isDirect ?? false,
        airlines,
        program: PROGRAM_NAMES[source] ?? source,
      });
    }

    results.sort((a, b) => a.milesRequired - b.milesRequired);
    return results.slice(0, 10);
  } catch (err) {
    console.error("Seats.aero fetch failed:", err);
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

export interface TravelerSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  originAirports: string[];
  destinationAirports: string[];
}

export async function searchFlightsForTravelers(
  travelers: TravelerSearchInput[],
  departureDate: string,
  returnDate: string | undefined,
  cabinClass: string,
): Promise<TravelerFlightGroup[]> {
  const cabin = normalizeCabin(cabinClass);

  // Deduplicate routes — many travelers share the same origin/dest
  const uniqueRoutes = new Map<string, { origin: string; dest: string; date: string }>();

  for (const traveler of travelers) {
    const origin = traveler.originAirports[0] ?? "";
    const dest = traveler.destinationAirports[0] ?? "";
    if (!origin || !dest) continue;

    const outKey = `${origin}-${dest}-${departureDate}-${cabin}`;
    if (!uniqueRoutes.has(outKey)) {
      uniqueRoutes.set(outKey, { origin, dest, date: departureDate });
    }

    if (returnDate) {
      const retKey = `${dest}-${origin}-${returnDate}-${cabin}`;
      if (!uniqueRoutes.has(retKey)) {
        uniqueRoutes.set(retKey, { origin: dest, dest: origin, date: returnDate });
      }
    }
  }

  // Fire ALL route searches in parallel (cash + award per route)
  const routeEntries = Array.from(uniqueRoutes.entries());
  const routeResults = await Promise.all(
    routeEntries.map(async ([key, { origin, dest, date }]) => {
      const [cash, award] = await Promise.all([
        searchCashFlights({ origin, destination: dest, date, cabinClass: cabin }),
        searchAwardFlights({ origin, destination: dest, date, cabinClass: cabin }),
      ]);
      return [key, { cash, award }] as const;
    }),
  );

  const routeCache = new Map(routeResults);

  // Assemble results per traveler (all data already fetched, pure mapping)
  const groups: TravelerFlightGroup[] = [];

  for (const traveler of travelers) {
    const origin = traveler.originAirports[0] ?? "";
    const dest = traveler.destinationAirports[0] ?? "";
    if (!origin || !dest) continue;

    const segments: FlightSegment[] = [];

    const outKey = `${origin}-${dest}-${departureDate}-${cabin}`;
    const outData = routeCache.get(outKey);
    if (outData) {
      segments.push({
        segmentLabel: "Outbound",
        origin,
        destination: dest,
        date: departureDate,
        cashOptions: outData.cash,
        awardOptions: outData.award,
      });
    }

    if (returnDate) {
      const retKey = `${dest}-${origin}-${returnDate}-${cabin}`;
      const retData = routeCache.get(retKey);
      if (retData) {
        segments.push({
          segmentLabel: "Return",
          origin: dest,
          destination: origin,
          date: returnDate,
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

function normalizeCabin(
  cabin: string,
): "economy" | "premium_economy" | "business" | "first" {
  const c = cabin?.toLowerCase().replace(/[\s_-]+/g, "") ?? "economy";
  if (c.includes("first")) return "first";
  if (c.includes("business")) return "business";
  if (c.includes("premium")) return "premium_economy";
  return "economy";
}
