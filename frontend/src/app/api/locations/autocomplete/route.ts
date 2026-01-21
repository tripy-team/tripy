import { NextResponse } from "next/server";

// Simple stub implementation for city autocomplete.
// Replace this with a real search (DB / Amadeus / backend proxy) later.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitParam = searchParams.get("limit") ?? "10";
  const limit = Number(limitParam);

  if (!q) {
    return NextResponse.json({ cities: [] }, { status: 200 });
  }

  const max = Number.isFinite(limit) && limit > 0 ? limit : 10;

  const allCities = [
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
      city_id: "lon_gb",
      name: "London",
      region: "England",
      country: "United Kingdom",
      lat: 51.5074,
      lng: -0.1278,
    },
    {
      city_id: "tok_jp",
      name: "Tokyo",
      region: "Tokyo",
      country: "Japan",
      lat: 35.6895,
      lng: 139.6917,
    },
  ];

  const qLower = q.toLowerCase();
  const cities = allCities
    .filter((c) => c.name.toLowerCase().includes(qLower))
    .slice(0, max);

  return NextResponse.json({ cities }, { status: 200 });
}

