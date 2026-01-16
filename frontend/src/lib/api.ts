// Simplified API client - all endpoints in one file
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.tripy.com';

function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('auth_token');
  }
  return null;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Auth
export const auth = {
  login: (email: string, password: string) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
    }
  },
};

// Trips
export const trips = {
  create: (title: string, start_date: string, end_date: string) =>
    request('/trips', {
      method: 'POST',
      body: JSON.stringify({ title, start_date, end_date }),
    }),

  get: (trip_id: string) =>
    request('/trips/get', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),

  invite: (trip_id: string) =>
    request('/trips/invite', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),

  join: (invite_code: string) =>
    request('/trips/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code }),
    }),

  members: (trip_id: string) =>
    request('/trips/members', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),
};

// Destinations
export const destinations = {
  add: (trip_id: string, name: string, must_include = false, excluded = false) =>
    request('/destinations/add', {
      method: 'POST',
      body: JSON.stringify({ trip_id, name, must_include, excluded }),
    }),

  list: (trip_id: string) =>
    request('/destinations/list', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),

  vote: (trip_id: string, destination_id: string, vote: -1 | 0 | 1) =>
    request('/destinations/vote', {
      method: 'POST',
      body: JSON.stringify({ trip_id, destination_id, vote }),
    }),
};

// Points
export const points = {
  upsert: (trip_id: string, program: string, balance: number) =>
    request('/points/upsert', {
      method: 'POST',
      body: JSON.stringify({ trip_id, program, balance }),
    }),

  summary: (trip_id: string) =>
    request('/points/summary', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),
};

// Itineraries
export const itineraries = {
  generate: (trip_id: string) =>
    request('/itinerary/generate', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),

  get: (trip_id: string) =>
    request('/itinerary/get', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),
};

// Users
export const users = {
  me: () => request('/users/me'),

  updateProfile: (data: { name?: string; default_home_airport?: string; timezone?: string }) =>
    request('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
