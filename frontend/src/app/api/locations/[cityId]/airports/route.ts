import { NextResponse } from "next/server";

// Simple mock mapping from city_id to nearby airports.
// Replace with real backend lookup later.
const AIRPORTS_BY_CITY: Record<string, { iata: string; name: string; distance_km: number }[]> = {
  nyc_us: [
    { iata: "JFK", name: "John F. Kennedy International Airport", distance_km: 21 },
    { iata: "LGA", name: "LaGuardia Airport", distance_km: 13 },
    { iata: "EWR", name: "Newark Liberty International Airport", distance_km: 23 },
  ],
  par_fr: [
    { iata: "CDG", name: "Charles de Gaulle Airport", distance_km: 25 },
    { iata: "ORY", name: "Paris Orly Airport", distance_km: 14 },
  ],
  lhr_gb: [
    { iata: "LHR", name: "London Heathrow Airport", distance_km: 24 },
    { iata: "LGW", name: "London Gatwick Airport", distance_km: 45 },
  ],
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit") ?? "3";
  const limit = Number(limitParam);
  // For routes like /api/locations/[cityId]/airports, the path ends with /{cityId}/airports
  const pathname = new URL(req.url).pathname;
  const segments = pathname.split("/").filter(Boolean);
  // e.g. ["api", "locations", "{cityId}", "airports"]
  const cityId = segments.length >= 4 ? decodeURIComponent(segments[segments.length - 2]) : "";

  const allAirports = AIRPORTS_BY_CITY[cityId] ?? [];
  const max = Number.isFinite(limit) && limit > 0 ? limit : 3;
  const airports = allAirports.slice(0, max);

  return NextResponse.json({ airports }, { status: 200 });
}

