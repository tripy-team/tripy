import { NextResponse } from "next/server";

// Simple in-memory mock data for city suggestions.
// This is a stub to prove wiring works; replace with real backend or DB later.
const MOCK_CITIES = [
  {
    city_id: "nyc_us",
    name: "New York City",
    region: "NY",
    country: "United States",
    lat: 40.7128,
    lng: -74.006,
  },
  {
    city_id: "par_fr",
    name: "Paris",
    region: "Île-de-France",
    country: "France",
    lat: 48.8566,
    lng: 2.3522,
  },
  {
    city_id: "lhr_gb",
    name: "London",
    region: "England",
    country: "United Kingdom",
    lat: 51.5074,
    lng: -0.1278,
  },
  {
    city_id: "sfo_us",
    name: "San Francisco",
    region: "CA",
    country: "United States",
    lat: 37.7749,
    lng: -122.4194,
  },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitParam = searchParams.get("limit") ?? "10";
  const limit = Number(limitParam);

  if (!q) {
    return NextResponse.json({ cities: [] }, { status: 200 });
  }

  const needle = q.toLowerCase();
  const max = Number.isFinite(limit) && limit > 0 ? limit : 10;

  const cities = MOCK_CITIES.filter((c) =>
    `${c.name} ${c.region ?? ""} ${c.country ?? ""}`.toLowerCase().includes(needle),
  ).slice(0, max);

  return NextResponse.json({ cities }, { status: 200 });
}

