import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "csv-parse/sync";

type AirportRow = {
  iata_code: string;
  name: string;
  municipality: string;
  iso_country: string;
  country_name: string;
  type: string;
};

type Suggestion = {
  name: string;
  type: string;
  description: string;
  id: string;
  airports: Array<{ id: string; name: string; city: string }>;
};

let _airports: AirportRow[] | null = null;
let _countryMap: Map<string, string> | null = null;

function getFilesDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "..", "backend", "files"),
    join(cwd, "backend", "files"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "airports.csv"))) return p;
  }
  return null;
}

function loadCountries(dir: string): Map<string, string> {
  if (_countryMap) return _countryMap;
  const map = new Map<string, string>();
  const p = join(dir, "countries.csv");
  if (!existsSync(p)) return map;
  try {
    const raw = readFileSync(p, "utf-8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Array<{
      code?: string;
      name?: string;
    }>;
    for (const r of rows) {
      const code = (r.code || "").trim().toUpperCase();
      const name = (r.name || "").trim();
      if (code && name) map.set(code, name);
    }
  } catch {
    // ignore
  }
  _countryMap = map;
  return map;
}

function getCountryName(iso: string, countryMap: Map<string, string>): string {
  const c = (iso || "").trim().toUpperCase();
  return countryMap.get(c) || c;
}

function loadAirports(dir: string): AirportRow[] {
  if (_airports) return _airports;
  const list: AirportRow[] = [];
  const countryMap = loadCountries(dir);
  const p = join(dir, "airports.csv");
  if (!existsSync(p)) return list;
  try {
    const raw = readFileSync(p, "utf-8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Array<{
      iata_code?: string;
      name?: string;
      municipality?: string;
      iso_country?: string;
      type?: string;
    }>;
    for (const r of rows) {
      const iata = (r.iata_code || "").trim().toUpperCase();
      if (!iata || iata.length !== 3) continue;
      list.push({
        iata_code: iata,
        name: (r.name || "").trim(),
        municipality: (r.municipality || "").trim(),
        iso_country: (r.iso_country || "").trim(),
        country_name: getCountryName(r.iso_country || "", countryMap),
        type: (r.type || "").trim().toLowerCase(),
      });
    }
  } catch {
    // ignore
  }
  _airports = list;
  return list;
}

function score(airport: AirportRow, q: string): number {
  const qu = q.toUpperCase();
  const iata = airport.iata_code;
  const name = (airport.name || "").toUpperCase();
  const city = (airport.municipality || "").toUpperCase();
  const country = (airport.country_name || "").toUpperCase();

  let s = 0;
  if (qu === iata) s += 1000;
  else if (iata.startsWith(qu)) s += 700;
  else if (name.startsWith(qu)) s += 500;
  else if (city.startsWith(qu)) s += 450;

  if (iata.includes(qu)) s += 300;
  if (name.includes(qu)) s += 250;
  if (city.includes(qu)) s += 200;
  if (country.includes(qu)) s += 150;

  const t = airport.type || "";
  if (t === "large_airport") s += 50;
  else if (t === "medium_airport") s += 25;

  return s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitParam = searchParams.get("limit") ?? "10";
  const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 50);

  if (!q || q.length < 1) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  const dir = getFilesDir();
  if (!dir) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  const airports = loadAirports(dir);
  if (airports.length === 0) {
    return NextResponse.json({ suggestions: [] }, { status: 200 });
  }

  const scored = airports
    .map((a) => ({ score: score(a, q), airport: a }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.airport.iata_code.localeCompare(b.airport.iata_code);
    })
    .slice(0, limit);

  const suggestions: Suggestion[] = scored.map(({ airport: a }) => ({
    name: a.name || a.iata_code,
    type: "airport",
    id: a.iata_code,
    description: [a.municipality, a.country_name].filter(Boolean).join(", "),
    airports: [{ id: a.iata_code, name: a.name || a.iata_code, city: a.municipality || "" }],
  }));

  return NextResponse.json({ suggestions }, { status: 200 });
}
