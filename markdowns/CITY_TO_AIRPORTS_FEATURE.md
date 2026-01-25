# City-to-Airports Search Feature

## Overview
Users can now enter a **city name** or **city nickname** in any airport field (departure, arrival, destination), and the system will automatically return **all commercial airports** in that city or metropolitan area.

## Examples

### City Names
- **"New York"** → Returns: JFK (John F. Kennedy), LGA (LaGuardia), EWR (Newark Liberty)
- **"London"** → Returns: LHR (Heathrow), LGW (Gatwick), STN (Stansted), LTN (Luton), LCY (London City)
- **"Paris"** → Returns: CDG (Charles de Gaulle), ORY (Orly)
- **"Los Angeles"** → Returns: LAX, BUR (Burbank), SNA (John Wayne), LGB (Long Beach), ONT (Ontario)
- **"San Francisco"** → Returns: SFO, OAK (Oakland), SJC (San Jose)

### City Nicknames & Abbreviations
- **"NYC"** → All New York airports (JFK, LGA, EWR)
- **"LA"** → All Los Angeles airports
- **"SF"** → All San Francisco Bay Area airports
- **"DC"** → All Washington D.C. airports (DCA, IAD, BWI)
- **"CHI"** → Chicago airports (ORD, MDW)

### Airport Codes (Still Supported)
- **"JFK"** → John F. Kennedy International Airport + other NYC airports
- **"CDG"** → Charles de Gaulle + other Paris airports
- **"LHR"** → Heathrow + other London airports

## Implementation Details

### Backend (Python/FastAPI)

#### 1. Airport Service (`backend/src/services/airport_service.py`)
The `search_airports()` function implements a multi-step intelligent search:

```python
def search_airports(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search airports based on query - handles both city names and IATA codes.
    For city queries (e.g., "nyc", "New York"), returns all airports for that city.
    For IATA codes (e.g., "JFK", "CDG"), returns that specific airport.
    """
```

**Search Strategy:**
1. **Exact IATA Code Match** - If query is a 3-letter valid IATA code, return that airport first
2. **City Nickname Expansion** - Check if query matches known nicknames (NYC, LA, SF, etc.)
3. **City-Based Search** - Use OpenAI to find all commercial airports for the city
4. **Fallback** - General airport search if city search fails

**Supported City Nicknames:**
```python
city_nicknames = {
    "NYC": "New York",
    "LA": "Los Angeles",
    "SF": "San Francisco",
    "DC": "Washington",
    "CHI": "Chicago",
    "PHX": "Phoenix",
    "PHI": "Philadelphia",
    "BOS": "Boston",
    "DFW": "Dallas",
    "SEA": "Seattle",
    "MIA": "Miami",
    "ATL": "Atlanta",
    # ... and more
}
```

#### 2. OpenAI Integration (`backend/src/handlers/openAI.py`)
The `find_commercial_airports_for_city()` function uses GPT-4o-mini to:
- Understand natural language city queries
- Return all major commercial airports for the city
- Handle typos and variations (e.g., "Parris" → Paris)
- Include city nicknames (e.g., "NYC" → New York)

**Key Features:**
- Uses OpenAI's structured JSON output for reliable parsing
- Filters results to **commercial airports only** (excludes private airports, heliports)
- Returns detailed airport information: IATA code, name, city, country, region

#### 3. API Endpoint (`backend/src/app.py`)
```
GET /api/airports/autocomplete?q={query}&limit={limit}
```

**Response Format:**
```json
{
  "airports": [
    {
      "airport_id": "JFK,New York,United States",
      "iata_code": "JFK",
      "airport_name": "John F. Kennedy International Airport",
      "city": "New York",
      "state": "NY",
      "country": "United States",
      "region": "North America",
      "display_name": "JFK - John F. Kennedy International Airport (New York)"
    },
    {
      "iata_code": "LGA",
      "airport_name": "LaGuardia Airport",
      "city": "New York",
      // ...
    },
    {
      "iata_code": "EWR",
      "airport_name": "Newark Liberty International Airport",
      "city": "Newark",
      // ...
    }
  ]
}
```

### Frontend (Next.js/React)

#### 1. AirportAutocomplete Component (`frontend/src/components/ui/AirportAutocomplete.tsx`)

**Key Features:**
- **City Grouping** - Groups airports by city when multiple airports are found
- **"Select All" Option** - Shows option to select all airports for a city
- **Individual Airport Selection** - Users can also select individual airports
- **Intelligent Placeholder** - Shows: "City or airport (e.g., NYC, London, JFK)"

**UI Behavior:**
1. User types "NYC" or "New York"
2. Dropdown shows:
   ```
   ┌─────────────────────────────────────────────────┐
   │  3  New York, United States                     │
   │     Select all 3 airports (JFK, LGA, EWR)       │
   │                                                  │
   │     JFK  New York, NY • United States           │
   │          John F. Kennedy International Airport  │
   │                                                  │
   │     LGA  New York, NY • United States           │
   │          LaGuardia Airport                      │
   │                                                  │
   │     EWR  Newark, NJ • United States             │
   │          Newark Liberty International Airport   │
   └─────────────────────────────────────────────────┘
   ```

3. User can:
   - Click the city header to select all airports (stores as "New York (JFK,LGA,EWR)")
   - Click an individual airport to select just that one

#### 2. API Route Handler (`frontend/src/app/api/airports/autocomplete/route.ts`)
- Proxies requests from frontend to backend FastAPI server
- Handles errors gracefully
- Provides debugging information in development mode

## Usage Examples

### Solo Trip Setup
```typescript
<AirportAutocomplete
  value={startDestination}
  onValueChange={setStartDestination}
  placeholder="City or airport (e.g., NYC, London, JFK)"
  onSelect={(value) => {
    // value could be:
    // - "JFK" (single airport)
    // - "New York (JFK,LGA,EWR)" (all airports)
  }}
/>
```

### Flight Search
When searching for flights:
- If user enters "NYC", the backend will search flights from **all three NYC airports** (JFK, LGA, EWR)
- This increases the chances of finding better award availability and pricing
- Users can still narrow down to a specific airport if they prefer

## Benefits

### For Users
1. **Easier Input** - Type "NYC" instead of remembering "JFK" or "LGA"
2. **More Options** - See all airports in a city, not just the main one
3. **Better Availability** - Search across multiple airports increases award seat availability
4. **Flexible** - Can still select individual airports if needed

### For the System
1. **Intelligent Matching** - OpenAI understands variations, typos, and nicknames
2. **Commercial Airports Only** - Filters out private airports and heliports automatically
3. **Comprehensive Coverage** - Returns all major airports, including secondary ones
4. **Fallback Strategy** - Multiple layers of search ensure results are always returned

## Technical Architecture

```
User Input ("NYC")
    ↓
Frontend: AirportAutocomplete.tsx
    ↓
Next.js API Route: /api/airports/autocomplete
    ↓
FastAPI Backend: /api/airports/autocomplete
    ↓
airport_service.search_airports()
    ├─→ Step 1: Check if IATA code → Direct match
    ├─→ Step 2: Check city nickname → Expand
    ├─→ Step 3: OpenAI city search → find_commercial_airports_for_city()
    │                                  ↓
    │                            GPT-4o-mini API
    │                            (structured JSON output)
    │                                  ↓
    │                            Filter commercial airports
    │                                  ↓
    │                            Return: JFK, LGA, EWR
    └─→ Step 4: Fallback CSV search
    ↓
Return to Frontend
    ↓
Display grouped airports with "Select All" option
    ↓
User selects city or individual airport
```

## Testing

### Manual Testing
1. Navigate to Solo Trip Setup page
2. In "Start Airport" field, enter:
   - "NYC" → Should show JFK, LGA, EWR grouped
   - "London" → Should show LHR, LGW, STN, LTN, LCY
   - "Paris" → Should show CDG, ORY
   - "JFK" → Should show JFK first, then other NYC airports

### API Testing
```bash
# Test the backend API directly
curl "http://localhost:8000/api/airports/autocomplete?q=NYC&limit=10"

# Expected response:
{
  "airports": [
    {"iata_code": "JFK", "city": "New York", ...},
    {"iata_code": "LGA", "city": "New York", ...},
    {"iata_code": "EWR", "city": "Newark", ...}
  ]
}
```

## Configuration

### Environment Variables
- `OPENAI_ADMIN_KEY` - Required for OpenAI-powered city search
- `NEXT_PUBLIC_BACKEND_URL` - Frontend needs this to connect to backend (default: http://localhost:8000)

### Adjustable Parameters
- `max_results` - Number of airports to return (default: 10)
- `city_nicknames` - Dictionary in `airport_service.py` (can add more nicknames)
- OpenAI model - Currently using `gpt-4o-mini` (can upgrade to gpt-4 if needed)

## Known Limitations

1. **OpenAI Dependency** - Requires OpenAI API key; falls back to CSV search if unavailable
2. **Commercial Airports Only** - Excludes private airports, military bases, heliports
3. **Rate Limiting** - OpenAI API has rate limits (consider caching for production)
4. **Cost** - Each search query costs ~$0.001 (using gpt-4o-mini)

## Future Enhancements

1. **Caching** - Cache OpenAI responses for common city queries (NYC, LA, London, etc.)
2. **Offline Mode** - Pre-populate common city-to-airports mappings in static JSON
3. **User Preferences** - Remember user's preferred airports for each city
4. **Distance-based Sorting** - Sort airports by distance from city center
5. **Real-time Availability** - Show which airports have better award availability

## Migration Notes

- **Backward Compatible** - Existing IATA code inputs still work
- **No Database Changes** - Uses existing airports.csv data + OpenAI
- **Gradual Rollout** - Can test with specific user groups first

## Support

For issues or questions:
1. Check backend logs: `backend/logs/app.log`
2. Check frontend console: Browser DevTools
3. Verify OpenAI API key is set correctly
4. Test backend endpoint directly with curl/Postman
