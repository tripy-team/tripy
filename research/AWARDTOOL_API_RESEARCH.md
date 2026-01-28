# AwardTool API Research

## Overview

The **AwardTool API** is a real-time award flight search service that aggregates award seat availability and pricing across 24+ airline loyalty programs. It enables applications like Tripy to search for award flights (flights booked with points/miles) across multiple airlines simultaneously.

---

## API Architecture

The AwardTool API uses a **two-phase asynchronous architecture** designed to handle the complexity of searching multiple airline programs in parallel:

### Phase 1: Priming (Search Initiation)

```
POST https://apisv2.awardtoolapi.com/flight_trigger/search_real_time
```

This endpoint initiates an asynchronous search across specified airline programs. The server begins querying multiple airline systems in the background.

**Request Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `origin` | string | Origin airport code (e.g., "JFK") |
| `destination` | string | Destination airport code (e.g., "LHR") |
| `date` | string | Travel date in YYYY-M-DD format |
| `pax` | integer | Number of passengers |
| `programs` | array | Airline program codes to search (e.g., ["UA", "AA", "BA"]) |
| `cabins` | array | Cabin classes: "Economy", "Premium Economy", "Business", "First" |
| `task_id` | string | Unique identifier for tracking this search (UUID) |
| `api_key` | string | Authentication key |
| `exit_early` | boolean | If true, returns immediately for polling |

**Example Request:**

```python
{
    "date": "2026-2-06",
    "origin": "JFK",
    "destination": "LHR",
    "pax": 1,
    "programs": ["QF", "AC", "UA"],
    "cabins": ["Economy", "Premium Economy", "Business", "First"],
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "api_key": "your-api-key",
    "exit_early": True
}
```

### Phase 2: Polling (Result Retrieval)

```
POST https://apisv2.awardtoolapi.com/flight_retrieval/search_result
```

This endpoint retrieves incremental search results. The API returns flights as they are found, allowing progressive loading.

**Request Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `task_id` | string | The task ID from the priming request |
| `api_key` | string | Authentication key |

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `result` | array | Array of flight objects found in this poll |
| `finish` | boolean | True when search is complete |
| `program_done` | array | List of airline programs that have completed searching |
| `missing_keys` | array | Any programs that couldn't be searched (auth issues) |

---

## Supported Airline Programs (24 Programs)

The AwardTool API supports searching across all major airline loyalty programs:

### US Airlines
| Code | Program |
|------|---------|
| AA | American Airlines AAdvantage |
| UA | United MileagePlus |
| DL | Delta SkyMiles |
| AS | Alaska Mileage Plan |
| B6 | JetBlue TrueBlue |

### North American Partners
| Code | Program |
|------|---------|
| AC | Air Canada Aeroplan |
| AM | Aeromexico Club Premier |
| AV | Avianca LifeMiles |

### European Airlines
| Code | Program |
|------|---------|
| BA | British Airways Executive Club |
| KL | Air France/KLM Flying Blue |
| LH | Lufthansa Miles & More |
| VS | Virgin Atlantic Flying Club |
| AY | Finnair Plus |
| SK | SAS EuroBonus |
| TP | TAP Air Portugal Miles&Go |
| TK | Turkish Miles & Smiles |

### Asia-Pacific Airlines
| Code | Program |
|------|---------|
| QF | Qantas Frequent Flyer |
| SQ | Singapore KrisFlyer |
| CX | Cathay Pacific Asia Miles |
| VA | Virgin Australia Velocity |

### Middle East Airlines
| Code | Program |
|------|---------|
| EK | Emirates Skywards |
| EY | Etihad Guest |
| QR | Qatar Airways Privilege Club |

### Latin America
| Code | Program |
|------|---------|
| G3 | GOL Smiles |

---

## Flight Result Data Structure

Each flight result contains detailed award pricing and flight information:

```json
{
    "program_code": "UA",
    "origin": "JFK",
    "destination": "LHR",
    "departure_time": "2026-02-06T19:30:00",
    "arrival_time": "2026-02-07T07:45:00",
    "cabin": "Business",
    "miles": 60000,
    "taxes_and_fees": 150.00,
    "airline_code": "UA",
    "flight_number": "UA100",
    "aircraft": "Boeing 777-300ER",
    "available_seats": 4,
    "mixed_cabin": false
}
```

---

## Billing Model

The API charges based on **unique `task_id` values**:
- Each unique `task_id` represents one billable search
- Multiple polls with the same `task_id` are not additional charges
- Programs can be batched into the same `task_id` for efficiency

**Recommendation:** Generate one `task_id` per user search request and reuse it for all program searches and polling.

---

## How AwardTool API Helps Tripy

### Current Integration Status

Tripy already integrates with AwardTool API (see `backend/src/handlers/flights.py`), but the example script reveals opportunities for enhancement:

### 1. **Parallel Program Searching**

The example demonstrates searching multiple program groups in parallel:

```python
program_lists = [["QF", "AC", "UA"], ["AA", "AS", "AV"], ["B6", "VA", "VS"]]
for program_list in program_lists:
    request_body["programs"] = program_list
    response = requests.post(PRIMING_ENDPOINT, json=request_body)
```

**Benefit for Tripy:** Reduces search latency by parallelizing program searches while staying within API limits.

### 2. **Incremental Result Loading**

The polling architecture allows Tripy to:
- Show users partial results as they arrive
- Provide better UX with progressive loading
- Timeout gracefully while still returning useful results

```python
while not finish and poll_count < max_polls:
    response = requests.post(POLLING_ENDPOINT, json=polling_body)
    new_flights = response.json().get("result", [])
    all_flights.extend(new_flights)  # Accumulate results
```

### 3. **Comprehensive Program Coverage**

With 24 supported programs, Tripy can offer users maximum redemption options:

| Tripy Feature | AwardTool Capability |
|--------------|---------------------|
| **Transfer optimization** | Search programs that partner with Chase, Amex, Citi, Capital One, Bilt |
| **Cross-alliance searching** | Star Alliance (UA), Oneworld (AA, BA), SkyTeam (AF, DL) |
| **Sweet spot finding** | Compare same route across all programs to find best value |

### 4. **Multi-Cabin Search**

Single API call can search all cabin classes:
- Economy
- Premium Economy
- Business
- First

This enables Tripy to show users upgrade opportunities when premium cabins offer better value.

---

## Integration Recommendations for Tripy

### Short-Term Improvements

1. **Implement Polling-Based Search**
   - Current: Synchronous blocking calls
   - Proposed: Use `exit_early=True` + polling for better timeout handling

2. **Add Progress Indicators**
   - Track `program_done` to show users which airlines have been searched
   - Display partial results while search continues

3. **Optimize Program Batching**
   - Group programs by alliance or transfer partner for smarter batching
   - Prioritize programs user has points in

### Medium-Term Enhancements

1. **Implement Search Result Caching by Task ID**
   - Cache polling results to allow resume if user navigates away
   - Reduce repeated API calls for same search

2. **Add "Missing Keys" Handling**
   - Alert users when certain programs couldn't be searched
   - Suggest alternative programs

3. **Program-Level Availability Tracking**
   - Track which programs consistently have availability on routes
   - Use historical data to prioritize searches

### Long-Term Strategic Value

1. **Award Sweet Spot Database**
   - Build knowledge base of routes where specific programs offer exceptional value
   - Example: "JFK-DXB in First Class via Emirates Skywards typically costs 85k miles"

2. **Dynamic Program Prioritization**
   - For users with Chase points: prioritize UA, BA, AF (Chase partners)
   - For users with Amex points: prioritize DL, BA, AF (Amex partners)

3. **Availability Calendar Integration**
   - Use AwardTool's `panorama_calendar_data` endpoint (already in Tripy)
   - Show users date flexibility for better award availability

---

## API Rate Limits and Best Practices

### Recommended Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Polling interval | 5 seconds | Balance between responsiveness and API load |
| Max polling time | 60 seconds | Most searches complete within this window |
| Programs per request | 3-5 | Optimal batch size for parallel processing |
| Request timeout | 10 seconds | Prevent hanging on slow responses |

### Error Handling

```python
# Recommended error handling pattern
try:
    response = requests.post(endpoint, json=body, timeout=10)
    if response.status_code == 200:
        # Process results
    else:
        logger.error(f"API error: {response.status_code}")
except requests.exceptions.Timeout:
    # Continue polling - don't fail the entire search
except requests.exceptions.RequestException as e:
    # Log and continue
```

---

## Comparison with Current Tripy Implementation

| Aspect | Current Tripy | Example Script Pattern |
|--------|--------------|----------------------|
| Search mode | Synchronous | Async with polling |
| Program grouping | All at once | Batched groups |
| Result handling | Wait for complete | Progressive accumulation |
| Timeout handling | Hard timeout | Graceful degradation |
| Progress feedback | None | Program-by-program |

---

## Cost Optimization Strategies

1. **Intelligent Caching**
   - Cache award availability for 6 hours (current Tripy default)
   - Cache panorama calendar data for 24 hours

2. **Search De-duplication**
   - Track recent searches by route/date
   - Reuse task_ids when appropriate

3. **Program Filtering**
   - Only search programs relevant to user's point balances
   - Skip programs with known poor availability on route

---

## Conclusion

The AwardTool API is a critical data source for Tripy's award flight optimization. The two-phase priming/polling architecture enables:

1. **Comprehensive coverage** across 24 airline programs
2. **Progressive result loading** for better UX
3. **Graceful timeout handling** for reliability
4. **Efficient billing** through task_id consolidation

By adopting the patterns demonstrated in the example script, Tripy can enhance its search reliability, user experience, and cost efficiency while maintaining comprehensive award flight coverage.

---

## References

- AwardTool API Example: `/Users/ericzhong/Downloads/awardtool_api_example.py`
- Current Tripy Integration: `backend/src/handlers/flights.py`
- Tripy Award Programs Config: `backend/src/utils/award_programs.py`
