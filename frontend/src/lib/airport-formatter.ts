/**
 * Airport Formatter Utility
 * 
 * Helper functions to search for airports and get airport codes
 * Used for converting city names to airport codes for autopopulation
 */

import { locations } from './api';

/**
 * Search for an airport by city name or airport code and return the IATA code
 * Used for autopopulation from chatbot when city names are extracted
 */
export async function searchAndFormatAirport(query: string): Promise<string> {
  if (!query || !query.trim()) {
    return query;
  }
  
  const trimmed = query.trim().toUpperCase();
  
  // If already an airport code (3 letters), return it
  if (/^[A-Z]{3}$/.test(trimmed)) {
    return trimmed;
  }
  
  // If already formatted as "City (CODE)" or "City (CODE1,CODE2,CODE3)", extract the first code
  const codeMatch = trimmed.match(/\(([A-Z]{3}(?:,[A-Z]{3})*)\)/);
  if (codeMatch) {
    // Extract first airport code from comma-separated list
    const codes = codeMatch[1].split(',');
    return codes[0].trim();
  }
  
  try {
    // Search for airports using the airport autocomplete
    const response = await locations.airportsAutocomplete(query.trim(), 5);
    
    if (response && response.airports && response.airports.length > 0) {
      // Get the best match (first result, which should be sorted by relevance)
      const bestMatch = response.airports[0];
      return bestMatch.iata_code;
    }
    
    // If no match found, return the original query (might be a valid airport code)
    return trimmed;
  } catch (error) {
    console.error('Error searching for airport:', error);
    // Return original query if search fails
    return trimmed;
  }
}

/**
 * Search and format multiple airports
 */
export async function searchAndFormatAirports(queries: string[]): Promise<string[]> {
  if (!queries || queries.length === 0) {
    return [];
  }
  
  // Search all airports in parallel
  const formatted = await Promise.all(
    queries.map(query => searchAndFormatAirport(query))
  );
  
  return formatted;
}

/** True if the string looks like an IATA airport code (3 letters). */
export function isLikelyAirportCode(s: string): boolean {
  return typeof s === 'string' && /^[A-Za-z]{3}$/.test(s.trim());
}

/**
 * Resolve an IATA code to its city name via airports autocomplete.
 * Returns null if not found or on error.
 */
export async function getCityForAirportCode(iata: string): Promise<string | null> {
  const code = (iata || '').trim().toUpperCase();
  if (!code || code.length !== 3) return null;
  try {
    const res = await locations.airportsAutocomplete(code, 5);
    const list = res?.airports || [];
    const match = list.find((a) => (a.iata_code || '').toUpperCase() === code);
    return (match?.city || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Batch-resolve IATA codes to city names. Returns a map code -> city.
 * Deduplicates and skips non–3-letter strings.
 */
export async function getCityMapForCodes(codes: string[]): Promise<Record<string, string>> {
  const unique = [...new Set((codes || []).map((c) => (c || '').trim().toUpperCase()).filter((c) => c.length === 3))];
  const entries = await Promise.all(
    unique.map(async (c) => {
      const city = await getCityForAirportCode(c);
      return [c, city] as const;
    })
  );
  return Object.fromEntries(entries.filter(([, city]) => city != null)) as Record<string, string>;
}

/**
 * Format an airport for display: if it looks like an IATA code and we have a city, show "CODE (City)".
 * Otherwise return the original string.
 */
export function formatAirportDisplay(codeOrName: string, city?: string | null): string {
  const s = (codeOrName || '').trim();
  if (!s) return s;
  if (city && isLikelyAirportCode(s)) return `${s.toUpperCase()} (${city})`;
  return s;
}
