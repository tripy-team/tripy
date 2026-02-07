/**
 * Client-side fallback for destination/airport autocomplete when the API returns empty.
 * Ensures "on every letter" the popup has suggestions.
 */

export interface FallbackCity {
  name: string;
  country: string;
  airportCode: string;
}

export interface FallbackAirport {
  iata_code: string;
  airport_name: string;
  city: string;
  country: string;
}

// Cities: name, country, primary airport. Used for DestinationAutocomplete.
export const POPULAR_CITIES: FallbackCity[] = [
  { name: "Amsterdam", country: "Netherlands", airportCode: "AMS" },
  { name: "Athens", country: "Greece", airportCode: "ATH" },
  { name: "Atlanta", country: "United States", airportCode: "ATL" },
  { name: "Austin", country: "United States", airportCode: "AUS" },
  { name: "Bangkok", country: "Thailand", airportCode: "BKK" },
  { name: "Barcelona", country: "Spain", airportCode: "BCN" },
  { name: "Beijing", country: "China", airportCode: "PEK" },
  { name: "Berlin", country: "Germany", airportCode: "BER" },
  { name: "Boston", country: "United States", airportCode: "BOS" },
  { name: "Brussels", country: "Belgium", airportCode: "BRU" },
  { name: "Buenos Aires", country: "Argentina", airportCode: "EZE" },
  { name: "Cairo", country: "Egypt", airportCode: "CAI" },
  { name: "Chicago", country: "United States", airportCode: "ORD" },
  { name: "Copenhagen", country: "Denmark", airportCode: "CPH" },
  { name: "Dallas", country: "United States", airportCode: "DFW" },
  { name: "Delhi", country: "India", airportCode: "DEL" },
  { name: "Denver", country: "United States", airportCode: "DEN" },
  { name: "Dubai", country: "United Arab Emirates", airportCode: "DXB" },
  { name: "Dublin", country: "Ireland", airportCode: "DUB" },
  { name: "Frankfurt", country: "Germany", airportCode: "FRA" },
  { name: "Hong Kong", country: "Hong Kong", airportCode: "HKG" },
  { name: "Houston", country: "United States", airportCode: "IAH" },
  { name: "Istanbul", country: "Turkey", airportCode: "IST" },
  { name: "Kuala Lumpur", country: "Malaysia", airportCode: "KUL" },
  { name: "Las Vegas", country: "United States", airportCode: "LAS" },
  { name: "Lisbon", country: "Portugal", airportCode: "LIS" },
  { name: "London", country: "United Kingdom", airportCode: "LHR" },
  { name: "Los Angeles", country: "United States", airportCode: "LAX" },
  { name: "Madrid", country: "Spain", airportCode: "MAD" },
  { name: "Miami", country: "United States", airportCode: "MIA" },
  { name: "Milan", country: "Italy", airportCode: "MXP" },
  { name: "Montreal", country: "Canada", airportCode: "YUL" },
  { name: "Mumbai", country: "India", airportCode: "BOM" },
  { name: "Munich", country: "Germany", airportCode: "MUC" },
  { name: "Nashville", country: "United States", airportCode: "BNA" },
  { name: "Naples", country: "Italy", airportCode: "NAP" },
  { name: "New York", country: "United States", airportCode: "JFK" },
  { name: "Nice", country: "France", airportCode: "NCE" },
  { name: "Orlando", country: "United States", airportCode: "MCO" },
  { name: "Oslo", country: "Norway", airportCode: "OSL" },
  { name: "Palma de Mallorca", country: "Spain", airportCode: "PMI" },
  { name: "Panama City", country: "Panama", airportCode: "PTY" },
  { name: "Paris", country: "France", airportCode: "CDG" },
  { name: "Philadelphia", country: "United States", airportCode: "PHL" },
  { name: "Phoenix", country: "United States", airportCode: "PHX" },
  { name: "Portland", country: "United States", airportCode: "PDX" },
  { name: "Prague", country: "Czech Republic", airportCode: "PRG" },
  { name: "Rio de Janeiro", country: "Brazil", airportCode: "GIG" },
  { name: "Rome", country: "Italy", airportCode: "FCO" },
  { name: "San Francisco", country: "United States", airportCode: "SFO" },
  { name: "San Diego", country: "United States", airportCode: "SAN" },
  { name: "Seattle", country: "United States", airportCode: "SEA" },
  { name: "Seoul", country: "South Korea", airportCode: "ICN" },
  { name: "Singapore", country: "Singapore", airportCode: "SIN" },
  { name: "Stockholm", country: "Sweden", airportCode: "ARN" },
  { name: "Sydney", country: "Australia", airportCode: "SYD" },
  { name: "Tokyo", country: "Japan", airportCode: "NRT" },
  { name: "Toronto", country: "Canada", airportCode: "YYZ" },
  { name: "Vancouver", country: "Canada", airportCode: "YVR" },
  { name: "Vienna", country: "Austria", airportCode: "VIE" },
  { name: "Washington", country: "United States", airportCode: "IAD" },
  { name: "Zurich", country: "Switzerland", airportCode: "ZRH" },
];

// Airports: IATA, name, city, country. Used for AirportAutocomplete. Includes city-level and airport-specific.
// Includes secondary metro airports (e.g. HOU, MDW, DAL) so users can find them in fallback mode.
export const POPULAR_AIRPORTS: FallbackAirport[] = [
  { iata_code: "AMS", airport_name: "Schiphol", city: "Amsterdam", country: "Netherlands" },
  { iata_code: "ATH", airport_name: "Athens International", city: "Athens", country: "Greece" },
  { iata_code: "ATL", airport_name: "Hartsfield-Jackson", city: "Atlanta", country: "United States" },
  { iata_code: "AUS", airport_name: "Austin-Bergstrom", city: "Austin", country: "United States" },
  { iata_code: "BCN", airport_name: "El Prat", city: "Barcelona", country: "Spain" },
  { iata_code: "BER", airport_name: "Berlin Brandenburg", city: "Berlin", country: "Germany" },
  { iata_code: "BKK", airport_name: "Suvarnabhumi", city: "Bangkok", country: "Thailand" },
  { iata_code: "BNA", airport_name: "Nashville International", city: "Nashville", country: "United States" },
  { iata_code: "BOS", airport_name: "Logan", city: "Boston", country: "United States" },
  { iata_code: "BRU", airport_name: "Brussels", city: "Brussels", country: "Belgium" },
  { iata_code: "BUR", airport_name: "Hollywood Burbank", city: "Los Angeles", country: "United States" },
  { iata_code: "BWI", airport_name: "Baltimore/Washington", city: "Washington", country: "United States" },
  { iata_code: "CDG", airport_name: "Charles de Gaulle", city: "Paris", country: "France" },
  { iata_code: "CLT", airport_name: "Charlotte Douglas", city: "Charlotte", country: "United States" },
  { iata_code: "CPH", airport_name: "Copenhagen", city: "Copenhagen", country: "Denmark" },
  { iata_code: "DAL", airport_name: "Dallas Love Field", city: "Dallas", country: "United States" },
  { iata_code: "DCA", airport_name: "Reagan National", city: "Washington", country: "United States" },
  { iata_code: "DEL", airport_name: "Indira Gandhi", city: "Delhi", country: "India" },
  { iata_code: "DEN", airport_name: "Denver International", city: "Denver", country: "United States" },
  { iata_code: "DFW", airport_name: "Dallas/Fort Worth", city: "Dallas", country: "United States" },
  { iata_code: "DUB", airport_name: "Dublin", city: "Dublin", country: "Ireland" },
  { iata_code: "DXB", airport_name: "Dubai International", city: "Dubai", country: "United Arab Emirates" },
  { iata_code: "FCO", airport_name: "Fiumicino", city: "Rome", country: "Italy" },
  { iata_code: "FLL", airport_name: "Fort Lauderdale-Hollywood", city: "Miami", country: "United States" },
  { iata_code: "FRA", airport_name: "Frankfurt", city: "Frankfurt", country: "Germany" },
  { iata_code: "HKG", airport_name: "Hong Kong International", city: "Hong Kong", country: "Hong Kong" },
  { iata_code: "HND", airport_name: "Haneda", city: "Tokyo", country: "Japan" },
  { iata_code: "HOU", airport_name: "William P. Hobby", city: "Houston", country: "United States" },
  { iata_code: "IAD", airport_name: "Dulles International", city: "Washington", country: "United States" },
  { iata_code: "IAH", airport_name: "George Bush Intercontinental", city: "Houston", country: "United States" },
  { iata_code: "ICN", airport_name: "Incheon", city: "Seoul", country: "South Korea" },
  { iata_code: "IST", airport_name: "Istanbul", city: "Istanbul", country: "Turkey" },
  { iata_code: "KUL", airport_name: "Kuala Lumpur International", city: "Kuala Lumpur", country: "Malaysia" },
  { iata_code: "JFK", airport_name: "John F. Kennedy", city: "New York", country: "United States" },
  { iata_code: "EWR", airport_name: "Newark Liberty", city: "New York", country: "United States" },
  { iata_code: "LGA", airport_name: "LaGuardia", city: "New York", country: "United States" },
  { iata_code: "LAX", airport_name: "Los Angeles International", city: "Los Angeles", country: "United States" },
  { iata_code: "LAS", airport_name: "Harry Reid", city: "Las Vegas", country: "United States" },
  { iata_code: "LGW", airport_name: "Gatwick", city: "London", country: "United Kingdom" },
  { iata_code: "LHR", airport_name: "Heathrow", city: "London", country: "United Kingdom" },
  { iata_code: "LIS", airport_name: "Lisbon", city: "Lisbon", country: "Portugal" },
  { iata_code: "MAD", airport_name: "Adolfo Suárez", city: "Madrid", country: "Spain" },
  { iata_code: "MCO", airport_name: "Orlando International", city: "Orlando", country: "United States" },
  { iata_code: "MDW", airport_name: "Midway", city: "Chicago", country: "United States" },
  { iata_code: "MIA", airport_name: "Miami International", city: "Miami", country: "United States" },
  { iata_code: "MSP", airport_name: "Minneapolis-Saint Paul", city: "Minneapolis", country: "United States" },
  { iata_code: "MUC", airport_name: "Munich", city: "Munich", country: "Germany" },
  { iata_code: "MXP", airport_name: "Malpensa", city: "Milan", country: "Italy" },
  { iata_code: "NAP", airport_name: "Naples", city: "Naples", country: "Italy" },
  { iata_code: "NCE", airport_name: "Côte d'Azur", city: "Nice", country: "France" },
  { iata_code: "NRT", airport_name: "Narita", city: "Tokyo", country: "Japan" },
  { iata_code: "OAK", airport_name: "Oakland International", city: "San Francisco", country: "United States" },
  { iata_code: "ORD", airport_name: "O'Hare", city: "Chicago", country: "United States" },
  { iata_code: "ORY", airport_name: "Orly", city: "Paris", country: "France" },
  { iata_code: "OSL", airport_name: "Oslo Gardermoen", city: "Oslo", country: "Norway" },
  { iata_code: "PDX", airport_name: "Portland International", city: "Portland", country: "United States" },
  { iata_code: "PEK", airport_name: "Beijing Capital", city: "Beijing", country: "China" },
  { iata_code: "PHL", airport_name: "Philadelphia", city: "Philadelphia", country: "United States" },
  { iata_code: "PHX", airport_name: "Sky Harbor", city: "Phoenix", country: "United States" },
  { iata_code: "PMI", airport_name: "Palma de Mallorca", city: "Palma de Mallorca", country: "Spain" },
  { iata_code: "PRG", airport_name: "Václav Havel", city: "Prague", country: "Czech Republic" },
  { iata_code: "PTY", airport_name: "Tocumen", city: "Panama City", country: "Panama" },
  { iata_code: "RDU", airport_name: "Raleigh-Durham", city: "Raleigh", country: "United States" },
  { iata_code: "SAN", airport_name: "San Diego International", city: "San Diego", country: "United States" },
  { iata_code: "SAT", airport_name: "San Antonio International", city: "San Antonio", country: "United States" },
  { iata_code: "SEA", airport_name: "Seattle-Tacoma", city: "Seattle", country: "United States" },
  { iata_code: "SFO", airport_name: "San Francisco International", city: "San Francisco", country: "United States" },
  { iata_code: "SIN", airport_name: "Changi", city: "Singapore", country: "Singapore" },
  { iata_code: "SJC", airport_name: "San Jose International", city: "San Francisco", country: "United States" },
  { iata_code: "SLC", airport_name: "Salt Lake City International", city: "Salt Lake City", country: "United States" },
  { iata_code: "SNA", airport_name: "John Wayne", city: "Los Angeles", country: "United States" },
  { iata_code: "STL", airport_name: "St. Louis Lambert", city: "St. Louis", country: "United States" },
  { iata_code: "SYD", airport_name: "Kingsford Smith", city: "Sydney", country: "Australia" },
  { iata_code: "TPA", airport_name: "Tampa International", city: "Tampa", country: "United States" },
  { iata_code: "YUL", airport_name: "Montréal-Trudeau", city: "Montreal", country: "Canada" },
  { iata_code: "VIE", airport_name: "Vienna International", city: "Vienna", country: "Austria" },
  { iata_code: "YVR", airport_name: "Vancouver", city: "Vancouver", country: "Canada" },
  { iata_code: "YYZ", airport_name: "Pearson", city: "Toronto", country: "Canada" },
  { iata_code: "ZRH", airport_name: "Zurich", city: "Zurich", country: "Switzerland" },
];

interface CitySuggestionShape {
  name: string;
  city_id: string;
  country: string;
  airport_code?: string;
  transport_modes?: string[];
}

interface AirportSuggestionShape {
  airport_id: string;
  iata_code: string;
  airport_name: string;
  city: string;
  country: string;
  uniqueKey: string;
  region?: string;
  display_name: string;
}

function rank(q: string, text: string, preferIata?: string): number {
  const t = text.toLowerCase();
  const ql = q.toLowerCase();
  if (preferIata && preferIata.toLowerCase() === ql) return 0;
  if (t.startsWith(ql)) return 1;
  if (t.includes(ql)) return 2;
  return 3;
}

export function filterFallbackCities(query: string, limit: number): CitySuggestionShape[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return POPULAR_CITIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.airportCode && c.airportCode.toLowerCase().includes(q)) ||
      c.country.toLowerCase().includes(q)
  )
    .sort((a, b) => {
      const ra = rank(q, a.name, a.airportCode);
      const rb = rank(q, b.name, b.airportCode);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((c) => ({
      name: c.name,
      city_id: c.airportCode || c.name,
      country: c.country,
      airport_code: c.airportCode,
      transport_modes: ["flight"] as string[],
    }));
}

export function filterFallbackAirports(query: string, limit: number): AirportSuggestionShape[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return POPULAR_AIRPORTS.filter(
    (a) =>
      a.iata_code.toLowerCase().includes(q) ||
      a.airport_name.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q) ||
      a.country.toLowerCase().includes(q)
  )
    .sort((a, b) => {
      const ra = rank(q, a.iata_code);
      const rb = rank(q, b.iata_code);
      if (ra !== rb) return ra - rb;
      const ra2 = rank(q, a.city);
      const rb2 = rank(q, b.city);
      if (ra2 !== rb2) return ra2 - rb2;
      return a.iata_code.localeCompare(b.iata_code);
    })
    .slice(0, limit)
    .map((a) => ({
      airport_id: a.iata_code,
      iata_code: a.iata_code,
      airport_name: a.airport_name,
      city: a.city,
      country: a.country,
      region: "",
      display_name: `${a.iata_code} – ${a.airport_name}`,
      uniqueKey: `${a.iata_code}-${a.city}`.toLowerCase(),
    }));
}
