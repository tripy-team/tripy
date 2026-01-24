// Client-side city data for autocomplete
// This replaces the Amadeus API dependency

export interface CityData {
  city: string;
  country: string;
  region: string;
}

// Popular airports mapping for major cities
const airportCodes: Record<string, string[]> = {
  'Paris': ['CDG', 'ORY'],
  'London': ['LHR', 'LGW', 'STN'],
  'New York': ['JFK', 'LGA', 'EWR'],
  'Los Angeles': ['LAX'],
  'Tokyo': ['NRT', 'HND'],
  'Barcelona': ['BCN'],
  'Rome': ['FCO', 'CIA'],
  'Amsterdam': ['AMS'],
  'Berlin': ['BER', 'TXL'],
  'Madrid': ['MAD'],
  'Miami': ['MIA'],
  'San Francisco': ['SFO'],
  'Chicago': ['ORD', 'MDW'],
  'Boston': ['BOS'],
  'Seattle': ['SEA'],
  'Toronto': ['YYZ', 'YTZ'],
  'Vancouver': ['YVR'],
  'Sydney': ['SYD'],
  'Melbourne': ['MEL'],
  'Dubai': ['DXB'],
  'Singapore': ['SIN'],
  'Hong Kong': ['HKG'],
  'Bangkok': ['BKK'],
  'Seoul': ['ICN', 'GMP'],
  'Beijing': ['PEK', 'PKX'],
  'Shanghai': ['PVG', 'SHA'],
  'Mumbai': ['BOM'],
  'Delhi': ['DEL'],
  'Cairo': ['CAI'],
  'Istanbul': ['IST', 'SAW'],
  'Mexico City': ['MEX'],
  'São Paulo': ['GRU', 'CGH'],
  'Rio de Janeiro': ['GIG', 'SDU'],
  'Buenos Aires': ['EZE', 'AEP'],
  'Lima': ['LIM'],
  'Bogotá': ['BOG'],
  'Santiago': ['SCL'],
};

// Cities data - using a static array instead of JSON import to avoid build issues
// This data comes from scripts/cities.json
const citiesData: CityData[] = [
  {"city": "Paris", "country": "France", "region": "Europe"},
  {"city": "London", "country": "United Kingdom", "region": "Europe"},
  {"city": "Barcelona", "country": "Spain", "region": "Europe"},
  {"city": "Rome", "country": "Italy", "region": "Europe"},
  {"city": "Amsterdam", "country": "Netherlands", "region": "Europe"},
  {"city": "Berlin", "country": "Germany", "region": "Europe"},
  {"city": "New York", "country": "United States", "region": "North America"},
  {"city": "Los Angeles", "country": "United States", "region": "North America"},
  {"city": "San Francisco", "country": "United States", "region": "North America"},
  {"city": "Miami", "country": "United States", "region": "North America"},
  {"city": "Chicago", "country": "United States", "region": "North America"},
  {"city": "Boston", "country": "United States", "region": "North America"},
  {"city": "Seattle", "country": "United States", "region": "North America"},
  {"city": "Tokyo", "country": "Japan", "region": "Asia"},
  {"city": "Bangkok", "country": "Thailand", "region": "Asia"},
  {"city": "Singapore", "country": "Singapore", "region": "Asia"},
  {"city": "Dubai", "country": "United Arab Emirates", "region": "Middle East"},
  {"city": "Sydney", "country": "Australia", "region": "Oceania"},
  {"city": "Melbourne", "country": "Australia", "region": "Oceania"},
  {"city": "Toronto", "country": "Canada", "region": "North America"},
  {"city": "Vancouver", "country": "Canada", "region": "North America"},
  {"city": "Mexico City", "country": "Mexico", "region": "North America"},
  {"city": "Cancun", "country": "Mexico", "region": "North America"},
  {"city": "Rio de Janeiro", "country": "Brazil", "region": "South America"},
  {"city": "Buenos Aires", "country": "Argentina", "region": "South America"},
  {"city": "Cairo", "country": "Egypt", "region": "Africa"},
  {"city": "Cape Town", "country": "South Africa", "region": "Africa"},
  {"city": "Istanbul", "country": "Turkey", "region": "Middle East"},
  {"city": "Mumbai", "country": "India", "region": "Asia"},
  {"city": "Delhi", "country": "India", "region": "Asia"},
  {"city": "Seoul", "country": "South Korea", "region": "Asia"},
  {"city": "Hong Kong", "country": "China", "region": "Asia"},
  {"city": "Beijing", "country": "China", "region": "Asia"},
  {"city": "Shanghai", "country": "China", "region": "Asia"},
  // Add more popular cities as needed
];

export const cities: CityData[] = citiesData;

// Search function for client-side autocomplete
export function searchCities(query: string, maxResults: number = 10): CityData[] {
  if (!query || query.length < 1) {
    return [];
  }

  const queryLower = query.toLowerCase().trim();
  const results: CityData[] = [];

  // First, try exact matches (case-insensitive)
  for (const city of cities) {
    if (city.city.toLowerCase() === queryLower) {
      results.push(city);
      if (results.length >= maxResults) return results;
    }
  }

  // Then, try starts-with matches
  for (const city of cities) {
    if (
      city.city.toLowerCase().startsWith(queryLower) &&
      !results.find(r => r.city === city.city && r.country === city.country)
    ) {
      results.push(city);
      if (results.length >= maxResults) return results;
    }
  }

  // Then, try contains matches
  for (const city of cities) {
    if (
      (city.city.toLowerCase().includes(queryLower) ||
       city.country.toLowerCase().includes(queryLower)) &&
      !results.find(r => r.city === city.city && r.country === city.country)
    ) {
      results.push(city);
      if (results.length >= maxResults) return results;
    }
  }

  return results;
}

// Get airport codes for a city
export function getAirportCodes(cityName: string): string[] {
  return airportCodes[cityName] || [];
}

// Format city name with airport code
export function formatCityWithAirport(city: CityData): string {
  const airports = getAirportCodes(city.city);
  if (airports.length > 0) {
    return `${city.city} (${airports[0]})`;
  }
  return city.city;
}
