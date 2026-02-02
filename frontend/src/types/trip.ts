/**
 * Trip Types for Solo Booking Flow (Flights Only)
 * 
 * These types mirror the backend schemas and are used at the API boundary.
 * Frontend uses camelCase; serializers handle conversion to/from snake_case.
 */

export type TripType = 'one_way' | 'round_trip';
export type DateMode = 'fixed' | 'flexible';
export type OptimizationMode = 'oop' | 'cpp' | 'balanced';
export type FlightClass = 'basic_economy' | 'economy' | 'premium' | 'business' | 'first';
export type TimePreference = 'any' | 'morning' | 'afternoon' | 'evening' | 'night';
export type TripStatus = 'draft' | 'optimized' | 'selected' | 'instructions_unlocked' | 'completed' | 'cancelled';

/**
 * Request to create a new solo trip
 */
export interface CreateTripRequest {
  title: string;
  tripType: TripType;
  dateMode: DateMode;
  
  // REQUIRED: Origin and destinations (P0-9 fix)
  origin: string;           // IATA code, e.g., "JFK"
  destinations: string[];   // IATA codes for cities to visit
  finalDestination?: string; // For one-way; defaults to origin for round-trip
  
  // Only required if dateMode === "fixed"
  startDate?: string;
  endDate?: string;
  // Only used if dateMode === "flexible"
  durationDays?: number;
  
  maxBudget?: number;
  
  adults?: number;
  children?: number;
  bags?: number;
  flightClass?: FlightClass;
  optimizationMode?: OptimizationMode;
  departureTimePreference?: TimePreference;
  arrivalTimePreference?: TimePreference;
}

/**
 * Trip response from API (after camelCase transformation)
 */
export interface Trip {
  tripId: string;
  title: string;
  tripType: TripType;
  dateMode: DateMode;
  origin: string;
  destinations: string[];
  finalDestination?: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  maxBudget?: number;
  adults: number;
  children: number;
  bags: number;
  flightClass: FlightClass;
  optimizationMode: OptimizationMode;
  departureTimePreference: TimePreference;
  arrivalTimePreference: TimePreference;
  status: TripStatus;
  createdAt: string;
  createdBy: string;
  inviteCode?: string;
}

/**
 * Request to update trip status
 */
export interface UpdateTripStatusRequest {
  status: TripStatus;
  paymentProof?: PaymentProof;
}

/**
 * Payment proof stored in trip metadata
 */
export interface PaymentProof {
  provider: 'mock' | 'stripe';
  status: string;
  paymentIntentId?: string;
  paidAt: string;
  amount: number;
  currency: string;
}

/**
 * Request to select an itinerary
 */
export interface SelectItineraryRequest {
  itineraryId: string;
  itinerarySnapshot: unknown; // Full itinerary for reproducibility
  cashPriceAtSelection: number;
  outOfPocketAtSelection: number;
}

/**
 * Selection response
 */
export interface SelectionResponse {
  ok: boolean;
  itineraryId?: string;
  itinerarySnapshot?: unknown;
  cashPriceAtSelection?: number;
  outOfPocketAtSelection?: number;
  selectedAt?: string;
}
