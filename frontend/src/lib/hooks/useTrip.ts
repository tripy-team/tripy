/**
 * Custom hook for fetching and managing trip data.
 * Provides loading states, error handling, and refetch capabilities.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { trips as tripsAPI, Trip } from '@/lib/api';

export interface UseTripResult {
  trip: Trip | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTrip(tripId: string | null): UseTripResult {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrip = useCallback(async () => {
    if (!tripId) {
      setTrip(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await tripsAPI.get(tripId);
      setTrip(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch trip';
      setError(message);
      setTrip(null);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchTrip();
  }, [fetchTrip]);

  return {
    trip,
    loading,
    error,
    refetch: fetchTrip,
  };
}

export default useTrip;
