/**
 * API Client for Tripy Backend
 * 
 * This client handles communication with the backend FastAPI server.
 * In development, set BACKEND_URL in your .env.local file (e.g., http://localhost:8000)
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BACKEND_URL.replace(/\/$/, '')}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Trip endpoints
export interface CreateTripRequest {
  title: string;
  start_date: string;
  end_date: string;
  user_id?: string;
}

export interface Trip {
  tripId: string;
  createdBy: string;
  title: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  status: string;
}

export async function createTrip(request: CreateTripRequest): Promise<Trip> {
  return apiRequest<Trip>('/trips', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getTrip(tripId: string): Promise<Trip> {
  return apiRequest<Trip>('/trips/get', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

export async function getInviteCode(tripId: string): Promise<{ inviteCode: string }> {
  return apiRequest<{ inviteCode: string }>('/trips/invite', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

// Destination endpoints
export interface AddDestinationRequest {
  trip_id: string;
  name: string;
  must_include?: boolean;
  excluded?: boolean;
  user_id?: string;
}

export interface Destination {
  tripId: string;
  destinationId: string;
  name: string;
  mustInclude: boolean;
  excluded: boolean;
  createdBy: string;
}

export async function addDestination(request: AddDestinationRequest): Promise<Destination> {
  return apiRequest<Destination>('/destinations/add', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export interface DestinationsListResponse {
  destinations: Destination[];
  scores: Record<string, number>;
}

export async function listDestinations(tripId: string): Promise<DestinationsListResponse> {
  return apiRequest<DestinationsListResponse>('/destinations/list', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

// Points endpoints
export interface UpsertPointsRequest {
  trip_id: string;
  program: string;
  balance: number;
  user_id?: string;
}

export interface Points {
  tripId: string;
  userProgram: string;
  userId: string;
  program: string;
  balance: number;
  source: string;
}

export async function upsertPoints(request: UpsertPointsRequest): Promise<Points> {
  return apiRequest<Points>('/points/upsert', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export interface PointsSummary {
  tripId: string;
  totalPoints: number;
  items: Points[];
}

export async function getPointsSummary(tripId: string): Promise<PointsSummary> {
  return apiRequest<PointsSummary>('/points/summary', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

// Itinerary endpoints
export interface GenerateItineraryRequest {
  trip_id: string;
}

export interface SavedItineraryItem {
  tripId: string;
  itemId: string;
  type: string;
  route: string[];
}

export interface GenerateItineraryResponse {
  routes: string[][];
  saved: SavedItineraryItem;
}

export async function generateItinerary(tripId: string): Promise<GenerateItineraryResponse> {
  return apiRequest<GenerateItineraryResponse>('/itinerary/generate', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

export interface ItineraryItem {
  tripId: string;
  itemId: string;
  type: string;
  [key: string]: unknown;
}

export interface GetItineraryResponse {
  items: ItineraryItem[];
}

export async function getItinerary(tripId: string): Promise<GetItineraryResponse> {
  return apiRequest<GetItineraryResponse>('/itinerary/get', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

// Auth endpoints
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user_id: string;
  email: string;
  user: {
    userId: string;
    email: string;
    name: string;
    createdAt: string;
  };
  tokens: {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export interface SignUpRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface SignUpResponse {
  user_id: string;
  email: string;
  user: {
    userId: string;
    email: string;
    name: string;
    createdAt: string;
  };
  confirmation_required: boolean;
  code_delivery_details?: {
    Destination?: string;
    DeliveryMedium?: string;
    AttributeName?: string;
  };
}

export interface ConfirmSignUpRequest {
  email: string;
  confirmation_code: string;
}

export async function login(request: LoginRequest): Promise<LoginResponse> {
  const response = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  
  // Store tokens in localStorage (or use a more secure method in production)
  if (typeof window !== 'undefined' && response.tokens) {
    localStorage.setItem('access_token', response.tokens.access_token);
    localStorage.setItem('id_token', response.tokens.id_token);
    localStorage.setItem('refresh_token', response.tokens.refresh_token);
  }
  
  return response;
}

export async function signup(request: SignUpRequest): Promise<SignUpResponse> {
  return apiRequest<SignUpResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function confirmSignup(request: ConfirmSignUpRequest): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/auth/confirm', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

// City search endpoints
export interface CitySearchResult {
  id: string;
  name: string;
  iataCode: string;
  type: string;
  cityName?: string;
  countryName?: string;
  regionCode?: string;
}

export interface CitySearchResponse {
  cities: CitySearchResult[];
}

export async function searchCities(query: string, maxResults: number = 10): Promise<CitySearchResponse> {
  return apiRequest<CitySearchResponse>(`/cities/search?query=${encodeURIComponent(query)}&max_results=${maxResults}`, {
    method: 'GET',
  });
}