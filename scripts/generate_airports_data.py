#!/usr/bin/env python3
"""
Generate TypeScript airport data from OurAirports CSV.
Filters to commercial airports only and creates a compact format.
"""

import csv
import json
from pathlib import Path

# Metro city mappings (airline-style)
METRO_MAPPINGS = {
    "NYC": ["JFK", "LGA", "EWR"],  # New York
    "LON": ["LHR", "LGW", "STN", "LTN"],  # London
    "PAR": ["CDG", "ORY"],  # Paris
    "WAS": ["DCA", "IAD", "BWI"],  # Washington DC
    "CHI": ["ORD", "MDW"],  # Chicago
    "LAX": ["LAX", "BUR", "SNA", "ONT"],  # Los Angeles
    "SFO": ["SFO", "OAK", "SJC"],  # San Francisco Bay Area
    "MIA": ["MIA", "FLL", "PBI"],  # Miami
    "TYO": ["NRT", "HND"],  # Tokyo
    "ROM": ["FCO", "CIA"],  # Rome
    "MIL": ["MXP", "LIN"],  # Milan
    "BER": ["BER", "SXF"],  # Berlin
    "MAD": ["MAD", "TOJ"],  # Madrid
    "BCN": ["BCN"],  # Barcelona
    "AMS": ["AMS"],  # Amsterdam
    "DUB": ["DUB"],  # Dublin
    "ZUR": ["ZRH"],  # Zurich
    "VIE": ["VIE"],  # Vienna
    "CPH": ["CPH"],  # Copenhagen
    "STO": ["ARN", "NYO"],  # Stockholm
    "OSL": ["OSL"],  # Oslo
    "HEL": ["HEL"],  # Helsinki
    "IST": ["IST", "SAW"],  # Istanbul
    "DXB": ["DXB"],  # Dubai
    "SIN": ["SIN"],  # Singapore
    "BKK": ["BKK"],  # Bangkok
    "HKG": ["HKG"],  # Hong Kong
    "ICN": ["ICN", "GMP"],  # Seoul
    "PEK": ["PEK", "PKX"],  # Beijing
    "PVG": ["PVG", "SHA"],  # Shanghai
    "SYD": ["SYD"],  # Sydney
    "MEL": ["MEL"],  # Melbourne
    "YTO": ["YYZ", "YTZ"],  # Toronto
    "YVR": ["YVR"],  # Vancouver
    "MEX": ["MEX"],  # Mexico City
    "GRU": ["GRU", "CGH"],  # São Paulo
    "GIG": ["GIG", "SDU"],  # Rio de Janeiro
}

# Popularity scores (higher = more popular, used for ranking)
POPULARITY_SCORES = {
    # Major hubs
    "JFK": 100, "LHR": 100, "CDG": 100, "DXB": 100, "SIN": 100,
    "LAX": 95, "ORD": 95, "DFW": 95, "ATL": 95, "DEN": 95,
    "SFO": 90, "SEA": 90, "MIA": 90, "BOS": 90, "IAD": 90,
    "NRT": 90, "HND": 90, "ICN": 90, "HKG": 90, "PVG": 90,
    "AMS": 85, "FRA": 85, "MUC": 85, "ZRH": 85, "VIE": 85,
    "BCN": 80, "MAD": 80, "LGW": 80, "ORY": 80, "FCO": 80,
    # Regional
    "YVR": 75, "YYZ": 75, "SYD": 75, "MEL": 75, "AKL": 75,
    "BKK": 70, "SGN": 70, "KUL": 70, "CGK": 70, "MNL": 70,
}

def normalize_string(s: str) -> str:
    """Normalize string for matching."""
    if not s:
        return ""
    return s.strip().upper()

def is_commercial_airport(row: dict) -> bool:
    """Check if airport is commercial."""
    iata = normalize_string(row.get("iata_code", ""))
    if len(iata) != 3:
        return False
    
    scheduled = normalize_string(row.get("scheduled_service", "")) == "YES"
    airport_type = normalize_string(row.get("type", ""))
    
    # Only include commercial airports
    allowed_types = {"LARGE_AIRPORT", "MEDIUM_AIRPORT", "SMALL_AIRPORT"}
    return scheduled and airport_type in allowed_types

def extract_state(iso_region: str) -> str:
    """Extract state/province from ISO region code."""
    if not iso_region or "-" not in iso_region:
        return ""
    parts = iso_region.split("-", 1)
    if len(parts) == 2:
        return parts[1]  # e.g., "US-CA" -> "CA"
    return ""

def get_continent_name(continent_code: str) -> str:
    """Convert continent code to name."""
    mapping = {
        "NA": "North America",
        "SA": "South America",
        "EU": "Europe",
        "AS": "Asia",
        "AF": "Africa",
        "OC": "Oceania",
        "AN": "Antarctica",
    }
    return mapping.get(continent_code, continent_code)

def load_countries(csv_path: Path) -> dict:
    """Load country code to name mapping."""
    countries = {}
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                code = row.get("code", "").strip().upper()
                name = row.get("name", "").strip()
                if code and name:
                    countries[code] = name
    except Exception as e:
        print(f"Warning: Could not load countries.csv: {e}")
    return countries

def process_airports_csv(csv_path: Path, countries_path: Path, output_path: Path):
    """Process airports CSV and generate TypeScript data file."""
    airports = []
    seen_iata = set()
    
    # Load country names
    countries = load_countries(countries_path)
    print(f"Loaded {len(countries)} country names")
    
    print(f"Reading {csv_path}...")
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not is_commercial_airport(row):
                continue
            
            iata = normalize_string(row.get("iata_code", ""))
            if not iata or iata in seen_iata:
                continue
            seen_iata.add(iata)
            
            municipality = row.get("municipality", "").strip()
            country_code = row.get("iso_country", "").strip()
            iso_region = row.get("iso_region", "").strip()
            name = row.get("name", "").strip()
            lat = row.get("latitude_deg", "")
            lon = row.get("longitude_deg", "")
            continent = get_continent_name(row.get("continent", "").strip())
            
            # Get country name from countries.csv if available
            country_name = countries.get(country_code, country_code)
            
            state = extract_state(iso_region)
            
            airport_data = {
                "iata": iata,
                "city": municipality or name.split()[0] if name else "",
                "country": country_name,
                "airport": name,
                "state": state if state else None,
                "lat": float(lat) if lat else None,
                "lon": float(lon) if lon else None,
                "continent": continent,
                "popularity": POPULARITY_SCORES.get(iata, 0),
            }
            
            airports.append(airport_data)
    
    # Sort by popularity (descending), then by IATA code
    airports.sort(key=lambda x: (-x["popularity"], x["iata"]))
    
    print(f"Found {len(airports)} commercial airports")
    print(f"Writing to {output_path}...")
    
    # Generate TypeScript file
    ts_content = f"""// Auto-generated from OurAirports CSV
// Run: python scripts/generate_airports_data.py

export type Airport = {{
  iata: string;
  city: string;
  country: string;
  airport: string;
  state?: string;
  lat?: number;
  lon?: number;
  continent?: string;
  popularity: number;
}};

export const AIRPORTS: Airport[] = {json.dumps(airports, indent=2, ensure_ascii=False)};

// Metro city mappings (airline-style)
export const METRO_MAPPINGS: Record<string, string[]> = {json.dumps(METRO_MAPPINGS, indent=2)};
"""
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(ts_content)
    
    print(f"✅ Generated {output_path} with {len(airports)} airports")
    
    # Also generate JSON for backend use
    json_path = output_path.with_suffix(".json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"airports": airports, "metro_mappings": METRO_MAPPINGS}, f, indent=2, ensure_ascii=False)
    print(f"✅ Generated {json_path}")

if __name__ == "__main__":
    project_root = Path(__file__).parent.parent
    csv_path = project_root / "backend" / "files" / "airports.csv"
    countries_path = project_root / "backend" / "files" / "countries.csv"
    output_path = project_root / "frontend" / "src" / "data" / "airports.ts"
    
    # Create data directory if it doesn't exist
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    if not csv_path.exists():
        print(f"❌ Error: {csv_path} not found")
        exit(1)
    
    if not countries_path.exists():
        print(f"⚠️  Warning: {countries_path} not found, using country codes")
    
    process_airports_csv(csv_path, countries_path, output_path)
    print("✅ Done!")
