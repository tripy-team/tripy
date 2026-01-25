# Tripy Implementation Plan v5.0

## Frontend-Intuitive Integration Guide

### Changelog

| Version | Date | Focus |
|---------|------|-------|
| v1.0 | Jan 2026 | Core backend services and API integration |
| v2.0 | Jan 2026 | Multi-modal transport, autocomplete, chatbot |
| v3.0 | Jan 2026 | Algorithm details - minimize out-of-pocket objective |
| v5.0 | Jan 2026 | **Frontend-intuitive integration** - API contracts, UX patterns, state management |

---

## Executive Summary

This document bridges the gap between backend optimization algorithms and frontend user experience. It provides:

1. **Intuitive API contracts** - Response shapes that map directly to UI components
2. **State management patterns** - How to manage complex trip planning state
3. **UX flow specifications** - Step-by-step user journeys with loading states
4. **Component-to-endpoint mapping** - Which components call which APIs
5. **Error handling patterns** - User-friendly error messages and recovery flows

---

## Table of Contents

1. [Frontend Architecture Patterns](#frontend-architecture-patterns)
2. [API Contract Specifications](#api-contract-specifications)
3. [Trip Planning User Flows](#trip-planning-user-flows)
4. [Component-API Mapping](#component-api-mapping)
5. [State Management Guide](#state-management-guide)
6. [Loading & Error States](#loading--error-states)
7. [Multi-Modal Transport UI](#multi-modal-transport-ui)
8. [Points Optimization Display](#points-optimization-display)
9. [Real-Time Updates](#real-time-updates)
10. [Mobile Responsiveness](#mobile-responsiveness)

---

## Frontend Architecture Patterns

### Recommended Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND DATA ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │         URL State (Router)       │
                    │   tripId, step, view, filters    │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │      Page Components (App Router)│
                    │  /solo/setup, /solo/results, etc │
                    └──────────────┬──────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│   Local State     │  │  Form State       │  │   Server State    │
│   (useState)      │  │  (form inputs)    │  │   (API data)      │
│                   │  │                   │  │                   │
│ • UI toggles      │  │ • Destinations    │  │ • Trip data       │
│ • Modal open      │  │ • Dates           │  │ • Itinerary       │
│ • Selected item   │  │ • Points          │  │ • Members         │
└───────────────────┘  └───────────────────┘  └───────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │        API Client (lib/api.ts)   │
                    │   Token management, error handling│
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │         Backend (FastAPI)        │
                    └─────────────────────────────────┘
```

### State Categories

| State Type | Storage | Example | Persistence |
|------------|---------|---------|-------------|
| **URL State** | `useSearchParams` | `tripId`, `step`, `view` | Shareable, bookmarkable |
| **Form State** | `useState` | Input values, validation | Session only |
| **Server State** | API fetch + `useState` | Trip data, itineraries | Refetch on mount |
| **UI State** | `useState` | Modals, toggles, selections | None |
| **Auth State** | `localStorage` | Tokens, user profile | Persistent |

### Key Principle: Derive, Don't Duplicate

```typescript
// ❌ BAD: Duplicate state
const [trip, setTrip] = useState(null);
const [destinations, setDestinations] = useState([]);
const [startDestination, setStartDestination] = useState(null);

// ✅ GOOD: Derive from single source
const [trip, setTrip] = useState(null);
const destinations = trip?.destinations ?? [];
const startDestination = destinations.find(d => d.isStart);
```

---

## API Contract Specifications

### Design Principles for Frontend-Friendly APIs

1. **Flat response structures** - Avoid deep nesting
2. **Pre-computed values** - Include calculated fields (e.g., `savingsPercentage`)
3. **Display-ready strings** - Include formatted values alongside raw data
4. **Consistent error shapes** - Same error structure across all endpoints
5. **Pagination metadata** - Include counts and cursors

### Core API Response Shapes

#### Trip Response

```typescript
// GET /trips/{tripId} or POST /trips/get
interface TripResponse {
  tripId: string;
  title: string;
  createdBy: string;
  
  // Dates
  startDate: string;           // "2025-03-10"
  endDate: string;             // "2025-03-18"
  displayDateRange: string;    // "Mar 10 - 18, 2025" (pre-formatted)
  durationDays: number;        // 8
  
  // Status
  status: "planning" | "optimizing" | "ready" | "booked";
  inviteCode: string;
  shareUrl: string;            // Full URL for sharing
  
  // Budget
  maxBudget: number | null;
  displayBudget: string;       // "$2,000" or "No limit"
  
  // Options
  includeHotels: boolean;
  includeGroundTransport: boolean;
  transportPreference: "any" | "flight_only" | "train_preferred";
  
  // Counts (for dashboard display)
  memberCount: number;
  destinationCount: number;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}
```

#### Destinations List Response

```typescript
// POST /destinations/list
interface DestinationsResponse {
  tripId: string;
  destinations: Destination[];
  
  // Pre-computed for UI
  startDestination: Destination | null;
  endDestination: Destination | null;
  visitDestinations: Destination[];  // Excludes start/end
  
  // Summary
  totalCount: number;
  includedCount: number;      // Not excluded
  excludedCount: number;
}

interface Destination {
  destinationId: string;
  tripId: string;
  name: string;
  displayName: string;        // "Tokyo (NRT, HND)" or "Paris"
  
  // Flags
  isStart: boolean;
  isEnd: boolean;
  mustInclude: boolean;
  excluded: boolean;
  
  // Resolved data (filled by backend)
  airports: AirportInfo[];    // Resolved airport codes
  cityCode: string | null;    // "TYO", "PAR"
  country: string | null;
  countryCode: string | null;
  
  // Voting (for group trips)
  voteScore: number | null;
  voteRank: number | null;
  
  // Image
  imageUrl: string | null;
  heroImageUrl: string | null;
}

interface AirportInfo {
  iataCode: string;           // "NRT"
  airportName: string;        // "Narita International"
  isPrimary: boolean;         // First/main airport
}
```

#### Points Summary Response

```typescript
// POST /points/summary
interface PointsSummaryResponse {
  tripId: string;
  
  // By user (for group trips)
  byUser: UserPointsSummary[];
  
  // Combined totals
  totals: {
    bankPoints: ProgramBalance[];     // Chase, Amex, etc.
    airlineMiles: ProgramBalance[];   // UA, DL, etc.
    hotelPoints: ProgramBalance[];    // Marriott, Hilton, etc.
    totalValueUSD: number;            // Based on TPG valuations
    displayTotalValue: string;        // "$3,450"
  };
  
  // Transfer recommendations (pre-computed)
  recommendations: TransferRecommendation[];
}

interface UserPointsSummary {
  userId: string;
  userName: string;
  email: string;
  
  programs: ProgramBalance[];
  totalValueUSD: number;
  displayTotalValue: string;
}

interface ProgramBalance {
  program: string;            // "Chase Ultimate Rewards"
  programCode: string;        // "chase"
  balance: number;            // 200000
  displayBalance: string;     // "200,000"
  
  // Valuation
  valuationCPP: number;       // 2.0 (cents per point)
  valueUSD: number;           // 4000
  displayValue: string;       // "$4,000"
  
  // Category
  category: "bank" | "airline" | "hotel";
  
  // Transfer partners (for bank programs)
  transferPartners?: string[];  // ["UA", "BA", "AF"]
}

interface TransferRecommendation {
  fromProgram: string;        // "Chase Ultimate Rewards"
  toProgram: string;          // "United MileagePlus"
  reason: string;             // "Best value for SEA-NRT route"
  potentialSavings: number;
  displaySavings: string;
}
```

#### Itinerary Generation Response

```typescript
// POST /itinerary/generate
interface ItineraryGenerateResponse {
  tripId: string;
  status: "Optimal" | "Suboptimal" | "Infeasible" | "Error";
  
  // Status details
  statusMessage: string;      // User-friendly message
  statusDetails: string[];    // Detailed breakdown
  
  // Solution (when successful)
  solution: ItinerarySolution | null;
  
  // Alternatives (up to 3 options)
  alternatives: ItinerarySolution[];
  
  // Generation metadata
  generatedAt: string;
  generationTimeMs: number;
  
  // Warnings/suggestions
  warnings: Warning[];
  suggestions: Suggestion[];
}

interface ItinerarySolution {
  solutionId: string;
  label: string;              // "Best Value", "Fastest", "Most Points"
  
  // Path visualization
  path: PathCity[];
  
  // Segments (flights, trains, etc.)
  segments: TransportSegment[];
  
  // Cost breakdown
  costs: CostBreakdown;
  
  // Savings comparison
  savings: SavingsBreakdown;
  
  // Points usage
  pointsUsage: PointsUsageBreakdown;
  
  // Transfer instructions (if points used)
  transferInstructions: TransferInstruction[];
}

interface PathCity {
  order: number;
  cityName: string;
  cityCode: string;
  arrivalDate: string | null;
  departureDate: string | null;
  nightsStay: number;
}

interface TransportSegment {
  segmentId: string;
  order: number;
  
  // Route
  origin: string;             // "SEA"
  originName: string;         // "Seattle"
  destination: string;        // "NRT"
  destinationName: string;    // "Tokyo Narita"
  
  // Transport mode
  mode: "flight" | "train" | "bus" | "car" | "ferry";
  modeIcon: string;           // "✈️" | "🚄" | "🚌" | "🚗" | "⛴️"
  modeLabel: string;          // "Flight" | "Train" | etc.
  
  // Operator details
  operator: string;           // "United Airlines" | "Eurostar"
  operatorCode: string;       // "UA" | "EUROSTAR"
  operatorLogo: string | null;
  flightNumber: string | null;
  
  // Timing
  departureTime: string;      // "10:30"
  arrivalTime: string;        // "14:45+1"
  departureDate: string;      // "2025-03-10"
  arrivalDate: string;        // "2025-03-11"
  durationMinutes: number;    // 660
  displayDuration: string;    // "11h 00m"
  
  // Payment method
  paymentMethod: "cash" | "points";
  
  // If cash
  cashCost: number | null;
  displayCashCost: string | null;  // "$850"
  
  // If points
  pointsUsed: number | null;
  pointsProgram: string | null;
  pointsProgramCode: string | null;
  surcharge: number | null;
  displaySurcharge: string | null; // "$50"
  
  // Transfer details (if points from bank)
  transferFrom: string | null;     // "Chase Ultimate Rewards"
  transferFromCode: string | null; // "chase"
  
  // Value metrics
  cashEquivalent: number;          // What this would cost in cash
  displayCashEquivalent: string;
  valuePerPoint: number | null;    // CPP achieved
}

interface CostBreakdown {
  // Cash components
  totalCash: number;
  cashBookings: number;        // Full cash payments
  pointsSurcharges: number;    // Taxes/fees on points bookings
  displayTotalCash: string;
  
  // Points components
  totalPointsUsed: number;
  displayPointsUsed: string;
  pointsValueUsed: number;     // USD value of points
  
  // Total trip value
  totalTripValue: number;      // Cash equivalent of entire trip
  displayTripValue: string;
}

interface SavingsBreakdown {
  // All-cash comparison
  allCashCost: number;
  displayAllCashCost: string;
  
  // Actual out-of-pocket
  outOfPocket: number;
  displayOutOfPocket: string;
  
  // Savings
  cashSaved: number;
  displayCashSaved: string;
  savingsPercentage: number;
  displaySavingsPercentage: string;  // "87%"
  
  // Per-segment breakdown
  segmentSavings: SegmentSaving[];
}

interface SegmentSaving {
  segmentId: string;
  cashPrice: number;
  outOfPocket: number;
  saved: number;
  method: string;              // "Used 70k Chase→United points"
}

interface PointsUsageBreakdown {
  // By program
  byProgram: ProgramUsage[];
  
  // Summary
  totalBankPointsUsed: number;
  totalAirlineMilesUsed: number;
  remainingPoints: ProgramBalance[];
}

interface ProgramUsage {
  program: string;
  programCode: string;
  category: "bank" | "airline";
  
  used: number;
  displayUsed: string;
  
  remaining: number;
  displayRemaining: string;
  
  transferredTo: string | null;  // For bank points
}

interface TransferInstruction {
  order: number;
  
  fromProgram: string;
  fromProgramCode: string;
  toProgram: string;
  toProgramCode: string;
  
  pointsToTransfer: number;
  displayPoints: string;
  
  estimatedTime: string;       // "Instant" | "1-2 days"
  
  instructions: string[];      // Step-by-step
  warningMessage: string | null;
}

interface Warning {
  type: "budget" | "availability" | "timing" | "transfer";
  severity: "info" | "warning" | "error";
  message: string;
  suggestion: string | null;
}

interface Suggestion {
  type: "save_more" | "faster" | "alternative";
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string | null;
}
```

#### Error Response (Consistent Across All Endpoints)

```typescript
// All error responses follow this shape
interface ErrorResponse {
  error: true;
  code: string;               // "INVALID_REQUEST", "NOT_FOUND", etc.
  message: string;            // User-friendly message
  details: string | null;     // Technical details (for debugging)
  
  // For validation errors
  fieldErrors?: FieldError[];
  
  // Recovery suggestions
  suggestions?: string[];
  
  // Retry guidance
  retryable: boolean;
  retryAfterMs?: number;
}

interface FieldError {
  field: string;
  message: string;
}
```

---

## Trip Planning User Flows

### Solo Trip Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SOLO TRIP USER FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

Step 1: /solo/setup
┌─────────────────────────────────────────────────────────────────────────────┐
│  TRIP SETUP                                                                 │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  🤖 Trip Assistant (Chatbot)                                          │ │
│  │  "Describe your trip in natural language..."                          │ │
│  │  [Auto-fills form below]                                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐       │
│  │  📍 Starting From            │  │  📅 Travel Dates             │       │
│  │  [AirportAutocomplete]       │  │  [DateRangePicker]           │       │
│  │  "Seattle (SEA)"             │  │  Mar 10 - Mar 18, 2025       │       │
│  └──────────────────────────────┘  └──────────────────────────────┘       │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  🌍 Destinations to Visit                                             │ │
│  │  [DestinationAutocomplete] + [Add Button]                            │ │
│  │                                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐                                  │ │
│  │  │ 🗼 Tokyo     │  │ ⛩️ Kyoto    │  [+ Add destination]            │ │
│  │  │ NRT, HND     │  │ KIX, ITM    │                                   │ │
│  │  └──────────────┘  └──────────────┘                                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐       │
│  │  💰 Max Budget (Optional)    │  │  🚄 Transport Preference     │       │
│  │  [$ ________]                │  │  [Any / Flights / Trains]    │       │
│  └──────────────────────────────┘  └──────────────────────────────┘       │
│                                                                             │
│                        [Continue to Points →]                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Creates trip, redirects to points
                                   ▼
Step 2: /points-setup?tripId=xxx
┌─────────────────────────────────────────────────────────────────────────────┐
│  YOUR POINTS                                                                │
│                                                                             │
│  Add your credit card points and airline miles:                            │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  💳 Credit Card Points (Can Transfer)                                 │ │
│  │                                                                       │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Chase Ultimate Rewards           [200,000] pts                │  │ │
│  │  │  → Transfers to: United, British Airways, Air France...       │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Amex Membership Rewards          [150,000] pts                │  │ │
│  │  │  → Transfers to: Delta, ANA, Singapore...                     │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                       │ │
│  │  [+ Add Credit Card Program]                                         │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  ✈️ Airline Miles (Use Directly)                                      │ │
│  │                                                                       │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  United MileagePlus               [50,000] miles               │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                       │ │
│  │  [+ Add Airline Program]                                             │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  📊 Total Points Value: $7,250                                        │ │
│  │  Based on The Points Guy valuations                                  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                        [Optimize My Trip →]                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ POST /itinerary/generate
                                   │ Shows loading state
                                   ▼
Step 3: /solo/results?tripId=xxx
┌─────────────────────────────────────────────────────────────────────────────┐
│  YOUR OPTIMIZED ITINERARY                                                   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  💰 SAVINGS SUMMARY                                                   │ │
│  │                                                                       │ │
│  │  All-Cash Price:        $1,850    ████████████████████               │ │
│  │  Your Out-of-Pocket:    $230      ███                                │ │
│  │                         ─────                                         │ │
│  │  You Save:              $1,620 (87%)  🎉                             │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  🗺️ YOUR ROUTE                                                        │ │
│  │                                                                       │ │
│  │  SEA ──✈️──> NRT ──🚄──> KIX ──✈️──> SEA                             │ │
│  │  Mar 10      Mar 11      Mar 14      Mar 18                          │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  SEGMENT 1: Seattle → Tokyo                          Mar 10          │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  ✈️ United Airlines UA123                                       │  │ │
│  │  │  SEA 10:30 → NRT 14:45+1            11h 15m                    │  │ │
│  │  │                                                                │  │ │
│  │  │  💳 Paid with Points                                           │  │ │
│  │  │  70,000 Chase → United miles                                   │  │ │
│  │  │  + $50 taxes/fees                                              │  │ │
│  │  │                                                                │  │ │
│  │  │  Cash price: $850  │  You pay: $50  │  Saved: $800 ✓          │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  SEGMENT 2: Tokyo → Kyoto                            Mar 14          │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  🚄 Shinkansen Nozomi                                          │  │ │
│  │  │  NRT → KIX via Tokyo Station       2h 30m                      │  │ │
│  │  │                                                                │  │ │
│  │  │  💵 Paid with Cash                                             │  │ │
│  │  │  $130                                                          │  │ │
│  │  │                                                                │  │ │
│  │  │  Why train? Cheaper than flight ($130 vs $180)                │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  SEGMENT 3: Kyoto → Seattle                          Mar 18          │ │
│  │  ┌────────────────────────────────────────────────────────────────┐  │ │
│  │  │  ✈️ United Airlines UA456                                       │  │ │
│  │  │  KIX 16:00 → SEA 10:30              10h 30m                    │  │ │
│  │  │                                                                │  │ │
│  │  │  💳 Paid with Points                                           │  │ │
│  │  │  65,000 Chase → United miles                                   │  │ │
│  │  │  + $50 taxes/fees                                              │  │ │
│  │  │                                                                │  │ │
│  │  │  Cash price: $750  │  You pay: $50  │  Saved: $700 ✓          │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  [Compare Options]  [View Transfer Instructions]  [Proceed to Booking →]  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Calls Per Step

| Step | User Action | API Call | Response Used For |
|------|-------------|----------|-------------------|
| 1.1 | Types in chatbot | `POST /extract-trip-info` | Auto-fill form fields |
| 1.2 | Types in airport field | `GET /api/airports/autocomplete?q=...` | Show dropdown |
| 1.3 | Types in destination field | `GET /api/destinations/autocomplete?q=...` | Show dropdown |
| 1.4 | Clicks "Continue" | `POST /trips` | Get tripId, redirect |
| 2.1 | Adds points program | `POST /points/upsert` | Update display |
| 2.2 | Loads page | `GET /points/valuations` | Show CPP values |
| 2.3 | Clicks "Optimize" | `POST /itinerary/generate` | Redirect to results |
| 3.1 | Loads results | `POST /itinerary/get` | Display itinerary |

---

## Component-API Mapping

### Complete Component Reference

```typescript
// Frontend Component → Backend API Mapping

// ═══════════════════════════════════════════════════════════════════════════
// AUTOCOMPLETE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// AirportAutocomplete.tsx
// Used in: Trip setup (origin/return)
// Endpoint: GET /api/airports/autocomplete?q={query}&limit=10
interface AirportAutocompleteProps {
  value: string;
  onChange: (value: string, airports: AirportInfo[]) => void;
  placeholder?: string;
  label?: string;
}

// DestinationAutocomplete.tsx
// Used in: Trip setup (destinations to visit)
// Endpoint: GET /api/destinations/autocomplete?q={query}&limit=10
// Fallback: GET /api/fallback/destinations?q={query}
interface DestinationAutocompleteProps {
  value: string;
  onChange: (destination: Destination) => void;
  excludeIds?: string[];  // Already selected
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIP SETUP COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// TripChatbotInline.tsx
// Used in: Trip setup page header
// Endpoint: POST /extract-trip-info
interface TripChatbotProps {
  onExtract: (info: ExtractedTripInfo) => void;
}

// DateRangePicker.tsx
// Used in: Trip setup
// No API call - local state only
interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (start: Date | null, end: Date | null) => void;
  minDate?: Date;
  maxDate?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// POINTS COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// PointsAllocation.tsx
// Used in: Points setup page
// Endpoints:
//   - GET /points/valuations (on mount)
//   - POST /points/upsert (on add/edit)
//   - POST /points/summary (refresh totals)
interface PointsAllocationProps {
  tripId: string;
  userId: string;
  onComplete: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// ItineraryCard.tsx
// Used in: Results page, comparison page
// No API call - receives data as props
interface ItineraryCardProps {
  solution: ItinerarySolution;
  isSelected?: boolean;
  onSelect?: () => void;
}

// TransportSegment.tsx
// Used in: ItineraryCard
// No API call - receives data as props
interface TransportSegmentProps {
  segment: TransportSegment;
  showDetails?: boolean;
}

// SavingsSummary.tsx
// Used in: Results page header
// No API call - receives data as props
interface SavingsSummaryProps {
  savings: SavingsBreakdown;
  animate?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOKING COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// TransferInstructions.tsx
// Used in: Booking page
// No API call - data included in itinerary response
interface TransferInstructionsProps {
  instructions: TransferInstruction[];
  onStepComplete: (step: number) => void;
}

// RouteSelector.tsx
// Used in: Comparison page
// No API call - receives alternatives as props
interface RouteSelectorProps {
  alternatives: ItinerarySolution[];
  selected: string;  // solutionId
  onSelect: (solutionId: string) => void;
}
```

### API Hooks (Recommended Pattern)

```typescript
// lib/hooks/useTrip.ts
export function useTrip(tripId: string | null) {
  const [trip, setTrip] = useState<TripResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId) return;
    
    setLoading(true);
    api.trips.get(tripId)
      .then(setTrip)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [tripId]);

  return { trip, loading, error, refetch: () => {...} };
}

// lib/hooks/useItinerary.ts
export function useItinerary(tripId: string | null) {
  const [itinerary, setItinerary] = useState<ItineraryGenerateResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!tripId) return;
    
    setGenerating(true);
    setError(null);
    
    try {
      const result = await api.itineraries.generate(tripId);
      setItinerary(result);
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setGenerating(false);
    }
  }, [tripId]);

  const fetch = useCallback(async () => {
    if (!tripId) return;
    
    try {
      const result = await api.itineraries.get(tripId);
      setItinerary(result);
    } catch (e) {
      // No existing itinerary is not an error
      if (e.code !== 'NOT_FOUND') {
        setError(e.message);
      }
    }
  }, [tripId]);

  return { itinerary, generating, error, generate, fetch };
}

// lib/hooks/usePoints.ts
export function usePoints(tripId: string | null) {
  const [summary, setSummary] = useState<PointsSummaryResponse | null>(null);
  const [valuations, setValuations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch valuations once
    api.points.valuations().then(setValuations);
  }, []);

  useEffect(() => {
    if (!tripId) return;
    
    setLoading(true);
    api.points.summary(tripId)
      .then(setSummary)
      .finally(() => setLoading(false));
  }, [tripId]);

  const upsert = useCallback(async (program: string, balance: number) => {
    if (!tripId) return;
    
    await api.points.upsert(tripId, program, balance);
    // Refresh summary
    const updated = await api.points.summary(tripId);
    setSummary(updated);
  }, [tripId]);

  return { summary, valuations, loading, upsert };
}
```

---

## State Management Guide

### Trip Setup State

```typescript
// Recommended state structure for /solo/setup or /group/setup

interface TripSetupState {
  // Form inputs
  origin: {
    name: string;           // Display name: "Seattle (SEA)"
    code: string;           // IATA: "SEA"
    airports: string[];     // All codes: ["SEA"]
  } | null;
  
  destinations: Array<{
    id: string;             // Local ID for reordering
    name: string;
    code: string | null;
    airports: string[];
    isRequired: boolean;
  }>;
  
  dateRange: {
    start: Date | null;
    end: Date | null;
    isFlexible: boolean;
    flexDays: number;       // ±3 days, etc.
  };
  
  budget: {
    enabled: boolean;
    amount: number | null;
  };
  
  options: {
    includeHotels: boolean;
    includeGroundTransport: boolean;
    transportPreference: "any" | "flight_only" | "train_preferred";
  };
  
  // Validation
  errors: Record<string, string>;
  
  // Submission
  isSubmitting: boolean;
}

// Initial state
const initialState: TripSetupState = {
  origin: null,
  destinations: [],
  dateRange: {
    start: null,
    end: null,
    isFlexible: false,
    flexDays: 0,
  },
  budget: {
    enabled: false,
    amount: null,
  },
  options: {
    includeHotels: false,
    includeGroundTransport: true,
    transportPreference: "any",
  },
  errors: {},
  isSubmitting: false,
};
```

### Results Page State

```typescript
// State for /solo/results or /group/results

interface ResultsPageState {
  // Server data
  itinerary: ItineraryGenerateResponse | null;
  
  // Local UI state
  selectedSolutionId: string | null;  // For comparison view
  expandedSegments: Set<string>;      // Which segments are expanded
  
  // View mode
  view: "summary" | "detailed" | "transfer";
  
  // Loading states
  isLoading: boolean;
  isRegenerating: boolean;
  
  // Error state
  error: {
    message: string;
    canRetry: boolean;
  } | null;
}
```

### URL State Synchronization

```typescript
// Pattern for keeping URL in sync with state

// /solo/results?tripId=xxx&view=detailed&solution=abc123

function useResultsUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const tripId = searchParams.get("tripId");
  const view = searchParams.get("view") || "summary";
  const solutionId = searchParams.get("solution");
  
  const setView = (newView: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("view", newView);
    router.push(`?${params.toString()}`);
  };
  
  const setSolution = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("solution", id);
    router.push(`?${params.toString()}`);
  };
  
  return { tripId, view, solutionId, setView, setSolution };
}
```

---

## Loading & Error States

### Loading State Patterns

```typescript
// Different loading patterns for different operations

// 1. Full page loading (initial data fetch)
function ResultsPage() {
  const { itinerary, loading, error } = useItinerary(tripId);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-600">Loading your itinerary...</p>
        </div>
      </div>
    );
  }
  
  // ...
}

// 2. Inline loading (button action)
function GenerateButton({ tripId }: { tripId: string }) {
  const { generate, generating } = useItinerary(tripId);
  
  return (
    <button
      onClick={generate}
      disabled={generating}
      className="btn-primary"
    >
      {generating ? (
        <>
          <Spinner size="sm" className="mr-2" />
          Optimizing your trip...
        </>
      ) : (
        "Optimize My Trip"
      )}
    </button>
  );
}

// 3. Skeleton loading (partial data)
function ItineraryCard({ solutionId }: { solutionId: string }) {
  const { solution, loading } = useSolution(solutionId);
  
  if (loading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-4" />
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    );
  }
  
  // ...
}

// 4. Progress loading (long operations)
function ItineraryGeneration({ tripId }: { tripId: string }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Starting...");
  
  useEffect(() => {
    const steps = [
      { progress: 10, status: "Analyzing your destinations..." },
      { progress: 30, status: "Searching for flights..." },
      { progress: 50, status: "Checking train options..." },
      { progress: 70, status: "Optimizing points usage..." },
      { progress: 90, status: "Finalizing your itinerary..." },
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) {
        setProgress(steps[i].progress);
        setStatus(steps[i].status);
        i++;
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="text-center py-12">
      <div className="w-64 mx-auto mb-4">
        <div className="h-2 bg-gray-200 rounded-full">
          <div
            className="h-2 bg-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <p className="text-gray-600">{status}</p>
    </div>
  );
}
```

### Error State Patterns

```typescript
// User-friendly error messages

const ERROR_MESSAGES: Record<string, { title: string; message: string; action?: string }> = {
  // Network errors
  NETWORK_ERROR: {
    title: "Connection Problem",
    message: "We couldn't reach our servers. Check your internet connection and try again.",
    action: "Retry",
  },
  
  // Auth errors
  UNAUTHORIZED: {
    title: "Session Expired",
    message: "Please log in again to continue.",
    action: "Log In",
  },
  
  // Itinerary errors
  ITINERARY_INFEASIBLE: {
    title: "No Routes Found",
    message: "We couldn't find a way to visit all your destinations within your budget. Try increasing your budget or removing a destination.",
    action: "Adjust Trip",
  },
  
  NO_FLIGHTS_AVAILABLE: {
    title: "No Flights Available",
    message: "We couldn't find any flights for your dates. Try different dates or nearby airports.",
    action: "Change Dates",
  },
  
  INSUFFICIENT_POINTS: {
    title: "Not Enough Points",
    message: "You don't have enough points for this route. Consider adding more points or adjusting your trip.",
    action: "Add Points",
  },
  
  // Generic
  UNKNOWN_ERROR: {
    title: "Something Went Wrong",
    message: "We're having technical difficulties. Please try again in a few minutes.",
    action: "Retry",
  },
};

function ErrorDisplay({ error, onRetry, onAction }: ErrorDisplayProps) {
  const errorInfo = ERROR_MESSAGES[error.code] || ERROR_MESSAGES.UNKNOWN_ERROR;
  
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
      <div className="flex items-start">
        <AlertCircle className="w-6 h-6 text-red-600 mr-3 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-900">{errorInfo.title}</h3>
          <p className="mt-1 text-red-700">{errorInfo.message}</p>
          
          {error.suggestions && (
            <ul className="mt-2 text-sm text-red-600 list-disc list-inside">
              {error.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          
          {errorInfo.action && (
            <button
              onClick={onAction || onRetry}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              {errorInfo.action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Multi-Modal Transport UI

### Transport Mode Display

```tsx
// components/TransportSegment.tsx

const TRANSPORT_MODES = {
  flight: {
    icon: Plane,
    label: "Flight",
    color: "blue",
    bgColor: "bg-blue-50",
    textColor: "text-blue-700",
    borderColor: "border-blue-200",
  },
  train: {
    icon: Train,
    label: "Train",
    color: "green",
    bgColor: "bg-green-50",
    textColor: "text-green-700",
    borderColor: "border-green-200",
  },
  bus: {
    icon: Bus,
    label: "Bus",
    color: "orange",
    bgColor: "bg-orange-50",
    textColor: "text-orange-700",
    borderColor: "border-orange-200",
  },
  car: {
    icon: Car,
    label: "Car",
    color: "purple",
    bgColor: "bg-purple-50",
    textColor: "text-purple-700",
    borderColor: "border-purple-200",
  },
  ferry: {
    icon: Ship,
    label: "Ferry",
    color: "cyan",
    bgColor: "bg-cyan-50",
    textColor: "text-cyan-700",
    borderColor: "border-cyan-200",
  },
};

function TransportSegmentCard({ segment }: { segment: TransportSegment }) {
  const mode = TRANSPORT_MODES[segment.mode];
  const Icon = mode.icon;
  
  return (
    <div className={`rounded-lg border ${mode.borderColor} ${mode.bgColor} p-4`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-full bg-white ${mode.textColor}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <span className={`font-medium ${mode.textColor}`}>{mode.label}</span>
            <span className="text-gray-600 ml-2">{segment.operator}</span>
          </div>
        </div>
        <span className="text-gray-500 text-sm">{segment.displayDuration}</span>
      </div>
      
      {/* Route */}
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <div className="font-bold text-lg">{segment.origin}</div>
          <div className="text-sm text-gray-500">{segment.departureTime}</div>
        </div>
        
        <div className="flex-1 flex items-center">
          <div className="flex-1 border-t-2 border-dashed border-gray-300" />
          <Icon className={`w-4 h-4 mx-2 ${mode.textColor}`} />
          <div className="flex-1 border-t-2 border-dashed border-gray-300" />
        </div>
        
        <div className="text-center">
          <div className="font-bold text-lg">{segment.destination}</div>
          <div className="text-sm text-gray-500">{segment.arrivalTime}</div>
        </div>
      </div>
      
      {/* Payment info */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-200">
        {segment.paymentMethod === "points" ? (
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-purple-600" />
            <span className="text-sm">
              {segment.displayPointsUsed} {segment.pointsProgram} + {segment.displaySurcharge}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            <span className="text-sm">{segment.displayCashCost} cash</span>
          </div>
        )}
        
        <div className="text-sm text-gray-500">
          vs {segment.displayCashEquivalent} all-cash
        </div>
      </div>
      
      {/* Why this mode? (for non-flights) */}
      {segment.mode !== "flight" && (
        <div className="mt-3 text-sm text-gray-600 bg-white rounded p-2">
          💡 {getWhyMessage(segment)}
        </div>
      )}
    </div>
  );
}

function getWhyMessage(segment: TransportSegment): string {
  if (segment.mode === "train") {
    return `Train selected: ${segment.displayCashCost} vs flight alternative. Often faster city-center to city-center.`;
  }
  if (segment.mode === "bus") {
    return `Bus selected: Budget-friendly at ${segment.displayCashCost}. Takes longer but saves money.`;
  }
  return "";
}
```

### Transport Preference Selector

```tsx
// components/TransportPreferenceSelector.tsx

function TransportPreferenceSelector({
  value,
  onChange,
}: {
  value: "any" | "flight_only" | "train_preferred";
  onChange: (value: string) => void;
}) {
  const options = [
    {
      value: "any",
      label: "Any",
      description: "Optimize for cost across all transport",
      icon: Shuffle,
    },
    {
      value: "flight_only",
      label: "Flights Only",
      description: "Only consider flights",
      icon: Plane,
    },
    {
      value: "train_preferred",
      label: "Prefer Trains",
      description: "Use trains when practical",
      icon: Train,
    },
  ];
  
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Transport Preference
      </label>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;
          
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`
                p-3 rounded-lg border-2 text-left transition-all
                ${isSelected
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
                }
              `}
            >
              <Icon className={`w-5 h-5 mb-1 ${isSelected ? "text-blue-600" : "text-gray-400"}`} />
              <div className={`font-medium ${isSelected ? "text-blue-900" : "text-gray-900"}`}>
                {option.label}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

---

## Points Optimization Display

### Savings Visualization

```tsx
// components/SavingsBreakdown.tsx

function SavingsBreakdown({ savings }: { savings: SavingsBreakdown }) {
  const percentage = Math.round(savings.savingsPercentage);
  
  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
      <h3 className="text-lg font-semibold text-green-900 mb-4">
        💰 Your Savings
      </h3>
      
      {/* Visual comparison */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-4">
          <span className="w-32 text-sm text-gray-600">All Cash:</span>
          <div className="flex-1 h-6 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-gray-400 rounded-full" style={{ width: "100%" }} />
          </div>
          <span className="w-24 text-right font-medium">{savings.displayAllCashCost}</span>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="w-32 text-sm text-gray-600">You Pay:</span>
          <div className="flex-1 h-6 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-1000"
              style={{ width: `${100 - percentage}%` }}
            />
          </div>
          <span className="w-24 text-right font-bold text-green-700">
            {savings.displayOutOfPocket}
          </span>
        </div>
      </div>
      
      {/* Savings callout */}
      <div className="bg-white rounded-lg p-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-600">You Save</div>
          <div className="text-2xl font-bold text-green-700">{savings.displayCashSaved}</div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-green-600">{percentage}%</div>
          <div className="text-sm text-gray-500">savings</div>
        </div>
      </div>
    </div>
  );
}
```

### Points Usage Visualization

```tsx
// components/PointsUsageChart.tsx

function PointsUsageChart({ usage }: { usage: PointsUsageBreakdown }) {
  return (
    <div className="bg-white rounded-xl p-6 border">
      <h3 className="text-lg font-semibold mb-4">Points Used</h3>
      
      <div className="space-y-4">
        {usage.byProgram.map((program) => {
          const total = program.used + program.remaining;
          const usedPercent = total > 0 ? (program.used / total) * 100 : 0;
          
          return (
            <div key={program.programCode} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{program.program}</span>
                <span className="text-gray-500">
                  {program.displayUsed} / {program.displayRemaining} remaining
                </span>
              </div>
              
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    program.category === "bank" ? "bg-purple-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
              
              {program.transferredTo && (
                <div className="text-xs text-gray-500">
                  → Transferred to {program.transferredTo}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Transfer Instructions UI

```tsx
// components/TransferInstructions.tsx

function TransferInstructions({
  instructions,
  onComplete,
}: {
  instructions: TransferInstruction[];
  onComplete: (step: number) => void;
}) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  
  const markComplete = (order: number) => {
    setCompletedSteps((prev) => new Set([...prev, order]));
    onComplete(order);
  };
  
  return (
    <div className="bg-white rounded-xl border divide-y">
      <div className="p-4">
        <h3 className="font-semibold flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-purple-600" />
          Transfer Instructions
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Complete these transfers to book your trip with points
        </p>
      </div>
      
      {instructions.map((instruction) => {
        const isComplete = completedSteps.has(instruction.order);
        
        return (
          <div
            key={instruction.order}
            className={`p-4 ${isComplete ? "bg-green-50" : ""}`}
          >
            <div className="flex items-start gap-4">
              {/* Step number */}
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                  ${isComplete
                    ? "bg-green-500 text-white"
                    : "bg-gray-100 text-gray-600"
                  }
                `}
              >
                {isComplete ? <Check className="w-5 h-5" /> : instruction.order}
              </div>
              
              {/* Content */}
              <div className="flex-1">
                <div className="font-medium">
                  Transfer {instruction.displayPoints} points
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {instruction.fromProgram} → {instruction.toProgram}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  ⏱️ {instruction.estimatedTime}
                </div>
                
                {/* Step-by-step instructions */}
                <ol className="mt-3 space-y-1 text-sm text-gray-600">
                  {instruction.instructions.map((step, i) => (
                    <li key={i}>{i + 1}. {step}</li>
                  ))}
                </ol>
                
                {instruction.warningMessage && (
                  <div className="mt-2 text-sm text-amber-600 bg-amber-50 p-2 rounded">
                    ⚠️ {instruction.warningMessage}
                  </div>
                )}
                
                {!isComplete && (
                  <button
                    onClick={() => markComplete(instruction.order)}
                    className="mt-3 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Mark as complete
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

---

## Real-Time Updates

### Polling Pattern for Long Operations

```typescript
// lib/hooks/useItineraryGeneration.ts

export function useItineraryGeneration(tripId: string) {
  const [status, setStatus] = useState<"idle" | "generating" | "complete" | "error">("idle");
  const [result, setResult] = useState<ItineraryGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  
  const generate = useCallback(async () => {
    setStatus("generating");
    setProgress(0);
    setError(null);
    
    try {
      // Start generation
      const response = await api.itineraries.generate(tripId);
      
      // If it's a long-running operation, poll for status
      if (response.status === "processing") {
        await pollForCompletion(tripId, setProgress);
      }
      
      // Get final result
      const final = await api.itineraries.get(tripId);
      setResult(final);
      setStatus("complete");
      
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }, [tripId]);
  
  return { status, result, error, progress, generate };
}

async function pollForCompletion(
  tripId: string,
  onProgress: (p: number) => void
): Promise<void> {
  const maxAttempts = 30;  // 30 seconds max
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    await sleep(1000);
    attempts++;
    
    const status = await api.itineraries.status(tripId);
    onProgress(status.progress || (attempts / maxAttempts) * 100);
    
    if (status.complete) {
      return;
    }
    
    if (status.error) {
      throw new Error(status.error);
    }
  }
  
  throw new Error("Generation timed out");
}
```

---

## Mobile Responsiveness

### Responsive Component Patterns

```tsx
// Responsive itinerary view

function ItineraryView({ solution }: { solution: ItinerarySolution }) {
  return (
    <div className="space-y-4">
      {/* Summary - stacks on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          title="Out of Pocket"
          value={solution.costs.displayTotalCash}
          icon={DollarSign}
        />
        <SummaryCard
          title="Points Used"
          value={solution.costs.displayPointsUsed}
          icon={CreditCard}
        />
        <SummaryCard
          title="Savings"
          value={solution.savings.displaySavingsPercentage}
          icon={TrendingDown}
          highlight
        />
      </div>
      
      {/* Path visualization - horizontal on desktop, vertical on mobile */}
      <div className="hidden md:block">
        <HorizontalPathView cities={solution.path} />
      </div>
      <div className="md:hidden">
        <VerticalPathView cities={solution.path} />
      </div>
      
      {/* Segments - full width on mobile */}
      <div className="space-y-3 md:space-y-4">
        {solution.segments.map((segment) => (
          <TransportSegmentCard
            key={segment.segmentId}
            segment={segment}
            compact={/* mobile view */ true}
          />
        ))}
      </div>
    </div>
  );
}

// Mobile path view (vertical timeline)
function VerticalPathView({ cities }: { cities: PathCity[] }) {
  return (
    <div className="relative pl-8">
      {/* Vertical line */}
      <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-200" />
      
      {cities.map((city, i) => (
        <div key={city.order} className="relative pb-6 last:pb-0">
          {/* Dot */}
          <div className={`
            absolute left-0 w-6 h-6 rounded-full flex items-center justify-center
            ${i === 0 || i === cities.length - 1
              ? "bg-blue-600 text-white"
              : "bg-white border-2 border-gray-300"
            }
          `}>
            {i === 0 && <MapPin className="w-3 h-3" />}
            {i === cities.length - 1 && <Flag className="w-3 h-3" />}
          </div>
          
          {/* Content */}
          <div className="ml-4">
            <div className="font-medium">{city.cityName}</div>
            <div className="text-sm text-gray-500">
              {city.arrivalDate && `Arrive: ${city.arrivalDate}`}
              {city.nightsStay > 0 && ` • ${city.nightsStay} nights`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Backend Changes Required

### New/Modified Endpoints

| Endpoint | Change | Purpose |
|----------|--------|---------|
| `POST /itinerary/generate` | Add `displayXxx` fields | Pre-formatted strings |
| `POST /itinerary/generate` | Add `alternatives` array | Multiple solutions |
| `POST /destinations/list` | Add `startDestination`, `endDestination` | Computed fields |
| `POST /points/summary` | Add `recommendations` | Transfer suggestions |
| `GET /api/airports/autocomplete` | Add `cityCode`, `country` | Richer data |

### Response Shape Guidelines

1. **Always include display-ready strings**
   ```python
   response = {
       "totalCash": 230.0,
       "displayTotalCash": "$230",  # ← Pre-formatted
   }
   ```

2. **Include computed/derived fields**
   ```python
   response = {
       "destinations": [...],
       "startDestination": next((d for d in destinations if d.isStart), None),  # ← Computed
   }
   ```

3. **Use consistent error format**
   ```python
   raise HTTPException(
       status_code=400,
       detail={
           "error": True,
           "code": "INVALID_DATES",
           "message": "End date must be after start date",
           "suggestions": ["Try adjusting your dates"],
           "retryable": False,
       }
   )
   ```

---

## Summary

### Key Frontend-Intuitive Principles

1. **Pre-compute on backend** - Include display strings, derived fields
2. **Flat response shapes** - Avoid deep nesting
3. **Consistent patterns** - Same error shape, same loading patterns
4. **URL-driven state** - Make trips shareable/bookmarkable
5. **Progressive disclosure** - Show summary first, details on expand
6. **Clear transport modes** - Visual distinction between flight/train/bus
7. **Savings focus** - Always show what user is saving

### Implementation Priority

| Priority | Feature | Impact |
|----------|---------|--------|
| High | Pre-formatted display fields | Reduces frontend complexity |
| High | Consistent error handling | Better UX |
| High | Transport mode icons/labels | Clear multi-modal display |
| Medium | Transfer instructions UI | Helps users complete bookings |
| Medium | Progress indicators | Better long-operation UX |
| Low | Real-time polling | Advanced feature |

---

*Document Version: 5.0*
*Last Updated: January 2026*
*Focus: Frontend-Intuitive Integration*
