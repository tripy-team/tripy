/**
 * API Client for Tripy Backend
 * 
 * This client handles communication with the backend FastAPI server.
 * In development, set BACKEND_URL in your .env.local file (e.g., http://localhost:8000)
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Get access token from storage (checks sessionStorage first, then localStorage)
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  // Check sessionStorage first (more secure), fallback to localStorage
  return sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
}

/**
 * Check if token is expired (simple check - in production, decode and check exp claim)
 */
function isTokenExpired(): boolean {
  // For MVP, we'll rely on the backend to reject expired tokens
  // In production, decode JWT and check exp claim
  return false;
}

/**
 * Make API request with authentication and error handling
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<T> {
  const url = `${BACKEND_URL.replace(/\/$/, '')}${endpoint}`;
  
  // Build headers as a Record to allow dynamic assignment
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Merge existing headers if they're a plain object
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, options.headers);
    }
  }

  // Add Authorization header if auth is required
  if (requireAuth) {
    const token = getAccessToken();
    if (token && !isTokenExpired()) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (token) {
      // Token expired - could implement refresh logic here
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('id_token');
        localStorage.removeItem('refresh_token');
      }
      throw new Error('Session expired. Please log in again.');
    } else {
      throw new Error('Authentication required. Please log in.');
    }
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: headers as HeadersInit,
    });

    // Handle 401 Unauthorized - token might be invalid
    if (response.status === 401 && requireAuth) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('id_token');
        localStorage.removeItem('refresh_token');
        // Redirect to login if we're in the browser
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
      throw new Error('Authentication failed. Please log in again.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your connection and try again.');
    }
    // Re-throw other errors
    throw error;
  }
}

// Trip endpoints
export interface CreateTripRequest {
  title: string;
  start_date: string;
  end_date: string;
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
  // Login endpoint doesn't require auth
  const response = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(request),
  }, false); // requireAuth = false for login
  
  // Store tokens in sessionStorage (more secure than localStorage - cleared on tab close)
  // Note: For production, consider using httpOnly cookies set by the backend
  if (typeof window !== 'undefined' && response.tokens) {
    sessionStorage.setItem('access_token', response.tokens.access_token);
    sessionStorage.setItem('id_token', response.tokens.id_token);
    sessionStorage.setItem('refresh_token', response.tokens.refresh_token);
    // Also store in localStorage for persistence (can be removed if using sessionStorage only)
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