/**
 * Custom hook for fetching and generating itineraries.
 * Provides loading states, generation progress, and error handling.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { itineraries as itinerariesAPI, ItineraryItem } from '@/lib/api';

// Extended itinerary response with new display fields
export interface ItineraryResponse {
  status: string;
  statusMessage?: string;
  solution?: ItinerarySolution | null;
  items: ItineraryItem[];
  alternatives?: ItinerarySolution[];
  warnings?: Warning[];
  suggestions?: Suggestion[];
  out_of_pocket?: OutOfPocketData | null;
  out_of_pocket_hotels?: OutOfPocketHotelsData | null;
  relaxed_message?: string | null;
  ai_suggested_routes?: boolean;
  // Display fields
  displayTotalCash?: string;
  displayPointsUsed?: string;
  displayOutOfPocket?: string;
}

export interface ItinerarySolution {
  solutionId?: string;
  label?: string;
  path?: PathCity[];
  segments?: TransportSegment[];
  costs?: CostBreakdown;
  savings?: SavingsBreakdown;
  pointsUsage?: PointsUsageBreakdown;
  transferInstructions?: TransferInstruction[];
}

export interface PathCity {
  order: number;
  cityName: string;
  cityCode: string;
  arrivalDate?: string | null;
  departureDate?: string | null;
  nightsStay: number;
}

export interface TransportSegment {
  segmentId: string;
  order: number;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  mode: 'flight' | 'train' | 'bus' | 'car' | 'ferry';
  modeIcon: string;
  modeLabel: string;
  operator?: string;
  operatorCode?: string;
  operatorLogo?: string | null;
  flightNumber?: string | null;
  departureTime?: string;
  arrivalTime?: string;
  departureDate?: string;
  arrivalDate?: string;
  durationMinutes?: number;
  displayDuration?: string;
  paymentMethod: 'cash' | 'points';
  cashCost?: number | null;
  displayCashCost?: string | null;
  pointsUsed?: number | null;
  pointsProgram?: string | null;
  pointsProgramCode?: string | null;
  surcharge?: number | null;
  displaySurcharge?: string | null;
  transferFrom?: string | null;
  transferFromCode?: string | null;
  cashEquivalent?: number;
  displayCashEquivalent?: string;
  valuePerPoint?: number | null;
}

export interface CostBreakdown {
  totalCash: number;
  cashBookings: number;
  pointsSurcharges: number;
  displayTotalCash: string;
  totalPointsUsed: number;
  displayPointsUsed: string;
  pointsValueUsed: number;
  totalTripValue: number;
  displayTripValue: string;
}

export interface SavingsBreakdown {
  allCashCost: number;
  displayAllCashCost: string;
  outOfPocket: number;
  displayOutOfPocket: string;
  cashSaved: number;
  displayCashSaved: string;
  savingsPercentage: number;
  displaySavingsPercentage: string;
  segmentSavings?: SegmentSaving[];
}

export interface SegmentSaving {
  segmentId: string;
  cashPrice: number;
  outOfPocket: number;
  saved: number;
  method: string;
}

export interface PointsUsageBreakdown {
  byProgram: ProgramUsage[];
  totalBankPointsUsed: number;
  totalAirlineMilesUsed: number;
  remainingPoints: ProgramBalance[];
}

export interface ProgramUsage {
  program: string;
  programCode: string;
  category: 'bank' | 'airline';
  used: number;
  displayUsed: string;
  remaining: number;
  displayRemaining: string;
  transferredTo?: string | null;
}

export interface ProgramBalance {
  program: string;
  programCode: string;
  balance: number;
  displayBalance: string;
}

export interface TransferInstruction {
  order: number;
  fromProgram: string;
  fromProgramCode: string;
  toProgram: string;
  toProgramCode: string;
  pointsToTransfer: number;
  displayPoints: string;
  estimatedTime: string;
  instructions: string[];
  warningMessage?: string | null;
}

export interface Warning {
  type: 'budget' | 'availability' | 'timing' | 'transfer';
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string | null;
}

export interface Suggestion {
  type: 'save_more' | 'faster' | 'alternative';
  title: string;
  description: string;
  actionLabel: string;
  actionUrl?: string | null;
}

export interface OutOfPocketData {
  best_by_cash?: { price?: number; out_of_pocket?: number } | null;
  best_by_surcharge?: { surcharge?: number; out_of_pocket?: number; points?: number } | null;
  best_overall?: { out_of_pocket?: number; price?: number; surcharge?: number; points?: number } | null;
  origin?: string;
  destination?: string;
  outbound_date?: string;
  return_date?: string;
}

export interface OutOfPocketHotelsData {
  best_by_cash?: { cash?: number; out_of_pocket?: number } | null;
  best_by_points?: { surcharge?: number; out_of_pocket?: number } | null;
  best_overall?: { out_of_pocket?: number; cash?: number; points?: number; surcharge?: number } | null;
  destination?: string;
  check_in?: string;
  check_out?: string;
}

export interface UseItineraryResult {
  itinerary: ItineraryResponse | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
  progress: number;
  progressMessage: string;
  generate: () => Promise<ItineraryResponse | null>;
  fetch: () => Promise<void>;
  reset: () => void;
}

const PROGRESS_STEPS = [
  { progress: 10, message: 'Analyzing your destinations...' },
  { progress: 25, message: 'Searching for flights...' },
  { progress: 40, message: 'Checking train and bus options...' },
  { progress: 55, message: 'Fetching award availability...' },
  { progress: 70, message: 'Optimizing points usage...' },
  { progress: 85, message: 'Calculating savings...' },
  { progress: 95, message: 'Finalizing your itinerary...' },
];

export function useItinerary(tripId: string | null): UseItineraryResult {
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  // Progress simulation during generation
  useEffect(() => {
    if (!generating) {
      setProgress(0);
      setProgressMessage('');
      return;
    }

    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < PROGRESS_STEPS.length) {
        setProgress(PROGRESS_STEPS[stepIndex].progress);
        setProgressMessage(PROGRESS_STEPS[stepIndex].message);
        stepIndex++;
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [generating]);

  const fetchItinerary = useCallback(async () => {
    if (!tripId) {
      setItinerary(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await itinerariesAPI.get(tripId);
      setItinerary(result as ItineraryResponse);
    } catch (e) {
      // Not finding an existing itinerary is not an error
      const message = e instanceof Error ? e.message : 'Failed to fetch itinerary';
      if (!message.includes('not found') && !message.includes('404')) {
        setError(message);
      }
      setItinerary(null);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  const generateItinerary = useCallback(async (): Promise<ItineraryResponse | null> => {
    if (!tripId) return null;

    setGenerating(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Starting optimization...');

    try {
      const result = await itinerariesAPI.generate(tripId);
      const response = result as ItineraryResponse;
      setItinerary(response);
      setProgress(100);
      setProgressMessage('Complete!');
      return response;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate itinerary';
      setError(message);
      return null;
    } finally {
      setGenerating(false);
    }
  }, [tripId]);

  const reset = useCallback(() => {
    setItinerary(null);
    setLoading(false);
    setGenerating(false);
    setError(null);
    setProgress(0);
    setProgressMessage('');
  }, []);

  return {
    itinerary,
    loading,
    generating,
    error,
    progress,
    progressMessage,
    generate: generateItinerary,
    fetch: fetchItinerary,
    reset,
  };
}

export default useItinerary;
