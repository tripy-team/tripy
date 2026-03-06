# Itinerary Generation Performance: AWS Architecture Options

## Current Architecture & Bottlenecks

### How It Works Today

```
User clicks "Generate" → POST /itinerary/generate → Lambda / App Runner (30s limit)
  ├── Load trip data from DynamoDB (fast, ~100ms)
  ├── Resolve cities → airports via CSV + OpenAI fallback (~1-2s)
  ├── Fetch flight edges in parallel (SerpAPI + AwardTool, semaphore 8) ← SLOW
  ├── Run ILP solver (PuLP, up to 60s timeout) ← SLOW
  ├── Generate smart tips via OpenAI (~2-5s)
  └── Write results to DynamoDB (~200ms)
→ Return full JSON response to frontend
```

The frontend shows a fake progress animation (`TripGenerationLoader`, ~55s) while waiting for a single synchronous HTTP response.

### Where Time Is Spent

| Phase | Typical Duration | Bounded By |
|-------|-----------------|------------|
| DynamoDB reads | ~100-200ms | Network |
| City → Airport resolution | ~1-2s | CSV lookup + occasional OpenAI call (10s timeout) |
| **Flight edge fetching** | **5-25s** | SerpAPI (25s read timeout) × AwardTool (30s) × O-D pairs, semaphore 8 |
| **ILP optimization** | **2-30s** | PuLP solver (60s timeout), depends on problem size |
| Smart tips (OpenAI) | ~2-5s | gpt-4o-mini, 10-15s timeout |
| DynamoDB writes | ~200ms | Batch write |
| **Total** | **~10-60s** | Often exceeds 30s API Gateway / Lambda limit |

### Core Problems

1. **30-second hard ceiling**: API Gateway HTTP API has a 30s max timeout. Complex trips with many O-D pairs regularly exceed this.
2. **Synchronous request/response**: The entire pipeline must complete within a single HTTP request. No way to return partial progress.
3. **External API fan-out**: Each O-D pair requires SerpAPI + AwardTool calls. With 6+ destinations, that's 30+ external API calls, even with a semaphore of 8.
4. **ILP solver is CPU-bound**: PuLP runs single-threaded and can take 30s+ for complex constraint sets. Lambda's shared vCPU isn't ideal.
5. **No real progress feedback**: The frontend animation is decorative — it doesn't reflect actual backend progress.

---

## Architecture Options

### Option 1: Async Job Queue with SQS + Polling

Decouple generation from the HTTP request. The API immediately returns a job ID, and the frontend polls for completion.

```
POST /itinerary/generate
  → Write job to SQS
  → Return { jobId, status: "processing" }

SQS → Lambda (15 min timeout, 1024+ MB)
  → Run full pipeline
  → Write results to DynamoDB
  → Update job status to "complete"

Frontend polls GET /itinerary/status/{jobId} every 2-3s
  → Returns { status, progress?, items? }
```

**Pros**
- Removes the 30s timeout constraint entirely (Lambda can run up to 15 minutes)
- Simple to implement — SQS + Lambda is a well-understood pattern
- Built-in retry with SQS dead-letter queues
- No infrastructure to manage (fully serverless)
- Can report granular progress by updating a DynamoDB status record at each phase

**Cons**
- Polling adds latency overhead (2-3s per poll interval) — user waits slightly longer than necessary
- More DynamoDB writes for status updates (negligible cost but more code)
- Frontend needs polling logic (but replaces the current fake timer, so net improvement)
- Cold starts on the worker Lambda can add 2-5s on first invocation

**Estimated Complexity**: Low-Medium
**Estimated Cost Impact**: Minimal (SQS is essentially free at this scale)

---

### Option 2: WebSocket via API Gateway + Lambda

Push real-time progress updates to the frontend over a persistent WebSocket connection.

```
Frontend opens WebSocket → API Gateway WebSocket API → connect Lambda
Frontend sends { action: "generate", tripId }
  → Lambda writes job to DynamoDB, triggers worker

Worker Lambda (15 min timeout):
  → Phase complete → POST to WebSocket API → push to client
  → "Fetching flights for LAX→NRT..." (phase 1/4)
  → "Running optimization..." (phase 2/4)
  → "Generating tips..." (phase 3/4)
  → "Done!" + full results (phase 4/4)
```

**Pros**
- Real-time progress creates a dramatically better UX ("Searching flights to Tokyo...")
- No wasted time from polling intervals — results arrive the instant they're ready
- Can stream partial results (e.g., show each flight as it's found before ILP runs)
- Makes the generation feel faster even at the same actual speed (perceived performance)

**Cons**
- Significantly more complex: WebSocket API, connection management Lambda, connection table in DynamoDB
- API Gateway WebSocket APIs have a 10-minute idle timeout and 29-minute connection duration limit
- Harder to debug and test than REST endpoints
- Need to handle reconnection gracefully (user switches tabs, network blip)
- WebSocket API Gateway pricing is slightly higher ($1/million messages + connection minutes)
- Cold starts on the connect/disconnect Lambdas add overhead

**Estimated Complexity**: High
**Estimated Cost Impact**: Low (but more operational overhead)

---

### Option 3: Server-Sent Events (SSE) via App Runner

Since production already runs on App Runner (not Lambda), use SSE to stream progress on the existing long-lived server process.

```
POST /itinerary/generate (Accept: text/event-stream)
  → App Runner process (no 30s limit for SSE)
  → yield { event: "phase", data: "Resolving airports..." }
  → yield { event: "phase", data: "Fetching 12 flight routes..." }
  → yield { event: "flight_found", data: { route: "LAX→NRT", price: "$450" } }
  → yield { event: "optimizing", data: "Running solver..." }
  → yield { event: "complete", data: { items: [...] } }
```

**Pros**
- Simplest real-time option — SSE is just HTTP with chunked responses, natively supported by FastAPI (`StreamingResponse`)
- App Runner doesn't have API Gateway's 30s limit — requests can run for minutes
- No new infrastructure needed (no WebSocket API, no SQS, no extra Lambda)
- Frontend uses standard `EventSource` API or `fetch` with `ReadableStream`
- Can show incremental results (flights as they're found, then optimization, then tips)
- Already running FastAPI on App Runner — this is a natural fit

**Cons**
- Only works with App Runner (not Lambda behind API Gateway, which has a 30s limit)
- SSE is unidirectional (server → client only) — but that's all we need here
- App Runner has a default request timeout of 120s (configurable up to 120s); very long generations would need a keep-alive heartbeat
- If App Runner scales to zero, the first request hits a cold start (~5-10s for Python)
- App Runner concurrency: each instance handles N concurrent requests; heavy ILP work could starve other requests
- Reconnection logic needed if the connection drops mid-stream

**Estimated Complexity**: Low
**Estimated Cost Impact**: None (uses existing App Runner)

---

### Option 4: Step Functions Orchestration

Model the itinerary pipeline as a state machine with AWS Step Functions, enabling parallel execution and fine-grained control.

```
Step Functions State Machine:
  ├── LoadTripData (Lambda, 5s)
  ├── ResolveAirports (Lambda, 10s)
  ├── Parallel: FetchFlightEdges
  │   ├── FetchPair_LAX_NRT (Lambda)
  │   ├── FetchPair_SFO_CDG (Lambda)
  │   ├── FetchPair_JFK_LHR (Lambda)
  │   └── ... (one Lambda per O-D pair)
  ├── RunILPOptimization (Lambda, 60s, high memory)
  ├── Parallel:
  │   ├── GenerateSmartTips (Lambda)
  │   └── RenderItems (Lambda)
  └── SaveResults (Lambda)

Frontend polls execution status via GET /itinerary/status/{executionArn}
```

**Pros**
- True parallelism: each O-D pair gets its own Lambda invocation (no semaphore bottleneck)
- Could cut flight-fetching time from 15-25s down to 3-5s (limited only by the slowest single pair)
- Built-in error handling, retries, and timeouts per step
- Visual debugging in the Step Functions console
- Can assign different memory/timeout to each step (e.g., 3GB for ILP, 512MB for flight fetch)
- Native integration with DynamoDB, SQS, SNS for notifications

**Cons**
- Most complex option: requires decomposing the monolithic `generate_optimized_itinerary` into separate Lambda functions
- Step Functions pricing: $25 per million state transitions (Standard) — could add up with many O-D pairs
- Express Workflows are cheaper but limited to 5 minutes and don't support all integrations
- Cold starts multiply: each parallel Lambda may cold start independently
- Debugging distributed state machines is harder than debugging a single function
- Significant refactoring effort to extract each phase into a standalone Lambda

**Estimated Complexity**: Very High
**Estimated Cost Impact**: Medium ($25/M transitions + more Lambda invocations)

---

### Option 5: ECS Fargate Task (Fire-and-Forget Container)

Spin up a dedicated container for each generation request with no timeout constraints.

```
POST /itinerary/generate
  → API starts ECS Fargate task with tripId as env var
  → Return { jobId, status: "processing" }

Fargate Task (up to hours, any memory/CPU):
  → Run full pipeline with generous resources
  → Write results to DynamoDB
  → Optionally push SNS notification

Frontend polls GET /itinerary/status/{jobId}
```

**Pros**
- No timeout limits at all (tasks can run for hours)
- Full control over CPU and memory (up to 16 vCPU, 120 GB RAM) — great for ILP solver
- Can run the exact same Python code as App Runner (same Docker image)
- No cold start if using Fargate Spot (though startup is ~30-60s)
- Isolated: one generation can't affect other requests

**Cons**
- **Slow startup**: Fargate tasks take 30-60s to pull image and start — this alone may be longer than current generation time
- More expensive than Lambda for short-lived tasks
- Requires ECR image, ECS cluster, task definition, VPC configuration
- Over-engineered for a task that typically completes in 10-60s
- No built-in retry (need to implement manually or wrap with Step Functions)

**Estimated Complexity**: Medium-High
**Estimated Cost Impact**: Medium-High (minimum container billing + always-on cluster config)

---

### Option 6: Hybrid — SSE + Background Worker for Complex Trips

Combine the simplicity of SSE for most trips with an async fallback for complex ones.

```
POST /itinerary/generate
  → Estimate complexity (number of O-D pairs, destinations)
  → If simple (≤4 destinations): SSE stream directly (Option 3)
  → If complex (>4 destinations): 
      → Return { jobId, status: "processing", estimated: "45s" }
      → Enqueue to SQS → Worker Lambda (15 min)
      → Frontend switches to polling mode
```

**Pros**
- Fast trips stay fast (no queue overhead, no polling delay)
- Complex trips don't timeout (worker Lambda has 15 minutes)
- Best UX for the common case (SSE streaming with real-time progress)
- Graceful degradation: if SSE connection drops, results are still saved and can be fetched
- Can tune the complexity threshold over time based on real performance data

**Cons**
- Two code paths to maintain (SSE and async)
- Frontend needs to handle both modes (SSE stream vs. polling)
- Complexity threshold needs tuning — wrong threshold means either timeouts or unnecessary queuing
- More infrastructure than Option 3 alone (SQS + worker Lambda in addition to App Runner)

**Estimated Complexity**: Medium
**Estimated Cost Impact**: Low

---

## Comparison Matrix

| Criteria | SQS + Polling | WebSocket | SSE (App Runner) | Step Functions | ECS Fargate | Hybrid SSE + SQS |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Removes 30s limit** | Yes | Yes | Yes | Yes | Yes | Yes |
| **Real-time progress** | Coarse (poll) | Excellent | Excellent | Coarse (poll) | Coarse (poll) | Excellent + poll |
| **Implementation effort** | Low-Med | High | **Low** | Very High | Med-High | Medium |
| **New AWS services** | SQS | WS API GW | None | Step Functions | ECS/ECR | SQS |
| **Operational complexity** | Low | Medium | **Low** | High | Medium | Low-Med |
| **Cost impact** | ~$0 | Low | **$0** | Medium | Med-High | Low |
| **Supports partial results** | No | Yes | Yes | No | No | Yes |
| **Retry/error handling** | Built-in (DLQ) | Manual | Manual | Built-in | Manual | Partial |
| **Scales to complex trips** | Yes | Yes | Moderate | **Excellent** | Yes | Yes |
| **Cold start impact** | 2-5s (Lambda) | 2-5s (Lambda) | **None** (warm) | Multiplied | 30-60s | None / 2-5s |

---

## Recommendations

### Short-Term Win (1-2 days): **Option 3 — SSE via App Runner**

This is the lowest-effort, highest-impact change:

1. Production already runs on App Runner with FastAPI — `StreamingResponse` is built-in.
2. No new AWS services to provision or manage.
3. Removes the 30s timeout since App Runner handles long-lived HTTP connections (up to 120s, with heartbeat).
4. Real-time progress dramatically improves perceived performance even before actual speed improves.
5. The `TripGenerationLoader` animation can show real phase updates instead of a fake timer.

**Key implementation steps:**
- Convert `generate_optimized_itinerary` to an async generator that `yield`s progress events.
- Wrap in `StreamingResponse(media_type="text/event-stream")`.
- Frontend switches from `fetch` to `EventSource` or `fetch` + `ReadableStream`.
- Add heartbeat every 15s to prevent connection timeout.

### Medium-Term (1-2 weeks): **Parallelize Flight Fetching**

Independent of the architecture change, the biggest raw speed improvement comes from better parallelism in the flight-fetching phase:

1. Increase the semaphore from 8 to 15-20 (App Runner can handle more concurrency than Lambda).
2. Use `asyncio.gather` with `return_exceptions=True` so one slow pair doesn't block others.
3. Set aggressive per-pair timeouts (10s instead of 25s) and gracefully degrade for pairs that timeout.
4. Cache flight results in DynamoDB or ElastiCache with a 15-30 minute TTL to avoid re-fetching on retries.

### Long-Term (if scale demands): **Option 6 — Hybrid SSE + SQS**

If trips grow in complexity (10+ destinations, 50+ O-D pairs), add the SQS worker path:

1. Simple trips (≤4 destinations) continue using SSE for instant feedback.
2. Complex trips get queued to a worker Lambda with a 15-minute timeout.
3. Frontend detects which mode it's in and adapts (SSE vs. polling).
4. This gives headroom for arbitrarily complex itineraries without any timeout concerns.

---

## Quick Wins (No Architecture Change)

Before changing any architecture, these optimizations can shave 5-15s off generation time within the existing setup:

| Optimization | Estimated Savings | Effort |
|-------------|-------------------|--------|
| Move smart tips generation to **after** returning the core itinerary (post-response background task) | 2-5s | Low |
| Increase flight-fetch semaphore from 8 → 16 on App Runner | 3-8s | Trivial |
| Add aggressive per-pair timeout (10s) with graceful skip | 5-15s on worst case | Low |
| Pre-warm airport resolution cache on trip creation | 1-2s | Low |
| Cache SerpAPI results in DynamoDB (15 min TTL) across users with same O-D pair | Variable, high for popular routes | Medium |
| Use v2 pipeline (`itinerary_v2/pipeline.py`) which already exists but isn't wired up | Unknown (needs testing) | Medium |
| Return core results immediately, backfill tips via a separate lightweight request | 2-5s perceived | Low |
