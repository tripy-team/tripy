# Backend Integration TODOs

This document outlines all the places in the frontend where backend API calls need to be implemented.

## Backend API Endpoints Available

### Authentication & User

- `GET /users/me` - Get current user profile
- `PUT /users/profile` - Update user profile (name, default_home_airport, timezone)

### Trips

- `POST /trips` - Create a new trip (title, start_date, end_date)
- `POST /trips/get` - Get trip by ID
- `POST /trips/invite` - Get invite code for a trip

### Trip Members

- `POST /trips/join` - Join a trip using invite code
- `POST /trips/members` - List all members of a trip

### Destinations

- `POST /destinations/add` - Add destination to trip (trip_id, name, must_include, excluded)
- `POST /destinations/list` - List all destinations for a trip (returns destinations + scores)
- `POST /destinations/vote` - Cast vote on a destination (trip_id, destination_id, vote: -1/0/+1)

### Points

- `POST /points/upsert` - Add/update points for a user in a trip (trip_id, program, balance)
- `POST /points/summary` - Get points summary for a trip

### Itinerary

- `POST /itinerary/generate` - Generate itineraries for a trip
- `POST /itinerary/get` - Get saved itinerary for a trip

### Invites

- Lambda function: Creates invite token and returns invite URL

---

## Frontend Pages Requiring Backend Integration

### 1. Authentication Pages

#### `/login` (`src/app/(auth)/login/page.tsx`)

- **TODO**: Replace mock auth with actual API call
- **Endpoint needed**: Auth endpoint (not in current backend - needs to be added)
- **Current state**: Has TODO comment at line 46

#### `/register` (`src/app/(auth)/register/page.tsx`)

- **TODO**: Replace alert with actual registration API call
- **Endpoint needed**: Registration endpoint (not in current backend - needs to be added)
- **Current state**: Has alert at line 57

#### `/forgot-password` (`src/app/(auth)/forgot-password/page.tsx`)

- **TODO**: Implement password reset API call
- **Endpoint needed**: Password reset endpoint (not in current backend - needs to be added)
- **Current state**: Has TODO comment at line 26

### 2. Dashboard (`src/app/(app)/dashboard/page.tsx`)

#### Load User Trips

- **TODO**: Replace mock trips array with API call to fetch user's trips
- **Endpoint needed**: `GET /trips` (list user trips - needs to be added) or use `POST /trips/get` for each trip
- **Current state**: Mock data at lines 13-70
- **Data needed**:
  - Trip ID, name, destination, dates, status, type
  - Points used, cash spent
  - Members count, hotel, flight class

#### Load User Profile

- **TODO**: Fetch user profile on mount
- **Endpoint**: `GET /users/me`
- **Current state**: No user profile loading

#### Calculate Stats

- **TODO**: Calculate stats from real trip data (already done, but needs real data)
- **Current state**: Calculated from mock data at lines 75-77

### 3. Solo Trip Setup (`src/app/(app)/solo/setup/page.tsx`)

#### Create Trip

- **TODO**: On "Generate Itineraries" click, create trip first
- **Endpoint**: `POST /trips`
- **Current state**: `handleGenerate` just navigates (line 54-56)
- **Data to send**:
  - title: Auto-generate "Solo Trip to [first city]"
  - start_date: from state
  - end_date: from state

#### Add Destinations

- **TODO**: After creating trip, add each city as destination
- **Endpoint**: `POST /destinations/add`
- **Current state**: Cities stored in local state only
- **Data to send**: trip_id, name (city), must_include: false, excluded: false

#### Add Points

- **TODO**: Save credit card points to backend
- **Endpoint**: `POST /points/upsert`
- **Current state**: Points stored in local state only
- **Data to send**: trip_id, program (card name), balance (points)

#### Generate Itineraries

- **TODO**: After setup complete, call generate endpoint
- **Endpoint**: `POST /itinerary/generate`
- **Current state**: Not implemented
- **Data to send**: trip_id

### 4. Solo Results (`src/app/(app)/solo/results/page.tsx`)

#### Load Itineraries

- **TODO**: Replace mock data with API call
- **Endpoint**: `POST /itinerary/get`
- **Current state**: Mock data generated in useEffect (lines 26-73)
- **Data needed**: Routes/itineraries with cities, costs, points, scores

#### Save Selected Itinerary

- **TODO**: When user selects an itinerary, save it
- **Endpoint**: `POST /itinerary/save` (may need to be added) or use existing save in generate
- **Current state**: Only local state management

### 5. Group Trip Setup (`src/app/(app)/group/setup/page.tsx`)

#### Create Trip

- **TODO**: On "Generate Invite Link" click, create trip
- **Endpoint**: `POST /trips`
- **Current state**: `generateInvite` creates fake code (line 16-19)
- **Data to send**:
  - title: Auto-generate "Group Trip to [first city]"
  - start_date: from state
  - end_date: from state

#### Add Destinations

- **TODO**: After creating trip, add each city as destination
- **Endpoint**: `POST /destinations/add`
- **Current state**: Cities stored in local state only

#### Generate Invite Link

- **TODO**: After trip created, get invite code and generate link
- **Endpoint**: `POST /trips/invite` or use invites Lambda
- **Current state**: Fake code generation (line 17)
- **Note**: Backend has invites Lambda that creates invite tokens

### 6. Group Join (`src/app/(app)/group/join/[inviteCode]/page.tsx`)

#### Load Trip Info

- **TODO**: Fetch trip details using invite code
- **Endpoint**: `POST /trips/join` (validates invite and returns trip info)
- **Current state**: Mock tripInfo object (lines 15-22)
- **Data needed**: Trip name, admin, cities, duration, start date, current members

#### Join Trip

- **TODO**: On "Join Trip" click, submit join request with user data
- **Endpoint**: `POST /trips/join`
- **Current state**: `handleJoin` just navigates (line 24-26)
- **Data to send**: invite_code, budget, points, airport

#### Add Points

- **TODO**: Save user's points to trip
- **Endpoint**: `POST /points/upsert`
- **Current state**: Points in local state only

### 7. Group Dashboard (`src/app/(app)/group/dashboard/page.tsx`)

#### Load Trip Details

- **TODO**: Fetch trip details (from trip_id in URL or context)
- **Endpoint**: `POST /trips/get`
- **Current state**: Hardcoded trip name "European Adventure 2025" (line 30)

#### Load Members

- **TODO**: Fetch trip members
- **Endpoint**: `POST /trips/members`
- **Current state**: Mock members array (lines 9-14)
- **Data needed**: Member name, budget, points, airport, status

#### Load Destinations

- **TODO**: Fetch trip destinations
- **Endpoint**: `POST /destinations/list`
- **Current state**: Hardcoded cities array (line 134)

#### Load Points Summary

- **TODO**: Fetch aggregated points data
- **Endpoint**: `POST /points/summary`
- **Current state**: Calculated from mock data (lines 17-18)

#### Generate Itineraries

- **TODO**: On "Generate Itineraries" click, call generate endpoint
- **Endpoint**: `POST /itinerary/generate`
- **Current state**: Just navigates (line 153)

### 8. Group Voting (`src/app/(app)/group/voting/page.tsx`)

#### Load Itineraries

- **TODO**: Fetch generated itineraries for voting
- **Endpoint**: `POST /itinerary/get`
- **Current state**: Mock itineraries (lines 20-59)

#### Load Members

- **TODO**: Fetch members and their voting status
- **Endpoint**: `POST /trips/members` + voting status (may need separate endpoint)
- **Current state**: Mock members array (lines 64-69)

#### Submit Vote

- **TODO**: Save user's ranking/vote
- **Endpoint**: `POST /destinations/vote` (for each destination) or new ranking endpoint
- **Current state**: `handleSubmit` just sets local state (line 85-91)
- **Note**: Current backend has destination voting, but may need itinerary ranking endpoint

### 9. Group Results (`src/app/(app)/group/results/page.tsx`)

#### Load Itineraries

- **TODO**: Fetch generated itineraries
- **Endpoint**: `POST /itinerary/get`
- **Current state**: Mock data in useEffect (lines 24-69)

#### Load Group Size

- **TODO**: Get actual member count
- **Endpoint**: `POST /trips/members` (count members)
- **Current state**: Hardcoded `groupSize = 4` (line 22)

### 10. TopBar Component (`src/components/TopBar.tsx`)

#### Check Authentication

- **TODO**: Replace `isAuthenticated = false` with actual auth check
- **Endpoint**: `GET /users/me` (check if user exists)
- **Current state**: Hardcoded false (line 8)

---

## Missing Backend Endpoints

The following endpoints are needed but don't exist yet:

1. **Authentication**
   - `POST /auth/login` - User login
   - `POST /auth/register` - User registration
   - `POST /auth/forgot-password` - Password reset request
   - `POST /auth/reset-password` - Password reset confirmation

2. **Trips**
   - `GET /trips` - List all trips for current user
   - `POST /trips/{tripId}/update` - Update trip details

3. **Itinerary**
   - `POST /itinerary/save` - Save selected itinerary
   - `POST /itinerary/rank` - Submit itinerary ranking for group voting

4. **User Profile**
   - `GET /users/me` - Already exists, but needs to be called from frontend

---

## Data Structure Mappings

### Trip Creation

Frontend → Backend:

- `startDate` → `start_date`
- `endDate` → `end_date`
- `title` → Auto-generate from destinations

### Points

Frontend → Backend:

- `creditCards[].program` → `program`
- `creditCards[].points` → `balance`
- Need `trip_id` from created trip

### Destinations

Frontend → Backend:

- `cities[]` → `name`
- `must_include` → false (default)
- `excluded` → false (default)
- Need `trip_id` from created trip

---

## Implementation Priority

1. **High Priority** (Core functionality):
   - Trip creation (solo & group)
   - Destination management
   - Itinerary generation
   - Trip member management

2. **Medium Priority** (User experience):
   - Points management
   - User profile loading
   - Dashboard trip listing

3. **Low Priority** (Nice to have):
   - Voting/ranking system
   - Itinerary saving
   - Profile updates

---

## Notes

- All backend endpoints use POST with JSON body
- Authentication is handled via JWT in request headers (from `get_user_id_from_event`)
- Frontend needs to store `trip_id` after trip creation to use in subsequent calls
- Consider using React Query or SWR for data fetching and caching
- Error handling needs to be added for all API calls
- Loading states are already implemented in most pages
