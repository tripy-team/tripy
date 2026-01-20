/**
 * City Formatter Utility
 * 
 * Helper functions to format city names with airport codes
 * and search for cities to get their codes for autopopulation
 */

import { cities as citiesAPI, CitySearchResult } from './api';

/**
 * Format a city name with its airport code
 * Returns "City (CODE)" format if code is available, otherwise just city name
 */
export function formatCityWithCode(city: CitySearchResult | string): string {
  if (typeof city === 'string') {
    // If it's already formatted as "City (CODE)", return as-is
    if (/^.+ \(\w{3}\)$/.test(city)) {
      return city;
    }
    // Otherwise, return the string as-is (will be formatted when searched)
    return city;
  }
  
  const cityName = city.name || city.cityName || '';
  const iataCode = city.iataCode || city.id || '';
  
  if (iataCode && iataCode.length === 3) {
    return `${cityName} (${iataCode.toUpperCase()})`;
  }
  
  return cityName;
}

/**
 * Search for a city by name and return formatted "City (CODE)" string
 * Used for autopopulation from chatbot
 */
export async function searchAndFormatCity(cityName: string): Promise<string> {
  if (!cityName || !cityName.trim()) {
    return cityName;
  }
  
  // If already formatted, return as-is
  if (/^.+ \(\w{3}\)$/.test(cityName.trim())) {
    return cityName.trim();
  }
  
  try {
    // Search for the city
    const response = await citiesAPI.search(cityName.trim(), 5);
    
    if (response && response.cities && response.cities.length > 0) {
      // Get the best match (first result, which should be sorted by relevance)
      const bestMatch = response.cities[0];
      return formatCityWithCode(bestMatch);
    }
    
    // If no match found, return the original city name
    return cityName.trim();
  } catch (error) {
    console.error('Error searching for city:', error);
    // Return original name if search fails
    return cityName.trim();
  }
}

/**
 * Search and format multiple cities
 */
export async function searchAndFormatCities(cityNames: string[]): Promise<string[]> {
  if (!cityNames || cityNames.length === 0) {
    return [];
  }
  
  // Search all cities in parallel
  const formatted = await Promise.all(
    cityNames.map(city => searchAndFormatCity(city))
  );
  
  return formatted;
}
