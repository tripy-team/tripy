# AwardTool API Documentation & Transfer Instructions Implementation

## Overview

This document details the AwardTool Real-time Search Engine API, its integration with the Tripy backend, and implementation strategies for generating specific transfer instructions for users.

---

## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Request/Response Formats](#requestresponse-formats)
3. [Current Tripy Integration](#current-tripy-integration)
4. [Transfer Instructions Implementation](#transfer-instructions-implementation)
5. [Recommended Enhancements](#recommended-enhancements)
6. [Code Examples](#code-examples)

---

## API Endpoints

### 1. Real-time Search API - Crawler Trigger

**Endpoint**: `https://apis.awardtool.com/flight_trigger/search_real_time`

**Purpose**: Initiates a real-time search for award ticket availability across multiple airline programs.

**Method**: POST

**Constraints**:
- Maximum 5 programs per query (recommended)
- Date range cannot exceed 2 days per query
- One day's worth of data per task for all programs

### 2. Real-time Search API - Data Retrieval

**Endpoint**: `https://apis.awardtool.com/flight_retrieval/search_result`

**Purpose**: Retrieves search results for a previously triggered task (polling API).

**Method**: POST

### 3. Legacy Direct Search (Currently Used by Tripy)

**Endpoint**: `https://www.awardtool-api.com/search_real_time`

**Purpose**: Direct synchronous search (waits for results).

**Method**: POST

### 4. Panorama Calendar API

**Endpoint**: `https://www.awardtool-api.com/panorama/panorama_calendar_data`

**Purpose**: Quick availability calendar scan (30-90 days) to identify dates with award availability.

**Method**: POST

### 5. Program Accuracy Stats

**Endpoint**: `https://www.awardtool-api.com/program_stats_api`

**Purpose**: Get accuracy statistics for specific airline programs.

**Method**: POST

---

## Request/Response Formats

### Real-time Search Request

```json
{
  "date": "2026-02-06",
  "origin": "JFK",
  "destination": "LHR",
  "pax": 1,
  "programs": ["UA", "AA", "DL", "BA", "AF"],
  "cabins": ["Economy", "Premium Economy", "Business", "First"],
  "task_id": "db8032021-ffd0-4301c-80f6-123c93097031de2d",
  "exit_early": true,
  "api_key": "YOUR_API_KEY"
}
```

#### Request Fields

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `pax` | integer | Number of passengers | Required |
| `programs` | array | Airline program codes | Max 5 recommended |
| `cabins` | array | Cabin types to search | `Economy`, `Premium Economy`, `Business`, `First` |
| `origin` | string | Departure airport (IATA code) | 3-letter code |
| `destination` | string | Arrival airport (IATA code) | 3-letter code |
| `date` | string | Travel date | `YYYY-MM-DD` or `YYYY-M-D` format |
| `task_id` | string | User-assigned task ID (optional) | UUID format recommended |
| `exit_early` | boolean | Return immediately, use polling API | `true` for async |
| `api_key` | string | API authentication key | Required |

### Real-time Search Response

```json
{
  "data": [
    {
      "airline_code": "B6",
      "airline_name": "JetBlue",
      "award_points": 14000,
      "surcharge": 5.6,
      "cabin_type": "Economy",
      "date": "2026-03-08",
      "seats": 1,
      "program_code": "B6",
      
      "transfer_options": [
        { "points": 14000, "program": "chase" },
        { "points": 17500, "program": "amex" },
        { "points": 14000, "program": "citi" }
      ],
      
      "fare": {
        "day_count": 0,
        "travel_minutes_total": 170,
        "travel_time_display": "2h 50m",
        "products": [
          {
            "flight_number": "B61702",
            "origin": "FLL",
            "destination": "JFK",
            "departure_time": "2026-03-08T06:00:00",
            "arrival_time": "2026-03-08T08:50:00",
            "travel_minutes": 170,
            "operating_carrier": "B6",
            "aircraft": "Airbus A320",
            "cabin_type": "Economy",
            "layover_time": 0
          }
        ]
      },
      
      "cabin_prices": {
        "Economy": {
          "miles": 14000,
          "tax": 5.6,
          "seats": 1,
          "transfer_options": [
            { "points": 14000, "program": "chase" },
            { "points": 17500, "program": "amex" },
            { "points": 14000, "program": "citi" }
          ]
        }
      },
      
      "url": "https://www.jetblue.com/booking/flights?from=FLL&to=JFK&depart=2026-03-08&usePoints=true"
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Flight date |
| `award_points` | integer | Points needed for one-way, one adult |
| `surcharge` | float | Taxes/fees in USD |
| `cabin_type` | string | Cabin class |
| `airline_name` | string | Airline name(s), joined by `&` for multi-carrier |
| `seats` | integer | Seats available (-1 if unknown) |
| `fare.products` | array | Individual flight segment information |
| `transfer_options` | array | **Bank transfer options with required points** |
| `url` | string | Direct booking URL |

### Data Retrieval Request (Polling)

```json
{
  "task_id": "9a63f64b-1a3f-4d32-906d-c68aaf77c429",
  "api_key": "YOUR_API_KEY"
}
```

### Data Retrieval Response

| Field | Type | Description |
|-------|------|-------------|
| `result` | array | Flight data results |
| `program_done` | string | Completed program format: `program_id\|departure\|arrival\|pax\|date` |
| `finish` | boolean | `false` = more data available, `true` = task complete |
| `time_elapsed` | float | Time elapsed for this task |

---

## Current Tripy Integration

### File Locations

| File | Purpose |
|------|---------|
| `backend/src/handlers/flights.py` | AwardTool API client, merges with SerpAPI |
| `backend/src/handlers/award_calendar.py` | Panorama calendar integration |
| `backend/src/handlers/transfer_strategy.py` | Transfer graph and instruction builder |
| `backend/src/utils/award_programs.py` | Bank→Airline transfer mappings |
| `backend/src/services/itinerary_service.py` | Orchestration, transfer tips generation |
| `backend/src/handlers/ilp_adapter.py` | ILP optimization input builder |
| `backend/src/handlers/points_maximizer.py` | ILP solver for optimal payment modes |

### Current Flow

```
1. User creates trip with destinations, dates, points balances
                    ↓
2. generate_optimized_itinerary() called
                    ↓
3. For each O-D pair:
   a. Panorama Calendar → identify best dates
   b. AwardTool Real-time → get exact points + surcharges
   c. SerpAPI Google Flights → get cash prices
   d. Merge: award edges get priority
                    ↓
4. ILP Optimization (points_maximizer.py)
   - Minimizes out-of-pocket (cash + surcharges)
   - Determines optimal payment: cash vs points
   - Selects best bank→airline transfers
                    ↓
5. Build transfer_tips from solution.pay_mode
                    ↓
6. Return optimized itinerary with transfer instructions
```

### Current AwardTool Call (flights.py)

```python
async def _awardtool_realtime(origin, destination, date_str, cabins, pax, programs, client):
    payload = {
        "origin": origin,
        "destination": destination,
        "programs": [p.upper() for p in programs],
        "cabins": cabins,
        "date": date_str,
        "pax": str(pax),
        "api_key": AWARD_TOOL_API_KEY,
    }
    r = await client.post(
        "https://www.awardtool-api.com/search_real_time",
        json=payload,
        timeout=TIMEOUT
    )
    return r.json()
```

---

## Transfer Instructions Implementation

### The Critical Field: `transfer_options`

The `transfer_options` array in AwardTool responses is the key to generating specific transfer instructions:

```json
"transfer_options": [
  { "points": 14000, "program": "chase" },
  { "points": 17500, "program": "amex" },
  { "points": 14000, "program": "citi" }
]
```

This tells us:
- **Chase Ultimate Rewards**: Transfer 14,000 points (1:1 ratio)
- **Amex Membership Rewards**: Transfer 17,500 points (1.25:1 ratio - less favorable)
- **Citi ThankYou Points**: Transfer 14,000 points (1:1 ratio)

### Transfer Instruction Generation

#### Step 1: Match User's Points to Best Transfer Option

```python
def find_best_transfer_option(transfer_options, user_points):
    """
    Given AwardTool's transfer_options and user's point balances,
    find the best transfer strategy.
    
    Args:
        transfer_options: List of {"points": int, "program": str}
        user_points: Dict of {program: balance}
    
    Returns:
        Best option with sufficient balance, prioritizing fewest points
    """
    # Sort by points needed (ascending)
    sorted_options = sorted(transfer_options, key=lambda x: x["points"])
    
    for opt in sorted_options:
        bank = opt["program"].lower()
        points_needed = opt["points"]
        
        if user_points.get(bank, 0) >= points_needed:
            return {
                "bank": bank,
                "points_to_transfer": points_needed,
                "has_sufficient_balance": True,
                "user_balance": user_points.get(bank, 0),
            }
    
    # No sufficient balance - return option with most points available
    best_partial = None
    max_available = 0
    for opt in sorted_options:
        bank = opt["program"].lower()
        available = user_points.get(bank, 0)
        if available > max_available:
            max_available = available
            best_partial = {
                "bank": bank,
                "points_to_transfer": opt["points"],
                "has_sufficient_balance": False,
                "user_balance": available,
                "shortfall": opt["points"] - available,
            }
    
    return best_partial
```

#### Step 2: Build Detailed Instructions

```python
BANK_METADATA = {
    "chase": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "transfer_time": "instant",
        "min_transfer": 1000,
    },
    "amex": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "transfer_time": "1-2 business days",
        "min_transfer": 1000,
    },
    "citi": {
        "name": "Citi ThankYou Points",
        "portal_url": "https://thankyou.citi.com",
        "transfer_time": "instant to 24 hours",
        "min_transfer": 1000,
    },
    "capitalone": {
        "name": "Capital One Miles",
        "portal_url": "https://www.capitalone.com/credit-cards/benefits/travel/",
        "transfer_time": "instant to 2 days",
        "min_transfer": 100,
    },
    "bilt": {
        "name": "Bilt Rewards",
        "portal_url": "https://www.biltrewards.com",
        "transfer_time": "instant",
        "min_transfer": 1000,
        "special_note": "Transfers only on the 1st of each month for best value",
    },
}

AIRLINE_METADATA = {
    "UA": {"name": "United MileagePlus", "booking_url": "https://www.united.com"},
    "AA": {"name": "American AAdvantage", "booking_url": "https://www.aa.com"},
    "DL": {"name": "Delta SkyMiles", "booking_url": "https://www.delta.com"},
    "B6": {"name": "JetBlue TrueBlue", "booking_url": "https://www.jetblue.com"},
    "BA": {"name": "British Airways Avios", "booking_url": "https://www.britishairways.com"},
    "AF": {"name": "Air France Flying Blue", "booking_url": "https://www.airfrance.com"},
    # ... more airlines
}

def build_transfer_instruction(
    bank: str,
    airline: str,
    points_to_transfer: int,
    surcharge: float,
    route: str,
    booking_url: str = None,
    operating_carrier: str = None,
) -> dict:
    """
    Build detailed transfer instruction with step-by-step guide.
    """
    bank_info = BANK_METADATA.get(bank, {})
    airline_info = AIRLINE_METADATA.get(airline, {})
    
    bank_name = bank_info.get("name", bank.upper())
    airline_name = airline_info.get("name", airline)
    portal_url = bank_info.get("portal_url", "")
    booking_portal = booking_url or airline_info.get("booking_url", "")
    transfer_time = bank_info.get("transfer_time", "varies")
    
    # Build step-by-step instructions
    steps = [
        f"1. Log in to your {bank_name} account",
        f"2. Navigate to the rewards portal: {portal_url}",
        f"3. Select 'Transfer Points' or 'Transfer to Travel Partners'",
        f"4. Find and select '{airline_name}' from the airline partners list",
        f"5. Enter your {airline_name} frequent flyer number (create a free account if needed)",
        f"6. Enter transfer amount: {points_to_transfer:,} points",
        f"7. Confirm transfer (Transfer time: {transfer_time})",
        f"8. Once points arrive, visit {booking_portal}",
        f"9. Search for your flight: {route}",
        f"10. Select 'Book with miles' and complete booking",
    ]
    
    if surcharge and surcharge > 0:
        steps.append(f"11. Pay ~${surcharge:,.2f} in taxes and fees at checkout")
    
    # Add special notes
    notes = []
    if bank_info.get("special_note"):
        notes.append(bank_info["special_note"])
    
    # Codeshare information
    if operating_carrier and operating_carrier != airline:
        op_name = AIRLINE_METADATA.get(operating_carrier, {}).get("name", operating_carrier)
        notes.append(f"Note: You'll book through {airline_name} but fly on {op_name} (codeshare)")
    
    return {
        "summary": f"Transfer {points_to_transfer:,} {bank_name} → {airline_name}",
        "from_program": bank_name,
        "to_program": airline_name,
        "points_to_transfer": points_to_transfer,
        "surcharge": surcharge,
        "route": route,
        "transfer_portal_url": portal_url,
        "booking_url": booking_portal,
        "transfer_time": transfer_time,
        "steps": steps,
        "notes": notes,
        "is_codeshare": operating_carrier and operating_carrier != airline,
        "operating_carrier": operating_carrier,
    }
```

#### Step 3: Calculate Value (Cents Per Point)

```python
def calculate_cpp(cash_price: float, points_needed: int, surcharge: float) -> float:
    """
    Calculate cents per point value.
    
    CPP = (cash_price - surcharge) × 100 / points_needed
    
    Example:
        Cash fare: $450
        Award: 25,000 miles + $50 surcharge
        CPP = (450 - 50) × 100 / 25,000 = 1.60 cpp
    """
    if points_needed <= 0:
        return 0.0
    
    cash_saved = cash_price - surcharge
    if cash_saved <= 0:
        return 0.0
    
    return (cash_saved * 100) / points_needed
```

---

## Recommended Enhancements

### 1. Async Polling Implementation

The new API supports async polling (`exit_early: true`), which can improve performance for multi-route searches:

```python
import asyncio
import uuid

async def search_with_polling(
    origin: str,
    destination: str,
    date: str,
    programs: list,
    cabins: list,
    pax: int,
    api_key: str,
    max_wait_seconds: int = 60,
) -> dict:
    """
    Use the new polling-based API for better performance.
    """
    task_id = str(uuid.uuid4())
    
    # 1. Trigger the search
    trigger_payload = {
        "origin": origin,
        "destination": destination,
        "date": date,
        "programs": programs,
        "cabins": cabins,
        "pax": pax,
        "task_id": task_id,
        "exit_early": True,
        "api_key": api_key,
    }
    
    async with httpx.AsyncClient() as client:
        # Trigger search
        await client.post(
            "https://apis.awardtool.com/flight_trigger/search_real_time",
            json=trigger_payload,
        )
        
        # 2. Poll for results
        retrieval_payload = {"task_id": task_id, "api_key": api_key}
        all_results = []
        start_time = asyncio.get_event_loop().time()
        
        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait_seconds:
                break
            
            r = await client.post(
                "https://apis.awardtool.com/flight_retrieval/search_result",
                json=retrieval_payload,
            )
            data = r.json()
            
            if data.get("result"):
                all_results.extend(data["result"])
            
            if data.get("finish") == False:
                # Task complete
                break
            
            # Wait before next poll
            await asyncio.sleep(2)
        
        return {"data": all_results, "task_id": task_id}
```

### 2. Enhanced Transfer Options Extraction

```python
def extract_all_transfer_options(awardtool_response: dict) -> list:
    """
    Extract and deduplicate all transfer options from AwardTool response.
    Returns sorted list by points required (best value first).
    """
    options_map = {}  # (airline, bank) -> best option
    
    for item in awardtool_response.get("data", []):
        airline = item.get("airline_code") or item.get("program_code")
        award_points = item.get("award_points")
        surcharge = item.get("surcharge", 0)
        
        # Check both top-level and cabin_prices transfer_options
        transfer_opts = item.get("transfer_options", [])
        
        for cabin, cabin_data in item.get("cabin_prices", {}).items():
            transfer_opts.extend(cabin_data.get("transfer_options", []))
        
        for opt in transfer_opts:
            bank = opt.get("program", "").lower()
            points = opt.get("points", award_points)
            
            key = (airline, bank)
            if key not in options_map or points < options_map[key]["points"]:
                options_map[key] = {
                    "airline": airline,
                    "bank": bank,
                    "points": points,
                    "surcharge": surcharge,
                    "booking_url": item.get("url"),
                    "flight_info": item.get("fare", {}).get("products", []),
                }
    
    # Sort by points (best value first)
    return sorted(options_map.values(), key=lambda x: x["points"])
```

### 3. Multi-Segment Transfer Strategy

For multi-city trips, optimize transfers across all segments:

```python
def optimize_multi_segment_transfers(
    segments: list,  # List of (origin, dest, date, awardtool_data)
    user_points: dict,  # {bank: balance}
) -> list:
    """
    Optimize transfer strategy across multiple flight segments.
    
    Strategy:
    1. Group segments by best airline program
    2. Minimize total points transferred
    3. Consolidate transfers to same airline when possible
    """
    # Group by airline that appears in multiple segments
    airline_coverage = {}  # airline -> [segment_indices]
    
    for i, (origin, dest, date, data) in enumerate(segments):
        for item in data.get("data", []):
            airline = item.get("airline_code")
            if airline not in airline_coverage:
                airline_coverage[airline] = []
            airline_coverage[airline].append(i)
    
    # Find airlines that cover multiple segments (better for consolidation)
    multi_segment_airlines = {
        airline: indices
        for airline, indices in airline_coverage.items()
        if len(indices) > 1
    }
    
    # Build optimized transfer plan
    transfer_plan = []
    covered_segments = set()
    
    # First, try to cover multiple segments with one airline
    for airline, indices in sorted(
        multi_segment_airlines.items(),
        key=lambda x: -len(x[1])  # Most coverage first
    ):
        if any(i in covered_segments for i in indices):
            continue
        
        # Calculate total points needed for all segments with this airline
        total_points = 0
        segment_details = []
        
        for i in indices:
            origin, dest, date, data = segments[i]
            for item in data.get("data", []):
                if item.get("airline_code") == airline:
                    total_points += item.get("award_points", 0)
                    segment_details.append({
                        "segment": f"{origin}→{dest}",
                        "points": item.get("award_points"),
                        "surcharge": item.get("surcharge"),
                    })
                    break
        
        # Find best bank for this airline
        # (would need transfer_options from the data)
        # ... implementation continues
    
    return transfer_plan
```

### 4. Real-Time Availability Alerts

```python
async def check_award_availability_change(
    saved_search: dict,
    api_key: str,
) -> dict:
    """
    Check if award availability has changed since last search.
    Useful for alerting users about better options or sold-out awards.
    """
    current = await search_with_polling(
        origin=saved_search["origin"],
        destination=saved_search["destination"],
        date=saved_search["date"],
        programs=saved_search["programs"],
        cabins=saved_search["cabins"],
        pax=saved_search["pax"],
        api_key=api_key,
    )
    
    changes = {
        "price_drops": [],
        "price_increases": [],
        "new_availability": [],
        "sold_out": [],
    }
    
    # Compare current vs saved
    saved_options = {
        (item["airline_code"], item["cabin_type"]): item
        for item in saved_search.get("data", [])
    }
    
    current_options = {
        (item["airline_code"], item["cabin_type"]): item
        for item in current.get("data", [])
    }
    
    for key, curr in current_options.items():
        if key in saved_options:
            prev = saved_options[key]
            if curr["award_points"] < prev["award_points"]:
                changes["price_drops"].append({
                    "airline": key[0],
                    "cabin": key[1],
                    "old_points": prev["award_points"],
                    "new_points": curr["award_points"],
                    "savings": prev["award_points"] - curr["award_points"],
                })
            elif curr["award_points"] > prev["award_points"]:
                changes["price_increases"].append({
                    "airline": key[0],
                    "cabin": key[1],
                    "old_points": prev["award_points"],
                    "new_points": curr["award_points"],
                })
        else:
            changes["new_availability"].append(curr)
    
    for key, prev in saved_options.items():
        if key not in current_options:
            changes["sold_out"].append(prev)
    
    return changes
```

---

## Code Examples

### Complete Transfer Instruction Flow

```python
async def get_transfer_instructions_for_trip(
    origin: str,
    destination: str,
    date: str,
    user_points: dict,
    api_key: str,
) -> dict:
    """
    Complete flow: Search → Extract → Match → Build Instructions
    """
    # 1. Search AwardTool
    search_result = await _awardtool_realtime(
        origin=origin,
        destination=destination,
        date_str=date,
        cabins=["Economy", "Business"],
        pax=1,
        programs=["UA", "AA", "DL", "BA", "AF"],
        client=httpx.AsyncClient(),
    )
    
    # 2. Extract all transfer options
    all_options = extract_all_transfer_options(search_result)
    
    # 3. Find best option for user's balances
    best_option = find_best_transfer_option(
        [{"points": o["points"], "program": o["bank"]} for o in all_options],
        user_points,
    )
    
    if not best_option:
        return {"error": "No transfer options available for your point balances"}
    
    # 4. Get the full option details
    full_option = next(
        (o for o in all_options if o["bank"] == best_option["bank"]),
        None
    )
    
    # 5. Build detailed instruction
    instruction = build_transfer_instruction(
        bank=full_option["bank"],
        airline=full_option["airline"],
        points_to_transfer=full_option["points"],
        surcharge=full_option["surcharge"],
        route=f"{origin}→{destination}",
        booking_url=full_option.get("booking_url"),
    )
    
    # 6. Calculate value
    # (Would need cash price from SerpAPI for CPP calculation)
    
    return {
        "recommendation": instruction,
        "all_options": all_options,
        "user_balances": user_points,
    }
```

### Frontend Display Component (Reference)

```typescript
interface TransferInstruction {
  summary: string;
  from_program: string;
  to_program: string;
  points_to_transfer: number;
  surcharge: number;
  route: string;
  transfer_portal_url: string;
  booking_url: string;
  transfer_time: string;
  steps: string[];
  notes: string[];
  is_codeshare: boolean;
  operating_carrier?: string;
}

// Example usage in React component
function TransferInstructionCard({ instruction }: { instruction: TransferInstruction }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{instruction.summary}</CardTitle>
        <Badge>{instruction.route}</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span>Points to transfer:</span>
            <span className="font-bold">{instruction.points_to_transfer.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Taxes & fees:</span>
            <span>${instruction.surcharge.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Transfer time:</span>
            <span>{instruction.transfer_time}</span>
          </div>
          
          <Separator />
          
          <div>
            <h4 className="font-semibold mb-2">Step-by-Step Instructions</h4>
            <ol className="list-decimal list-inside space-y-1">
              {instruction.steps.map((step, i) => (
                <li key={i} className="text-sm">{step}</li>
              ))}
            </ol>
          </div>
          
          {instruction.notes.length > 0 && (
            <Alert>
              <AlertDescription>
                {instruction.notes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
          
          <div className="flex gap-2">
            <Button asChild>
              <a href={instruction.transfer_portal_url} target="_blank">
                Transfer Points
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={instruction.booking_url} target="_blank">
                Book Flight
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Summary

### Key Takeaways

1. **`transfer_options` is the critical field** - AwardTool provides exactly which banks can transfer to each airline and how many points are needed.

2. **Different banks may require different point amounts** - Due to varying transfer ratios (e.g., Amex→JetBlue requires 17,500 vs Chase→JetBlue requires 14,000).

3. **Async polling improves performance** - Use `exit_early: true` with the retrieval API for multi-route searches.

4. **Operating carrier matters for codeshares** - When booking via one airline to fly another, include this in instructions.

5. **CPP calculation requires cash price** - Combine AwardTool data with SerpAPI for value analysis.

### Implementation Priority

1. ✅ **Basic transfer instructions** - Already implemented in `itinerary_service.py`
2. ⚠️ **Enhanced transfer_options extraction** - Partially implemented, can be improved
3. ⬜ **Async polling API** - Not yet implemented (uses direct search)
4. ⬜ **Multi-segment transfer optimization** - Basic implementation exists
5. ⬜ **Availability change alerts** - Not yet implemented

---

## Appendix: Supported Airline Programs

| Code | Airline | Transfer Partners |
|------|---------|-------------------|
| UA | United MileagePlus | Chase, Bilt |
| AA | American AAdvantage | Citi, Bilt |
| DL | Delta SkyMiles | Amex |
| AS | Alaska Mileage Plan | Amex, Chase, Capital One, Bilt |
| B6 | JetBlue TrueBlue | Chase, Amex, Citi |
| BA | British Airways Avios | Chase, Amex, Capital One, Bilt |
| AF | Air France Flying Blue | Chase, Amex, Citi, Capital One, Bilt |
| SQ | Singapore KrisFlyer | Chase, Amex, Citi, Capital One |
| CX | Cathay Pacific Asia Miles | Amex, Citi, Capital One |
| NH | ANA Mileage Club | Amex |
| EK | Emirates Skywards | Amex, Citi, Capital One, Bilt |
| QR | Qatar Privilege Club | Amex, Citi, Capital One |

---

*Document generated based on AwardTool API documentation and Tripy backend code analysis.*
