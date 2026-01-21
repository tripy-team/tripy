import { NextResponse } from "next/server";

// Simple stub implementation for nearby airports.
// Replace this with a real lookup (backend proxy / DB / Amadeus) later.

const AIRPORTS_BY_CITY: Record<string, { iata: string; name: string; distance_km: number }[]> = {
    nyc_us: [
        { iata: "JFK", name: "John F. Kennedy International Airport", distance_km: 20 },
        { iata: "LGA", name: "LaGuardia Airport", distance_km: 13 },
        { iata: "EWR", name: "Newark Liberty International Airport", distance_km: 23 },
    ],
    par_fr: [
        { iata: "CDG", name: "Charles de Gaulle Airport", distance_km: 25 },
        { iata: "ORY", name: "Paris Orly Airport", distance_km: 14 },
    ],
    lon_gb: [
        { iata: "LHR", name: "Heathrow Airport", distance_km: 25 },
        { iata: "LGW", name: "Gatwick Airport", distance_km: 45 },
    ],
    tok_jp: [
        { iata: "HND", name: "Haneda Airport", distance_km: 20 },
        { iata: "NRT", name: "Narita International Airport", distance_km: 60 },
    ],
};

export async function GET(req: Request, ctx: { params: { cityId: string } }) {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit") ?? "3";
    const limit = Number(limitParam);
    const cityId = ctx.params.cityId;

    const max = Number.isFinite(limit) && limit > 0 ? limit : 3;
    const airports = (AIRPORTS_BY_CITY[cityId] ?? []).slice(0, max);

    return NextResponse.json({ airports }, { status: 200 });
}

