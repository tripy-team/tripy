'use client';

/**
 * useSoloTransferStrategy Hook
 * 
 * Loads booking instructions for a selected itinerary in the solo booking flow.
 * Uses typed TransferInstruction and BookingStep from the new schemas.
 */

import { useState, useCallback } from 'react';
import { toSnakeCase, toCamelCase } from '@/lib/serializers';
import { getProgramLabel } from '@/lib/programLabels';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

// Types aligned with backend schemas
export interface TransferInstruction {
  stepNumber: number;
  sourceProgram: string;
  targetProgram: string;
  pointsToTransfer: number;
  transferRatio: number;
  expectedTransferTime: string;
  portalUrl: string;
  warning?: string;
  bonusPercentage?: number;
  bonusEndDate?: string;
}

export interface FlightLegDetail {
  origin: string;
  destination: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes?: number;
  flightNumber: string;
  marketingCarrier: string;
  operatingCarrier?: string;
  aircraft?: string;
  cabin?: string;
}

export interface LayoverDetail {
  airport: string;
  airportName?: string;
  durationMinutes: number;
  isShort: boolean;
  isLong: boolean;
}

export interface BookingStep {
  stepNumber: number;
  type: 'flight' | 'hotel';
  airline?: string;
  hotelChain?: string;  // Fixup 6: Use hotelChain, not hotelName
  bookingUrl: string;
  segmentReference: string;

  // Flight-specific details
  origin?: string;
  destination?: string;
  departureTime?: string;
  arrivalTime?: string;
  cabinClass?: string;
  flightNumber?: string;
  operatingAirline?: string;
  durationMinutes?: number;

  // Connection details
  stops?: number;
  legs?: FlightLegDetail[];
  layovers?: LayoverDetail[];

  // Payment details
  paymentMethod?: 'points' | 'cash';
  pointsUsed?: number;
  cashPrice?: number;
  surcharge?: number;
  program?: string;
  paymentReason?: string;
}

export interface TransferStrategyResponse {
  transfers: TransferInstruction[];
  bookings: BookingStep[];
  totalPointsToTransfer: number;
  estimatedTotalTime: string;
  warnings: string[];
}

// Transformed step for UI display
export interface BookingGuideStep {
  stepNumber: number;
  action: 'transfer' | 'book_flight' | 'book_hotel';
  title: string;
  description: string;
  details: {
    from?: string;
    to?: string;
    points?: number;
    transferTime?: string;
    portalUrl?: string;
    bookingUrl?: string;
    warning?: string;

    // Flight-specific details
    flightNumber?: string;
    origin?: string;
    destination?: string;
    departureTime?: string;
    arrivalTime?: string;
    cabinClass?: string;
    airline?: string;
    operatingAirline?: string;
    durationMinutes?: number;
    stops?: number;
    legs?: FlightLegDetail[];
    layovers?: LayoverDetail[];

    // Payment info
    paymentMethod?: 'points' | 'cash';
    pointsUsed?: number;
    cashPrice?: number;
    surcharge?: number;
    program?: string;
    paymentReason?: string;
  };
}

export interface UseSoloTransferStrategyResult {
  steps: BookingGuideStep[];
  loading: boolean;
  error: string | null;
  loadStrategy: (tripId: string, itineraryId: string) => Promise<void>;
  rawTransfers: TransferInstruction[];
  rawBookings: BookingStep[];
}

/**
 * Get access token from storage
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
}

/**
 * Hook for loading transfer strategy and booking instructions
 */
export function useSoloTransferStrategy(): UseSoloTransferStrategyResult {
  const [steps, setSteps] = useState<BookingGuideStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTransfers, setRawTransfers] = useState<TransferInstruction[]>([]);
  const [rawBookings, setRawBookings] = useState<BookingStep[]>([]);

  const loadStrategy = useCallback(async (tripId: string, itineraryId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const token = getAccessToken();
      
      const requestBody = toSnakeCase({
        tripId,
        itineraryId,
      });
      
      const response = await fetch(`${BACKEND_URL}/solo/transfer-strategy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Failed to load transfer strategy: ${response.status} ${errorText}`);
      }
      
      const rawData = await response.json();
      const data: TransferStrategyResponse = toCamelCase(rawData);
      
      // Store raw data
      setRawTransfers(data.transfers || []);
      setRawBookings(data.bookings || []);
      
      // Transform to BookingGuideSteps for UI
      const transformedSteps: BookingGuideStep[] = [];
      let stepNum = 1;
      
      // Add transfer steps first
      for (const t of data.transfers || []) {
        // Use getProgramLabel() - never display raw IDs like "air_france_klm"
        transformedSteps.push({
          stepNumber: stepNum++,
          action: 'transfer',
          title: `Transfer to ${getProgramLabel(t.targetProgram)}`,
          description: `Move ${t.pointsToTransfer.toLocaleString()} points from ${getProgramLabel(t.sourceProgram)}`,
          details: {
            from: t.sourceProgram,  // Keep raw ID for internal use
            to: t.targetProgram,    // Keep raw ID for internal use
            points: t.pointsToTransfer,
            transferTime: t.expectedTransferTime,
            portalUrl: t.portalUrl,
            warning: t.warning,
          },
        });
      }
      
      // Add booking steps
      for (const b of data.bookings || []) {
        if (b.type === 'flight') {
          // Build a rich title with flight number and route
          const flightLabel = b.flightNumber
            ? `${b.airline || 'Flight'} ${b.flightNumber}`
            : (b.airline || 'Flight');
          const routeLabel = b.origin && b.destination
            ? `${b.origin} → ${b.destination}`
            : '';
          const title = routeLabel
            ? `Book ${flightLabel} (${routeLabel})`
            : `Book ${flightLabel}`;

          transformedSteps.push({
            stepNumber: stepNum++,
            action: 'book_flight',
            title,
            description: b.segmentReference,
            details: {
              bookingUrl: b.bookingUrl,
              flightNumber: b.flightNumber,
              origin: b.origin,
              destination: b.destination,
              departureTime: b.departureTime,
              arrivalTime: b.arrivalTime,
              cabinClass: b.cabinClass,
              airline: b.airline,
              operatingAirline: b.operatingAirline,
              durationMinutes: b.durationMinutes,
              stops: b.stops,
              legs: b.legs,
              layovers: b.layovers,
              paymentMethod: b.paymentMethod,
              pointsUsed: b.pointsUsed,
              cashPrice: b.cashPrice,
              surcharge: b.surcharge,
              program: b.program,
              paymentReason: b.paymentReason,
            },
          });
        } else {
          // Fixup 6: Use hotelChain (from backend hotel_chain after serialization)
          transformedSteps.push({
            stepNumber: stepNum++,
            action: 'book_hotel',
            title: `Book ${b.hotelChain || 'Hotel'}`,
            description: b.segmentReference,
            details: { bookingUrl: b.bookingUrl },
          });
        }
      }
      
      setSteps(transformedSteps);
      
    } catch (err) {
      console.error('Transfer strategy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load transfer strategy');
      setSteps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    steps,
    loading,
    error,
    loadStrategy,
    rawTransfers,
    rawBookings,
  };
}

export default useSoloTransferStrategy;
