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
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('id_token');
        sessionStorage.removeItem('refresh_token');
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
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('id_token');
        sessionStorage.removeItem('refresh_token');
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

    if (response.status === 204) {
      return {} as T;
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
}

export interface CreateTripRequest {
  title: string;
  start_date: string;
  end_date: string;
}

export interface Destination {
  tripId: string;
  destinationId: string;
  name: string;
  mustInclude: boolean;
  excluded: boolean;
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

// Auth API
export const auth = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const response = await apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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

  signup: async (email: string, password: string, firstName?: string, lastName?: string): Promise<SignUpResponse> => {
    return apiRequest<SignUpResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, firstName, lastName }),
    }, false); // requireAuth = false for signup
  },

  confirmSignup: async (email: string, confirmation_code: string): Promise<{ message: string }> => {
    return apiRequest<{ message: string }>('/auth/confirm', {
      method: 'POST',
      body: JSON.stringify({ email, confirmation_code }),
    }, false); // requireAuth = false for confirmation
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('id_token');
      localStorage.removeItem('refresh_token');
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('id_token');
      sessionStorage.removeItem('refresh_token');
    }
  },
};

// Trips API
export const trips = {
  create: async (title: string, start_date: string, end_date: string): Promise<Trip> => {
    return apiRequest<Trip>('/trips', {
      method: 'POST',
      body: JSON.stringify({ title, start_date, end_date }),
    });
  },

  get: async (trip_id: string): Promise<Trip> => {
    return apiRequest<Trip>('/trips/get', {
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
};

// Destinations API
export const destinations = {
  add: async (trip_id: string, name: string, must_include = false, excluded = false): Promise<Destination> => {
    return apiRequest<Destination>('/destinations/add', {
      method: 'POST',
      body: JSON.stringify({ trip_id, name, must_include, excluded }),
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
  upsert: async (trip_id: string, program: string, balance: number) => {
    return apiRequest('/points/upsert', {
      method: 'POST',
      body: JSON.stringify({ trip_id, program, balance }),
    });
  },

  summary: async (trip_id: string) => {
    return apiRequest('/points/summary', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
};

// Itineraries API
export const itineraries = {
  generate: async (trip_id: string) => {
    return apiRequest('/itinerary/generate', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },

  get: async (trip_id: string) => {
    return apiRequest<{ items: Array<Record<string, unknown>> }>('/itinerary/get', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
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

// Named exports for backward compatibility
export const createTrip = trips.create;
export const getTrip = trips.get;
export const getInviteCode = trips.invite;
export const addDestination = destinations.add;
export const listDestinations = destinations.list;
export const upsertPoints = points.upsert;
export const getPointsSummary = points.summary;
export const generateItinerary = itineraries.generate;
export const getItinerary = itineraries.get;
export const searchCities = cities.search;
