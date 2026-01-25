# Tripy - Product Documentation

## Executive Summary

**Tripy** is an AI-powered travel planning platform that helps users maximize the value of their credit card points and airline miles when booking flights and hotels. The platform uses sophisticated mathematical optimization (Integer Linear Programming) to find the best combination of cash and points to minimize out-of-pocket expenses while maximizing the redemption value of loyalty program rewards.

---

## What Tripy Does

### Core Value Proposition

1. **Maximize Points Value**: Users typically get 3-10x more value from their points compared to cash redemptions
2. **Minimize Out-of-Pocket Costs**: Intelligent optimization balances points usage with cash payments
3. **Multi-City Trip Planning**: Automatically determines optimal city ordering for complex itineraries
4. **Group Travel Coordination**: Collaborative planning with voting, cost-splitting, and shared itineraries
5. **Transfer Partner Optimization**: Recommends the best credit card to airline transfer strategies

### Target Users

- Credit card points collectors (Chase Ultimate Rewards, Amex Membership Rewards, etc.)
- Frequent travelers with multiple loyalty program balances
- Groups planning trips together
- Users who want to optimize their travel spending

---

## System Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS |
| **Backend** | FastAPI (Python), AWS Lambda |
| **Database** | Amazon DynamoDB |
| **Authentication** | AWS Cognito |
| **Optimization** | PuLP (Integer Linear Programming) with CBC Solver |
| **Storage** | Amazon S3 + CloudFront CDN |
| **Infrastructure** | AWS CDK (TypeScript) |
| **Deployment** | AWS Amplify (frontend), AWS App Runner/Lambda (backend) |

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER INTERFACE                                │
│                      (Next.js React Application)                         │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Dashboard   │  │  Trip Setup  │  │  Results &   │  │   Booking    │ │
│  │              │  │  (Solo/Group)│  │  Comparison  │  │  & Payment   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY / BACKEND                            │
│                        (FastAPI on Lambda/App Runner)                    │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │     Auth     │  │    Trips     │  │  Itinerary   │  │   Points     │ │
│  │   Service    │  │   Service    │  │   Service    │  │   Service    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
        │   External APIs  │ │   DynamoDB   │ │  ILP Optimizer   │
        │ • AwardTool      │ │   Tables     │ │  (PuLP/CBC)      │
        │ • SerpAPI        │ │              │ │                  │
        │ • Amadeus        │ │              │ │                  │
        │ • OpenAI         │ │              │ │                  │
        └──────────────────┘ └──────────────┘ └──────────────────┘
```

---

## Core Features

### 1. Points Management

Users can track points from multiple sources:

**Bank/Credit Card Programs:**
- Chase Ultimate Rewards
- American Express Membership Rewards
- Citi ThankYou Points
- Capital One Miles
- Bilt Rewards

**Airline Programs:**
- United MileagePlus
- American Airlines AAdvantage
- Delta SkyMiles
- British Airways Avios
- Air France Flying Blue
- And more...

**Hotel Programs:**
- Marriott Bonvoy
- Hilton Honors
- Hyatt World of Hyatt
- IHG One Rewards

### 2. Trip Planning

**Solo Trips:**
- Configure departure and arrival cities
- Add intermediate destinations (must-visit cities)
- Set budget constraints
- Allocate available points
- Generate optimized itineraries

**Group Trips:**
- Invite members via shareable codes
- Collaborative destination voting
- Aggregate points across all members
- Cost splitting and payment allocation
- Any member can pay for any other member

### 3. Itinerary Generation

The system generates multiple optimized itineraries considering:
- Available points balances
- Cash budget limits
- Flight preferences (cabin class)
- Hotel preferences (star rating)
- Travel dates (fixed or flexible)

### 4. Smart Transfer Recommendations

Provides detailed guidance on:
- Which credit card points to transfer
- Which airline program to transfer to
- Step-by-step transfer instructions
- Portal URLs and booking links
- Transfer timing and processing times

---

## The Optimization Engine

### What Gets Optimized

Tripy solves a **multi-objective optimization problem** using Integer Linear Programming (ILP):

```
MAXIMIZE:
    W₁ × (Points Value) - W₂ × (Cash Paid) - W₃ × (Travel Time) + W₄ × (Card Benefits)

Subject to:
    • Valid travel paths (flow conservation)
    • Must-visit all selected destinations
    • Points used ≤ Available balances
    • Cash spent ≤ Budget
    • Transfer partner eligibility
    • Award seat availability
```

### Weight Priorities

| Weight | Value | Purpose |
|--------|-------|---------|
| W₁ | 10⁶ | Prioritize high points value redemptions |
| W₂ | 10³ | Minimize cash expenditure |
| W₃ | 1.0 | Secondary: minimize travel time |
| W₄ | 10⁴ | Bonus for card benefits (free bags, etc.) |

### Points Value Calculation

```
Points Value = Cash Price - Award Surcharge
Cents Per Point (CPP) = (Points Value × 100) / Miles Required
```

The system only recommends using points when the redemption value exceeds a minimum threshold (default: 1.0 cpp), ensuring users get good value from their points.

### Decision Variables

The ILP optimizer makes binary decisions for:

1. **Edge Selection** (`x[p][e]`): Which flight segments each passenger takes
2. **Cash Payment** (`z[q,p][e]`): Which payer pays cash for which passenger's segment
3. **Points Payment** (`y[q,p][s,a][e]`): Which payer uses which bank→airline transfer
4. **Native Miles** (`y_native[q,p][a][e]`): Direct airline miles usage
5. **Transfer Blocks** (`t_blocks[q][s,a]`): How many blocks of points to transfer

### Constraints

| Constraint | Description |
|------------|-------------|
| **Flow Conservation** | Each traveler has exactly one valid path from start to end |
| **Must-Visit** | Each selected destination is visited exactly once |
| **Payment Exclusivity** | Each segment has exactly one payment method |
| **Points Limits** | Cannot exceed available balances |
| **Cash Budget** | Total cash ≤ per-traveler budget |
| **Transfer Rules** | Only use valid transfer partners |
| **Seat Availability** | Respect award seat limits |

### Dynamic City Ordering

A key feature is **automatic destination ordering**. Given:
- Start: New York (JFK)
- Must-visit: Tokyo (HND), Paris (CDG)
- End: Miami (MIA)

The optimizer determines whether JFK→HND→CDG→MIA or JFK→CDG→HND→MIA is better, considering:
- Flight availability
- Points redemption value
- Total cost
- Travel time

---

## Data Flow

### Itinerary Generation Process

```
1. USER REQUEST
   ├── Departure: FLL
   ├── Destinations: Tokyo, Paris
   ├── Arrival: MCO
   ├── Budget: $3,000
   └── Points: 200k Chase UR

2. PARALLEL FLIGHT FETCH
   ├── FLL→HND: AwardTool + SerpAPI
   ├── FLL→CDG: AwardTool + SerpAPI
   ├── HND→CDG: AwardTool + SerpAPI
   ├── CDG→HND: AwardTool + SerpAPI
   ├── HND→MCO: AwardTool + SerpAPI
   └── CDG→MCO: AwardTool + SerpAPI

3. BUILD ILP GRAPH
   ├── Extract all cities
   ├── Build cost matrices (cash, time, points)
   ├── Map user points to bank sources
   └── Construct transfer graph

4. RUN ILP OPTIMIZATION
   ├── PuLP/CBC solver
   ├── Find optimal paths
   ├── Determine payment allocation
   └── Calculate totals

5. GENERATE RESULTS
   ├── Optimal route: FLL→HND→CDG→MCO
   ├── Payment modes per segment
   ├── Transfer instructions
   └── Total costs and savings
```

### External API Integration

| API | Purpose | Cache Duration |
|-----|---------|----------------|
| **AwardTool** | Award flight availability and pricing | 6 hours |
| **SerpAPI** | Google Flights cash prices | 90 minutes |
| **Amadeus** | City and airport search | N/A |
| **OpenAI** | Natural language processing, suggestions | N/A |

---

## Key Algorithms

### 1. Award-First Search Strategy

```python
def get_flights(origin, destination, date):
    # Step 1: Check award availability first
    award_flights = awardtool_api.search(origin, destination, date)
    
    # Step 2: Get cash prices from SerpAPI
    cash_flights = serpapi.google_flights(origin, destination, date)
    
    # Step 3: Merge results - prioritize flights with both options
    return merge_and_rank(award_flights, cash_flights)
```

### 2. Transfer Partner Selection

The system maintains a transfer graph mapping banks to airlines:

```python
TRANSFER_GRAPH = {
    "chase": {
        "UA": 1.0,  # 1:1 transfer ratio
        "BA": 1.0,
        "AF": 1.0,
        "SQ": 1.0,
        ...
    },
    "amex": {
        "DL": 1.0,
        "BA": 1.0,
        "AF": 1.0,
        ...
    },
    ...
}
```

### 3. Fallback Strategies

If the primary optimization fails:

1. **Budget Relaxation**: Retry with 2x, 3x, 5x, 10x budget
2. **Hub Fallback**: Try nearby major airports for small airports
3. **Simple Generator**: Generate basic routes within constraints
4. **Ground Transport**: Add bus/car options for short distances

---

## Database Schema

### DynamoDB Tables

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `tripy-trips` | `trip_id` | Trip metadata |
| `tripy-destinations` | `trip_id, destination_id` | Destinations per trip |
| `tripy-itineraries` | `trip_id, itinerary_id` | Generated itineraries |
| `tripy-points` | `trip_id, user_id, program` | Points allocations |
| `tripy-trip-members` | `trip_id, user_id` | Group membership |
| `tripy-users` | `user_id` | User profiles |
| `tripy-city-images` | `city_name` | Curated city images |

---

## Frontend User Flows

### Solo Trip Flow

```
Dashboard → Solo Setup → Generate Itineraries → View Results → Compare Options → Book
```

1. **Setup Page**: Enter destinations, dates, budget, allocate points
2. **Results Page**: View 3-5 optimized itinerary options
3. **Comparison Page**: Side-by-side comparison of routes
4. **Booking Page**: Transfer instructions and booking links

### Group Trip Flow

```
Dashboard → Group Setup → Invite Members → Voting → Generate → Winner → Book
```

1. **Setup Page**: Configure trip basics
2. **Invite Members**: Share invite code
3. **Voting Page**: Members rank destination preferences
4. **Results Page**: Aggregated group itineraries
5. **Winner Page**: Selected final itinerary
6. **Booking/Payment**: Split costs and coordinate bookings

---

## Performance Optimizations

### Backend Optimizations

| Optimization | Implementation |
|--------------|----------------|
| **Parallel Requests** | `asyncio.gather()` for all O-D pairs |
| **Request Limiting** | Semaphore limits concurrent API calls |
| **Multi-Layer Caching** | Redis/DynamoDB with TTL-based expiration |
| **Graph Pruning** | ILP constraints eliminate infeasible paths early |

### Frontend Optimizations

| Optimization | Implementation |
|--------------|----------------|
| **Image CDN** | CloudFront with responsive srcsets |
| **Code Splitting** | Next.js automatic route splitting |
| **Progressive Loading** | Skeleton states during data fetches |

---

## API Endpoints Summary

### Authentication
- `POST /auth/login` - User login
- `POST /auth/signup` - Registration
- `POST /auth/refresh` - Token refresh

### Trips
- `POST /trips` - Create trip
- `GET /trips` - List user's trips
- `POST /trips/invite` - Get/regenerate invite code
- `POST /trips/join` - Join via invite code

### Destinations
- `POST /destinations/add` - Add destination
- `POST /destinations/list` - List trip destinations

### Points
- `POST /points/upsert` - Add/update points
- `POST /points/summary` - Get trip points summary
- `GET /points/valuations` - Get TPG point valuations

### Itinerary
- `POST /itinerary/generate` - Generate optimized itinerary
- `POST /itinerary/get` - Retrieve saved itinerary

### Search
- `GET /api/airports/autocomplete` - Airport search
- `GET /api/destinations/autocomplete` - City search

---

## Key Value Metrics

### Cents Per Point (CPP)

The primary metric for evaluating redemption value:

| Rating | CPP Range | Example |
|--------|-----------|---------|
| **Excellent** | 3.0+ cpp | 50k points for $1,500 flight = 3.0 cpp |
| **Good** | 1.5-3.0 cpp | 50k points for $1,000 flight = 2.0 cpp |
| **Minimum** | 1.0+ cpp | Threshold for recommendation |
| **Poor** | <1.0 cpp | Below cash value, not recommended |

### Total Savings

```
Savings = Cash Price - (Award Surcharge + Points Value in Cash)
```

Where Points Value in Cash = Points Used × Base Point Value (typically ~1 cpp)

---

## Future Considerations

### Potential Enhancements

1. **Real-time Award Tracking**: Monitor award availability changes
2. **Price Alerts**: Notify when point requirements drop
3. **Multi-Airline Itineraries**: Mix carriers in single trips
4. **Hotel Optimization**: Extend ILP to include hotel stays
5. **Mobile App**: Native iOS/Android applications

### Scalability Paths

1. **Regional Expansion**: Support for more airline programs
2. **Enterprise Features**: Corporate travel management
3. **API Access**: Third-party integrations

---

## Conclusion

Tripy transforms complex travel planning with credit card points into an optimized, user-friendly experience. By combining:

- **Sophisticated ILP optimization** for route and payment decisions
- **Real-time flight data** from multiple sources
- **Intelligent transfer recommendations** with detailed instructions
- **Collaborative features** for group travel

The platform delivers significant value to users, typically saving 50-80% compared to cash bookings while ensuring optimal use of loyalty program rewards.

---

*Last updated: January 2026*
