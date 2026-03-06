# Implementation Plan: Faster Itinerary Generation

## Problem

Itinerary generation is slow and opaque. When a user clicks "Generate" (group flow) or lands on the results page (solo flow), a single synchronous HTTP request fires to `POST /itinerary/generate`. The backend must complete the entire pipeline — loading trip data, resolving airports, fetching flights across all origin-destination pairs, running the ILP solver, generating AI tips, and writing results to DynamoDB — before returning a response.

This creates three concrete problems:

1. **Timeout failures.** The Lambda deployment has a hard 30-second ceiling (API Gateway HTTP API limit). Complex trips with 5+ destinations produce 30+ O-D pairs, each requiring SerpAPI and AwardTool calls. Even with a semaphore of 8, the flight-fetching phase alone can take 25s+, and the ILP solver can add another 10-30s. The request times out and the user sees an error.

2. **No progress visibility.** The frontend shows a `TripGenerationLoader` component with a time-based animation (default 55s, group uses 20s). The progress bar, stage labels ("Searching flights...", "Optimizing..."), and percentages are entirely decorative — they have no connection to what the backend is actually doing. If the backend finishes in 8s, the user still watches an animation. If it takes 45s, the animation stalls at 99%.

3. **Perceived slowness.** Even when generation completes within the timeout, the lack of real feedback makes 15 seconds feel like a minute. Users have no sense of whether the system is working, stuck, or failed.

**Affected flows:**
- **Group:** `frontend/src/app/(app)/group/payment/page.tsx` → `generateItinerary(tripId)` → `POST /itinerary/generate` → `itinerary_service.generate_optimized_itinerary()`
- **Solo (legacy fallback):** `frontend/src/app/(app)/solo/results/page.tsx` → `itinerariesAPI.generate(tripId)` → same endpoint
- **Solo (primary):** `POST /solo/optimize` → `OrchestratorAgent.optimize_solo()` (different pipeline, same class of problem)

**Where time is spent in `generate_optimized_itinerary` (itinerary_service.py):**

| Phase | Duration | Why |
|-------|----------|-----|
| Load trip/destinations/members/points | ~200ms | DynamoDB reads, fast |
| Resolve cities → airports | ~1-2s | CSV lookup + occasional OpenAI fallback (10s timeout) |
| Fetch flight edges (all O-D pairs) | 5-25s | SerpAPI (25s read timeout) + AwardTool (30s timeout), semaphore 8 |
| ILP optimization | 2-30s | PuLP single-threaded solver, 60s timeout |
| Smart tips + transfer tips | 2-5s | OpenAI gpt-4o-mini, run in parallel |
| Write results to DynamoDB | ~200ms | batch_write_items |

---

## Solution

**Hybrid SSE + SQS**: Stream real-time progress to the frontend for every generation, and offload complex trips to a background worker when they exceed what a single request can handle.

### What this means in the context of Tripy

Today, the user experience is: click generate → stare at a fake progress bar → either get results or get an error after 30 seconds. The bar says "Optimizing your flights..." but has no idea what the backend is doing.

After this change, the experience becomes:

1. **User clicks generate.** The frontend opens an SSE connection via `fetch` (POST with `ReadableStream`, not `EventSource` — see design decision in Phase 3) to a new streaming endpoint.
2. **Real progress appears immediately.** The backend yields typed events as it works: "Loading trip data...", "Resolving airports for 4 cities...", "Searching flights: LAX → NRT (3/12)...", "Running optimization...", "Saving itinerary...".
3. **For simple trips (≤4 destinations, ≤20 O-D pairs):** Generation completes in 10-20s over the SSE stream. No queuing, no polling, minimal overhead.
4. **For complex trips (>4 destinations or >20 O-D pairs):** The backend decides **before flight fetching** to hand off to an SQS worker. It sends a `{ type: "status", status: "queued", jobId: "..." }` SSE event and closes the stream. The frontend automatically switches to polling `GET /itinerary/jobs/latest/{tripId}` every 3s. A worker Lambda with a 15-minute timeout runs the full pipeline and writes progress + results to DynamoDB.
5. **Results are always persisted.** Whether delivered via SSE or async worker, final results end up in the `tripy-itinerary` DynamoDB table with a monotonically increasing `itineraryVersion` (stored on the trip record in `tripy-trips`). If the SSE connection drops mid-stream, the frontend can always fall back to `GET /itinerary/get`.
6. **Duplicate clicks are safe.** A trip-level generation lock (conditional DynamoDB write on `__generation_lock__`) prevents concurrent jobs for the same trip. A second click for an in-progress job receives the existing job's status.

The key insight is that **most trips are simple** (2-3 destinations, <15 O-D pairs). These should stream directly with excellent UX. Only the long-tail complex trips need the async fallback.

**Explicit non-goal for v1:** Partial results UI. We will *not* render individual flights as they arrive. The SSE stream delivers progress messages and phase updates only. The frontend always calls `GET /itinerary/get` after receiving a `complete` status to load the full itinerary. This avoids building a half-baked partial list that doesn't map to the final ILP-optimized itinerary. We can revisit partial rendering in a future iteration once the streaming infrastructure is proven.

---

## SSE Protocol Specification

### Event Schema (v1)

All events share a base envelope. The schema is versioned so the frontend can ignore unknown versions gracefully.

**Wire format uses camelCase** for all field names (consistent with the existing frontend API contract). The Python model uses `Field(alias=...)` to map from snake_case internally.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | integer | yes | Schema version. Currently `1`. |
| `seq` | integer | yes | Monotonically increasing sequence number per stream. Frontend uses this to detect missed events or stale data. |
| `tripId` | string | yes | The trip this event belongs to. |
| `jobId` | string | no | Present when job is queued to SQS. Used for polling. |
| `type` | string enum | yes | One of: `phase`, `progress`, `status`. |
| `phase` | string enum | no | Current pipeline phase. One of: `loading`, `airports`, `flights`, `optimizing`, `saving`, `tips`. Strict enum — no ad-hoc strings. |
| `status` | string enum | no | For `type=status` events. One of: `started`, `queued`, `already_processing`, `complete`, `error`. |
| `message` | string | no | Human-readable progress message for display. |
| `progress` | object | no | `{ current: int, total: int, unit: string }`. Unit is one of: `"pair"`, `"city"`, `"step"`. |
| `ts` | string (ISO 8601) | yes | Server timestamp when the event was emitted. |
| `itineraryVersion` | integer | no | Present on `complete` status. Monotonic version for result staleness detection. |
| `degraded` | boolean | no | `true` if some routes were skipped. Present on `complete` status. |
| `skippedRoutes` | string[] | no | List of skipped O-D pairs (e.g. `["SFO→CDG"]`). Present when `degraded=true`. |
| `error` | object | no | Present on error status. `{ code: string, userMessage: string, debugId: string }`. |

**Removed `type=result`:** The stream does not carry the full itinerary payload. Every flow — SSE inline, SSE cached, and polling — terminates with `type=status, status=complete` containing only `itineraryVersion`. The frontend **always** calls `GET /itinerary/get` afterward to load items. This keeps SSE payloads small and the data-loading path consistent.

### Example Payloads

```json
{"v":1,"seq":1,"tripId":"abc-123","type":"status","status":"started","ts":"2025-03-04T10:00:00Z"}
{"v":1,"seq":2,"tripId":"abc-123","type":"phase","phase":"loading","message":"Loading trip data...","ts":"2025-03-04T10:00:00Z"}
{"v":1,"seq":3,"tripId":"abc-123","type":"phase","phase":"airports","message":"Resolving airports for 4 cities...","progress":{"current":0,"total":4,"unit":"city"},"ts":"2025-03-04T10:00:01Z"}
{"v":1,"seq":8,"tripId":"abc-123","type":"phase","phase":"flights","message":"Searching 12 flight routes...","progress":{"current":0,"total":12,"unit":"pair"},"ts":"2025-03-04T10:00:02Z"}
{"v":1,"seq":14,"tripId":"abc-123","type":"progress","phase":"flights","message":"Searched SFO → CDG","progress":{"current":6,"total":12,"unit":"pair"},"ts":"2025-03-04T10:00:08Z"}
{"v":1,"seq":21,"tripId":"abc-123","type":"phase","phase":"optimizing","message":"Running optimization...","ts":"2025-03-04T10:00:15Z"}
{"v":1,"seq":22,"tripId":"abc-123","type":"phase","phase":"saving","message":"Saving your itinerary...","ts":"2025-03-04T10:00:18Z"}
{"v":1,"seq":23,"tripId":"abc-123","type":"status","status":"complete","itineraryVersion":3,"ts":"2025-03-04T10:00:19Z"}
```

Queued example (complex trip):

```json
{"v":1,"seq":1,"tripId":"abc-123","type":"status","status":"started","ts":"2025-03-04T10:00:00Z"}
{"v":1,"seq":2,"tripId":"abc-123","type":"phase","phase":"loading","message":"Loading trip data...","ts":"2025-03-04T10:00:00Z"}
{"v":1,"seq":3,"tripId":"abc-123","type":"phase","phase":"airports","message":"Resolving airports for 7 cities...","ts":"2025-03-04T10:00:01Z"}
{"v":1,"seq":4,"tripId":"abc-123","type":"status","status":"queued","jobId":"job_a1b2c3","message":"Trip is complex (28 routes). Processing in background...","ts":"2025-03-04T10:00:02Z"}
```

Degraded success example:

```json
{"v":1,"seq":23,"tripId":"abc-123","type":"status","status":"complete","itineraryVersion":3,"degraded":true,"skippedRoutes":["SFO→CDG","LAX→FCO"],"ts":"2025-03-04T10:00:19Z"}
```

Error example:

```json
{"v":1,"seq":15,"tripId":"abc-123","type":"status","status":"error","error":{"code":"ILP_INFEASIBLE","userMessage":"We couldn't find a valid itinerary within your budget. Try relaxing constraints.","debugId":"req_x7k9m2"},"ts":"2025-03-04T10:00:25Z"}
```

### Wire Format Requirements

Each SSE event on the wire must include:

```
id: <seq>
event: <type>
data: <JSON payload>

```

- **`id: <seq>`**: Included for debugging and future use. v1 does **not** support SSE resume — see "Reconnection Behavior" below.
- **`retry: 3000`**: Sent once at the start of the stream.
- **Comment heartbeats**: Send `: keep-alive\n\n` every 15 seconds during long-running phases (ILP solving). These are SSE comments (not JSON events), which is cheaper and consistent with the SSE spec.

Full wire example:

```
retry: 3000

id: 1
event: status
data: {"v":1,"seq":1,"tripId":"abc-123","type":"status","status":"started","ts":"2025-03-04T10:00:00Z"}

: keep-alive

id: 8
event: phase
data: {"v":1,"seq":8,"tripId":"abc-123","type":"phase","phase":"flights","message":"Searching 12 flight routes...","progress":{"current":0,"total":12,"unit":"pair"},"ts":"2025-03-04T10:00:02Z"}

```

### Reconnection Behavior (v1)

v1 does **not** support SSE resume. We use `fetch` (not `EventSource`), so the browser will not auto-reconnect or send `Last-Event-ID`. We include `id:` fields for debugging and log correlation, but the server does not store an event log and cannot replay missed events.

**On disconnect, the client switches to polling:**

1. If the stream was for an inline job (no `jobId`), the frontend calls `GET /itinerary/get` to check if results were written. If not found, it retries the generate call.
2. If the stream was for a queued job (has `jobId`), the frontend switches to polling `GET /itinerary/jobs/latest/{tripId}`.

This is simple and robust. Resume support can be added in a future version if needed, by storing events in DynamoDB with TTL and replaying from `Last-Event-ID`.

### Response Headers

The SSE endpoint must set these headers to prevent buffering by proxies and ALBs:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

In FastAPI, yield `bytes` (not `str`) from the `StreamingResponse` generator to force immediate flushing in ASGI servers. The media type `text/event-stream` is set on the `StreamingResponse` constructor.

App Runner sits behind an internal ALB. The 15-second comment heartbeat interval is chosen to be well below App Runner's idle timeout (default 120s, configurable). Confirm this during deployment.

---

## DynamoDB Schema for Generation

### Existing Tables (unchanged)

**`tripy-trips`** (PK: `tripId` STRING, no SK):
- Stores trip metadata. We add two new fields:
  - `itineraryVersion` (number, default 0): Incremented atomically on each successful generation.
  - `tipsStatus` (string: `"pending"` | `"ready"` | `"failed"`): Tracks async tip generation.

**`tripy-itinerary`** (PK: `tripId` STRING, SK: `itemId` STRING):
- Existing items use `itemId` values like `path`, `payments`, `totals`, etc.
- We add new system items with reserved `itemId` prefixes:

### New Items in `tripy-itinerary`

| Item | PK | SK (`itemId`) | Purpose |
|------|----|---------------|---------|
| **Generation lock** | `tripId` | `__generation_lock__` | Prevents concurrent generation for the same trip |
| **Job status** | `tripId` | `__job__{jobId}` | Tracks async job progress for polling |
| **Tips** | `tripId` | `__tips__` | Deferred smart tips (written after main result) |

### Generation Lock Item

```json
{
  "tripId": "abc-123",
  "itemId": "__generation_lock__",
  "jobId": "job_a1b2c3",
  "requestId": "req_x7k9m2",
  "status": "processing",
  "lastHeartbeatAt": "2025-03-04T10:00:12Z",
  "startedAt": "2025-03-04T10:00:00Z",
  "ttl": 1741262400
}
```

This is the **single source of truth** for "is a generation running for this trip?" The lock is acquired with a conditional write and released (updated to terminal status) on completion or error.

**Acquire lock:**

```python
itinerary_repo.put_item_conditional(
    item={
        "tripId": trip_id,
        "itemId": "__generation_lock__",
        "jobId": job_id,
        "requestId": request_id,
        "status": "processing",
        "lastHeartbeatAt": now_iso(),
        "startedAt": now_iso(),
        "ttl": int(time.time()) + 86400,  # 24h
    },
    condition_expression=(
        "attribute_not_exists(itemId) "
        "OR #s IN (:complete, :error) "
        "OR lastHeartbeatAt < :stale"
    ),
    expression_names={"#s": "status"},
    expression_values={
        ":complete": "complete",
        ":error": "error",
        ":stale": stale_threshold_iso(),  # now - 5 minutes
    },
)
```

If the conditional write fails (`ConditionalCheckFailedException`), a generation is already in progress. Read the lock item and return `already_processing` with the existing `jobId`.

**Release lock:** On completion or error, update the lock item's `status` to the terminal state. The `ttl` ensures stale locks are eventually cleaned up even if the release fails.

### Job Status Item

```json
{
  "tripId": "abc-123",
  "itemId": "__job__job_a1b2c3",
  "jobId": "job_a1b2c3",
  "requestId": "req_x7k9m2",
  "status": "processing",
  "phase": "flights",
  "message": "Searching flights: SFO → CDG (6/12)",
  "progress": { "current": 6, "total": 12, "unit": "pair" },
  "itineraryVersion": null,
  "workerAttempt": 1,
  "lastHeartbeatAt": "2025-03-04T10:00:12Z",
  "startedAt": "2025-03-04T10:00:00Z",
  "completedAt": null,
  "error": null,
  "updatedAt": "2025-03-04T10:00:12Z",
  "ttl": 1741262400
}
```

- `ttl`: Auto-expire after 24 hours. Results live in the main itinerary items.
- `workerAttempt`: Incremented on SQS retry (max 2 via DLQ `maxReceiveCount`).
- `lastHeartbeatAt`: Worker updates every 30s. Stale (>5 min) indicates a stuck worker.

### `itineraryVersion` (on `tripy-trips`)

The `itineraryVersion` field lives on the **trip record** in `tripy-trips`. It is the canonical, monotonic version counter.

**On generation success:**

```python
trip_repo.update_trip_conditional(
    trip_id=trip_id,
    update_expression="SET itineraryVersion = if_not_exists(itineraryVersion, :zero) + :one, optimizationGenerated = :true",
    condition_expression="attribute_not_exists(itineraryVersion) OR itineraryVersion = :current",
    expression_values={
        ":zero": 0,
        ":one": 1,
        ":current": current_version,
        ":true": True,
    },
)
```

If the conditional update fails, a concurrent job already wrote a newer version. The stale job discards its results (they're already saved but the version pointer didn't advance — effectively a no-op since the newer results overwrite them).

Every itinerary item written by `batch_write_items` includes `itineraryVersion` so results can be associated with the version that created them.

### Polling API (tripId-only)

v1 uses a single polling endpoint keyed by `tripId`:

```
GET /itinerary/jobs/latest/{tripId}
```

This reads the `__generation_lock__` item to get the current `jobId`, then reads the corresponding `__job__{jobId}` item. No GSI is needed.

We do **not** expose a `GET /itinerary/jobs/{jobId}` endpoint in v1 because it would require either a table scan or a GSI. The `jobId` is still stored in status items for debugging and log correlation, and the frontend receives it in SSE events, but polling is always by `tripId`.

If jobId-based polling is needed later, add a GSI on `tripy-itinerary` with `PK: jobId`, projection `ALL`.

---

## Job Status State Machine

Both SSE streaming and polling share the same state model. This ensures the frontend renders consistently regardless of delivery mode.

### States

```
                    ┌─────────┐
                    │  queued  │
                    └────┬────┘
                         │ worker picks up
                         ▼
┌─────────┐        ┌────────────┐
│ started  │──────▶ │ processing │
└─────────┘  (or)  └─────┬──────┘
  (inline)          │         │
                    ▼         ▼
              ┌──────────┐ ┌───────┐
              │ complete  │ │ error │
              └──────────┘ └───────┘
```

- **`started`**: Inline SSE generation has begun. Written to the lock item in DynamoDB, but not to a separate job status item (inline jobs don't need polling).
- **`queued`**: Job enqueued to SQS. Lock item and job status item both written to DynamoDB.
- **`processing`**: Worker has picked up the job. Job status item updated with phase/progress.
- **`complete`**: Itinerary generated and persisted. Terminal state. Lock item updated.
- **`error`**: Generation failed after retries. Terminal state. Lock item updated.

---

## Idempotency and Concurrency

### Problem

Without protection, a user who double-clicks "Generate" or refreshes the page mid-generation will trigger duplicate jobs. Two concurrent pipelines for the same trip will race to write results, potentially corrupting the itinerary.

### Solution: Trip-Level Generation Lock

The `__generation_lock__` item in `tripy-itinerary` is the single concurrency control point. It prevents multiple simultaneous generations for the same trip regardless of whether they come from the same user, different browser tabs, or API retries.

**Flow:**

1. **Frontend generates a `requestId`** (UUIDv4) per generate click and sends it with the request.
2. **Backend attempts to acquire the lock** via conditional `put_item` (see schema section above).
3. **If lock acquired:** Proceed with generation (inline or queued).
4. **If lock not acquired (ConditionalCheckFailedException):**
   - Read the existing lock item.
   - If `status` is `processing`/`queued` and `lastHeartbeatAt` is fresh (< 5 min): Return SSE `status=already_processing` with the existing `jobId`.
   - If `status` is `complete`: Return SSE `status=complete` with `itineraryVersion`.
   - If `status` is `error` or heartbeat is stale: The existing lock is dead. Retry acquiring with a force overwrite (unconditional put). If two requests race on this retry, one wins and the other gets `already_processing` — no harm done.

**Worker heartbeat:** The SQS worker updates `lastHeartbeatAt` on the lock item every 30s. If a worker dies without updating, the lock becomes stale after 5 minutes and can be re-acquired.

### Repo Helpers

Add to `backend/src/repos/itinerary_repo.py`:

```python
from typing import Optional
from botocore.exceptions import ClientError

def put_item_conditional(
    item: dict,
    condition_expression: str,
    expression_names: dict = None,
    expression_values: dict = None,
) -> bool:
    """Write item only if condition is met. Returns False on ConditionalCheckFailedException."""
    try:
        kwargs = {
            "Item": sanitize_for_dynamodb(item),
            "ConditionExpression": condition_expression,
        }
        if expression_names:
            kwargs["ExpressionAttributeNames"] = expression_names
        if expression_values:
            kwargs["ExpressionAttributeValues"] = sanitize_for_dynamodb(expression_values)
        t.put_item(**kwargs)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise

def get_item(trip_id: str, item_id: str) -> Optional[dict]:
    resp = t.get_item(Key={"tripId": trip_id, "itemId": item_id})
    return resp.get("Item")

def get_generation_lock(trip_id: str) -> Optional[dict]:
    return get_item(trip_id, "__generation_lock__")

def get_job_status(trip_id: str, job_id: str) -> Optional[dict]:
    return get_item(trip_id, f"__job__{job_id}")

def get_latest_job(trip_id: str) -> Optional[dict]:
    lock = get_generation_lock(trip_id)
    if not lock or "jobId" not in lock:
        return None
    return get_job_status(trip_id, lock["jobId"])
```

---

## Implementation Plan

### Phase 1: Backend — SSE Streaming Endpoint

**Goal:** Create a new endpoint that streams progress events as the itinerary is generated, replacing the synchronous `POST /itinerary/generate` for the App Runner deployment.

#### Step 1.1: Create SSE event types and formatter

**File:** `backend/src/models/sse_events.py` (new)

The backend uses Pydantic v2 (`pydantic==2.8.2` in `requirements.txt`). We use `Field(default_factory=...)` for the timestamp to avoid any v1/v2 compatibility issues, and `Field(alias=...)` with `model_dump(by_alias=True)` to emit camelCase on the wire while using snake_case internally.

```python
import json
import time
from enum import Enum
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Any, Optional, List

SCHEMA_VERSION = 1

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

class Phase(str, Enum):
    LOADING = "loading"
    AIRPORTS = "airports"
    FLIGHTS = "flights"
    OPTIMIZING = "optimizing"
    SAVING = "saving"
    TIPS = "tips"

class StatusValue(str, Enum):
    STARTED = "started"
    QUEUED = "queued"
    ALREADY_PROCESSING = "already_processing"
    COMPLETE = "complete"
    ERROR = "error"

class ErrorCode(str, Enum):
    ILP_INFEASIBLE = "ILP_INFEASIBLE"
    ILP_TIMEOUT = "ILP_TIMEOUT"
    FLIGHT_FETCH_FAILED = "FLIGHT_FETCH_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    TRIP_NOT_FOUND = "TRIP_NOT_FOUND"
    ACCESS_DENIED = "ACCESS_DENIED"

class SSEEvent(BaseModel):
    v: int = SCHEMA_VERSION
    seq: int
    trip_id: str = Field(alias="tripId")
    type: str
    phase: Optional[Phase] = None
    status: Optional[StatusValue] = None
    message: Optional[str] = None
    progress: Optional[dict] = None
    job_id: Optional[str] = Field(default=None, alias="jobId")
    itinerary_version: Optional[int] = Field(default=None, alias="itineraryVersion")
    degraded: Optional[bool] = None
    skipped_routes: Optional[List[str]] = Field(default=None, alias="skippedRoutes")
    error: Optional[dict] = None
    ts: str = Field(default_factory=_now_iso)

    model_config = {"populate_by_name": True}

def format_sse(event: SSEEvent) -> bytes:
    """Format as wire SSE and return bytes (forces flush in ASGI)."""
    payload = event.model_dump(by_alias=True, exclude_none=True)
    lines = f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(payload)}\n\n"
    return lines.encode("utf-8")

def format_sse_comment(comment: str) -> bytes:
    return f": {comment}\n\n".encode("utf-8")

def format_sse_retry(ms: int) -> bytes:
    return f"retry: {ms}\n\n".encode("utf-8")
```

#### Step 1.2: Refactor `generate_optimized_itinerary` into an async generator

**File:** `backend/src/services/itinerary_service.py`

The current function is a single async function that returns a dict. Create a new `generate_optimized_itinerary_stream` that yields `SSEEvent`s at each phase. The existing `generate_optimized_itinerary` stays untouched for backward compatibility with the Lambda deployment.

This requires extracting inline logic into named helper functions (`_load_trip_data`, `_resolve_airports`, `_build_od_pairs`, `_generate_tips`, `_build_and_save_items`) that both paths can call. Some of these already exist; others are inline blocks that need extraction.

**Critical: flight fetching must remain concurrent.** The current code uses `asyncio.gather` with a semaphore. The streaming version must use `asyncio.as_completed()` instead of a sequential loop, so we get both concurrency *and* per-pair progress events as tasks finish:

**Critical: sync boto3 calls must not block the event loop.** All repo functions (`itinerary_repo.put_item`, `trip_repo.get_trip`, etc.) use synchronous boto3. In the streaming generator and endpoint, wrap these calls with `asyncio.get_event_loop().run_in_executor(None, ...)` or `starlette.concurrency.run_in_threadpool(...)` to prevent blocking. This is especially important because a blocked event loop will delay heartbeat delivery, which can cause the ALB to close the connection.

The generator accepts an `allow_queue` parameter (default `True`) so the SQS worker can call it with `allow_queue=False` to prevent recursive queuing:

```python
async def generate_optimized_itinerary_stream(
    trip_id: str,
    optimization_mode: str = "money_saving",
    request_id: str = "",
    allow_queue: bool = True,
) -> AsyncGenerator[SSEEvent, None]:
    seq = 0

    def next_event(**kwargs) -> SSEEvent:
        nonlocal seq
        seq += 1
        return SSEEvent(seq=seq, tripId=trip_id, **kwargs)

    yield next_event(type="status", status=StatusValue.STARTED)

    # --- Phase: loading ---
    yield next_event(type="phase", phase=Phase.LOADING, message="Loading trip data...")
    trip, destinations, members, points = await run_in_threadpool(_load_trip_data, trip_id)

    # --- Phase: airports ---
    yield next_event(type="phase", phase=Phase.AIRPORTS,
                     message=f"Resolving airports for {len(destinations)} cities...",
                     progress={"current": 0, "total": len(destinations), "unit": "city"})
    airport_mappings = await _resolve_airports(destinations)

    # --- Decision point: inline vs queue ---
    pairs = _build_od_pairs(airport_mappings)
    decision = _decide_execution_mode(destinations, pairs, has_points=bool(points))

    if allow_queue and decision == "queued":
        job_id = await run_in_threadpool(_enqueue_to_sqs, trip_id, optimization_mode, request_id)
        yield next_event(type="status", status=StatusValue.QUEUED, jobId=job_id,
                         message=f"Trip is complex ({len(pairs)} routes). Processing in background...")
        return

    # --- Phase: flights (concurrent with progress) ---
    yield next_event(type="phase", phase=Phase.FLIGHTS,
                     message=f"Searching {len(pairs)} flight routes...",
                     progress={"current": 0, "total": len(pairs), "unit": "pair"})

    sem = asyncio.Semaphore(_get_concurrency_cap())
    completed = 0

    async def _bounded_fetch(o, d):
        async with sem:
            try:
                return o, d, await asyncio.wait_for(
                    _fetch_edges_for_route(o, d, leg_date, combined_points, travelers, start_dest_code),
                    timeout=10.0
                )
            except asyncio.TimeoutError:
                logger.warning(f"Timeout: {o}→{d} after 10s")
                return o, d, ({}, False)

    tasks = [asyncio.create_task(_bounded_fetch(o, d)) for o, d in pairs]
    edges_all = {}
    skipped_pairs = []

    for coro in asyncio.as_completed(tasks):
        o, d, (edges, success) = await coro
        if success:
            edges_all.update(edges)
        else:
            skipped_pairs.append(f"{o}→{d}")
        completed += 1
        yield next_event(type="progress", phase=Phase.FLIGHTS,
                         message=f"Searched {o} → {d}" + ("" if success else " (skipped)"),
                         progress={"current": completed, "total": len(pairs), "unit": "pair"})

    # --- Pre-solver feasibility check ---
    degrade_threshold = len(pairs) * 0.5
    if len(skipped_pairs) >= degrade_threshold:
        yield next_event(type="status", status=StatusValue.ERROR,
                         error={"code": "FLIGHT_FETCH_FAILED",
                                "userMessage": f"Too many routes timed out ({len(skipped_pairs)}/{len(pairs)}). Please try again later.",
                                "debugId": f"req_{request_id[:8]}"})
        return

    missing_legs = _find_disconnected_destinations(pairs, edges_all, destinations)
    if missing_legs:
        yield next_event(type="status", status=StatusValue.ERROR,
                         error={"code": "FLIGHT_FETCH_FAILED",
                                "userMessage": f"No flight data found for {', '.join(missing_legs[:3])}. Try removing these destinations.",
                                "debugId": f"req_{request_id[:8]}"})
        return

    # --- Phase: optimizing ---
    yield next_event(type="phase", phase=Phase.OPTIMIZING, message="Running optimization...")
    solution = await run_in_threadpool(run_ilp_from_edges, edges_all, ...)

    # --- Phase: saving ---
    yield next_event(type="phase", phase=Phase.SAVING, message="Saving your itinerary...")
    version = await run_in_threadpool(_build_and_save_items, solution, trip_id, ...)

    yield next_event(type="status", status=StatusValue.COMPLETE,
                     itineraryVersion=version,
                     degraded=bool(skipped_pairs) or None,
                     skippedRoutes=skipped_pairs or None)

    # Tips generated asynchronously after the complete event (see Step 4.1)
    asyncio.create_task(_generate_and_save_tips_async(trip_id, solution, ...))
```

**`_find_disconnected_destinations`**: After flight fetching, check that every destination has at least one inbound and one outbound edge in `edges_all`. If a destination is unreachable, return its name. This prevents the ILP solver from hitting an infeasible solution due to missing data.

#### Step 1.3: Create the SSE endpoint

**File:** `backend/src/app.py`

The endpoint uses `POST` (not `GET`) because it requires a JSON body with `trip_id` and `request_id`. Native `EventSource` only supports GET, but we intentionally use `fetch` + `ReadableStream` on the frontend (see Phase 3 rationale). If we ever want `EventSource` support, we can add a `GET` variant that takes query params.

```python
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from src.models.sse_events import format_sse, format_sse_comment, format_sse_retry, SSEEvent, StatusValue

class GenerateStreamRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    optimization_mode: str = Field(default="money_saving")
    request_id: str = Field(..., min_length=1)

@app.post("/itinerary/generate-stream")
async def generate_itinerary_stream(
    request: GenerateStreamRequest,
    user_id: str = Depends(get_current_user_id),
):
    # Auth: verify trip exists and user is owner/member (sync boto3 → run_in_threadpool)
    trip = await run_in_threadpool(trip_service.get_trip, request.trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    await run_in_threadpool(_verify_trip_access, trip, user_id)

    # Acquire generation lock (see Idempotency section)
    lock_acquired = await run_in_threadpool(
        _try_acquire_generation_lock, request.trip_id, request.request_id
    )

    if not lock_acquired:
        existing_lock = await run_in_threadpool(itinerary_repo.get_generation_lock, request.trip_id)
        if existing_lock and existing_lock["status"] in ("processing", "queued") and _is_heartbeat_fresh(existing_lock):
            async def already_processing():
                yield format_sse_retry(3000)
                yield format_sse(SSEEvent(
                    seq=1, tripId=request.trip_id, type="status",
                    status=StatusValue.ALREADY_PROCESSING,
                    jobId=existing_lock.get("jobId"),
                    message="Generation already in progress.",
                ))
            return StreamingResponse(already_processing(), media_type="text/event-stream",
                                     headers=_sse_headers())

    # Already generated — return cached
    if trip.get("optimizationGenerated"):
        async def already_done():
            yield format_sse_retry(3000)
            yield format_sse(SSEEvent(
                seq=1, tripId=request.trip_id, type="status",
                status=StatusValue.COMPLETE,
                itineraryVersion=trip.get("itineraryVersion", 1),
                message="Itinerary already generated.",
            ))
        return StreamingResponse(already_done(), media_type="text/event-stream",
                                 headers=_sse_headers())

    # Stream generation with heartbeat interleaving
    async def event_stream():
        queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=100)
        yield format_sse_retry(3000)

        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                try:
                    queue.put_nowait(format_sse_comment("keep-alive"))
                except asyncio.QueueFull:
                    pass  # skip heartbeat if queue is backed up

        async def generate():
            try:
                async for event in itinerary_service.generate_optimized_itinerary_stream(
                    request.trip_id, request.optimization_mode, request.request_id
                ):
                    await queue.put(format_sse(event))
            except Exception as e:
                debug_id = f"req_{request.request_id[:8]}"
                logger.exception(f"[{debug_id}] Generation stream failed")
                await queue.put(format_sse(SSEEvent(
                    seq=999, tripId=request.trip_id, type="status",
                    status=StatusValue.ERROR,
                    error={"code": "INTERNAL_ERROR", "userMessage": "Something went wrong. Please try again.", "debugId": debug_id},
                )))
            finally:
                await queue.put(None)  # sentinel: generation done

        hb_task = asyncio.create_task(heartbeat())
        gen_task = asyncio.create_task(generate())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            hb_task.cancel()
            if not gen_task.done():
                gen_task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers=_sse_headers())

def _sse_headers() -> dict:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
```

The `asyncio.Queue(maxsize=100)` ensures:
- Generation events use `await queue.put()` — if the queue is full (client is slow to consume), generation backpressures naturally.
- Heartbeats use `queue.put_nowait()` — if the queue is full, the heartbeat is silently dropped (the queue already has data flowing, so idle timeout isn't a concern).
- The `None` sentinel ensures the generator exits cleanly after the pipeline finishes.

---

### Phase 2: Backend — SQS Async Fallback for Complex Trips

**Goal:** For trips that would exceed a comfortable SSE duration, offload to a background worker before the expensive flight-fetching phase begins.

#### Step 2.1: Decision point — where and how

The inline-vs-queue decision happens **after loading trip data and resolving airports, but before flight fetching**. This is the earliest point where we know the exact number of O-D pairs.

**Complexity heuristic inputs:**

| Input | Source | Weight |
|-------|--------|--------|
| Number of destinations | `len(destinations)` | Primary |
| Number of O-D pairs (exact) | `len(pairs)` after `_build_od_pairs()` | Primary |
| Award + cash both enabled | `bool(combined_points)` | Multiplier (doubles expected API calls per pair) |
| Number of multi-airport cities | Airport resolution result | Minor (adds pairs) |

**Thresholds (initial, tunable via env vars):**

```python
QUEUE_THRESHOLD_DESTINATIONS = int(os.environ.get("QUEUE_THRESHOLD_DESTINATIONS", "5"))
QUEUE_THRESHOLD_PAIRS = int(os.environ.get("QUEUE_THRESHOLD_PAIRS", "20"))

def _decide_execution_mode(destinations: list, pairs: list, has_points: bool = False) -> str:
    effective_pairs = len(pairs) * (2 if has_points else 1)
    if len(destinations) > QUEUE_THRESHOLD_DESTINATIONS or effective_pairs > QUEUE_THRESHOLD_PAIRS:
        logger.info(f"decision=queued destinations={len(destinations)} pairs={len(pairs)} effective={effective_pairs}")
        return "queued"
    logger.info(f"decision=inline destinations={len(destinations)} pairs={len(pairs)} effective={effective_pairs}")
    return "inline"
```

**No mid-stream escalation.** If a trip is classified as "inline" but takes longer than expected, it runs to completion over SSE. We do not implement "time budget with early exit and queue escalation" in v1. The heartbeat keeps the connection alive for up to 120s (App Runner limit), which is sufficient for inline trips. If this proves insufficient, we tighten the thresholds.

#### Step 2.2: SQS queue and DLQ

**File:** `infra/lib/apiStackLambda.ts` (add to existing stack to share env vars and permissions)

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

const generationDLQ = new sqs.Queue(this, 'ItineraryGenerationDLQ', {
  queueName: 'tripy-itinerary-generation-dlq',
  retentionPeriod: Duration.days(7),
});

const generationQueue = new sqs.Queue(this, 'ItineraryGenerationQueue', {
  queueName: 'tripy-itinerary-generation',
  visibilityTimeout: Duration.minutes(15),
  retentionPeriod: Duration.hours(4),
  deadLetterQueue: { maxReceiveCount: 2, queue: generationDLQ },
});
```

#### Step 2.3: Worker Lambda

**File:** `infra/lib/apiStackLambda.ts`

```typescript
const workerFunction = new lambda.Function(this, 'ItineraryWorker', {
  functionName: 'tripy-itinerary-worker',
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: 'src.workers.itinerary_worker.handler',
  timeout: Duration.minutes(15),
  memorySize: 2048,
  code: lambda.Code.fromAsset('../backend', { /* same excludes as main Lambda */ }),
  environment: {
    ...apiFunction.environment,
    GENERATION_QUEUE_URL: generationQueue.queueUrl,
  },
});
generationQueue.grantConsumeMessages(workerFunction);
workerFunction.addEventSource(new SqsEventSource(generationQueue, { batchSize: 1 }));
generationQueue.grantSendMessages(apiFunction);
```

**Packaging concern — PuLP / CBC solver in Lambda:**

PuLP uses the CBC solver binary. On Lambda (Amazon Linux 2023), the pre-packaged CBC binary from `pip install pulp` may not work. Verify by:

1. Running `pulp.pulpTestAll()` in a test Lambda invocation.
2. If CBC fails: either (a) include a Lambda-compatible CBC binary in a Lambda Layer, or (b) switch to a **container image Lambda** built from the same base as App Runner (`python:3.11-slim` or `python:3.12-slim`).

If using a container image Lambda:
- Create `backend/Dockerfile.worker` extending the backend image with a `CMD` that points to the Lambda handler.
- Use `lambda.DockerImageFunction` in CDK instead of `lambda.Function`.
- Document the build path in the deploy script.

**Environment parity:** The worker must have the same env vars as the main API (DynamoDB tables, SerpAPI key, AwardTool token, OpenAI key, etc). These come from Secrets Manager (`USE_SECRETS_MANAGER=true`). The worker Lambda must have the same Secrets Manager read permissions as the main Lambda.

#### Step 2.4: Worker handler

**File:** `backend/src/workers/itinerary_worker.py` (new)

The worker calls `generate_optimized_itinerary_stream` with `allow_queue=False` to prevent recursive queuing (the worker should never decide to re-enqueue to SQS).

```python
import json
import asyncio
import logging
from datetime import datetime, timezone
from src.repos import itinerary_repo
from src.services import itinerary_service
from src.models.sse_events import StatusValue

logger = logging.getLogger(__name__)

def handler(event, context):
    for record in event["Records"]:
        body = json.loads(record["body"])
        trip_id = body["trip_id"]
        optimization_mode = body.get("optimization_mode", "money_saving")
        request_id = body.get("request_id", "")
        attempt = int(record.get("attributes", {}).get("ApproximateReceiveCount", "1"))
        asyncio.run(_process(trip_id, optimization_mode, request_id, attempt))

async def _process(trip_id: str, optimization_mode: str, request_id: str, attempt: int):
    lock = itinerary_repo.get_generation_lock(trip_id)
    if not lock:
        logger.error(f"No generation lock found for trip {trip_id}")
        return

    job_id = lock["jobId"]
    _update_status(trip_id, job_id, "processing", "Starting generation...", attempt=attempt)
    _update_lock_heartbeat(trip_id, job_id)

    heartbeat_task = asyncio.create_task(_worker_heartbeat_loop(trip_id, job_id))

    try:
        async for event in itinerary_service.generate_optimized_itinerary_stream(
            trip_id, optimization_mode, request_id,
            allow_queue=False,  # prevent recursive queuing
        ):
            if event.type in ("phase", "progress"):
                _update_status(
                    trip_id, job_id, "processing", event.message,
                    phase=event.phase.value if event.phase else None,
                    progress=event.progress, attempt=attempt,
                )
            elif event.type == "status" and event.status == StatusValue.COMPLETE:
                _update_status(
                    trip_id, job_id, "complete", "Done",
                    itinerary_version=event.itinerary_version, attempt=attempt,
                )
                _update_lock_status(trip_id, "complete")
            elif event.type == "status" and event.status == StatusValue.ERROR:
                _update_status(
                    trip_id, job_id, "error", event.error.get("userMessage", "Unknown error"),
                    attempt=attempt,
                )
                _update_lock_status(trip_id, "error")
    except Exception as e:
        logger.exception(f"Worker failed for trip {trip_id}")
        _update_status(trip_id, job_id, "error", str(e), attempt=attempt)
        _update_lock_status(trip_id, "error")
        raise
    finally:
        heartbeat_task.cancel()

async def _worker_heartbeat_loop(trip_id: str, job_id: str):
    """Update lock heartbeat every 30s so stale detection works."""
    while True:
        await asyncio.sleep(30)
        _update_lock_heartbeat(trip_id, job_id)

def _update_status(trip_id: str, job_id: str, status: str, message: str, **kwargs):
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "tripId": trip_id,
        "itemId": f"__job__{job_id}",
        "jobId": job_id,
        "status": status,
        "message": message,
        "updatedAt": now,
        "lastHeartbeatAt": now,
        "workerAttempt": kwargs.get("attempt", 1),
    }
    if kwargs.get("phase"):
        item["phase"] = kwargs["phase"]
    if kwargs.get("progress"):
        item["progress"] = kwargs["progress"]
    if kwargs.get("itinerary_version") is not None:
        item["itineraryVersion"] = kwargs["itinerary_version"]
        item["completedAt"] = now
    if status == "error":
        item["error"] = {"code": "INTERNAL_ERROR", "userMessage": message}
    itinerary_repo.put_item(item)

def _update_lock_heartbeat(trip_id: str, job_id: str):
    now = datetime.now(timezone.utc).isoformat()
    itinerary_repo.put_item({
        "tripId": trip_id,
        "itemId": "__generation_lock__",
        "jobId": job_id,
        "status": "processing",
        "lastHeartbeatAt": now,
    })

def _update_lock_status(trip_id: str, status: str):
    now = datetime.now(timezone.utc).isoformat()
    lock = itinerary_repo.get_generation_lock(trip_id)
    if lock:
        lock["status"] = status
        lock["updatedAt"] = now
        itinerary_repo.put_item(lock)
```

#### Step 2.5: Polling endpoint

**File:** `backend/src/app.py`

Single endpoint, keyed by `tripId`:

```python
@app.get("/itinerary/jobs/latest/{trip_id}")
async def get_latest_job_status(trip_id: str, user_id: str = Depends(get_current_user_id)):
    """Poll the latest generation job for a trip."""
    trip = await run_in_threadpool(trip_service.get_trip, trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    await run_in_threadpool(_verify_trip_access, trip, user_id)

    job = await run_in_threadpool(itinerary_repo.get_latest_job, trip_id)
    if not job:
        raise HTTPException(404, "No generation job found for this trip")
    return job
```

---

### Phase 3: Frontend — SSE Client + Adaptive UI

**Goal:** Replace the fake `TripGenerationLoader` animation with real progress from the backend, and handle both SSE and polling modes.

#### Design decision: `fetch` + `ReadableStream`, not `EventSource`

`EventSource` is the native browser API for SSE, but it only supports `GET` requests and cannot set custom headers. Our endpoint requires `POST` (JSON body) and `Authorization: Bearer <token>`. We use `fetch` with `response.body.getReader()` instead. This is intentional — do not attempt to use `EventSource`.

#### Step 3.1: SSE parser utility

**File:** `frontend/src/lib/sse/parse.ts` (new)

A small, tested utility for parsing SSE wire format from chunked `ReadableStream` data. This handles:
- Splitting events on `\n\n` boundaries
- Parsing multiline `data:` fields
- Handling partial chunk boundaries (buffering incomplete events)
- Ignoring comment lines (`: keep-alive`)
- Extracting `id:`, `event:`, `data:` fields

```typescript
export type ParsedSSEEvent = {
  id?: string;
  event?: string;
  data: string;
};

export function createSSEParser() {
  let buffer = '';

  return {
    push(chunk: string): ParsedSSEEvent[] {
      buffer += chunk;
      const events: ParsedSSEEvent[] = [];
      const parts = buffer.split('\n\n');

      buffer = parts.pop() ?? '';

      for (const part of parts) {
        if (!part.trim()) continue;
        const event: ParsedSSEEvent = { data: '' };
        const lines = part.split('\n');
        for (const line of lines) {
          if (line.startsWith(':')) continue;
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;
          const field = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trimStart();
          if (field === 'id') event.id = value;
          else if (field === 'event') event.event = value;
          else if (field === 'data') event.data += (event.data ? '\n' : '') + value;
        }
        if (event.data || event.event) events.push(event);
      }
      return events;
    },
    flush(): ParsedSSEEvent[] {
      if (!buffer.trim()) return [];
      const result = this.push('\n\n');
      buffer = '';
      return result;
    },
  };
}
```

Add tests in `frontend/src/lib/sse/parse.test.ts` covering:
- Single event parsing
- Multiple events in one chunk
- Event split across chunks (partial boundary)
- Comment-only chunks (no events returned)
- Multiline `data:` fields
- `retry:` line is ignored (not an event)

#### Step 3.2: Create the stream hook

**File:** `frontend/src/lib/hooks/useItineraryStream.ts` (new)

```typescript
import { createSSEParser } from '@/lib/sse/parse';
import { v4 as uuidv4 } from 'uuid';

type Phase = 'loading' | 'airports' | 'flights' | 'optimizing' | 'saving' | 'tips';

type StreamState = {
  status: 'idle' | 'streaming' | 'polling' | 'complete' | 'error';
  phase: Phase | null;
  message: string | null;
  progress: { current: number; total: number; unit: string } | null;
  jobId: string | null;
  itineraryVersion: number | null;
  degraded: boolean;
  skippedRoutes: string[];
  error: { code: string; userMessage: string; debugId: string } | null;
};

const INITIAL_STATE: StreamState = {
  status: 'idle', phase: null, message: null, progress: null,
  jobId: null, itineraryVersion: null, degraded: false,
  skippedRoutes: [], error: null,
};

export function useItineraryStream() {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async (tripId: string) => {
    const requestId = uuidv4();
    setState({ ...INITIAL_STATE, status: 'streaming' });

    const response = await fetch(`${API_URL}/itinerary/generate-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getToken()}`,
      },
      body: JSON.stringify({ trip_id: tripId, request_id: requestId }),
    });

    if (!response.ok || !response.body) {
      setState(s => ({ ...s, status: 'error', error: { code: 'HTTP_ERROR', userMessage: 'Failed to connect.', debugId: requestId } }));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSSEParser();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const raw of events) {
          if (!raw.data) continue;
          const event = JSON.parse(raw.data);

          if (event.type === 'status') {
            if (event.status === 'queued' || event.status === 'already_processing') {
              setState(s => ({ ...s, status: 'polling', jobId: event.jobId, message: event.message }));
              _startPolling(tripId);
              return;
            }
            if (event.status === 'complete') {
              setState(s => ({
                ...s, status: 'complete',
                itineraryVersion: event.itineraryVersion,
                degraded: event.degraded ?? false,
                skippedRoutes: event.skippedRoutes ?? [],
              }));
              return;
            }
            if (event.status === 'error') {
              setState(s => ({ ...s, status: 'error', error: event.error }));
              return;
            }
          }

          if (event.type === 'phase' || event.type === 'progress') {
            setState(s => ({
              ...s,
              phase: event.phase ?? s.phase,
              message: event.message ?? s.message,
              progress: event.progress ?? s.progress,
            }));
          }
        }
      }

      // Stream ended without a terminal event — treat as disconnect.
      // Check if results were written by trying GET /itinerary/get.
      // If not found, switch to polling in case a queued job is running.
      _startPolling(tripId);
      setState(s => ({ ...s, status: 'polling', message: 'Reconnecting...' }));
    } finally {
      reader.releaseLock();
    }
  }, []);

  const _startPolling = useCallback((tripId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/itinerary/jobs/latest/${tripId}`, {
          headers: { 'Authorization': `Bearer ${await getToken()}` },
        });
        if (!res.ok) return;
        const data = await res.json();

        setState(s => ({
          ...s,
          phase: data.phase ?? s.phase,
          message: data.message ?? s.message,
          progress: data.progress ?? s.progress,
        }));

        if (data.status === 'complete') {
          clearInterval(pollingRef.current!);
          setState(s => ({
            ...s, status: 'complete',
            itineraryVersion: data.itineraryVersion,
          }));
        } else if (data.status === 'error') {
          clearInterval(pollingRef.current!);
          setState(s => ({
            ...s, status: 'error',
            error: data.error ?? { code: 'WORKER_ERROR', userMessage: data.message, debugId: '' },
          }));
        }
      } catch {
        // Network error during poll — keep trying
      }
    }, 3000);
  }, []);

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  return { ...state, generate };
}
```

**On disconnect / unexpected stream end:** If the stream ends without a terminal `status` event (network error, tab switch, etc.), the hook switches to polling `GET /itinerary/jobs/latest/{tripId}`. This covers both inline (results may already be written) and queued (worker is still running) scenarios.

#### Step 3.3: Update `TripGenerationLoader` for real progress

**File:** `frontend/src/components/ui/TripGenerationLoader.tsx`

Add new optional props. When `phase` and `message` are provided (streaming mode), display real backend data. When absent (backward compat), fall back to the existing time-based animation.

```typescript
interface TripGenerationLoaderProps {
  isVisible: boolean;
  isComplete?: boolean;
  onComplete?: () => void;
  estimatedDuration?: number;
  // Streaming mode props
  phase?: Phase | null;
  message?: string | null;
  progress?: { current: number; total: number; unit: string } | null;
  error?: { code: string; userMessage: string } | null;
}
```

Progress bar behavior in streaming mode:
- `loading`: 5%
- `airports`: 10%
- `flights`: 10% + (80% × `progress.current / progress.total`)
- `optimizing`: 92%
- `saving`: 98%
- `complete`: 100% → trigger completion animation → call `onComplete`

The `message` prop replaces the hardcoded stage labels.

#### Step 3.4: Update group payment page

**File:** `frontend/src/app/(app)/group/payment/page.tsx`

Replace:
```typescript
await generateItinerary(tripId);
```

With:
```typescript
const stream = useItineraryStream();
// In handler:
await stream.generate(tripId);
// After complete, load full itinerary:
const itinerary = await itineraries.get(tripId);
// Pass to loader:
<TripGenerationLoader
  isVisible={isGenerating}
  isComplete={stream.status === 'complete'}
  onComplete={handleGenerationComplete}
  phase={stream.phase}
  message={stream.message}
  progress={stream.progress}
  error={stream.error}
/>
```

**Important:** After `stream.status === 'complete'`, the frontend calls `itineraries.get(tripId)` to load the full itinerary. The SSE stream intentionally does not carry the full payload.

#### Step 3.5: Update solo results page

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

Same pattern for the legacy fallback path that calls `itineraries.generate`. The primary solo path (`solo.optimize`) keeps its current behavior until a separate effort addresses it.

---

### Phase 4: Quick Wins (Parallel with Phases 1-3)

These are independent optimizations that reduce raw generation time regardless of the streaming architecture. Each has guardrails to prevent regressions.

#### Step 4.1: Defer smart tips to post-response

Smart tips take 2-5s and aren't needed for the initial results display. In the streaming generator, yield the `complete` status event **before** tips are generated. Tips are generated asynchronously and written to DynamoDB under a dedicated item.

**Persistence:**
- Tips are stored as `itemId: __tips__` in the `tripy-itinerary` table.
- A `tipsStatus` field is added to the trip record in `tripy-trips`:
  - `"pending"`: Tips generation started (set when `complete` status is emitted).
  - `"ready"`: Tips written to `__tips__` item.
  - `"failed"`: Tips generation failed (after retry).
- The frontend results page checks `tipsStatus` on initial load. If `"pending"`, it shows "Generating travel tips..." and re-fetches after 10s (up to 3 retries). If `"ready"`, it reads the `__tips__` item.

#### Step 4.2: Increase flight-fetch concurrency (with rate-limit awareness)

Do **not** blindly increase the semaphore from 8 to 16. SerpAPI and AwardTool have rate limits.

**Per-provider concurrency caps:**

```python
SERP_CONCURRENCY = int(os.environ.get("SERP_CONCURRENCY", "8"))
AWARD_CONCURRENCY = int(os.environ.get("AWARD_CONCURRENCY", "4"))
```

Use separate semaphores per provider, not one global semaphore. Add exponential backoff with jitter on 429 responses:

```python
serp_sem = asyncio.Semaphore(SERP_CONCURRENCY)
award_sem = asyncio.Semaphore(AWARD_CONCURRENCY)

async def _fetch_with_backoff(provider_sem, fetch_fn, *args, max_retries=2):
    async with provider_sem:
        for attempt in range(max_retries + 1):
            try:
                return await fetch_fn(*args)
            except RateLimitError:
                if attempt == max_retries:
                    raise
                wait = (2 ** attempt) + random.uniform(0, 1)
                await asyncio.sleep(wait)
```

#### Step 4.3: Per-pair aggressive timeout with ILP-aware degradation

Set a 10-second per-pair timeout and gracefully skip timed-out pairs. Ensure the ILP solver can still produce a feasible solution:

- Mark skipped routes as `status: "missing"` with `reason: "timeout"` in the edges dict.
- **Before running ILP**, call `_find_disconnected_destinations()` to check if any destination has zero inbound or outbound edges. If so:
  - If the destination is optional (intermediate stop): exclude it and proceed.
  - If required (origin or final destination): fail with `FLIGHT_FETCH_FAILED`.
- **Degrade threshold**: if `timed_out_pairs / total_pairs > 0.5`, fail with `FLIGHT_FETCH_FAILED` (too much missing data for a meaningful result).
- Emit an SSE `progress` event for skipped routes so the frontend can display: "Skipped 3 routes due to timeout."
- Include `degraded: true` and `skippedRoutes: [...]` in the `complete` status event.

#### Step 4.4: Cache flight results across users

Cache SerpAPI and AwardTool results with precise cache keys:

**Cache key format:**
```
flight:{provider}:{origin}:{dest}:{date}:{cabin}:{passengers}:{currency}
```

Example: `flight:serp:LAX:NRT:2025-06-15:economy:2:USD`

**TTL by provider:**
- SerpAPI (cash prices): 15 minutes (prices change slowly within a session)
- AwardTool (award availability): 30 minutes (award seats change less frequently)

**Invalidation:** TTL-based only. No manual invalidation needed.

**No PII in cache:** These are route-level price lookups, not user-specific fares. No user data is included in the cache key or value.

Use the existing `cache_layer` (`utils/cache_layer.py`) which already supports Redis (if `REDIS_URL` is set) or in-memory fallback.

---

### Phase 5: Infrastructure Changes

#### Step 5.1: CDK updates

**File:** `infra/lib/apiStackLambda.ts`
- Add SQS queue, DLQ, and worker Lambda (see Phase 2 code).
- Grant main API Lambda `sqs:SendMessage` permission.
- Grant worker Lambda same DynamoDB, Secrets Manager, and S3 permissions as main Lambda.
- Pass `GENERATION_QUEUE_URL` as env var to both main API Lambda and App Runner.

**File:** `infra/lib/dbStack.ts`
- Enable TTL on `tripy-itinerary` table: `timeToLiveAttribute: "ttl"`. This is needed for auto-expiring lock and job status items.

No new tables or GSIs are needed in v1.

#### Step 5.2: App Runner configuration

**File:** `backend/apprunner.yaml`

Add environment variable:
```yaml
GENERATION_QUEUE_URL: ""  # Set via AWS console or IaC for App Runner
```

Confirm App Runner request timeout is sufficient for SSE. Default is 120s. The heartbeat interval (15s) is well below this. For trips that approach 120s inline, the complexity threshold should route them to SQS instead.

#### Step 5.3: Keep existing endpoint working

The existing `POST /itinerary/generate` endpoint stays as-is. The new `POST /itinerary/generate-stream` endpoint is additive. The frontend switches to the streaming endpoint behind a feature flag (see rollout section). The old endpoint continues to work for the Lambda deployment and any other clients.

---

## Error Handling and Retries

### SSE Error Events

All errors emitted via SSE include a structured error object:

```json
{
  "code": "ILP_INFEASIBLE",
  "userMessage": "We couldn't find a valid itinerary within your budget. Try relaxing your constraints.",
  "debugId": "req_x7k9m2"
}
```

**Error codes:**

| Code | Meaning | User Action |
|------|---------|-------------|
| `ILP_INFEASIBLE` | Solver found no feasible solution | Relax budget or remove a destination |
| `ILP_TIMEOUT` | Solver exceeded time limit | Reduce trip complexity |
| `FLIGHT_FETCH_FAILED` | Too many pairs timed out (>50%) or a required destination has no edges | Check dates, try again later |
| `TRIP_NOT_FOUND` | Trip ID doesn't exist | Invalid link |
| `ACCESS_DENIED` | User isn't trip owner/member | Check permissions |
| `INTERNAL_ERROR` | Unhandled exception | Retry; contact support if persistent |

The `debugId` is the first 8 characters of the `requestId`, sufficient for log correlation without exposing internal IDs.

### Async Job Retries

- SQS `maxReceiveCount: 2` — a failed job is retried once before landing in the DLQ.
- On each attempt, the worker increments `workerAttempt` in the job status item.
- On final failure (DLQ), the status item is updated to `error` with the failure message. A CloudWatch alarm on the DLQ can alert on persistent failures.
- The DLQ retains messages for 7 days for debugging.

### Partial Failures (Degraded Success)

If some O-D pairs time out but enough edges remain for a feasible ILP solution:
- **Succeed with a warning.** The `complete` event includes `degraded: true` and `skippedRoutes: [...]`.
- The frontend displays: "Your itinerary is ready, but we couldn't check prices for 3 routes. Results may be less optimal."
- **Hard fail threshold:** if `timed_out_pairs / total_pairs > 0.5`, fail with `FLIGHT_FETCH_FAILED`.
- **Disconnected destination check:** if any destination has zero inbound or outbound edges after fetching, fail with `FLIGHT_FETCH_FAILED` before attempting the solver.

---

## Observability

### Required Metrics

Emit structured logs and CloudWatch metrics at each phase boundary. Use a consistent format so they're searchable and dashboard-able.

| Metric | Type | Dimensions | Emitted At |
|--------|------|------------|------------|
| `itinerary.generate.duration_ms` | Timer | `mode=inline\|queued`, `status=success\|error` | Generation complete |
| `itinerary.phase.duration_ms` | Timer | `phase`, `mode` | Each phase boundary |
| `itinerary.flights.fetch_duration_ms` | Timer | `provider=serp\|award`, `route` | Each O-D pair |
| `itinerary.flights.pairs_total` | Counter | `mode` | Flight phase start |
| `itinerary.flights.pairs_succeeded` | Counter | `mode` | Flight phase end |
| `itinerary.flights.pairs_timed_out` | Counter | `mode` | Flight phase end |
| `itinerary.flights.pairs_cached` | Counter | `mode` | Flight phase end |
| `itinerary.solver.duration_ms` | Timer | `solver_status=optimal\|infeasible\|timeout` | ILP complete |
| `itinerary.decision` | Counter | `decision=inline\|queued` | Decision point |
| `itinerary.sse.client_disconnected` | Counter | — | SSE stream aborted by client |
| `itinerary.worker.attempt` | Counter | `attempt=1\|2` | Worker start |

### Structured Logging

Every log line during generation includes:

```python
logger.info("phase_complete", extra={
    "trip_id": trip_id,
    "request_id": request_id,
    "phase": "flights",
    "duration_ms": elapsed,
    "pairs_total": total,
    "pairs_succeeded": succeeded,
    "pairs_timed_out": timed_out,
    "pairs_cached": cached,
    "mode": "inline",
})
```

### Trace ID

The `requestId` (generated by the frontend, passed through the entire pipeline) serves as the trace ID. It's included in:
- Every SSE event (`debugId` in errors)
- Every log line
- The DynamoDB status and lock items
- The SQS message body

The frontend can display it on error screens: "Error ID: req_x7k9m2 — share this with support."

---

## Security and Auth

### Endpoint Authorization

Both the SSE endpoint (`POST /itinerary/generate-stream`) and the polling endpoint (`GET /itinerary/jobs/latest/{trip_id}`) require authentication via `Depends(get_current_user_id)`.

**Trip access verification:** The user must be the trip owner (`trip.createdBy == user_id`) or a trip member (check `tripy-trip-members` table). This is the same check as the existing `/itinerary/generate` endpoint. Extract into a shared `_verify_trip_access(trip, user_id)` function that raises `HTTPException(403)` on failure. Since `trip_repo` and `trip_member_repo` are sync boto3, wrap calls with `run_in_threadpool`.

**Worker re-validation:** The worker Lambda does not re-check auth (the job was already authorized when enqueued). However, it must verify the trip still exists and hasn't been deleted between enqueue and execution. If the trip is missing, the worker logs a warning and returns without processing.

**SSE auth with `fetch`:** We intentionally use `fetch` (not `EventSource`) for the SSE connection because `EventSource` cannot set the `Authorization` header. This is a deliberate design choice. The `fetch` approach sends the Bearer token in the request header, same as every other API call.

**No progress leakage:** The polling endpoint verifies trip membership before returning status. A non-member cannot observe another trip's generation progress.

---

## Rollout Order

| Order | What | Risk | Rollback |
|-------|------|------|----------|
| 1 | Quick wins (steps 4.1–4.4) | Low — independent optimizations within existing code | Revert PRs |
| 2 | SSE endpoint + frontend hook (phases 1 + 3) | Medium — new endpoint, new frontend code, but old endpoint still works | Set `USE_STREAMING_ITINERARY=false` in frontend env |
| 3 | SQS worker + polling fallback (phase 2) | Medium — new infra, but only activated for complex trips | Set `QUEUE_THRESHOLD_DESTINATIONS=999` to effectively disable |
| 4 | Remove old `TripGenerationLoader` time-based animation | Low — cleanup after streaming is proven | N/A |

### Feature Flag

**Frontend:** `NEXT_PUBLIC_USE_STREAMING_ITINERARY=true|false` (env var, defaults to `false` during rollout).

When `false`, the frontend uses the existing `generateItinerary()` call and time-based `TripGenerationLoader`. When `true`, it uses `useItineraryStream` and real progress. This allows instant rollback without a deploy.

**Backend:** The streaming endpoint exists regardless of the flag. The flag only controls whether the frontend calls it.

---

## Testing Strategy

1. **Unit — SSE parser:** Test `createSSEParser()` with single events, multi-event chunks, split chunks, comments, multiline data.
2. **Unit — event types:** Test `format_sse()` produces valid wire format with `id:`, `event:`, `data:` fields and camelCase field names.
3. **Unit — complexity heuristic:** Test `_decide_execution_mode()` with various destination/pair counts.
4. **Unit — generation lock:** Test conditional DynamoDB write acquires lock, rejects concurrent lock, allows re-acquire after stale/terminal.
5. **Unit — disconnected destinations:** Test `_find_disconnected_destinations()` detects unreachable nodes.
6. **Integration — SSE endpoint:** Test the full `POST /itinerary/generate-stream` with DynamoDB local. Verify event sequence, auth checks, lock acquisition, and cached-result fast path.
7. **Integration — worker:** Test `itinerary_worker.handler` with a mock SQS event. Verify status updates in DynamoDB and `allow_queue=False` is passed.
8. **E2E — simple trip:** 2 destinations, verify SSE stream completes with real progress and `complete` status in < 30s.
9. **E2E — complex trip:** 6+ destinations, verify `queued` event within 2s, worker completes within 15 min, polling returns `complete`.
10. **E2E — connection drop:** Kill the SSE connection mid-stream. Verify frontend falls back to polling, itinerary results are written to DynamoDB and retrievable via `GET /itinerary/get`.
11. **E2E — duplicate click:** Fire two generate requests with different `requestId`s for the same trip. Verify the second receives `already_processing` with the existing `jobId`.
12. **E2E — timeout heartbeat:** Verify the `: keep-alive` comment keeps the App Runner connection alive during a long ILP phase.
13. **E2E — App Runner flush:** During the `flights` phase of a 12-pair trip, verify the UI message updates at least every 5 seconds. If all messages arrive in a burst at the end, the test fails (buffering detected).
14. **Backward compat:** Verify `POST /itinerary/generate` (non-streaming) still works when `USE_STREAMING_ITINERARY=false`.

---

## Files to Create/Modify

### Backend

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/models/sse_events.py` | **Create** | SSE event types, enums, wire formatter (camelCase aliases) |
| `backend/src/services/itinerary_service.py` | **Modify** | Extract helper functions, add `generate_optimized_itinerary_stream` with `allow_queue` param, add `_find_disconnected_destinations`, wrap sync boto3 in `run_in_threadpool` |
| `backend/src/app.py` | **Modify** | Add `POST /itinerary/generate-stream`, `GET /itinerary/jobs/latest/{trip_id}`, lock acquisition, queue-based heartbeat interleaving, shared `_verify_trip_access` |
| `backend/src/workers/itinerary_worker.py` | **Create** | SQS worker handler with `allow_queue=False`, heartbeat loop, lock management |
| `backend/src/repos/itinerary_repo.py` | **Modify** | Add `put_item_conditional`, `get_item`, `get_generation_lock`, `get_job_status`, `get_latest_job` |
| `backend/src/repos/trip_repo.py` | **Modify** | Add `update_trip_conditional` for atomic `itineraryVersion` increment |
| `backend/tests/test_sse_events.py` | **Create** | Unit tests for SSE formatting, camelCase aliasing |
| `backend/tests/test_itinerary_stream.py` | **Create** | Integration tests for streaming generator, lock, disconnected destinations |

### Infrastructure

| File | Action | Purpose |
|------|--------|---------|
| `infra/lib/apiStackLambda.ts` | **Modify** | Add SQS queue, DLQ, worker Lambda, permissions |
| `infra/lib/dbStack.ts` | **Modify** | Enable TTL on `tripy-itinerary` table |
| `backend/apprunner.yaml` | **Modify** | Add `GENERATION_QUEUE_URL` env var |

### Frontend

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/lib/sse/parse.ts` | **Create** | SSE wire format parser |
| `frontend/src/lib/sse/parse.test.ts` | **Create** | Parser unit tests |
| `frontend/src/lib/hooks/useItineraryStream.ts` | **Create** | SSE + polling hook with disconnect recovery |
| `frontend/src/components/ui/TripGenerationLoader.tsx` | **Modify** | Accept real progress props, dual-mode rendering |
| `frontend/src/app/(app)/group/payment/page.tsx` | **Modify** | Use `useItineraryStream` behind feature flag, call `itineraries.get()` after complete |
| `frontend/src/app/(app)/solo/results/page.tsx` | **Modify** | Use `useItineraryStream` for legacy fallback, behind feature flag |

---

## Acceptance Criteria

- [ ] Simple trip (≤4 destinations) returns SSE `complete` status in < 30s without SQS queuing
- [ ] Complex trip (>4 destinations) emits `queued` SSE event within 2s and worker completes within 15 min
- [ ] SSE disconnect mid-run: frontend falls back to polling, final itinerary retrievable via `GET /itinerary/get`
- [ ] Duplicate generate clicks for the same trip do not start duplicate jobs (trip-level lock; second request receives `already_processing`)
- [ ] `TripGenerationLoader` displays real phase + progress message (no decorative timer when streaming mode is on)
- [ ] Old `POST /itinerary/generate` endpoint still works identically when `USE_STREAMING_ITINERARY=false`
- [ ] Feature flag `NEXT_PUBLIC_USE_STREAMING_ITINERARY` toggles between old and new behavior without deploy
- [ ] SSE heartbeat (`: keep-alive` comment) is sent every 15s and prevents App Runner idle timeout
- [ ] All SSE events include `v`, `seq`, `tripId`, `ts` fields (camelCase on wire)
- [ ] Error events include `code`, `userMessage`, `debugId`
- [ ] Metrics for `itinerary.generate.duration_ms`, `itinerary.decision`, and `itinerary.flights.pairs_*` are emitted
- [ ] Worker Lambda can run PuLP/CBC solver (verified in test invocation)
- [ ] Polling endpoint enforces trip membership (non-members get 403)
- [ ] App Runner flush verified: during `flights` phase, UI messages update at least every 5s (no buffering burst)
- [ ] Worker calls generator with `allow_queue=False` (no recursive SQS enqueue)
- [ ] `itineraryVersion` increments atomically on trip record via conditional update
- [ ] Stale generation lock (heartbeat > 5 min) can be re-acquired
- [ ] Frontend always calls `GET /itinerary/get` after `complete` status (SSE does not carry full payload)
