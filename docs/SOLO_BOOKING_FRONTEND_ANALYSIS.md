# Solo Booking Trip Functionality - Frontend Analysis

## Overview

This document details every component of the solo booking trip functionality in the frontend, its connections to backend APIs, and identifies gaps in the frontend-backend integration.

---

## Table of Contents

1. [Frontend Pages](#1-frontend-pages)
2. [API Client Connections](#2-api-client-connections)
3. [Components Used](#3-components-used)
4. [Data Flow](#4-data-flow)
5. [Missing Connections & Gaps](#5-missing-connections--gaps)
6. [Backend Endpoints Available But Not Used](#6-backend-endpoints-available-but-not-used)
7. [Recommendations](#7-recommendations)

---

## 1. Frontend Pages

### 1.1 Solo Setup Page (`/solo/setup`)

**File:** `frontend/src/app/(app)/solo/setup/page.tsx`

**Purpose:** Configure all trip parameters before itinerary generation.

#### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `adults` | `number` | Number of adult travelers (default: 1) |
| `children` | `number` | Number of children (default: 0) |
| `maxBudget` | `number \| ''` | Maximum budget in dollars |
| `creditCards` | `CreditCardEntry[]` | User's credit cards with points |
| `pointsToUse` | `Record<string, number>` | Points allocated per program |
| `isFlexible` | `boolean` | Whether dates are flexible |
| `startDate` | `string` | Trip start date |
| `endDate` | `string` | Trip end date |
| `isOneWay` | `boolean` | One-way trip flag |
| `flexibleDuration` | `number` | Duration in days when flexible (default: 7) |
| `cities` | `string[]` | Destination cities to visit |
| `startDestination` | `string` | Starting airport (IATA code) |
| `endDestination` | `string` | Ending airport (IATA code) |
| `isRoundTrip` | `boolean` | Round trip flag |
| `flightClass` | `string` | Flight cabin class |
| `hotelClass` | `string` | Hotel star rating |
| `includeHotels` | `boolean` | Include hotels in optimization |
| `bags` | `number` | Number of checked bags |
| `optimizationMode` | `'oop' \| 'cpp' \| 'balanced'` | Optimization strategy |
| `departureTimePreference` | `string` | Preferred departure time |
| `arrivalTimePreference` | `string` | Preferred arrival time |

#### Backend API Calls

| Function | API Endpoint | Purpose |
|----------|--------------|---------|
| `usersAPI.getProfile()` | `GET /users/me` | Load user profile (credit cards) |
| `usersAPI.updateProfile()` | `PUT /users/profile` | Save credit cards |
| `createTrip()` | `POST /trips` | Create new trip |
| `addDestination()` | `POST /destinations/add` | Add destinations to trip |
| `upsertPoints()` | `POST /points/upsert` | Add user's points to trip |

#### Data NOT Sent to Backend (Gaps)

- `adults`, `children` - Party size NOT saved
- `bags` - Checked bags NOT saved
- `optimizationMode` - NOT sent to backend
- `departureTimePreference`, `arrivalTimePreference` - NOT sent
- `flightClass`, `hotelClass` - NOT sent in trip creation

---

### 1.2 Solo Results Page (`/solo/results`)

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

**Purpose:** Display optimized itinerary options after generation.

#### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `itineraries` | `Itinerary[]` | Generated itinerary options |
| `selectedId` | `number \| null` | Currently selected itinerary |
| `comparing` | `number[]` | Itineraries marked for comparison |
| `aiSuggestions` | `AIRouteSuggestion[]` | AI suggestions for remote destinations |
| `outOfPocket` | `OutOfPocketData \| null` | OOP calculation results |
| `userConstraints` | `object` | User's budget/points constraints |
| `relaxedMessage` | `string \| null` | Message when constraints relaxed |
| `budgetWarning` | `object \| null` | Warning when budget too low |
| `optimizationWarning` | `string \| null` | Warning from optimizer |

#### Backend API Calls

| Function | API Endpoint | Purpose |
|----------|--------------|---------|
| `itinerariesAPI.get(tripId)` | `POST /itinerary/get` | Fetch saved itinerary |
| `itinerariesAPI.generate(tripId)` | `POST /itinerary/generate` | Generate itinerary |
| `tripsAPI.get(tripId)` | `POST /trips/get` | Get trip details |
| `pointsAPI.summary(tripId)` | `POST /points/summary` | Get points summary |
| `destinations.list(tripId)` | `POST /destinations/list` | Get destination list |

#### Data Flow Issues

- Itinerary generation happens automatically if no existing items
- No explicit trigger for optimization mode selection
- `withinBudget` and `withinPoints` flags come from backend but aren't always consistent

---

### 1.3 Solo Comparison Page (`/solo/comparison`)

**File:** `frontend/src/app/(app)/solo/comparison/page.tsx`

**Purpose:** Side-by-side comparison of multiple itinerary options.

#### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `itineraries` | `Itinerary[]` | Itineraries to compare |
| `isLoading` | `boolean` | Loading state |

#### Backend API Calls

| Function | API Endpoint | Purpose |
|----------|--------------|---------|
| `itinerariesAPI.get(tripId)` | `POST /itinerary/get` | Fetch itineraries |

#### Missing Functionality

- Cannot compare specific itineraries (no selection passed from results)
- All itineraries fetched and displayed (no filtering by selected)
- No backend support for saving comparison selections

---

### 1.4 Solo Booking Page (`/solo/booking`)

**File:** `frontend/src/app/(app)/solo/booking/page.tsx`

**Purpose:** Display booking instructions, transfer steps, and handle payment.

#### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `isPaid` | `boolean` | Payment completed flag |
| `isProcessing` | `boolean` | Payment processing state |
| `trip` | `object` | Trip details |
| `items` | `Record[]` | Itinerary items |
| `expandedFlightIdx` | `number \| null` | Expanded flight card |

#### Backend API Calls

| Function | API Endpoint | Purpose |
|----------|--------------|---------|
| `itinerariesAPI.get(tripId)` | `POST /itinerary/get` | Fetch itinerary |
| `tripsAPI.get(tripId)` | `POST /trips/get` | Get trip details |
| `destinationsAPI.list(tripId)` | `POST /destinations/list` | Get destinations |
| `generateItinerary(tripId)` | `POST /itinerary/generate` | Regenerate on payment |

#### Display Features

- Transfer Instructions (blurred until paid)
- Flight segments with booking details
- Hotel bookings (if included)
- Out-of-pocket summary
- Service fee calculation

#### Missing Backend Connections

- No actual payment processing (mock only)
- No endpoint to mark trip as "paid"
- No endpoint to save booking confirmation
- Transfer instructions built client-side, not from backend

---

## 2. API Client Connections

### 2.1 Trips API (`/lib/api.ts`)

```
Frontend                     Backend Endpoint
---------                    ----------------
trips.create()         →     POST /trips
trips.get()            →     POST /trips/get
trips.list()           →     GET /trips
trips.delete()         →     POST /trips/delete
trips.join()           →     POST /trips/join
trips.invite()         →     POST /trips/invite
trips.listMembers()    →     POST /trips/members
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ✅ Create, Get

---

### 2.2 Destinations API

```
Frontend                     Backend Endpoint
---------                    ----------------
destinations.add()     →     POST /destinations/add
destinations.list()    →     POST /destinations/list
destinations.autocomplete() → (Next.js route handler)
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ✅ Add (start, end, intermediates)

---

### 2.3 Points API

```
Frontend                     Backend Endpoint
---------                    ----------------
points.upsert()        →     POST /points/upsert
points.summary()       →     POST /points/summary
points.valuations()    →     GET /points/valuations
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ✅ Upsert, Summary

---

### 2.4 Itineraries API

```
Frontend                     Backend Endpoint
---------                    ----------------
itineraries.generate() →     POST /itinerary/generate
itineraries.get()      →     POST /itinerary/get
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ✅ Generate, Get

---

### 2.5 Optimization API (Agentic)

```
Frontend                     Backend Endpoint
---------                    ----------------
optimization.solo()    →     POST /optimize/solo
optimization.group()   →     POST /optimize/group
optimization.getCostBreakdown() → GET /optimize/breakdown/{id}
optimization.compareStrategies() → GET /optimize/compare/{tripId}
optimization.dynamicRoute() → POST /optimize/dynamic-route
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ❌ NOT USED (available but not wired)

---

### 2.6 Hotels API

```
Frontend                     Backend Endpoint
---------                    ----------------
hotels.search()        →     POST /hotels/search
```

**Connected:** ✅ Yes  
**Used in Solo Flow:** ❌ NOT USED in setup

---

## 3. Components Used

### 3.1 UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `TripChatbotInline` | `components/trip-chatbot-inline.tsx` | Natural language trip extraction (imported but not rendered in current code) |
| `PointsAllocation` | `components/PointsAllocation.tsx` | Allocate points across programs |
| `DestinationAutocomplete` | `components/ui/DestinationAutocomplete.tsx` | City search autocomplete |
| `AirportAutocomplete` | `components/ui/AirportAutocomplete.tsx` | Airport search autocomplete |
| `DateRangePicker` | `components/date-range-picker.tsx` | Date selection |

### 3.2 Utility Functions

| Function | File | Purpose |
|----------|------|---------|
| `searchAndFormatAirport()` | `lib/airport-formatter.ts` | Format airport codes |
| `searchAndFormatCities()` | `lib/city-formatter.ts` | Format city names |
| `formatAirportDisplay()` | `lib/airport-formatter.ts` | Display airport with city |
| `getCityMapForCodes()` | `lib/airport-formatter.ts` | Map IATA codes to cities |
| `calculateServiceFee()` | `lib/utils.ts` | Calculate service fee |
| `formatDate()` | `lib/utils.ts` | Format dates |
| `tripDurationDays()` | `lib/utils.ts` | Calculate trip duration |

---

## 4. Data Flow

### 4.1 Complete Solo Trip Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SOLO SETUP PAGE                          │
├─────────────────────────────────────────────────────────────────┤
│ 1. Load user profile (credit cards)   → GET /users/me           │
│ 2. User fills form (dates, cities, budget, points, etc.)        │
│ 3. Click "Generate Itineraries"                                 │
│    ├─→ POST /trips (create trip)                                │
│    ├─→ POST /destinations/add (start destination)               │
│    ├─→ POST /destinations/add (end destination)                 │
│    ├─→ POST /destinations/add (each city)                       │
│    └─→ POST /points/upsert (each credit card)                   │
│ 4. Navigate to /solo/results?trip_id=xxx                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SOLO RESULTS PAGE                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch existing itinerary         → POST /itinerary/get       │
│ 2. Fetch trip details               → POST /trips/get           │
│ 3. Fetch points summary             → POST /points/summary      │
│ 4. If no itinerary exists:                                      │
│    └─→ POST /itinerary/generate (triggers optimization)         │
│ 5. Display ranked itineraries                                   │
│ 6. User selects & clicks "Book This Trip"                       │
│ 7. Navigate to /solo/booking?trip_id=xxx                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SOLO BOOKING PAGE                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch itinerary items            → POST /itinerary/get       │
│ 2. Fetch trip details               → POST /trips/get           │
│ 3. Fetch destinations               → POST /destinations/list   │
│ 4. Parse payment records (client-side)                          │
│ 5. Build transfer instructions (client-side)                    │
│ 6. Display booking details (blurred)                            │
│ 7. User clicks "Pay & Reveal"                                   │
│    └─→ POST /itinerary/generate (re-generate)                   │
│    └─→ Mock payment (2s delay)                                  │
│ 8. Reveal transfer instructions                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Missing Connections & Gaps

### 5.1 Setup Page Gaps

| Data | Collected | Sent to Backend | Status |
|------|-----------|-----------------|--------|
| Adults count | ✅ | ❌ | **MISSING** |
| Children count | ✅ | ❌ | **MISSING** |
| Checked bags | ✅ | ❌ | **MISSING** |
| Flight class | ✅ | ❌ | **MISSING** |
| Hotel class | ✅ | ❌ | **MISSING** |
| Include hotels | ✅ | ✅ (only flag) | Partial |
| Optimization mode | ✅ | ❌ | **MISSING** |
| Departure time pref | ✅ | ❌ | **MISSING** |
| Arrival time pref | ✅ | ❌ | **MISSING** |
| Flexible dates flag | ✅ | ❌ (only duration_days) | Partial |

### 5.2 Results Page Gaps

| Feature | Frontend | Backend Support | Status |
|---------|----------|-----------------|--------|
| OOP optimization | Shows results | ✅ Available | ⚠️ Uses legacy endpoint |
| CPP optimization | Mode selector exists | ✅ Available | ❌ Not triggered |
| Dynamic route | Not used | ✅ Available | ❌ Not connected |
| Hotel optimization | Not used | ✅ Available | ❌ Not connected |
| Cost breakdown | Not used | ✅ Available | ❌ Not connected |

### 5.3 Booking Page Gaps

| Feature | Frontend | Backend Support | Status |
|---------|----------|-----------------|--------|
| Payment processing | Mock only | ❌ None | **MISSING** |
| Booking confirmation | Not saved | ❌ None | **MISSING** |
| Transfer instructions | Built client-side | ✅ `/api/transfer-strategy` | ❌ Not connected |
| Trip status update | Not implemented | ❌ No endpoint | **MISSING** |
| Receipt generation | UI only | ❌ None | **MISSING** |
| Email confirmation | Not implemented | ❌ None | **MISSING** |

### 5.4 Overall Flow Gaps

1. **No itinerary selection persistence** - Selected itinerary not saved to backend
2. **No booking state management** - No way to mark trip as "booked"
3. **No payment integration** - Stripe/payment gateway not connected
4. **No booking history** - Cannot view past bookings
5. **No cancellation flow** - No way to cancel a booking

---

## 6. Backend Endpoints Available But Not Used

### 6.1 Optimization Endpoints (Agentic ILP System)

| Endpoint | Purpose | Frontend Usage |
|----------|---------|----------------|
| `POST /optimize/solo` | Solo trip ILP optimization | ❌ Not used |
| `POST /optimize/group` | Group trip optimization | ❌ N/A for solo |
| `GET /optimize/breakdown/{id}` | Detailed cost breakdown | ❌ Not used |
| `GET /optimize/compare/{tripId}` | Compare OOP vs CPP | ❌ Not used |
| `POST /optimize/dynamic-route` | Multi-city route optimization | ❌ Not used |

### 6.2 Hotel Endpoints

| Endpoint | Purpose | Frontend Usage |
|----------|---------|----------------|
| `POST /hotels/search` | Search hotels | ❌ Not used |
| `POST /hotels/optimize-out-of-pocket` | Hotel OOP optimization | ❌ Not used |
| `POST /hotels/calendar` | Hotel availability calendar | ❌ Not used |
| `POST /hotels/best-nights` | Find best consecutive nights | ❌ Not used |

### 6.3 Transfer Strategy Endpoints

| Endpoint | Purpose | Frontend Usage |
|----------|---------|----------------|
| `POST /api/transfer-strategy/optimize` | Optimize point transfers | ❌ Not used |
| `POST /api/transfer-strategy/simulate` | Simulate transfer allocation | ❌ Not used |
| `GET /api/transfer-partners` | Get transfer partner info | ❌ Not used |

### 6.4 Flight Endpoints (via Itinerary)

| Endpoint | Purpose | Frontend Usage |
|----------|---------|----------------|
| `POST /api/itinerary/optimize-out-of-pocket` | Flight OOP optimization | ❌ Direct call not used |

---

## 7. Recommendations

### 7.1 High Priority (Critical Gaps)

1. **Send all preferences to backend**
   - Modify `POST /trips` to accept: `adults`, `children`, `bags`, `flight_class`, `hotel_class`
   - Add optimization_mode, time preferences

2. **Connect to agentic optimization**
   - Replace `itineraries.generate()` with `optimization.solo()`
   - Use `optimization.compareStrategies()` for mode selection
   - Use `optimization.getCostBreakdown()` for booking page

3. **Implement payment flow**
   - Add Stripe or payment gateway integration
   - Create `POST /trips/{id}/payment` endpoint
   - Add `POST /trips/{id}/confirm-booking` endpoint

### 7.2 Medium Priority (Enhanced Features)

4. **Use dynamic route optimization**
   - Connect `/optimize/dynamic-route` for multi-city trips
   - Display route comparison UI

5. **Use transfer strategy API**
   - Replace client-side transfer logic with `/api/transfer-strategy/optimize`
   - Display optimized transfer order

6. **Add hotel integration**
   - Connect `hotels.search()` when `includeHotels` is true
   - Use `hotels/optimize-out-of-pocket` for hotel selection

### 7.3 Lower Priority (Polish)

7. **Add booking history**
   - Create endpoint to list user's booked trips
   - Add "My Bookings" page

8. **Add cancellation flow**
   - Create `POST /trips/{id}/cancel` endpoint
   - Add cancellation UI

9. **Add email notifications**
   - Send booking confirmation email
   - Send transfer reminders

---

## Appendix: File Reference

### Frontend Files

```
frontend/src/
├── app/(app)/solo/
│   ├── setup/page.tsx      # Trip configuration
│   ├── results/page.tsx    # Itinerary results
│   ├── comparison/page.tsx # Side-by-side comparison
│   └── booking/page.tsx    # Booking & payment
├── lib/
│   ├── api.ts              # API client
│   ├── airport-formatter.ts
│   ├── city-formatter.ts
│   └── utils.ts
├── components/
│   ├── PointsAllocation.tsx
│   └── ui/
│       ├── AirportAutocomplete.tsx
│       └── DestinationAutocomplete.tsx
└── types/
    └── optimization.ts
```

### Backend Files (Referenced)

```
backend/src/
├── app.py                   # API endpoints
├── handlers/
│   ├── solo_trip/          # Solo trip orchestration
│   │   ├── orchestrator.py
│   │   ├── flight_searcher.py
│   │   └── route_graph_builder.py
│   ├── ilp_adapter.py      # ILP optimization
│   ├── min_oop_optimizer.py
│   └── transfer_strategy.py
├── services/
│   ├── trip_service.py
│   ├── itinerary_service.py
│   └── points_service.py
└── optimization/
    ├── pipeline.py
    └── solver_v3.py
```

---

*Document generated: 2026-01-31*
