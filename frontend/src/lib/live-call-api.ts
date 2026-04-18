/**
 * Server-side persistence for live-call sessions.
 *
 * Wraps the existing auth'd Next.js routes:
 *   POST /api/clients/:clientId/meetings/:meetingId/live/start
 *   POST /api/clients/:clientId/meetings/:meetingId/live/stop
 *
 * So transcript chunks + commit-ready suggestions survive the call ending.
 */

import type { FinalEvent, TranscriptChunk } from './cactus-ws';

function authHeaders(): HeadersInit {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('tripy_token')
      : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface StartedLiveCall {
  id: string;
  meetingSessionId: string;
  status: string;
  startedAt: string | null;
}

export async function startLiveCall(
  clientId: string,
  meetingId: string,
): Promise<StartedLiveCall> {
  const res = await fetch(
    `/api/clients/${clientId}/meetings/${meetingId}/live/start`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!res.ok) {
    throw new Error(`Failed to start live call: ${res.status}`);
  }
  return res.json();
}

export async function stopLiveCall(
  clientId: string,
  meetingId: string,
  payload: {
    transcript: TranscriptChunk[];
    commitReady: FinalEvent['commitReady'];
  },
): Promise<void> {
  const res = await fetch(
    `/api/clients/${clientId}/meetings/${meetingId}/live/stop`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    // Don't fail the UI flow — log and move on; the call already ended
    console.error('[live-call-api] stop failed', res.status, await res.text());
  }
}
