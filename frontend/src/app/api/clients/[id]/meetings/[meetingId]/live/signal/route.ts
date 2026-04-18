import { requireAuth, json, errorResponse } from "@/lib/auth";

/**
 * Simple in-memory signaling relay for WebRTC.
 * In production, this would use a persistent store or WebSocket.
 */
const signalStore = new Map<string, Array<{
  type: string;
  payload: unknown;
  from: string;
  to: string;
  timestamp: number;
}>>();

function getKey(meetingId: string, role: string): string {
  return `${meetingId}:${role}`;
}

// Cleanup old signals (older than 30 seconds)
function cleanup(meetingId: string) {
  const now = Date.now();
  for (const [key, signals] of signalStore.entries()) {
    if (!key.startsWith(meetingId)) continue;
    const filtered = signals.filter((s) => now - s.timestamp < 30000);
    if (filtered.length === 0) {
      signalStore.delete(key);
    } else {
      signalStore.set(key, filtered);
    }
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    await requireAuth(request);
    const { meetingId } = await params;
    const url = new URL(request.url);
    const role = url.searchParams.get("role") || "advisor";

    cleanup(meetingId);

    const key = getKey(meetingId, role);
    const signals = signalStore.get(key) || [];

    // Drain the queue
    signalStore.delete(key);

    return json(signals);
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    await requireAuth(request);
    const { meetingId } = await params;
    const body = await request.json();

    const signal = {
      type: body.type,
      payload: body.payload,
      from: body.from,
      to: body.to,
      timestamp: Date.now(),
    };

    // Store signal for the target role
    const key = getKey(meetingId, signal.to);
    const existing = signalStore.get(key) || [];
    existing.push(signal);
    signalStore.set(key, existing);

    return json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}
