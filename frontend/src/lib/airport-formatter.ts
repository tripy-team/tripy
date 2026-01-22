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
  
  // If already formatted as "City (CODE)", extract the code
  const codeMatch = trimmed.match(/\(([A-Z]{3})\)/);
  if (codeMatch) {
    return codeMatch[1];
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
