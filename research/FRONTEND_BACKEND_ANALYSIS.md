# Tripy Frontend & Backend Analysis

## Executive Summary

Tripy is a full-stack travel planning application that optimizes award travel using loyalty points. The frontend is built with Next.js 15 (App Router) and React 19, while the backend is a FastAPI application with ILP-based optimization. The system integrates with multiple external APIs (Amadeus, SerpAPI, AwardTool, OpenAI) and uses AWS services (Cognito, DynamoDB, S3/CloudFront) for authentication, data storage, and content delivery.

---

## Table of Contents

1. [Frontend Architecture](#frontend-architecture)
2. [Frontend Features & Pages](#frontend-features--pages)
3. [Backend Architecture](#backend-architecture)
4. [API Endpoints](#api-endpoints)
5. [Frontend-Backend Communication](#frontend-backend-communication)
6. [Authentication Flow](#authentication-flow)
7. [Data Models](#data-models)
8. [External Integrations](#external-integrations)
9. [Feature Deep Dives](#feature-deep-dives)

---

## Frontend Architecture

### Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15.5.9 | React framework with App Router |
| React | 19.0.0 | UI library |
| TypeScript | 5.9.2 | Type safety |
| Tailwind CSS | 4.1.11 | Styling |
| Radix UI | - | Accessible UI primitives |
| React Leaflet | - | Map components |
| Lucide React | - | Icons |
| Playwright | - | E2E testing |

### Project Structure

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (app)/              # Protected app routes (require auth)
│   │   ├── (auth)/             # Authentication routes
│   │   ├── (legal)/            # Legal pages (privacy, terms)
│   │   ├── api/                # Next.js API route handlers (proxies)
│   │   └── page.tsx            # Landing page
│   ├── components/             # React components
│   │   └── ui/                 # Reusable UI components
│   ├── lib/                    # Utilities & helpers
│   │   ├── api.ts              # Centralized API client
│   │   ├── utils.ts            # Validation, formatting
│   │   ├── loyalty-programs.ts # Loyalty program definitions
│   │   └── ...                 # Other utilities
│   └── types.ts                # TypeScript type definitions
├── public/                     # Static assets
└── e2e/                        # Playwright E2E tests
```

### State Management Approach

The frontend uses a **no-framework approach** to state management:

| Method | Use Case |
|--------|----------|
| `useState` | Local component state |
| `useSearchParams` | URL-based shareable state (trip IDs, filters) |
| `localStorage` | User data, tokens, preferences |
| `sessionStorage` | Auth check flags |
| Custom Events | `tripy_auth_change` for cross-component auth updates |

### Key Environment Variables

```env
NEXT_PUBLIC_BACKEND_URL      # Backend API URL (default: http://localhost:8000)
NEXT_PUBLIC_CDN_DOMAIN       # CDN domain for images
NEXT_PUBLIC_S3_BUCKET        # S3 bucket for images
NEXT_PUBLIC_AWS_REGION       # AWS region
```

---

## Frontend Features & Pages

### Route Structure

The frontend uses Next.js App Router with **route groups**:

- `(app)` — Protected routes requiring authentication
- `(auth)` — Authentication pages
- `(legal)` — Legal/static pages

### Complete Page List

#### Public Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page (redirects to dashboard if logged in) |
| `/about` | About Tripy |
| `/contact` | Contact page |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |

#### Authentication Routes

| Route | Description |
|-------|-------------|
| `/login` | User login |
| `/register` | User registration |
| `/forgot-password` | Password reset initiation |
| `/auth/confirm-signup` | Email verification |

#### Protected Routes - Dashboard & Navigation

| Route | Description |
|-------|-------------|
| `/dashboard` | Main dashboard with trip overview |
| `/my-trips` | All trips list |
| `/explore` | Explore destinations |
| `/join` | Join a trip by code |
| `/points-setup` | Manage loyalty points |
| `/profile` | User profile |
| `/settings` | User settings |

#### Protected Routes - Solo Trip Flow

| Route | Description | Backend Impact |
|-------|-------------|----------------|
| `/solo/setup` | Solo trip setup form | Creates trip, stores user preferences |
| `/solo/results` | Solo trip results | Triggers itinerary generation |
| `/solo/comparison` | Compare itineraries | Fetches multiple itinerary options |
| `/solo/booking` | Booking page | Prepares booking data |

#### Protected Routes - Group Trip Flow

| Route | Description | Backend Impact |
|-------|-------------|----------------|
| `/group/setup` | Group trip setup | Creates group trip |
| `/group/dashboard` | Group trip overview | Fetches trip + members + destinations |
| `/group/results` | Group trip results | Triggers group itinerary generation |
| `/group/comparison` | Compare group itineraries | Fetches multiple options |
| `/group/itinerary` | View itinerary | Fetches saved itinerary |
| `/group/voting` | Vote on destinations | Updates destination votes |
| `/group/points-strategy` | Points strategy | Calculates optimal points usage |
| `/group/transfer-instructions` | Transfer instructions | Generates transfer steps |
| `/group/booking` | Group booking | Prepares group booking |
| `/group/payment` | Payment page | Payment processing |
| `/group/admin` | Group admin panel | Member management |
| `/group/winner` | Winning destination | Calculates vote winner |
| `/group/join/[inviteCode]` | Join via invite | Joins user to trip |

#### Other Routes

| Route | Description |
|-------|-------------|
| `/trips/[id]` | Individual trip detail |
| `/test` | Development test page |

### Major Components

#### Layout & Navigation
- `navigation.tsx` — Responsive nav bar with auth state awareness
- `footer.tsx` — Site footer
- `scroll-to-top.tsx` — Scroll to top button

#### Trip Components
- `trip-card.tsx` — Trip card display
- `trip-chatbot-inline.tsx` — AI chatbot for natural language trip extraction
- `route-selector.tsx` — Route selection component

#### Form Components
- `date-range-picker.tsx` — Date range picker
- `PointsAllocation.tsx` — Points allocation interface
- `city-autocomplete.tsx` — City autocomplete input
- `waitlist-button.tsx` — Waitlist signup

#### UI Components
- `AirportAutocomplete.tsx` — Airport search with autocomplete
- `DestinationAutocomplete.tsx` — Destination autocomplete
- `dropdown-menu.tsx` — Dropdown menu (Radix UI)
- `navigation-menu.tsx` — Navigation menu (Radix UI)

---

## Backend Architecture

### Technology Stack

| Technology | Purpose |
|------------|---------|
| FastAPI | Web framework |
| Uvicorn | ASGI server |
| Mangum | AWS Lambda adapter |
| boto3 | AWS SDK |
| PuLP | ILP optimization solver |
| PyJWT | JWT handling |
| Pydantic | Data validation |

### Project Structure

```
backend/
├── src/
│   ├── app.py                  # FastAPI application & routes
│   ├── config.py               # Configuration management
│   ├── deps.py                 # Dependency injection
│   ├── models.py               # Pydantic models
│   ├── handlers/               # Request handlers
│   │   ├── ilp_adapter.py      # ILP optimization adapter
│   │   ├── points_maximizer.py # Points optimization solver
│   │   ├── flights.py          # Flight search
│   │   ├── hotels.py           # Hotel search
│   │   ├── openAI.py           # AI integration
│   │   └── ...                 # Other handlers
│   ├── repos/                  # Data access layer
│   │   ├── ddb.py              # DynamoDB utilities
│   │   ├── trip_repo.py        # Trip CRUD
│   │   ├── user_repo.py        # User CRUD
│   │   └── ...                 # Other repositories
│   ├── services/               # Business logic
│   │   ├── itinerary_service.py # Itinerary generation
│   │   ├── points_service.py   # Points management
│   │   ├── auth_service.py     # Authentication
│   │   └── ...                 # Other services
│   └── utils/                  # Utilities
│       ├── jwt_auth.py         # JWT verification
│       ├── loyalty_programs.py # Program definitions
│       └── ...                 # Other utilities
├── files/                      # Static data files
│   ├── airports.csv            # Airport data
│   ├── countries.csv           # Country data
│   └── regions.csv             # Region data
└── requirements.txt            # Python dependencies
```

### Database Schema (DynamoDB)

| Table | Purpose | Key Structure |
|-------|---------|---------------|
| `USERS_TABLE` | User profiles | `userId` (PK) |
| `TRIPS_TABLE` | Trip metadata | `tripId` (PK), GSI on `inviteCode` |
| `TRIP_MEMBERS_TABLE` | Trip memberships | `tripId#userId` (PK), GSI on `userId` |
| `POINTS_TABLE` | Points balances | `userId#programId#tripId` (PK) |
| `DESTINATIONS_TABLE` | Trip destinations | `tripId#destinationId` (PK) |
| `DESTINATION_VOTES_TABLE` | Destination voting | `tripId#destinationId#userId` (PK) |
| `ITINERARY_TABLE` | Generated itineraries | `tripId` (PK) |

---

## API Endpoints

### Health & Utility

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | No | Root health check |
| GET | `/healthz` | No | Health check |
| POST | `/ingest` | No | Generic JSON ingestion |

### Authentication

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/auth/login` | No | Login with Cognito | `/login` page |
| POST | `/auth/signup` | No | Sign up new user | `/register` page |
| POST | `/auth/confirm` | No | Confirm email | `/auth/confirm-signup` |
| POST | `/auth/refresh` | No | Refresh tokens | Automatic by API client |
| POST | `/auth/forgot-password` | No | Initiate password reset | `/forgot-password` |
| POST | `/auth/confirm-forgot-password` | No | Confirm password reset | Password reset flow |

### Trips

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/trips` | Yes | Create new trip | Solo/Group setup pages |
| POST | `/trips/get` | Yes | Get trip by ID | Dashboard, trip detail |
| GET | `/trips` | Yes | List user's trips | My Trips page |
| POST | `/trips/invite` | Yes | Get invite code | Group admin |
| POST | `/trips/invite/regenerate` | Yes | Regenerate invite | Group admin |
| GET | `/trips/by-invite/{code}` | No | Get trip by invite | Join page |
| POST | `/trips/join` | Yes | Join trip | Join flow |
| POST | `/trips/members` | Yes | List trip members | Group dashboard |
| POST | `/trips/delete` | Yes | Delete trip (owner) | Trip management |

### Destinations

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/destinations/add` | Yes | Add destination to trip | Destination picker |
| POST | `/destinations/list` | Yes | List trip destinations | Trip detail pages |

### Points

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/points/upsert` | Yes | Add/update points | Points setup |
| POST | `/points/summary` | Yes | Get points summary | Trip results |
| GET | `/points/valuations` | Yes | Get TPG valuations | Points strategy |

### Itinerary

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/itinerary/generate` | Yes | Generate optimized itinerary | Results page |
| POST | `/itinerary/get` | Yes | Get saved itinerary | Itinerary view |

### Hotels

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/hotels/search` | Yes | Search hotels | Hotel search |
| POST | `/hotels/optimize-out-of-pocket` | Yes | Optimize hotel costs | Booking page |

### Location/City Search

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST/GET | `/cities/search` | No | Search cities/airports | City autocomplete |
| GET | `/api/locations/autocomplete` | No | Unified autocomplete | Destination search |
| GET | `/api/airports/autocomplete` | No | Airport autocomplete | Airport picker |
| GET | `/api/destinations/autocomplete` | No | Destination autocomplete | Destination search |
| GET | `/api/locations/{city_id}/airports` | No | Airports for city | City selection |

### Flight Optimization

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/api/itinerary/optimize-out-of-pocket` | No | Optimize round-trip | Itinerary optimization |

### Images

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| GET | `/images/city/{name}` | No | Get city images | City cards |
| GET | `/images/city/{name}/hero` | No | Get hero image | Trip headers |
| GET | `/images/city/{name}/srcset` | No | Get responsive srcset | Image optimization |

### User Profile

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| GET | `/users/me` | Yes | Get current user | Profile page |
| POST | `/users/me/savings/calculate` | Yes | Calculate savings | Dashboard |
| GET | `/users/me/savings` | Yes | Get total savings | Dashboard |
| PUT | `/users/profile` | Yes | Update profile | Settings page |

### AI/OpenAI

| Method | Endpoint | Auth | Description | Frontend Usage |
|--------|----------|------|-------------|----------------|
| POST | `/extract-trip-info` | No | Extract trip from text | Trip chatbot |

---

## Frontend-Backend Communication

### API Client Architecture

The frontend uses a centralized API client (`src/lib/api.ts`) that:

1. **Base URL Configuration**: Uses `NEXT_PUBLIC_BACKEND_URL` environment variable
2. **Token Management**: Automatically attaches `access_token` to requests
3. **Token Refresh**: Auto-refreshes expired tokens (checks JWT `exp` claim)
4. **Error Handling**: Handles 401s with retry logic, redirects to login on auth failure
5. **Request/Response**: Uses `fetch` with JSON serialization

### API Client Methods

```typescript
// Authentication
api.auth.login(email, password)
api.auth.signup(email, password, name)
api.auth.confirmSignup(email, code)
api.auth.refreshToken(refreshToken)
api.auth.forgotPassword(email)
api.auth.logout()

// Trips
api.trips.create(tripData)
api.trips.list()
api.trips.get(tripId)
api.trips.getByInvite(inviteCode)
api.trips.join(inviteCode)
api.trips.listMembers(tripId)
api.trips.invite(tripId)
api.trips.delete(tripId)

// Destinations
api.destinations.autocomplete(query)
api.destinations.fallbackDestinations(query)
api.destinations.add(tripId, destination)
api.destinations.list(tripId)

// Points
api.points.upsert(userId, tripId, programId, balance)
api.points.summary(tripId)
api.points.valuations()

// Itineraries
api.itineraries.generate(tripId, options)
api.itineraries.get(tripId)

// Hotels
api.hotels.search(destination, dates, filters)

// Users
api.users.getProfile()
api.users.updateProfile(data)
api.users.getSavings()

// Cities & Locations
api.cities.search(query)
api.locations.autocomplete(query)
api.locations.airportsAutocomplete(query)
api.locations.getAirports(cityId)

// AI
api.tripExtraction.extract(text)
```

### Next.js API Routes (Proxies)

The frontend includes proxy routes that forward requests to the backend:

| Frontend Route | Backend Route | Purpose |
|----------------|---------------|---------|
| `/api/airports/autocomplete` | `/api/airports/autocomplete` | Airport search |
| `/api/destinations/autocomplete` | `/api/destinations/autocomplete` | Destination search |
| `/api/locations/autocomplete` | `/api/locations/autocomplete` | Location search |
| `/api/locations/[cityId]/airports` | `/api/locations/{cityId}/airports` | City airports |
| `/api/fallback/destinations` | Fuzzy match locally | Fallback search |
| `/api/ingest` | `/ingest` | Data ingestion |

### Data Flow Examples

#### Solo Trip Creation Flow

```
1. User fills form on /solo/setup
   ↓
2. Frontend calls api.trips.create() with trip data
   ↓
3. Backend POST /trips creates trip in DynamoDB
   ↓
4. Frontend stores tripId, redirects to /solo/results
   ↓
5. Frontend calls api.itineraries.generate(tripId)
   ↓
6. Backend POST /itinerary/generate:
   - Fetches flights via SerpAPI/AwardTool
   - Runs ILP optimization (PuLP)
   - Stores result in DynamoDB
   ↓
7. Frontend displays optimized itinerary
```

#### Group Trip Join Flow

```
1. User navigates to /group/join/[inviteCode]
   ↓
2. Frontend calls api.trips.getByInvite(inviteCode)
   ↓
3. Backend GET /trips/by-invite/{code} returns trip info
   ↓
4. User clicks "Join Trip"
   ↓
5. Frontend calls api.trips.join(inviteCode)
   ↓
6. Backend POST /trips/join:
   - Creates trip_member record
   - Returns trip details
   ↓
7. Frontend redirects to /group/dashboard
```

---

## Authentication Flow

### Token-Based Authentication

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│    Frontend     │         │     Backend      │         │  AWS Cognito    │
└────────┬────────┘         └────────┬─────────┘         └────────┬────────┘
         │                           │                            │
         │ POST /auth/login          │                            │
         │ {email, password}         │                            │
         │──────────────────────────>│                            │
         │                           │ InitiateAuth               │
         │                           │ (USER_PASSWORD_AUTH)       │
         │                           │───────────────────────────>│
         │                           │                            │
         │                           │ {access_token, id_token,   │
         │                           │  refresh_token}            │
         │                           │<───────────────────────────│
         │                           │                            │
         │ {access_token, id_token,  │                            │
         │  refresh_token, user}     │                            │
         │<──────────────────────────│                            │
         │                           │                            │
         │ Store tokens in           │                            │
         │ localStorage/sessionStorage                            │
         │                           │                            │
```

### Token Storage

| Storage | Key | Purpose |
|---------|-----|---------|
| `localStorage` | `access_token` | API authentication |
| `localStorage` | `id_token` | User identity |
| `localStorage` | `refresh_token` | Token refresh |
| `localStorage` | `user` | User profile JSON |
| `sessionStorage` | `tripy_auth_checked_session` | Prevent redundant auth checks |

### Protected Route Flow

```
1. User navigates to protected route (e.g., /dashboard)
   ↓
2. (app)/layout.tsx checks for tokens in localStorage
   ↓
3. If no tokens → redirect to /login
   ↓
4. If tokens exist → verify with sessionStorage flag
   ↓
5. If not verified → show loading spinner, verify token
   ↓
6. If token expired → auto-refresh via /auth/refresh
   ↓
7. If refresh fails → clear tokens, redirect to /login
   ↓
8. If verified → render page content
```

### JWT Verification (Backend)

The backend verifies JWTs using AWS Cognito's JWKS:

1. Extracts JWT from `Authorization: Bearer <token>` header
2. Decodes JWT header to get `kid` (key ID)
3. Fetches JWKS from Cognito's `.well-known/jwks.json` endpoint
4. Verifies signature using matching public key
5. Validates claims (`iss`, `aud`, `exp`)
6. Extracts `sub` (user ID) for request context

---

## Data Models

### Frontend Types (`src/types.ts`)

```typescript
interface User {
  userId: string;
  email: string;
  name: string;
  homeAirport?: string;
  timezone?: string;
  createdAt: string;
}

interface Trip {
  tripId: string;
  userId: string;
  type: 'solo' | 'group';
  origin: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  travelers: number;
  budget?: number;
  inviteCode?: string;
  createdAt: string;
}

interface TripMember {
  tripId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

interface Points {
  userId: string;
  programId: string;
  tripId: string;
  balance: number;
}

interface Destination {
  destinationId: string;
  tripId: string;
  name: string;
  city: string;
  country: string;
  votes?: number;
}

interface Itinerary {
  tripId: string;
  flights: Flight[];
  hotels: Hotel[];
  totalCost: number;
  totalPoints: number;
  savings: number;
}
```

### Backend Models (`src/models.py`)

```python
class TripCreate(BaseModel):
    type: Literal['solo', 'group']
    origin: str
    destinations: List[str]
    start_date: str
    end_date: str
    travelers: int = 1
    budget: Optional[float] = None

class PointsUpsert(BaseModel):
    user_id: str
    program_id: str
    trip_id: str
    balance: int

class ItineraryGenerateRequest(BaseModel):
    trip_id: str
    optimize_for: Literal['cost', 'points', 'balanced'] = 'balanced'
    max_stops: int = 2
    include_ground_transport: bool = False
```

---

## External Integrations

### AWS Services

| Service | Purpose | Usage |
|---------|---------|-------|
| **Cognito** | User authentication | Sign up, login, password reset, JWT tokens |
| **DynamoDB** | Primary database | All data storage (users, trips, points, etc.) |
| **S3** | Image storage | City images, user uploads |
| **CloudFront** | CDN | Image delivery |
| **App Runner** | Deployment | Backend hosting |

### Third-Party APIs

| API | Purpose | Key Endpoints Used |
|-----|---------|-------------------|
| **Amadeus** | City/airport search | Location API |
| **SerpAPI** | Google Flights search | Flights API, Autocomplete |
| **AwardTool** | Award flight search | Award availability API |
| **OpenAI** | AI features | GPT-4 for trip extraction, suggestions |

### Integration Flow

```
┌────────────────┐
│    Frontend    │
└───────┬────────┘
        │
        ▼
┌────────────────┐     ┌────────────────┐
│    Backend     │────>│  AWS Cognito   │ (Auth)
│   (FastAPI)    │     └────────────────┘
└───────┬────────┘
        │
        ├──────────────>┌────────────────┐
        │               │   DynamoDB     │ (Data)
        │               └────────────────┘
        │
        ├──────────────>┌────────────────┐
        │               │    Amadeus     │ (Cities)
        │               └────────────────┘
        │
        ├──────────────>┌────────────────┐
        │               │    SerpAPI     │ (Flights)
        │               └────────────────┘
        │
        ├──────────────>┌────────────────┐
        │               │   AwardTool    │ (Award Flights)
        │               └────────────────┘
        │
        └──────────────>┌────────────────┐
                        │    OpenAI      │ (AI)
                        └────────────────┘
```

---

## Feature Deep Dives

### 1. ILP-Based Itinerary Optimization

The core feature of Tripy is optimizing travel itineraries using Integer Linear Programming (ILP).

**Backend Components:**
- `handlers/ilp_adapter.py` — Adapts data for ILP solver
- `handlers/points_maximizer.py` — PuLP-based ILP solver
- `services/itinerary_service.py` — Orchestrates generation

**Optimization Objectives:**
1. Maximize points value (based on TPG valuations)
2. Minimize out-of-pocket cost
3. Respect constraints (dates, airports, stops)

**Flow:**
```
1. Fetch available flights (SerpAPI + AwardTool)
2. Build flight graph with costs and points
3. Define ILP variables (binary selection per flight)
4. Set objective function (minimize cost, maximize points)
5. Add constraints (departure/arrival times, connections)
6. Solve with PuLP
7. Extract optimal route
8. Store in DynamoDB
```

**Frontend Impact:**
- `/solo/results` and `/group/results` pages display optimized itineraries
- Loading states during optimization (can take 10-30 seconds)
- Multiple itinerary options presented for comparison

### 2. Points Management System

**Supported Programs (40+):**
- Credit card programs (Chase UR, Amex MR, Citi TY, Capital One)
- Airline programs (United, Delta, American, etc.)
- Hotel programs (Marriott, Hilton, Hyatt, IHG)

**Features:**
- Points balance entry via `/points-setup`
- TPG valuations for points value comparison
- Transfer partner recommendations
- Transfer instructions generation

**Backend Components:**
- `repos/points_repo.py` — Points storage
- `services/points_service.py` — Points logic
- `handlers/tpg_valuations.py` — TPG valuations scraping

### 3. AI-Powered Trip Extraction

**Feature:** Natural language trip planning via chatbot

**Flow:**
```
1. User types: "I want to fly from NYC to Paris in June for 5 days"
2. Frontend sends to POST /extract-trip-info
3. Backend calls OpenAI GPT-4 with structured prompt
4. AI extracts: origin=NYC, destination=Paris, dates=June, duration=5 days
5. Frontend pre-fills trip setup form
```

**Frontend Component:** `trip-chatbot-inline.tsx`

### 4. Group Trip Collaboration

**Features:**
- Invite codes for trip sharing
- Member roles (owner, admin, member)
- Destination voting
- Points pooling strategies
- Transfer instructions for point sharing

**Backend Endpoints:**
- `/trips/invite` — Generate invite code
- `/trips/join` — Join trip
- `/trips/members` — Member management
- `/destinations/add` — Add destinations
- Destination voting via DESTINATION_VOTES_TABLE

### 5. Multi-Source Search

**City/Airport Search Sources:**
1. **Amadeus API** — Official city/airport data
2. **SerpAPI** — Google autocomplete
3. **Local CSV** — Airport data (`files/airports.csv`)
4. **Fuzzy matching** — Fallback with rapidfuzz

**Frontend Components:**
- `AirportAutocomplete.tsx` — Airport picker
- `DestinationAutocomplete.tsx` — Destination picker
- `city-autocomplete.tsx` — City search

---

## Summary

### Frontend Responsibilities

1. **User Interface** — React components with Tailwind styling
2. **Routing** — Next.js App Router with protected routes
3. **Authentication** — Token management and auto-refresh
4. **API Communication** — Centralized API client
5. **State Management** — Local state + URL params + localStorage
6. **Form Handling** — Trip setup, points entry, profile management

### Backend Responsibilities

1. **Authentication** — AWS Cognito integration
2. **Data Storage** — DynamoDB CRUD operations
3. **Business Logic** — Trip management, points calculation
4. **Optimization** — ILP-based itinerary optimization
5. **External APIs** — Flight search, city search, AI integration
6. **Image Management** — City image curation and serving

### Key Integration Points

| Feature | Frontend → Backend | Backend Response |
|---------|-------------------|------------------|
| Login | POST /auth/login | Tokens + user data |
| Create Trip | POST /trips | Trip ID |
| Generate Itinerary | POST /itinerary/generate | Optimized routes |
| Search Airports | GET /api/airports/autocomplete | Airport list |
| Update Points | POST /points/upsert | Confirmation |
| Join Group | POST /trips/join | Trip details |

### Performance Considerations

1. **Itinerary Generation** — Can take 10-30 seconds; frontend shows loading state
2. **Search Autocomplete** — Debounced to reduce API calls
3. **Token Refresh** — Automatic before expiration to prevent 401s
4. **Image Loading** — CDN delivery with responsive srcset

---

*Document generated: January 2026*
*Tripy Version: Next.js 15 + FastAPI*
