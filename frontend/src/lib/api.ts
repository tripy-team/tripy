/**
 * API Client for Tripy Backend
 * 
 * This client handles communication with the backend FastAPI server.
 * In development, set NEXT_PUBLIC_BACKEND_URL in your .env.local file (e.g., http://localhost:8000)
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Convert snake_case keys to camelCase recursively
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function transformKeys<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => transformKeys(item)) as T;
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = transformKeys(value);
    }
    return result as T;
  }
  
  return obj as T;
}

// ============================================================================
// OFFLINE MODE TOGGLE
// ============================================================================
// Set this to true to bypass authentication and use mock data (for offline development)
// When true: API calls skip auth, layout skips auth check, mock profile is returned
// When false: Normal authentication required, real API calls made
// ============================================================================
export const SKIP_API_AUTH = true;

// Log backend URL in development for debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  console.log('Backend URL:', BACKEND_URL);
  if (SKIP_API_AUTH) {
    console.log('⚠️  API Authentication is DISABLED (offline mode)');
  }
}

/**
 * Get access token from storage (checks sessionStorage first, then localStorage)
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  // Check sessionStorage first (more secure), fallback to localStorage
  return sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
}

/**
 * Check if token is expired by decoding JWT and checking exp claim
 */
function isTokenExpired(token: string | null): boolean {
  if (!token) return true;

  try {
    // Decode JWT without verification (we just need the exp claim)
    const parts = token.split('.');
    if (parts.length !== 3) return true;

    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;

    if (!exp) return false; // No expiration claim, assume valid

    // Check if token expires in less than 60 seconds (refresh before it expires)
    const now = Math.floor(Date.now() / 1000);
    return exp - now < 60;
  } catch {
    // If we can't decode, assume expired to be safe
    return true;
  }
}

/**
 * Refresh access and ID tokens using refresh token
 */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');

  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    // Store new tokens
    if (typeof window !== 'undefined' && data.tokens) {
      if (data.tokens.access_token) {
        localStorage.setItem('access_token', data.tokens.access_token);
        sessionStorage.setItem('access_token', data.tokens.access_token);
      }
      if (data.tokens.id_token) {
        localStorage.setItem('id_token', data.tokens.id_token);
        sessionStorage.setItem('id_token', data.tokens.id_token);
      }
    }

    return true;
  } catch {
    return false;
  }
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
    if (SKIP_API_AUTH) {
      // Offline mode: skip auth header
    } else {
      let token = getAccessToken();

      // Check if token is expired and try to refresh
      if (token && isTokenExpired(token)) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          token = getAccessToken(); // Get the new token
        } else {
          // Refresh failed - clear tokens
          if (typeof window !== 'undefined') {
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('id_token');
            sessionStorage.removeItem('refresh_token');
            sessionStorage.removeItem('tripy_auth_checked_session');
          }
          throw new Error('Session expired. Please log in again.');
        }
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        throw new Error('Authentication required. Please log in.');
      }
    }
  }

  // Log itinerary requests in development
  if (process.env.NODE_ENV === 'development' && endpoint.startsWith('/itinerary/')) {
    console.log('[api]', options.method ?? 'GET', endpoint, { body: options.body });
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: headers as HeadersInit,
    });

    // Handle 401 Unauthorized - token might be invalid or expired
    if (response.status === 401 && requireAuth) {
      // Try to refresh token once before giving up
      const refreshed = await refreshAccessToken();

      if (refreshed) {
        // Retry the request with new token
        const newToken = getAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetch(url, {
            ...options,
            headers: headers as HeadersInit,
          });

          if (retryResponse.ok) {
            return retryResponse.json() as T;
          }
        }
      }

      // Refresh failed or retry failed - clear tokens and redirect
      if (typeof window !== 'undefined') {
        // Clear tokens
        localStorage.removeItem('access_token');
        localStorage.removeItem('id_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('id_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('tripy_auth_checked_session'); // Clear auth check flag

        // Only redirect if we're not already on login/auth pages
        const currentPath = window.location.pathname;
        const isAuthPage = currentPath.startsWith('/login') ||
          currentPath.startsWith('/register') ||
          currentPath.startsWith('/auth') ||
          currentPath === '/';

        if (!isAuthPage) {
          // Redirect to login
          window.location.href = '/login';
        }
      }
      throw new Error('Authentication failed. Please log in again.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();
    
    // Log itinerary responses in development
    if (process.env.NODE_ENV === 'development' && endpoint.startsWith('/itinerary/')) {
      console.log('[api]', endpoint, 'response', {
        status: (data as Record<string, unknown>)?.status,
        items: Array.isArray((data as Record<string, unknown>)?.items) 
          ? ((data as Record<string, unknown>).items as unknown[]).length 
          : undefined,
        relaxed_constraints: (data as Record<string, unknown>)?.relaxed_constraints,
      });
    }
    
    return data as T;
  } catch (error) {
    // Handle network errors with more specific messages
    if (error instanceof TypeError) {
      if (error.message.includes('fetch') || error.message === 'Failed to fetch') {
        // Network error - backend might not be running or URL is wrong
        const backendUrl = BACKEND_URL;
        console.error('Network error - Backend URL:', backendUrl);
        throw new Error(`Cannot connect to backend server at ${backendUrl}. Please ensure the backend is running.`);
      }
    }
    // Re-throw other errors
    throw error;
  }
}

// TypeScript interfaces for API responses
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
}

export interface Trip {
  tripId: string;
  createdBy: string;
  title: string;
  startDate: string;
  endDate: string;
  inviteCode: string;
  status: string;
  // Optional fields that may be included in API responses
  destinations?: string[];
  firstDestination?: string;
  memberCount?: number;
  includeHotels?: boolean;
  maxBudget?: number;
  durationDays?: number;
}

export interface PointsSummaryItem {
  userId?: string;
  program?: string;
  balance?: number;
  tripId?: string;
  /** Market-rate dollar value (TPG) when available */
  value?: number | null;
  /** Cents per point from TPG when available */
  centsPerPoint?: number | null;
  [key: string]: unknown; // Allow other fields from DynamoDB
}

export interface PointsSummary {
  tripId: string;
  totalPoints: number;
  /** Total market-rate dollar value (TPG) when available */
  totalValue?: number;
  items: PointsSummaryItem[];
}

export interface CreateTripRequest {
  title: string;
  start_date: string;
  end_date: string;
  /** Include hotel out-of-pocket in cost calculations (default true) */
  include_hotels?: boolean;
  /** Maximum budget in dollars for itinerary generation */
  max_budget?: number;
  /** Trip length in days when dates are flexible (start/end empty) */
  duration_days?: number;
}

export interface Destination {
  tripId: string;
  destinationId: string;
  name: string;
  mustInclude: boolean;
  excluded: boolean;
  isStart?: boolean;
  isEnd?: boolean;
  createdBy: string;
}

export interface CitySearchResult {
  id: string;
  name: string;
  iataCode: string;
  type: string;
  cityName?: string;
  countryName?: string;
  regionCode?: string;
}

export interface CitySuggestion {
  city_id: string;
  name: string;
  region?: string;
  country?: string;
  airport_code?: string;
  /** When present: ["flight","bus","car"] or ["bus","car"] for ground-only (no airport) */
  transport_modes?: string[];
  lat?: number | null;
  lng?: number | null;
}

export interface NearbyAirport {
  iata: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  distance_km?: number | null;
}

// Auth API
export const auth = {
  login: async (params: { email: string; password: string }): Promise<LoginResponse> => {
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(params),
    }, false); // requireAuth = false for login

    // Store tokens in sessionStorage (more secure than localStorage)
    // Note: For production, consider using httpOnly cookies set by the backend
    if (typeof window !== 'undefined' && response.tokens) {
      sessionStorage.setItem('access_token', response.tokens.access_token);
      sessionStorage.setItem('id_token', response.tokens.id_token);
      sessionStorage.setItem('refresh_token', response.tokens.refresh_token);
      // Also store in localStorage for persistence
      localStorage.setItem('access_token', response.tokens.access_token);
      localStorage.setItem('id_token', response.tokens.id_token);
      localStorage.setItem('refresh_token', response.tokens.refresh_token);
    }

    return response;
  },

  signup: async (params: { email: string; password: string; firstName?: string; lastName?: string }): Promise<SignUpResponse> => {
    return apiRequest<SignUpResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(params),
    }, false); // requireAuth = false for signup
  },

  confirmSignup: async (params: { email: string; confirmation_code: string }): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>('/auth/confirm', {
      method: 'POST',
      body: JSON.stringify(params),
    }, false); // requireAuth = false for confirmation
  },

  refreshToken: async (refresh_token: string): Promise<{ tokens: { access_token: string; id_token: string; expires_in: number } }> => {
    return apiRequest<{ tokens: { access_token: string; id_token: string; expires_in: number } }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    }, false); // requireAuth = false for token refresh
  },

  forgotPassword: async (email: string): Promise<{ message: string; code_delivery_details?: { Destination?: string; DeliveryMedium?: string; AttributeName?: string } }> => {
    return apiRequest<{ message: string; code_delivery_details?: { Destination?: string; DeliveryMedium?: string; AttributeName?: string } }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }, false); // requireAuth = false for forgot password
  },

  confirmForgotPassword: async (params: { email: string; confirmation_code: string; new_password: string }): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>('/auth/confirm-forgot-password', {
      method: 'POST',
      body: JSON.stringify(params),
    }, false); // requireAuth = false for password reset
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('id_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('id_token');
      sessionStorage.removeItem('refresh_token');
      sessionStorage.removeItem('tripy_auth_checked'); // Clear auth check flag
      // Trigger auth change event for components to update
      window.dispatchEvent(new Event('tripy_auth_change'));
    }
  },
};

// Trips API
export const trips = {
  create: async (params: { title: string; start_date: string; end_date: string; include_hotels?: boolean; max_budget?: number; duration_days?: number }): Promise<Trip> => {
    return apiRequest<Trip>('/trips', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  list: async (): Promise<{ trips: Trip[] }> => {
    return apiRequest<{ trips: Trip[] }>('/trips', {
      method: 'GET',
    });
  },

  get: async (trip_id: string): Promise<Trip> => {
    return apiRequest<Trip>('/trips/get', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  getByInvite: async (invite_code: string): Promise<Trip> => {
    return apiRequest<Trip>(`/trips/by-invite/${invite_code}`, {
      method: 'GET',
    }, false); // requireAuth = false for public invite access
  },

  join: async (invite_code: string): Promise<{ tripId: string }> => {
    return apiRequest<{ tripId: string }>('/trips/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code }),
    });
  },

  listMembers: async (trip_id: string): Promise<{ members: Array<{ userId: string; role: string; status: string; name?: string }> }> => {
    return apiRequest<{ members: Array<{ userId: string; role: string; status: string; name?: string }> }>('/trips/members', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  invite: async (trip_id: string): Promise<{ inviteCode: string }> => {
    return apiRequest<{ inviteCode: string }>('/trips/invite', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
  regenerateInvite: async (trip_id: string): Promise<{ inviteCode: string }> => {
    return apiRequest<{ inviteCode: string }>('/trips/invite/regenerate', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  delete: async (trip_id: string): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>('/trips/delete', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
};

// Destination autocomplete suggestion shape from /api/destinations/autocomplete (SerpAPI + fuzzy)
export interface DestinationsAutocompleteSuggestion {
  name: string;
  type?: string;
  description?: string;
  id?: string;
  airports?: Array<{ id?: string; name?: string; city?: string; city_id?: string; distance?: string }>;
}

// Destinations API
export const destinations = {
  autocomplete: async (
    q: string,
    limit: number = 10,
    commercialOnly?: boolean
  ): Promise<{ suggestions: DestinationsAutocompleteSuggestion[] }> => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (commercialOnly) params.set("commercial_only", "true");
    const endpoint = `/api/destinations/autocomplete?${params.toString()}`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(res.statusText || "Failed to fetch destination suggestions");
    }
    return res.json();
  },

  /** Fallback when autocomplete returns empty: uses backend/files (airports.csv, countries.csv). If commercialOnly, filters to large/medium/small. */
  fallbackDestinations: async (
    q: string,
    limit: number = 10,
    commercialOnly?: boolean
  ): Promise<{ suggestions: DestinationsAutocompleteSuggestion[] }> => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (commercialOnly) params.set("commercial_only", "true");
    const endpoint = `/api/fallback/destinations?${params.toString()}`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return { suggestions: [] };
    return res.json();
  },

  add: async (params: { trip_id: string; name: string; must_include?: boolean; excluded?: boolean; is_start?: boolean; is_end?: boolean }): Promise<Destination> => {
    return apiRequest<Destination>('/destinations/add', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: params.trip_id,
        name: params.name,
        must_include: params.must_include ?? false,
        excluded: params.excluded ?? false,
        is_start: params.is_start ?? false,
        is_end: params.is_end ?? false,
      }),
    });
  },

  list: async (trip_id: string): Promise<{ destinations: Destination[]; scores: Record<string, number> }> => {
    return apiRequest<{ destinations: Destination[]; scores: Record<string, number> }>('/destinations/list', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
};

// Points API
export const points = {
  upsert: async (params: { trip_id: string; program: string; balance: number }) => {
    return apiRequest('/points/upsert', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  summary: async (trip_id: string): Promise<PointsSummary> => {
    return apiRequest<PointsSummary>('/points/summary', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  /** Market-rate cents per point (TPG) for supported programs */
  valuations: async (): Promise<Record<string, number>> => {
    return apiRequest<Record<string, number>>('/points/valuations', { method: 'GET' });
  },
};

// Itineraries API
export interface ItineraryItem {
  route?: string[] | Array<{ name: string; days: number }>;
  cities?: string[] | Array<{ name: string; days: number }>;
  name?: string;
  cost?: number;
  totalCost?: number;
  totalCostPerPerson?: number;
  costPerPerson?: number;
  points?: number;
  pointsCost?: number;
  score?: number;
  /** True when totalCost <= trip max_budget */
  withinBudget?: boolean;
  /** True when pointsCost <= trip total points */
  withinPoints?: boolean;
  
  // Flight-specific fields from optimized itinerary
  /** Item type: path, payments, totals, or itinerary */
  type?: 'path' | 'payments' | 'totals' | 'itinerary' | string;
  /** Traveler ID for path/payments items */
  travelerId?: string;
  /** Flight path as airport codes */
  path?: string[];
  /** Payment details per flight segment */
  payments?: Array<{
    edge: [string, string, string];  // [origin, dest, flight_number]
    type: 'cash' | 'points';
    payer: string;
    fare?: number;  // cash only
    via?: { source: string; airline: string } | { native: string };  // points only
    miles?: number;
    surcharge?: number;
    points_value?: number;
    cents_per_point?: number;
    mode?: 'flight' | 'bus' | 'car';
  }>;
  /** Aggregated totals for the itinerary */
  totals?: {
    airline_points: number;
    cash: number;
    time: number;
    points_value: number;
    transfers: Record<string, Record<string, Record<string, {
      blocks: number;
      source_points: number;
      delivered_airline_points: number;
      operating_carriers?: string[];
      segment_description?: string;
    }>>>;
    native_used: Record<string, Record<string, number>>;
  };
  [key: string]: unknown; // Allow other fields from DynamoDB
}

export interface ItineraryResponse {
  items: ItineraryItem[];
}

export const itineraries = {
  generate: async (trip_id: string) => {
    return apiRequest('/itinerary/generate', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  get: async (trip_id: string): Promise<ItineraryResponse> => {
    return apiRequest<ItineraryResponse>('/itinerary/get', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
};

export interface HotelSearchResult {
  hotel_id: string;
  name: string;
  brand: string;
  program_code?: string | null;
  cash_cost?: number | null;
  points_cost?: number | null;
  surcharge?: number | null;
  star_rating?: unknown;
  address?: string;
}

export interface HotelSearchParams {
  destination: string;
  check_in: string;
  check_out: string;
  programs?: string[] | null;
  guests?: number;
  hotel_class?: string | null;
}

export const hotels = {
  search: async (params: HotelSearchParams): Promise<{ hotels: HotelSearchResult[] }> => {
    return apiRequest<{ hotels: HotelSearchResult[] }>('/hotels/search', {
      method: 'POST',
      body: JSON.stringify({
        destination: params.destination,
        check_in: params.check_in,
        check_out: params.check_out,
        programs: params.programs ?? undefined,
        guests: params.guests ?? 1,
        hotel_class: params.hotel_class ?? undefined,
      }),
    });
  },
};

// City Search API (public, no auth required)
export const cities = {
  search: async (query: string, maxResults: number = 10): Promise<{ cities: CitySearchResult[] }> => {
    return apiRequest<{ cities: CitySearchResult[] }>(
      `/cities/search?query=${encodeURIComponent(query)}&max_results=${maxResults}`,
      {
        method: 'GET',
      },
      false // requireAuth = false for city search
    );
  },
};

export interface AirportSuggestion {
  airport_id: string;
  iata_code: string;
  airport_name: string;
  city: string;
  country: string;
  region?: string;
  display_name: string;
}

export const locations = {
  // These hit Next.js route handlers on the same origin as the frontend,
  // not the FastAPI backend. We use relative URLs instead of BACKEND_URL.
  autocomplete: async (
    q: string,
    limit: number = 10
  ): Promise<{ cities: CitySuggestion[] }> => {
    const endpoint = `/api/locations/autocomplete?q=${encodeURIComponent(
      q
    )}&limit=${limit}`;

    if (typeof window !== 'undefined') {
      console.log('[locations.autocomplete] GET', endpoint);
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(res.statusText || 'Failed to fetch city suggestions');
    }
    return res.json();
  },

  airportsAutocomplete: async (
    q: string,
    limit: number = 10
  ): Promise<{ airports: AirportSuggestion[] }> => {
    // Use Next.js route handler (same origin as frontend)
    const endpoint = `/api/airports/autocomplete?q=${encodeURIComponent(
      q
    )}&limit=${limit}`;

    if (typeof window !== 'undefined') {
      console.log('[locations.airportsAutocomplete] GET', endpoint);
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(res.statusText || 'Failed to fetch airport suggestions');
    }
    return res.json();
  },

  getAirports: async (
    cityId: string,
    limit: number = 3
  ): Promise<{ airports: NearbyAirport[] }> => {
    const endpoint = `/api/locations/${encodeURIComponent(
      cityId
    )}/airports?limit=${limit}`;

    if (typeof window !== 'undefined') {
      console.log('[locations.getAirports] GET', endpoint);
    }

    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(res.statusText || 'Failed to fetch nearby airports');
    }
    return res.json();
  },
};

// User Profile API
export interface UserProfile {
  userId: string;
  email?: string;
  name?: string;
  default_home_airport?: string;
  timezone?: string;
  total_savings?: number;
  credit_cards?: Array<{
    id: string;
    program: string;
    points: number;
    /** Optional card product (e.g. "Delta SkyMiles Gold Amex") for benefit-aware optimization */
    card_product?: string;
  }>;
  flight_class?: string;
  hotel_class?: string;
  createdAt?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  default_home_airport?: string;
  timezone?: string;
  credit_cards?: Array<{
    id: string;
    program: string;
    points: number;
    card_product?: string;
  }>;
  flight_class?: string;
  hotel_class?: string;
}

// Mock profile data for offline development
// Edit this object to change the mock user profile
const MOCK_PROFILE: UserProfile = {
  userId: 'dev-user-john-doe',
  name: 'John Doe',
  email: 'johndoe@example.com',
  default_home_airport: undefined,
  timezone: 'America/New_York',
  total_savings: 0,
  credit_cards: [],
  flight_class: undefined,
  hotel_class: undefined,
  createdAt: new Date().toISOString(),
};

export const users = {
  getProfile: async (): Promise<UserProfile> => {
    if (SKIP_API_AUTH) {
      return MOCK_PROFILE;
    }
    return apiRequest<UserProfile>('/users/me', {
      method: 'GET',
    });
  },

  updateProfile: async (updates: UpdateProfileRequest): Promise<{ ok: boolean }> => {
    if (SKIP_API_AUTH) {
      // In offline mode, update the mock profile
      Object.assign(MOCK_PROFILE, updates);
      return { ok: true };
    }
    return apiRequest<{ ok: boolean }>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  getSavings: async (): Promise<{ total_savings: number; user_id: string }> => {
    if (SKIP_API_AUTH) {
      return { total_savings: MOCK_PROFILE.total_savings || 0, user_id: MOCK_PROFILE.userId };
    }
    return apiRequest<{ total_savings: number; user_id: string }>('/users/me/savings', {
      method: 'GET',
    });
  },

  calculateSavings: async (): Promise<{ total_savings: number; trips_count: number; trips_with_savings: number }> => {
    if (SKIP_API_AUTH) {
      return { total_savings: 0, trips_count: 0, trips_with_savings: 0 };
    }
    return apiRequest<{ total_savings: number; trips_count: number; trips_with_savings: number }>('/users/me/savings/calculate', {
      method: 'POST',
    });
  },
};

// Named exports for backward compatibility
export const login = auth.login;
export const signup = auth.signup;
export const confirmSignup = auth.confirmSignup;
export const logout = auth.logout;
export const createTrip = trips.create;
export const getTrip = trips.get;
export const getInviteCode = trips.invite;
export const addDestination = destinations.add;
export const listDestinations = destinations.list;
export const upsertPoints = points.upsert;
export const getPointsSummary = points.summary;
export const generateItinerary = itineraries.generate;
export const getItinerary = itineraries.get;
export const searchHotels = hotels.search;
export const searchCities = cities.search;

// Trip Information Extraction API (public, no auth required)
export interface ExtractedTripInfo {
  cities: string[];
  startDestination?: string | null;
  endDestination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  duration?: number | null;
  isFlexible?: boolean | null;
  minBudget?: number | null;
  maxBudget?: number | null;
  creditCards?: Array<{ program: string; points: number }> | null;
  flightClass?: string | null;
  hotelClass?: string | null;
}

export const tripExtraction = {
  extract: async (text: string): Promise<ExtractedTripInfo> => {
    return apiRequest<ExtractedTripInfo>('/extract-trip-info', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }, false); // requireAuth = false for trip extraction
  },
};

// ============================================================================
// GROUP TRIP API
// ============================================================================

// Member preferences stored in trip_members table
export interface MemberPreferences {
  userId: string;
  tripId: string;
  role: 'owner' | 'member';
  status: 'pending' | 'complete';
  name?: string;
  email?: string;
  // Travel party
  adults?: number;
  children?: number;
  bags?: number;
  // Flight preferences
  departureAirport?: string;
  arrivalAirport?: string;
  flightClass?: string;
  isRoundTrip?: boolean;
  // Accommodation preferences
  hotelClass?: string;
  roomOccupancy?: number;
  // Dates
  startDate?: string;
  endDate?: string;
  // Budget & Points
  budget?: number;
  availablePoints?: number;
  // Notes
  meetupNote?: string;
}

export interface GroupMember {
  userId: string;
  role: 'owner' | 'member';
  status: 'pending' | 'complete';
  name?: string;
  email?: string;
  // Aggregated data for dashboard display
  budget?: number;
  points?: number;
  airport?: string;
  preferences?: MemberPreferences;
}

// Points pool aggregation
export interface PointsPoolItem {
  program: string;
  totalBalance: number;
  memberContributions: Array<{
    userId: string;
    balance: number;
  }>;
}

export interface PointsPoolResponse {
  tripId: string;
  totalPoints: number;
  byProgram: PointsPoolItem[];
}

// OOP Optimization
export interface OptimizeOOPRequest {
  strategy?: 'minimize_cash' | 'minimize_points' | 'balanced';
  include_hotels?: boolean;
}

export interface BookingAssignment {
  category: 'flights' | 'hotels' | 'activities';
  assignedToUserId: string;
  assignedToName?: string;
  pointsUsed: number;
  cashValue: number;
  efficiency: number; // cents per point
  reason: string;
  program?: string;
}

export interface MemberCostBreakdown {
  userId: string;
  name?: string;
  initials?: string;
  baseCost: number;
  pointsSavings: number;
  finalCost: number;
  pointsUsed: number;
}

export interface OptimizeOOPResponse {
  tripId: string;
  strategy: string;
  totalCashCost: number;
  totalPointsUsed: number;
  totalSavings: number;
  bookingAssignments: BookingAssignment[];
  memberBreakdowns: MemberCostBreakdown[];
  averageEfficiency: number;
}

// Cost Allocation / Settlements
export interface Settlement {
  settlementId: string;
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  amount: number;
  status: 'pending' | 'paid' | 'confirmed';
  paidAt?: string;
  confirmedAt?: string;
}

export interface SettlementsResponse {
  tripId: string;
  settlements: Settlement[];
  totalOwed: number;
  fullySettled: boolean;
}

export interface SettlementStatusResponse {
  tripId: string;
  totalSettlements: number;
  pendingCount: number;
  paidCount: number;
  confirmedCount: number;
  totalAmount: number;
  settledAmount: number;
}

// Transfer instructions
export interface TransferInstruction {
  memberId: string;
  memberName: string;
  memberInitials: string;
  program: string;
  partner: string;
  amount: number;
  category: 'flights' | 'hotels' | 'activities';
  steps: string[];
  warning?: string;
  status: 'pending' | 'completed';
}

// Group API
export const group = {
  // Get aggregated points pool for a trip
  getPointsPool: async (tripId: string): Promise<PointsPoolResponse> => {
    return apiRequest<PointsPoolResponse>(`/group/${tripId}/points-pool`, {
      method: 'GET',
    });
  },

  // Optimize out-of-pocket costs
  optimizeOOP: async (tripId: string, options?: OptimizeOOPRequest): Promise<OptimizeOOPResponse> => {
    return apiRequest<OptimizeOOPResponse>(`/group/${tripId}/optimize-oop`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  // Simulate cost allocation without saving
  simulateAllocation: async (tripId: string, request: { itineraryId?: string }): Promise<{ allocations: MemberCostBreakdown[] }> => {
    return apiRequest<{ allocations: MemberCostBreakdown[] }>(`/group/${tripId}/simulate-allocation`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // Get all settlements for a trip
  getSettlements: async (tripId: string): Promise<SettlementsResponse> => {
    return apiRequest<SettlementsResponse>(`/group/${tripId}/settlements`, {
      method: 'GET',
    });
  },

  // Mark a settlement as paid
  markSettlementPaid: async (tripId: string, settlementId: string): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/group/${tripId}/settlements/${settlementId}/mark-paid`, {
      method: 'POST',
    });
  },

  // Confirm a settlement (by payee)
  confirmSettlement: async (tripId: string, settlementId: string): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/group/${tripId}/settlements/${settlementId}/confirm`, {
      method: 'POST',
    });
  },

  // Get settlement status summary
  getSettlementsStatus: async (tripId: string): Promise<SettlementStatusResponse> => {
    return apiRequest<SettlementStatusResponse>(`/group/${tripId}/settlements/status`, {
      method: 'GET',
    });
  },

  // Update member preferences
  updateMemberPreferences: async (tripId: string, preferences: Partial<MemberPreferences>): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/trips/${tripId}/member/preferences`, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  },

  // Get member preferences
  getMemberPreferences: async (tripId: string, userId?: string): Promise<MemberPreferences> => {
    const endpoint = userId 
      ? `/trips/${tripId}/member/${userId}/preferences`
      : `/trips/${tripId}/member/preferences`;
    return apiRequest<MemberPreferences>(endpoint, {
      method: 'GET',
    });
  },
};

// ============================================================================
// AGENTIC OPTIMIZATION API (OOP-First)
// ============================================================================

import type {
  OptimizeSoloResponse,
  OptimizeGroupResponse,
  RankedItinerary,
  CostBreakdown,
  DynamicRouteRequest,
  DynamicRouteResult,
} from '@/types/optimization';

export interface OptimizeSoloRequest {
  tripId: string;
  points: Record<string, number>;
  budget: number;
  cabinClasses?: string[];
  hotelStars?: number[];
  includeHotels?: boolean;
}

export interface OptimizeGroupRequest extends OptimizeSoloRequest {
  memberPoints: Record<string, Record<string, number>>;
  memberBudgets: Record<string, number>;
  splitMethod?: 'equal' | 'by_usage' | 'proportional';
}

export const optimization = {
  /**
   * Optimize solo trip - returns itineraries ranked by OOP (lowest first)
   * 
   * Uses agentic architecture:
   * 1. Flight Agent searches AwardTool + SerpAPI
   * 2. Hotel Agent searches hotel options
   * 3. ILP optimizer minimizes out-of-pocket
   * 4. Results ranked by lowest cash paid
   */
  solo: async (request: OptimizeSoloRequest): Promise<OptimizeSoloResponse> => {
    return apiRequest<OptimizeSoloResponse>('/optimize/solo', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: request.tripId,
        points: request.points,
        budget: request.budget,
        cabin_classes: request.cabinClasses,
        hotel_stars: request.hotelStars,
        include_hotels: request.includeHotels,
      }),
    });
  },

  /**
   * Optimize group trip - returns itineraries with settlements
   */
  group: async (request: OptimizeGroupRequest): Promise<OptimizeGroupResponse> => {
    return apiRequest<OptimizeGroupResponse>('/optimize/group', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: request.tripId,
        points: request.points,
        budget: request.budget,
        cabin_classes: request.cabinClasses,
        hotel_stars: request.hotelStars,
        include_hotels: request.includeHotels,
        member_points: request.memberPoints,
        member_budgets: request.memberBudgets,
        split_method: request.splitMethod,
      }),
    });
  },

  /**
   * Get detailed cost breakdown for an itinerary (from Cost Breakdown Agent)
   */
  getCostBreakdown: async (itineraryId: string): Promise<CostBreakdown> => {
    return apiRequest<CostBreakdown>(`/optimize/breakdown/${itineraryId}`, {
      method: 'GET',
    });
  },

  /**
   * Compare OOP vs CPP optimization strategies
   */
  compareStrategies: async (tripId: string): Promise<{
    oop: RankedItinerary | null;
    cpp: RankedItinerary | null;
    recommendation: 'oop' | 'cpp';
    explanation: string;
  }> => {
    return apiRequest(`/optimize/compare/${tripId}`, {
      method: 'GET',
    });
  },

  /**
   * Optimize multi-city route ordering for minimum out-of-pocket cost.
   * 
   * Given fixed start/end cities and intermediate cities to visit,
   * evaluates all route permutations and recommends the optimal order.
   * 
   * @example
   * // FLL → [HND, CDG] → MCO
   * // Evaluates: FLL → HND → CDG → MCO vs FLL → CDG → HND → MCO
   * const result = await optimization.dynamicRoute({
   *   startCity: 'FLL',
   *   endCity: 'MCO',
   *   intermediateCities: ['HND', 'CDG'],
   *   points: { chase: 200000 },
   *   travelDate: '2025-06-15'
   * });
   */
  dynamicRoute: async (request: DynamicRouteRequest): Promise<DynamicRouteResult> => {
    const response = await apiRequest<Record<string, unknown>>('/optimize/dynamic-route', {
      method: 'POST',
      body: JSON.stringify({
        start_city: request.startCity,
        end_city: request.endCity,
        intermediate_cities: request.intermediateCities,
        points: request.points,
        travel_date: request.travelDate,
        cabin_class: request.cabinClass || 'economy',
      }),
    });
    
    // Transform snake_case response to camelCase for frontend
    return transformKeys<DynamicRouteResult>(response);
  },
};
