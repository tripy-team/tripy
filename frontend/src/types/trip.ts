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

export interface FlexibilitySummary {
  bestDate?: {
    date: string;
    oop: number;
    hasAward: boolean;
    savings: number;
    cpp?: number | null;
  } | null;
  topAwardDates?: Array<{ date: string; oop: number; points?: number | null; cpp?: number | null }>;
  topCashDates?: Array<{ date: string; price?: number | null }>;
  flexibilitySavings?: number;
  hasFlexibilitySavings?: boolean;
  // multi-segment case (from optimize_multi_segment_dates)
  segments?: Array<{
    segment: string;
    date: string;
    oop: number;
    hasAward: boolean;
    cashPrice?: number | null;
    awardPoints?: number | null;
    savings: number;
    cpp?: number | null;
  }>;
  totalOop?: number;
  totalSavings?: number;
  totalPoints?: number;
  averageCpp?: number;
}

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
  flexibilityDays?: number;

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
  flexibilityDays?: number;
  flexibilitySummary?: FlexibilitySummary;
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
