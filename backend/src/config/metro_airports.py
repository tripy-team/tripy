"""
Single source of truth for metro airport groups.

All derivative lookups (AIRPORT_TO_METRO_KEY, NAME_TO_METRO_KEY, etc.)
are generated from the METROS dict. To add a new metro area, add ONE
entry to METROS — everything else auto-updates.
"""

METROS: dict[str, dict] = {
    # US Cities
    "SEA": {"names": ["seattle"], "airports": ["SEA"]},
    "NYC": {"names": ["new york", "nyc"], "airports": ["JFK", "EWR", "LGA"]},
    "LAX": {"names": ["los angeles", "la"], "airports": ["LAX", "BUR", "SNA", "ONT"]},
    "BAY": {"names": ["san francisco", "sf", "bay area"], "airports": ["SFO", "OAK", "SJC"]},
    "CHI": {"names": ["chicago"], "airports": ["ORD", "MDW"]},
    "WAS": {"names": ["washington", "washington dc", "dc"], "airports": ["IAD", "DCA", "BWI"]},
    "MIA": {"names": ["miami"], "airports": ["MIA", "FLL"]},
    "DFW": {"names": ["dallas"], "airports": ["DFW", "DAL"]},
    "IAH": {"names": ["houston"], "airports": ["IAH", "HOU"]},
    "BOS": {"names": ["boston"], "airports": ["BOS"]},
    # European Cities
    "LON": {"names": ["london"], "airports": ["LHR", "LGW", "STN", "LTN"]},
    "PAR": {"names": ["paris"], "airports": ["CDG", "ORY"]},
    "MIL": {"names": ["milan"], "airports": ["MXP", "LIN", "BGY"]},
    "ROM": {"names": ["rome"], "airports": ["FCO", "CIA"]},
    "FRA": {"names": ["frankfurt"], "airports": ["FRA", "HHN"]},
    "AMS": {"names": ["amsterdam"], "airports": ["AMS"]},
    # Asian Cities
    "TYO": {"names": ["tokyo"], "airports": ["NRT", "HND"]},
    "SEL": {"names": ["seoul"], "airports": ["ICN", "GMP"]},
    "SHA": {"names": ["shanghai"], "airports": ["PVG", "SHA"]},
    "BJS": {"names": ["beijing"], "airports": ["PEK", "PKX"]},
    "HKG": {"names": ["hong kong"], "airports": ["HKG"]},
    "SIN": {"names": ["singapore"], "airports": ["SIN"]},
    # Middle East
    "DXB": {"names": ["dubai"], "airports": ["DXB", "DWC"]},
}

# --- Generated lookups (never manually curate these) ---

# Backward-compat: city name → airport list (matches old METRO_AIRPORTS shape)
METRO_AIRPORTS: dict[str, list[str]] = {}
for _key, _meta in METROS.items():
    for _name in _meta["names"]:
        METRO_AIRPORTS[_name] = _meta["airports"]

# airport code → metro key (e.g. "EWR" → "NYC")
AIRPORT_TO_METRO_KEY: dict[str, str] = {}
for _key, _meta in METROS.items():
    for _code in _meta["airports"]:
        AIRPORT_TO_METRO_KEY[_code] = _key

# airport code → all airports in same metro (backward compat)
AIRPORT_TO_METRO: dict[str, list[str]] = {}
for _key, _meta in METROS.items():
    for _code in _meta["airports"]:
        AIRPORT_TO_METRO[_code] = _meta["airports"]

# city name/alias → metro key (e.g. "new york" → "NYC")
NAME_TO_METRO_KEY: dict[str, str] = {}
for _key, _meta in METROS.items():
    for _name in _meta["names"]:
        NAME_TO_METRO_KEY[_name] = _key


def expand_to_metro(airport_or_city: str) -> list[str]:
    """
    Expand an airport code or city name to all airports in its metro area.

    Returns empty list if the input is not recognized.
    """
    code_upper = airport_or_city.strip().upper()
    if code_upper in AIRPORT_TO_METRO:
        return list(AIRPORT_TO_METRO[code_upper])

    city_lower = airport_or_city.strip().lower()
    if city_lower in NAME_TO_METRO_KEY:
        return list(METROS[NAME_TO_METRO_KEY[city_lower]]["airports"])

    for city_name in NAME_TO_METRO_KEY:
        if city_lower in city_name or city_name in city_lower:
            return list(METROS[NAME_TO_METRO_KEY[city_name]]["airports"])

    return []


def normalize_to_metro_key(location: str) -> str | None:
    """
    Map any location string to its metro key, or None if unknown.

    Examples:
      normalize_to_metro_key("JFK")             → "NYC"
      normalize_to_metro_key("EWR")             → "NYC"
      normalize_to_metro_key("tokyo")           → "TYO"
      normalize_to_metro_key("Paris (CDG,ORY)") → "PAR"
      normalize_to_metro_key("unknown")         → None
    """
    code_upper = location.strip().upper()
    if code_upper in AIRPORT_TO_METRO_KEY:
        return AIRPORT_TO_METRO_KEY[code_upper]

    city_lower = location.strip().lower()
    if city_lower in NAME_TO_METRO_KEY:
        return NAME_TO_METRO_KEY[city_lower]

    # Parenthesized: "Tokyo (HND)" or "Paris (CDG,ORY)"
    if "(" in location and ")" in location:
        city_part = location[:location.index("(")].strip().lower()
        if city_part in NAME_TO_METRO_KEY:
            return NAME_TO_METRO_KEY[city_part]
        codes_part = location[location.index("(") + 1:location.index(")")]
        first_code = codes_part.split(",")[0].strip().upper()
        if first_code in AIRPORT_TO_METRO_KEY:
            return AIRPORT_TO_METRO_KEY[first_code]

    # Partial match on city names
    for city_name in NAME_TO_METRO_KEY:
        if city_lower in city_name or city_name in city_lower:
            return NAME_TO_METRO_KEY[city_name]

    return None
