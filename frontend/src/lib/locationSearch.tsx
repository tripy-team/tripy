import React from "react";
import type { Airport } from "@/data";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenSet = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

function intersectionSize(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/**
 * Simple fuzzy matching using Levenshtein-like distance
 * Returns a score between 0 and 1 (1 = perfect match)
 */
function fuzzyMatch(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  
  if (q === t) return 1.0;
  if (t.includes(q)) return 0.8;
  if (q.includes(t)) return 0.6;
  
  // Simple character overlap
  const qChars = new Set(q.split(""));
  const tChars = new Set(t.split(""));
  const overlap = intersectionSize(qChars, tChars);
  const maxLen = Math.max(q.length, t.length);
  
  return overlap / maxLen;
}

/**
 * Score rules (bigger = better):
 * 1) Exact IATA code match (SEA) - 1000 points
 * 2) Prefix match on IATA (SE...) - 700 points
 * 3) City/airport starts-with - 500 points
 * 4) Contains match - 250 points
 * 5) Token overlap bonus - 40 points per token
 * 6) Popularity boost - popularity * 0.1
 * 7) Fuzzy match bonus - up to 100 points
 */
export function scoreAirport(a: Airport, query: string): number {
  const q = normalize(query);
  if (!q) return -Infinity;

  const iata = normalize(a.iata);
  const city = normalize(a.city);
  const airport = normalize(a.airport);
  const state = normalize(a.state ?? "");
  const country = normalize(a.country);

  // A single searchable string for "contains"
  const haystack = `${iata} ${city} ${state} ${country} ${airport}`;

  let score = 0;

  // 1) exact IATA (strongest) - auto-rank #1 if 3 letters match exactly
  if (q.length === 3 && q === iata) {
    score += 1000;
  }

  // 2) prefix IATA
  if (iata.startsWith(q)) {
    score += 700;
  }

  // 3) starts-with city/airport name
  if (city.startsWith(q)) {
    score += 500;
  }
  if (airport.startsWith(q)) {
    score += 450;
  }

  // 4) contains matches
  if (haystack.includes(q)) {
    score += 250;
  }

  // 5) token overlap (useful for partial multi-word)
  const qTokens = tokenSet(q);
  const aTokens = tokenSet(haystack);
  const overlap = intersectionSize(qTokens, aTokens);
  score += overlap * 40;

  // 6) Popularity boost
  score += (a.popularity || 0) * 0.1;

  // 7) Fuzzy matching for typos
  const cityFuzzy = fuzzyMatch(q, city);
  const airportFuzzy = fuzzyMatch(q, airport);
  const bestFuzzy = Math.max(cityFuzzy, airportFuzzy);
  if (bestFuzzy > 0.5) {
    score += bestFuzzy * 100;
  }

  // tiny preference for shorter matches (tends to feel "snappier")
  score -= Math.min(30, haystack.length / 100);

  return score;
}

/**
 * Check if query matches a metro code (NYC, LON, PAR, etc.)
 */
export function getMetroAirports(query: string, metroMappings: Record<string, string[]>): string[] {
  const q = normalize(query).toUpperCase();
  const metroCodes = metroMappings[q];
  return metroCodes || [];
}

/**
 * Search airports with smart ranking
 */
export function searchAirports(
  airports: Airport[],
  query: string,
  limit = 10,
  metroMappings: Record<string, string[]> = {}
): Airport[] {
  const q = query.trim();
  if (!q) return [];

  // Check for metro code match first
  const metroCodes = getMetroAirports(q, metroMappings);
  if (metroCodes.length > 0) {
    // Return airports matching the metro code
    const metroSet = new Set(metroCodes);
    const metroResults = airports
      .filter((a) => metroSet.has(a.iata))
      .slice(0, limit);
    if (metroResults.length > 0) {
      return metroResults;
    }
  }

  return airports
    .map((a) => ({ a, s: scoreAirport(a, q) }))
    .filter(({ s }) => s > 0) // keep only meaningful matches
    .sort((x, y) => y.s - x.s || x.a.iata.localeCompare(y.a.iata))
    .slice(0, limit)
    .map(({ a }) => a);
}

/**
 * Highlight matching text in a string
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text || !query) return text;
  
  const lowerText = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const matchIndex = lowerText.indexOf(queryLower);
  
  if (matchIndex === -1) {
    // Try fuzzy highlighting - find similar substring
    const words = text.split(/\s+/);
    return (
      <>
        {words.map((word, i) => {
          const wordLower = word.toLowerCase();
          if (wordLower.includes(queryLower) || queryLower.includes(wordLower)) {
            return (
              <React.Fragment key={i}>
                {i > 0 && " "}
                <span className="font-semibold bg-blue-100 text-blue-900">
                  {word}
                </span>
              </React.Fragment>
            );
          }
          return <React.Fragment key={i}>{i > 0 && " "}{word}</React.Fragment>;
        })}
      </>
    );
  }
  
  const before = text.substring(0, matchIndex);
  const match = text.substring(matchIndex, matchIndex + query.length);
  const after = text.substring(matchIndex + query.length);
  
  return (
    <>
      {before}
      <span className="font-semibold bg-blue-100 text-blue-900">{match}</span>
      {after}
    </>
  );
}
