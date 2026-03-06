'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createSSEParser } from '@/lib/sse/parse';
import { getAccessToken } from '@/lib/api';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

export type Phase =
  | 'loading'
  | 'airports'
  | 'flights'
  | 'optimizing'
  | 'saving'
  | 'tips';

export type StreamError = {
  code: string;
  userMessage: string;
  debugId: string;
};

export type StreamState = {
  status: 'idle' | 'streaming' | 'polling' | 'complete' | 'error';
  phase: Phase | null;
  message: string | null;
  progress: { current: number; total: number; unit: string } | null;
  jobId: string | null;
  itineraryVersion: number | null;
  degraded: boolean;
  skippedRoutes: string[];
  error: StreamError | null;
};

const INITIAL_STATE: StreamState = {
  status: 'idle',
  phase: null,
  message: null,
  progress: null,
  jobId: null,
  itineraryVersion: null,
  degraded: false,
  skippedRoutes: [],
  error: null,
};

/**
 * Hook for streaming itinerary generation with automatic SSE → polling fallback.
 *
 * Usage:
 *   const stream = useItineraryStream();
 *   await stream.generate(tripId);
 *   // stream.status === 'complete' when done
 */
export function useItineraryStream() {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (tripId: string) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        try {
          const token = getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(
            `${BACKEND_URL}/itinerary/jobs/latest/${tripId}`,
            { headers },
          );
          if (!res.ok) return;
          const data = await res.json();

          setState((s) => ({
            ...s,
            phase: data.phase ?? s.phase,
            message: data.message ?? s.message,
            progress: data.progress ?? s.progress,
          }));

          if (data.status === 'complete') {
            stopPolling();
            setState((s) => ({
              ...s,
              status: 'complete',
              itineraryVersion: data.itineraryVersion ?? null,
            }));
          } else if (data.status === 'error') {
            stopPolling();
            setState((s) => ({
              ...s,
              status: 'error',
              error: data.error ?? {
                code: 'WORKER_ERROR',
                userMessage: data.message ?? 'Generation failed.',
                debugId: '',
              },
            }));
          }
        } catch {
          // network error during poll — keep trying
        }
      }, 3000);
    },
    [stopPolling],
  );

  const generate = useCallback(
    async (tripId: string) => {
      const requestId = crypto.randomUUID();
      setState({ ...INITIAL_STATE, status: 'streaming' });
      stopPolling();

      const token = getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const controller = new AbortController();
      abortRef.current = controller;

      let response: Response;
      try {
        response = await fetch(`${BACKEND_URL}/itinerary/generate-stream`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ trip_id: tripId, request_id: requestId }),
          signal: controller.signal,
        });
      } catch {
        setState((s) => ({
          ...s,
          status: 'error',
          error: {
            code: 'HTTP_ERROR',
            userMessage: 'Failed to connect to server.',
            debugId: requestId,
          },
        }));
        return;
      }

      if (!response.ok || !response.body) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: {
            code: 'HTTP_ERROR',
            userMessage: `Server returned ${response.status}.`,
            debugId: requestId,
          },
        }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSSEParser();

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const events = parser.push(decoder.decode(value, { stream: true }));
          for (const raw of events) {
            if (!raw.data) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw.data);
            } catch {
              continue;
            }

            if (event.type === 'status') {
              const s = event.status as string;
              if (s === 'queued' || s === 'already_processing') {
                setState((prev) => ({
                  ...prev,
                  status: 'polling',
                  jobId: (event.jobId as string) ?? null,
                  message: (event.message as string) ?? prev.message,
                }));
                startPolling(tripId);
                return;
              }
              if (s === 'complete') {
                setState((prev) => ({
                  ...prev,
                  status: 'complete',
                  itineraryVersion:
                    (event.itineraryVersion as number) ?? null,
                  degraded: (event.degraded as boolean) ?? false,
                  skippedRoutes:
                    (event.skippedRoutes as string[]) ?? [],
                }));
                return;
              }
              if (s === 'error') {
                setState((prev) => ({
                  ...prev,
                  status: 'error',
                  error: (event.error as StreamError) ?? {
                    code: 'UNKNOWN',
                    userMessage: 'Unknown error',
                    debugId: requestId,
                  },
                }));
                return;
              }
            }

            if (event.type === 'phase' || event.type === 'progress') {
              setState((prev) => ({
                ...prev,
                phase: (event.phase as Phase) ?? prev.phase,
                message: (event.message as string) ?? prev.message,
                progress:
                  (event.progress as StreamState['progress']) ??
                  prev.progress,
              }));
            }
          }
        }

        // Stream ended without a terminal event — connection likely dropped.
        // Fall back to polling in case a queued job is still running.
        setState((s) => ({
          ...s,
          status: 'polling',
          message: 'Reconnecting...',
        }));
        startPolling(tripId);
      } finally {
        reader.releaseLock();
      }
    },
    [startPolling, stopPolling],
  );

  const cancel = useCallback(() => {
    stopPolling();
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, [stopPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
      abortRef.current?.abort();
    };
  }, [stopPolling]);

  return { ...state, generate, cancel };
}
