/**
 * API Client for Tripy Backend
 * 
 * This client handles communication with the backend FastAPI server.
 * In development, set NEXT_PUBLIC_BACKEND_URL in your .env.local file (e.g., http://localhost:8000)
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

// Log backend URL in development for debugging
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  console.log('Backend URL:', BACKEND_URL);
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

    return response.json();
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

  forgotPassword: async (email: string): Promise<{ message: string; code_delivery_details?: any }> => {
    return apiRequest<{ message: string; code_delivery_details?: any }>('/auth/forgot-password', {
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
  create: async (params: { title: string; start_date: string; end_date: string }): Promise<Trip> => {
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

  invite: async (trip_id: string): Promise<{ inviteCode: string }> => {
    return apiRequest<{ inviteCode: string }>('/trips/invite', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    });
  },
};

// Destinations API
export const destinations = {
  add: async (params: { trip_id: string; name: string; must_include?: boolean; excluded?: boolean }): Promise<Destination> => {
    return apiRequest<Destination>('/destinations/add', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: params.trip_id,
        name: params.name,
        must_include: params.must_include ?? false,
        excluded: params.excluded ?? false,
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
export const searchCities = cities.search;
