// ---------------------------------------------------------------------------
// Hotel Search — SerpAPI (cash) + Backend Award Search
// ---------------------------------------------------------------------------

function getSerpApiKey() { return process.env.SERPAPI_KEY ?? ""; }
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HotelSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  rooms?: number;
  currency?: string;
  minStars?: number;
  sortBy?: "price" | "rating" | "relevance";
}

export interface CashHotelResult {
  source: "google_hotels";
  name: string;
  propertyToken?: string;
  cashTotal: number | null;
  cashPerNight: number;
  overallRating?: number;
  starRating?: number;
  neighborhood?: string;
  amenities: string[];
  thumbnailUrl?: string;
  bookingUrl?: string;
}

export interface AwardHotelResult {
  source: "awardtool";
  hotelId: string;
  name: string;
  program: string;
  programDisplayName: string;
  pointsPerNight: number;
  pointsTotal: number;
  surcharge: number;
  cashCost?: number;
  starRating?: number;
  category?: number;
}

export interface MergedHotelResult {
  hotelId: string;
  name: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;

  cashPerNight: number | null;
  cashTotal: number | null;

  awardOption?: {
    program: string;
    programDisplayName: string;
    pointsPerNight: number;
    pointsTotal: number;
    surcharge: number;
    category?: number;
    transferSources: {
      bank: string;
      bankDisplayName: string;
      ratio: number;
      transferTime: string;
    }[];
  };

  starRating?: number;
  overallRating?: number;
  neighborhood?: string;
  amenities: string[];
  thumbnailUrl?: string;
  bookingUrl?: string;

  cppValue?: number;
}

export interface ScoredHotel {
  hotel: MergedHotelResult;

  compositeScore: number;
  valueScore: number;
  locationScore: number;
  loyaltyScore: number;
  preferenceScore: number;
  qualityScore: number;

  rationale: string;
  paymentRecommendation: "points" | "cash" | "mixed";
  highlights: string[];

  cppValue?: number;
  estimatedSavings?: number;
}

export interface HotelStayGroup {
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  cashOptions: CashHotelResult[];
  awardOptions: AwardHotelResult[];
  scoredOptions?: ScoredHotel[];
}

export interface TravelerHotelGroup {
  travelerId: string;
  travelerName: string;
  clientId: string;
  stays: HotelStayGroup[];
}

export interface StayWindow {
  destination: string;
  checkIn: string;
  checkOut: string;
  nights: number;
}

export interface TravelerHotelSearchInput {
  travelerId: string;
  travelerName: string;
  clientId: string;
  stayWindows: StayWindow[];
  hotelPrograms?: string[];
}

// ---------------------------------------------------------------------------
// SerpAPI — Google Hotels (cash pricing)
// ---------------------------------------------------------------------------

const SORT_MAP: Record<string, number> = {
  price: 3,
  rating: 4,
  relevance: 1,
};

interface SerpApiHotelProperty {
  name?: string;
  property_token?: string;
  total_rate?: { extracted_lowest?: number };
  rate_per_night?: { extracted_lowest?: number; lowest?: string };
  overall_rating?: number;
  hotel_class?: number;
  neighborhood?: string;
  amenities?: string[];
  images?: { thumbnail?: string }[];
  link?: string;
}

interface SerpApiHotelAd {
  title?: string;
  property_token?: string;
  extracted_price?: number;
  price?: string;
  rating?: number;
  hotel_class?: number;
  amenities?: string[];
  thumbnail?: string;
  link?: string;
}

interface SerpApiHotelResponse {
  properties?: SerpApiHotelProperty[];
  ads?: SerpApiHotelAd[];
  error?: string;
}

export async function searchCashHotels(
  params: HotelSearchParams,
): Promise<CashHotelResult[]> {
  if (!getSerpApiKey()) {
    console.warn("SERPAPI_KEY not set — skipping cash hotel search");
    return [];
  }
  if (!params.destination || !params.checkIn || !params.checkOut) return [];

  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_hotels");
  url.searchParams.set("api_key", getSerpApiKey());
  url.searchParams.set("q", params.destination);
  url.searchParams.set("check_in_date", params.checkIn);
  url.searchParams.set("check_out_date", params.checkOut);
  url.searchParams.set("adults", String(params.adults ?? 2));
  url.searchParams.set("rooms", String(params.rooms ?? 1));
  url.searchParams.set("currency", params.currency ?? "USD");
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("sort_by", String(SORT_MAP[params.sortBy ?? "price"] ?? 3));

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`SerpAPI hotel error: ${res.status} ${res.statusText}`);
      return [];
    }
    const data: SerpApiHotelResponse = await res.json();
    if (data.error) {
      console.error("SerpAPI hotel error:", data.error);
      return [];
    }

    const results: CashHotelResult[] = [];
    const nights = computeNights(params.checkIn, params.checkOut);

    for (const p of (data.properties ?? []).slice(0, 20)) {
      if (!p.name) continue;

      const totalRate = p.total_rate?.extracted_lowest ?? null;
      const nightlyRate = p.rate_per_night?.extracted_lowest ?? null;
      const perNight = nightlyRate ?? (totalRate && nights > 0 ? totalRate / nights : null);
      if (perNight == null) continue;

      results.push({
        source: "google_hotels",
        name: p.name,
        propertyToken: p.property_token,
        cashTotal: totalRate ?? (perNight * nights),
        cashPerNight: perNight,
        overallRating: p.overall_rating,
        starRating: p.hotel_class,
        neighborhood: p.neighborhood,
        amenities: p.amenities ?? [],
        thumbnailUrl: p.images?.[0]?.thumbnail,
        bookingUrl: p.link,
      });
    }

    // Fallback: scrape from ads if no properties
    if (results.length === 0) {
      for (const ad of (data.ads ?? []).slice(0, 10)) {
        if (!ad.title) continue;

        const perNight = ad.extracted_price ?? parseFloat(ad.price?.replace(/[^0-9.]/g, "") ?? "");
        if (!perNight || isNaN(perNight)) continue;

        results.push({
          source: "google_hotels",
          name: ad.title,
          propertyToken: ad.property_token,
          cashTotal: perNight * nights,
          cashPerNight: perNight,
          overallRating: ad.rating,
          starRating: ad.hotel_class,
          amenities: ad.amenities ?? [],
          thumbnailUrl: ad.thumbnail,
          bookingUrl: ad.link,
        });
      }
    }

    results.sort((a, b) => a.cashPerNight - b.cashPerNight);
    return results;
  } catch (err) {
    console.error("SerpAPI hotel fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Award Hotel Search — calls backend API
// ---------------------------------------------------------------------------

export async function searchAwardHotels(
  params: HotelSearchParams,
  programs?: string[],
): Promise<AwardHotelResult[]> {
  if (!BACKEND_URL) {
    console.warn("BACKEND_URL not set — skipping award hotel search");
    return [];
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/hotels/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: params.destination,
        check_in: params.checkIn,
        check_out: params.checkOut,
        programs: programs ?? [],
        guests: params.adults ?? 2,
        rooms: params.rooms ?? 1,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.warn(`Backend hotel search returned ${res.status} — skipping award results`);
      return [];
    }

    const data = await res.json();
    const nights = computeNights(params.checkIn, params.checkOut);

    const results: AwardHotelResult[] = [];
    for (const opt of data.options ?? data.awardOptions ?? []) {
      if (!opt.name && !opt.hotel_name) continue;
      const pointsTotal = opt.points ?? opt.pointsTotal ?? opt.points_total ?? 0;
      if (!pointsTotal) continue;

      results.push({
        source: "awardtool",
        hotelId: opt.hotel_id ?? opt.hotelId ?? opt.property_token ?? "",
        name: opt.name ?? opt.hotel_name ?? "",
        program: opt.brand ?? opt.program ?? "",
        programDisplayName: HOTEL_PROGRAM_NAMES[opt.brand ?? opt.program ?? ""] ?? opt.brand ?? opt.program ?? "",
        pointsPerNight: nights > 0 ? Math.round(pointsTotal / nights) : pointsTotal,
        pointsTotal,
        surcharge: opt.surcharge ?? opt.taxes ?? 0,
        cashCost: opt.cash ?? opt.cashCost ?? opt.cash_cost ?? undefined,
        starRating: opt.star_rating ?? opt.starRating ?? undefined,
        category: opt.category ?? undefined,
      });
    }

    results.sort((a, b) => a.pointsTotal - b.pointsTotal);
    return results;
  } catch (err) {
    console.warn("Backend hotel search failed (non-fatal):", err);
    return [];
  }
}

const HOTEL_PROGRAM_NAMES: Record<string, string> = {
  HYATT: "World of Hyatt",
  MAR: "Marriott Bonvoy",
  HH: "Hilton Honors",
  IHG: "IHG One Rewards",
  WH: "Wyndham Rewards",
  CHOICE: "Choice Privileges",
  ACCOR: "Accor Live Limitless",
  "World of Hyatt": "World of Hyatt",
  "Marriott Bonvoy": "Marriott Bonvoy",
  "Hilton Honors": "Hilton Honors",
  "IHG One Rewards": "IHG One Rewards",
};

// ---------------------------------------------------------------------------
// Stay Window Derivation
// ---------------------------------------------------------------------------

export function deriveStayWindows(
  destinations: string[],
  departureDate: string,
  returnDate: string | undefined,
  legDates?: string[],
): StayWindow[] {
  if (!destinations.length || !departureDate) return [];
  const endDate = returnDate ?? departureDate;

  if (destinations.length === 1) {
    const nights = computeNights(departureDate, endDate);
    if (nights <= 0) return [];
    return [{
      destination: destinations[0],
      checkIn: departureDate,
      checkOut: endDate,
      nights,
    }];
  }

  if (legDates && legDates.length >= destinations.length) {
    return destinations.map((dest, i) => {
      const checkIn = legDates[i];
      const checkOut = legDates[i + 1] ?? endDate;
      return {
        destination: dest,
        checkIn,
        checkOut,
        nights: computeNights(checkIn, checkOut),
      };
    }).filter((w) => w.nights > 0);
  }

  // Evenly split total days across destinations
  const totalNights = computeNights(departureDate, endDate);
  if (totalNights <= 0) return [];
  const nightsPer = Math.floor(totalNights / destinations.length);
  const remainder = totalNights % destinations.length;

  const windows: StayWindow[] = [];
  const cursor = new Date(departureDate + "T12:00:00Z");

  for (let i = 0; i < destinations.length; i++) {
    const n = nightsPer + (i < remainder ? 1 : 0);
    if (n <= 0) continue;
    const checkIn = cursor.toISOString().split("T")[0];
    cursor.setDate(cursor.getDate() + n);
    const checkOut = cursor.toISOString().split("T")[0];

    windows.push({
      destination: destinations[i],
      checkIn,
      checkOut,
      nights: n,
    });
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Combined Search — per traveler with dedup
// ---------------------------------------------------------------------------

export async function searchHotelsForTravelers(
  travelers: TravelerHotelSearchInput[],
): Promise<TravelerHotelGroup[]> {
  // Deduplicate stay windows across travelers
  const uniqueWindows = new Map<string, StayWindow>();
  for (const t of travelers) {
    for (const w of t.stayWindows) {
      const key = `${w.destination}|${w.checkIn}|${w.checkOut}`;
      if (!uniqueWindows.has(key)) uniqueWindows.set(key, w);
    }
  }

  // Collect hotel programs across all travelers
  const allPrograms = new Set<string>();
  for (const t of travelers) {
    for (const p of t.hotelPrograms ?? []) allPrograms.add(p);
  }

  // Fire all searches in parallel (cash + award per window)
  const windowEntries = Array.from(uniqueWindows.entries());
  const windowResults = await Promise.all(
    windowEntries.map(async ([key, w]) => {
      const params: HotelSearchParams = {
        destination: w.destination,
        checkIn: w.checkIn,
        checkOut: w.checkOut,
      };
      const [cash, award] = await Promise.all([
        searchCashHotels(params),
        searchAwardHotels(params, Array.from(allPrograms)),
      ]);
      return [key, { cash, award, window: w }] as const;
    }),
  );

  const windowCache = new Map(windowResults);

  // Assemble per traveler
  const groups: TravelerHotelGroup[] = [];

  for (const traveler of travelers) {
    const stays: HotelStayGroup[] = [];

    for (const w of traveler.stayWindows) {
      const key = `${w.destination}|${w.checkIn}|${w.checkOut}`;
      const data = windowCache.get(key);
      if (!data) continue;

      stays.push({
        destination: w.destination,
        checkIn: w.checkIn,
        checkOut: w.checkOut,
        nights: w.nights,
        cashOptions: data.cash,
        awardOptions: data.award,
      });
    }

    groups.push({
      travelerId: traveler.travelerId,
      travelerName: traveler.travelerName,
      clientId: traveler.clientId,
      stays,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Merge Cash + Award into MergedHotelResult
// ---------------------------------------------------------------------------

export function mergeHotelOptions(
  cashOptions: CashHotelResult[],
  awardOptions: AwardHotelResult[],
  stayWindow: StayWindow,
  transferPartners: Record<string, { name: string; hotelPartners: Record<string, { ratio: number; transferTime: string }> }>,
): MergedHotelResult[] {
  const merged: MergedHotelResult[] = [];
  const awardByName = new Map<string, AwardHotelResult>();

  for (const a of awardOptions) {
    const normalizedName = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    awardByName.set(normalizedName, a);
  }

  // Process cash options, try to attach matching award options
  const matchedAwardNames = new Set<string>();

  for (const cash of cashOptions) {
    const normalizedName = cash.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const award = awardByName.get(normalizedName);
    if (award) matchedAwardNames.add(normalizedName);

    const awardOpt = award ? buildAwardOption(award, transferPartners) : undefined;

    const cppValue = (award && cash.cashTotal && award.pointsTotal > 0)
      ? Math.round(((cash.cashTotal - award.surcharge) / award.pointsTotal) * 10000) / 100
      : undefined;

    merged.push({
      hotelId: cash.propertyToken ?? normalizedName,
      name: cash.name,
      destination: stayWindow.destination,
      checkIn: stayWindow.checkIn,
      checkOut: stayWindow.checkOut,
      nights: stayWindow.nights,
      cashPerNight: cash.cashPerNight,
      cashTotal: cash.cashTotal,
      awardOption: awardOpt,
      starRating: cash.starRating,
      overallRating: cash.overallRating,
      neighborhood: cash.neighborhood,
      amenities: cash.amenities,
      thumbnailUrl: cash.thumbnailUrl,
      bookingUrl: cash.bookingUrl,
      cppValue,
    });
  }

  // Add award-only options (no cash match)
  for (const award of awardOptions) {
    const normalizedName = award.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (matchedAwardNames.has(normalizedName)) continue;

    const awardOpt = buildAwardOption(award, transferPartners);

    merged.push({
      hotelId: award.hotelId || normalizedName,
      name: award.name,
      destination: stayWindow.destination,
      checkIn: stayWindow.checkIn,
      checkOut: stayWindow.checkOut,
      nights: stayWindow.nights,
      cashPerNight: award.cashCost ? award.cashCost / Math.max(1, stayWindow.nights) : null,
      cashTotal: award.cashCost ?? null,
      awardOption: awardOpt,
      starRating: award.starRating,
      amenities: [],
      cppValue: (award.cashCost && award.pointsTotal > 0)
        ? Math.round(((award.cashCost - award.surcharge) / award.pointsTotal) * 10000) / 100
        : undefined,
    });
  }

  return merged;
}

function buildAwardOption(
  award: AwardHotelResult,
  transferPartners: Record<string, { name: string; hotelPartners: Record<string, { ratio: number; transferTime: string }> }>,
): NonNullable<MergedHotelResult["awardOption"]> {
  const transferSources: { bank: string; bankDisplayName: string; ratio: number; transferTime: string }[] = [];

  for (const [bankSlug, bank] of Object.entries(transferPartners)) {
    const match = Object.entries(bank.hotelPartners).find(
      ([programName]) => programName.toLowerCase().includes(award.program.toLowerCase())
        || award.programDisplayName.toLowerCase().includes(programName.toLowerCase()),
    );
    if (match) {
      transferSources.push({
        bank: bankSlug,
        bankDisplayName: bank.name,
        ratio: match[1].ratio,
        transferTime: match[1].transferTime,
      });
    }
  }

  return {
    program: award.program,
    programDisplayName: award.programDisplayName,
    pointsPerNight: award.pointsPerNight,
    pointsTotal: award.pointsTotal,
    surcharge: award.surcharge,
    category: award.category,
    transferSources,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function computeNights(checkIn: string, checkOut: string): number {
  try {
    const ci = new Date(checkIn + "T12:00:00Z");
    const co = new Date(checkOut + "T12:00:00Z");
    return Math.max(0, Math.round((co.getTime() - ci.getTime()) / 86_400_000));
  } catch {
    return 0;
  }
}
