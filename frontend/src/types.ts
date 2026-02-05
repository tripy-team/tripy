// All TypeScript types in one file for simplicity

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// User
export interface User {
  id: string;
  name: string;
  email: string;
  default_home_airport?: string;
  timezone?: string;
}

export interface Member {
  id: number;
  name: string;
  initials: string;
  budget: number;
  points: number;
  airport: string;
  status: 'pending' | 'complete';
}

// Trip
export type TripStatus = 'upcoming' | 'planning' | 'completed';
export type TripType = 'solo' | 'group';

export interface Trip {
  id: string;
  name: string;
  destination: string;
  dates: string;
  status: TripStatus;
  type: TripType;
  pointsUsed: number;
  cashSaved: number;
  thumbnail: string;
  members: number;
}

// Itinerary
export interface City {
  name: string;
  days: number;
}

export interface Itinerary {
  id: number;
  name: string;
  cities: City[];
  pointsCost: number;
  score: number;
  totalCost?: number; // For solo
  totalCostPerPerson?: number; // For group
}

// Destination
export type DestinationCategory = 'beach' | 'city' | 'adventure' | 'culture';

export interface Destination {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  avgPoints: number;
  avgCash: number;
  popularity: number;
  image: string;
  description: string;
  bestTime: string;
  category: DestinationCategory;
}

// Credit Cards
export interface CreditCard {
  id: string;
  program: string;
  points: number;
}
