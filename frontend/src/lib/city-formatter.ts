/**
 * City Formatter Utility
 *
 * Helper functions to format city names with airport codes
 * and search for cities to get their codes for autopopulation.
 */

import { cities as citiesAPI, CitySearchResult } from './api';

function isFormattedCity(s: string) {
  return /^.+ \([A-Za-z]{3}\)$/.test(s.trim());
}

function normalizeCityKey(s: string) {
  // For dedupe: strip code suffix, lower-case, trim spaces
  return s
    .trim()
    .replace(/\s*\([A-Za-z]{3}\)\s*$/, '')
    .toLowerCase();
}

function extractCitiesFromResponse(resp: any): CitySearchResult[] {
  // Support common shapes:
  // { cities: [...] }, { data: { cities: [...] } }, { results: [...] }, [...]
  if (!resp) return [];

  if (Array.isArray(resp)) return resp as CitySearchResult[];
  if (Array.isArray(resp.cities)) return resp.cities as CitySearchResult[];
  if (resp.data && Array.isArray(resp.data.cities)) return resp.data.cities as CitySearchResult[];
  if (Array.isArray(resp.results)) return resp.results as CitySearchResult[];

  return [];
}

/**
 * Format a city name with its airport code
 * Returns "City (CODE)" format if code is available, otherwise just city name
 */
export function formatCityWithCode(city: CitySearchResult | string): string {
  if (typeof city === 'string') {
    const s = city.trim();
    if (!s) return '';
    // If it's already formatted as "City (CODE)", return as-is
    if (isFormattedCity(s)) return s;
    return s;
  }

  const cityName = (city.name || (city as any).cityName || '').trim();
  const iataCode = (city.iataCode || (city as any).id || '').toString().trim();

  if (iataCode && iataCode.length === 3) {
    return `${cityName} (${iataCode.toUpperCase()})`.trim();
  }

  return cityName;
}

/**
 * Search for a city by name and return formatted "City (CODE)" string
 * Used for autopopulation from chatbot
 */
export async function searchAndFormatCity(cityName: string): Promise<string> {
  const input = (cityName || '').trim();
  if (!input) return '';

  // If already formatted, return as-is
  if (isFormattedCity(input)) return input;

  try {
    const resp = await citiesAPI.search(input, 5);
    const results = extractCitiesFromResponse(resp);

    if (results.length > 0) {
      const bestMatch = results[0];
      const formatted = formatCityWithCode(bestMatch);
      return formatted || input;
    }

    return input;
  } catch (error) {
    console.error('Error searching for city:', error);
    return input;
  }
}

/**
 * Concurrency-limited mapper (prevents 10+ parallel calls spiking the UI / API)
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length) as any;
  let i = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}

/**
 * Search and format multiple cities
 * - trims
 * - drops empty
 * - dedupes by base city (ignores "(CODE)")
 */
export async function searchAndFormatCities(cityNames: string[]): Promise<string[]> {
  if (!cityNames || cityNames.length === 0) return [];

  const cleaned = cityNames.map((c) => (c || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  // Deduplicate inputs first to avoid redundant API calls
  const seen = new Set<string>();
  const uniqueInputs: string[] = [];
  for (const c of cleaned) {
    const key = normalizeCityKey(c);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueInputs.push(c);
    }
  }

  const formatted = await mapLimit(uniqueInputs, 4, async (city) => searchAndFormatCity(city));

  // Final pass: remove empties + dedupe again (now that codes may exist)
  const finalSeen = new Set<string>();
  const final: string[] = [];
  for (const c of formatted) {
    const s = (c || '').trim();
    if (!s) continue;
    const key = normalizeCityKey(s);
    if (!finalSeen.has(key)) {
      finalSeen.add(key);
      final.push(s);
    }
  }

  return final;
}
