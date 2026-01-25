# Tripy: AI-Powered Group Trip Planning Made Easy

## Table of Contents
1. [What is Tripy?](#what-is-tripy)
2. [Core Technologies & APIs](#core-technologies--apis)
3. [The Purpose of Group Trips](#the-purpose-of-group-trips)
4. [How Tripy Makes Group Trip Planning Easy](#how-tripy-makes-group-trip-planning-easy)
5. [Group Trip Features in Detail](#group-trip-features-in-detail)
6. [Technical Architecture](#technical-architecture)
7. [Key Benefits](#key-benefits)

---

## What is Tripy?

**Tripy is an AI-powered travel planning platform that helps users maximize the value of their credit card points and airline miles to plan affordable, optimized trips.**

### Core Value Proposition

Tripy solves the fundamental challenges travelers face when trying to use loyalty points:

| Challenge | How Tripy Solves It |
|-----------|---------------------|
| **Confusing Point Values** | Automatically calculates cents-per-point (CPP) to show true redemption value |
| **Too Many Transfer Options** | AI optimization selects the best bank → airline transfer path |
| **Complex Multi-City Planning** | Automatically determines optimal city ordering |
| **Balancing Cash and Points** | ILP optimizer finds the ideal mix to minimize out-of-pocket costs |
| **Group Coordination** | Collaborative tools for voting, cost-splitting, and shared itineraries |

### How It Works

```
1. ENTER TRIP DETAILS
   └─ Departure, destinations, arrival, dates, budget

2. ADD POINTS BALANCES  
   └─ Credit card programs (Chase, Amex, Citi, Capital One, Bilt)
   └─ Airline miles (United, American, Delta, British Airways, etc.)

3. GENERATE OPTIMIZED ITINERARIES
   └─ AI generates multiple route options
   └─ Shows best cash vs. points strategies per flight
   └─ Calculates total savings compared to all-cash booking

4. BOOK WITH CONFIDENCE
   └─ Step-by-step transfer instructions
   └─ Direct links to booking portals
   └─ Detailed cost breakdowns
```

### Points Value Metrics

Tripy measures redemption value using **Cents Per Point (CPP)**:

| CPP Rating | Value Range | When to Use Points |
|------------|-------------|-------------------|
| Excellent | 3.0+ cpp | Always recommend |
| Good | 1.5-3.0 cpp | Recommend |
| Acceptable | 1.0-1.5 cpp | Recommend |
| Poor | <1.0 cpp | Never recommend — pay cash instead |

---

## Core Technologies & APIs

Tripy integrates with multiple external APIs to provide comprehensive flight and hotel search capabilities:

### Flight Search APIs

#### 1. AwardTool Real-Time Search API
The **AwardTool API** enables real-time searches for available award tickets across multiple airline programs:

- **Real-Time Award Availability**: Searches actual award seat inventory across programs like United (UA), American (AA), Delta (DL), Air Canada (AC), and more
- **Multi-Program Search**: Can query up to 5 airline programs per request
- **Cabin Class Support**: Economy, Premium Economy, Business, and First Class
- **Response Data**:
  - Award points required per flight
  - Surcharges and taxes
  - Seat availability counts
  - Airline names and flight details
  - Segment-by-segment information

#### 2. AwardTool Panorama API
Provides **year-round award availability data** for 25,000+ popular routes:

- **Route Data**: Lowest points required for any origin-destination pair over a date range
- **Yearly Calendar View**: See availability patterns across an entire year
- **Flight Details**: Top 10 lowest-point flights per cabin class
- **Filtering Options**: By program, stops, max points, tax, and duration

#### 3. SerpAPI Google Flights Integration

**Google Flights Results API** provides comprehensive cash flight pricing:
- Best flights and alternative flight options
- Multi-leg itineraries with layover information
- Carbon emissions data
- Price tracking and booking tokens

**Google Flights Airports API** provides airport data:
- Airport codes and names
- City and country information
- GPS coordinates
- City images and thumbnails

**Google Flights Autocomplete API** enables smart location search:
- City and airport suggestions
- Distance to airports from city centers
- Support for regions, countries, and specific airports

### Hotel Search APIs

#### 1. AwardTool Hotel API
Searches hotel award availability:
- Hotel calendar availability by date
- Points requirements per night
- Property details and amenities

#### 2. SerpAPI Google Hotels Integration
Provides comprehensive hotel search:
- Property listings with ratings and reviews
- Price comparisons across booking platforms
- Amenities, location ratings, and images
- Support for vacation rentals
- Filtering by brands, star rating, and price range

### Data Flow Example

```
User Request: "Fly from JFK to Tokyo, March 15-22"
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌──────────┐   ┌─────────────┐
│AwardTool│   │ SerpAPI  │   │  AwardTool  │
│ Search  │   │ Flights  │   │  Panorama   │
└────┬────┘   └────┬─────┘   └──────┬──────┘
     │             │                │
     └─────────────┼────────────────┘
                   ▼
         ┌─────────────────┐
         │   ILP Optimizer │
         │  Merges Results │
         │ Finds Best Mix  │
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │  Optimized Trip │
         │ Cash + Points   │
         │   Strategy      │
         └─────────────────┘
```

---

## The Purpose of Group Trips

### Why Group Travel is Complex

Planning a group trip is exponentially more complex than solo travel:

| Solo Travel | Group Travel |
|-------------|--------------|
| 1 set of preferences | Multiple conflicting preferences |
| 1 budget | Multiple budgets to coordinate |
| 1 points balance | Different points across multiple programs |
| 1 departure city | Members from different cities |
| Simple booking | Complex coordination and cost splitting |

### What Tripy's Group Trips Solve

**1. Destination Consensus**
- Members can propose and vote on destinations
- Democratic ranking system ensures everyone's voice is heard
- Automatic aggregation of preferences into optimal choices

**2. Points Pooling & Optimization**
- Aggregates points across all group members
- Optimizes which member's points to use for which flights
- Any member can pay for any other member's booking

**3. Fair Cost Allocation**
- Transparent cost splitting based on actual consumption
- Points contributions valued at fair market rate
- Clear settlement summaries showing who owes what

**4. Coordinated Logistics**
- Single source of truth for itinerary details
- Synchronized booking instructions
- Real-time status tracking for all members

---

## How Tripy Makes Group Trip Planning Easy

### Phase 1: Trip Creation & Invites

The **Trip Organizer** creates the group trip:

```
1. Set basic trip parameters:
   ├── Destinations (must-visit cities)
   ├── Date range (fixed or flexible)
   ├── Start and end locations
   └── Travel style (cabin class, hotel preferences)

2. Configure party size and budget

3. Add organizer's points allocation

4. Generate shareable invite code/link
```

**Invite System Features:**
- Unique invite codes per trip
- Shareable URLs: `/group/join/{inviteCode}`
- Codes can be regenerated by admin
- Public access to view trip info (login required to join)

### Phase 2: Member Onboarding

Each invited member completes their profile:

```
Member Join Flow:
├── View trip overview (organizer, dates, destinations)
├── Copy preferences from existing members (optional)
├── Set travel party (adults, children)
├── Configure flight preferences
│   ├── Departure/arrival airports
│   ├── Cabin class preference
│   └── Baggage needs
├── Set accommodation preferences
├── Enter travel dates (can differ from group)
├── Set budget limit
└── Add available points
```

### Phase 3: Group Dashboard

The dashboard provides at-a-glance group status:

| Metric | Description |
|--------|-------------|
| **Total Members** | Count of confirmed travelers |
| **Total Budget** | Combined spending limit |
| **Total Points** | Aggregated points across all programs |
| **Ready Status** | % of members who completed setup |

### Phase 4: Destination Voting (Optional)

For groups that haven't decided on destinations:

```
Voting Process:
1. Members rank destinations by preference
2. System aggregates rankings
3. Top-voted destinations are selected
4. Progress tracked per member
```

### Phase 5: Itinerary Generation

When all members are ready, the **ILP Optimizer** generates itineraries:

```
Optimization Inputs:
├── All member departure cities
├── All must-visit destinations
├── Combined points pool
├── Individual and group budgets
├── Date constraints
└── Travel preferences

Optimization Outputs:
├── Multiple route options (3-5 itineraries)
├── Per-segment payment recommendations
│   ├── Cash vs. points decisions
│   └── Which member's points to use
├── Cost breakdown per member
└── Total group savings calculation
```

### Phase 6: Results & Comparison

The results page shows:

**Per Itinerary:**
- Cities visited and days per city
- Total cost (cash + points value)
- Cost per person
- Budget/points constraint indicators
- Smart tips (transfer timing, sample activities)

**Cost Splitting View:**
```
┌─────────────────────────────────────────────────┐
│              COST BREAKDOWN                      │
├─────────────────────────────────────────────────┤
│ Member        Base Cost   Savings   Final Cost  │
├─────────────────────────────────────────────────┤
│ Alice         $1,200      -$400     $800        │
│ Bob           $1,200      -$250     $950        │
│ Carol         $1,200      -$180     $1,020      │
├─────────────────────────────────────────────────┤
│ Total         $3,600      -$830     $2,770      │
│ vs. Cash      $5,400                $2,630      │
│                                     SAVED!      │
└─────────────────────────────────────────────────┘
```

### Phase 7: Booking Coordination

Once an itinerary is selected, Tripy provides:

**Step-by-Step Transfer Instructions:**
1. Which member transfers points where
2. Transfer amounts and timing
3. Booking portal links
4. Confirmation tracking

**Payment Coordination:**
- Single payment flow for group
- Service fee calculation
- Promo code support

---

## Group Trip Features in Detail

### 1. Setup Page (`/group/setup`)
- Trip configuration wizard
- Party size management
- Points allocation interface
- AI Trip Assistant chatbot
- Invite code generation

### 2. Join Page (`/group/join/[inviteCode]`)
- Trip overview display
- Preference copying from existing members
- Individual travel configuration
- Budget and points entry

### 3. Dashboard (`/group/dashboard`)
- Member status tracking
- Destination management
- Ready-state monitoring
- Generate button when complete

### 4. Voting Page (`/group/voting`)
- Drag-and-drop ranking interface
- Real-time voting status
- Progress visualization
- Automatic aggregation

### 5. Results Page (`/group/results`)
- Multiple itinerary display
- Per-member cost breakdown
- Comparison selection
- Day-by-day editing
- Smart optimization tips

### 6. Winner Page (`/group/winner`)
- Final selected itinerary display
- Complete cost summary
- Booking preparation

### 7. Booking Page (`/group/booking`)
- Transfer instructions per member
- Booking links and portals
- Order summary
- Payment status

### 8. Points Strategy Page (`/group/points-strategy`)
- Optimal points allocation visualization
- Transfer recommendations
- Value optimization insights

---

## Technical Architecture

### Frontend Stack
- **Next.js 15** with App Router
- **React 19** with TypeScript
- **Tailwind CSS** for styling
- Real-time state management

### Backend Stack
- **FastAPI** (Python)
- **AWS Lambda** serverless deployment
- **DynamoDB** for data persistence
- **AWS Cognito** for authentication

### Optimization Engine
- **PuLP** library for Integer Linear Programming
- **CBC Solver** for optimization
- Multi-objective function balancing:
  - Points value maximization
  - Cash expenditure minimization
  - Travel time optimization

### Data Flow

```
Frontend (React)
  → API Client (api.ts)
    → Backend (FastAPI on Lambda)
      → Service Layer (business logic)
        → Repository Layer (DynamoDB)
          → External APIs (AwardTool, SerpAPI, Amadeus)
```

### Database Schema

| Table | Purpose |
|-------|---------|
| `tripy-trips` | Trip metadata |
| `tripy-destinations` | Destinations per trip |
| `tripy-itineraries` | Generated itineraries |
| `tripy-points` | Points allocations per trip/user |
| `tripy-trip-members` | Group membership |
| `tripy-users` | User profiles |

---

## Key Benefits

### For Individual Travelers

| Benefit | Impact |
|---------|--------|
| **Points Maximization** | 3-10x better value than cash redemption |
| **Time Savings** | Hours of research condensed to minutes |
| **Better Decisions** | Data-driven recommendations |
| **Flexibility** | Multiple options to choose from |

### For Group Travelers

| Benefit | Impact |
|---------|--------|
| **Democratic Planning** | Everyone's voice matters through voting |
| **Fair Cost Splitting** | Transparent, auditable cost allocation |
| **Points Pooling** | Leverage combined points for better deals |
| **Coordinated Booking** | Single source of truth for logistics |
| **Reduced Friction** | No more endless group chat debates |
| **Maximum Savings** | Optimization across all members' resources |

### Example Group Savings

```
Group: 4 friends, NYC to Tokyo + Paris

Without Tripy:
├── Total cash cost: $16,000
├── Points used inefficiently: ~50% waste
└── Coordination time: 20+ hours

With Tripy:
├── Optimized cash: $6,400
├── Points value achieved: 2.5+ cpp average
├── Coordination time: 2 hours
└── Total savings: $9,600 (60%)
```

---

## Summary

**Tripy transforms group trip planning from a logistical nightmare into a streamlined, optimized experience.**

By combining:
- **AI-powered itinerary optimization**
- **Real-time award flight availability** (via AwardTool)
- **Comprehensive cash pricing** (via SerpAPI/Google Flights)
- **Hotel search integration** (via AwardTool & Google Hotels)
- **Collaborative planning tools**
- **Fair cost splitting algorithms**
- **Step-by-step booking guidance**

Tripy enables groups to **travel more while spending less**, turning complex multi-person point redemptions into simple, transparent decisions that maximize value for everyone involved.

---

*Document generated: January 2026*
*Based on Tripy codebase and API documentation analysis*
