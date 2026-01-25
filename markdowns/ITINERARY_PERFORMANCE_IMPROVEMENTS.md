# Itinerary Generation: Performance Improvements

This document outlines **AWS services** and **code-level changes** to make itinerary generation faster. The main bottleneck is `generate_optimized_itinerary`, which does many **sequential** external API calls (SERP, AwardTool, OpenAI, ground transport) and can run 1–3+ minutes for 4+ cities.

---

## 1. Code changes (high impact, low infra)

### 1.1 Parallelize flight edge fetches (implemented)

**Problem:** For N cities, there are `N*(N-1)` origin–destination pairs. Each pair runs, **one after another**:

- AwardTool (Panorama + search_real_time) + SERP (Google Flights)
- Fallbacks: SERP-first, `get_flights_serp_only`
- Ground transport (bus/car) and, for small airports, hub fallbacks

With 4 cities that’s 12 pairs × ~5–15 s each → 60–180 s just for flights.

**Change:** Fetch edges for all pairs **in parallel** with `asyncio.gather`, and use an `asyncio.Semaphore` (e.g. 6–8) to avoid overloading SERP/AwardTool.

- **Location:** `backend/src/services/itinerary_service.py` — replace the `for origin, dest in pairs:` loop with a `_fetch_edges_for_route` helper and `asyncio.gather(..., return_exceptions=True)`.
- **Expected:** Large speedup (often 5–10x) for the flight-fetch phase when there are several O–D pairs.

### 1.2 Run OOP and hotels in parallel with flight fetch

**Problem:** `optimize_itinerary_out_of_pocket` and `optimize_hotels_out_of_pocket` run **before** the flight loop and are independent of `edges_all`. They still block the rest of the flow.

**Change:** Start them as tasks at the same time as the flight fetches, then `await` all results before ILP:

```python
oop_task = asyncio.create_task(asyncio.to_thread(optimize_itinerary_out_of_pocket, ...))
oop_hotels_task = asyncio.create_task(asyncio.to_thread(optimize_hotels_out_of_pocket, ...))
# ... run flight fetches in parallel ...
oop_result = await oop_task
oop_hotels_result = await oop_hotels_task
```

(Use only when the trip is simple A→B round-trip and `includeHotels`; otherwise no-op.)

### 1.3 Parallelize city → airport code resolution

**Problem:** `_normalize_city_to_code` runs **sequentially** for start, end, and each intermediate city. Each call can hit `city_service.search_cities` and/or OpenAI `find_commercial_airports_for_city`.

**Change:** Resolve all needed city names in one batch with `asyncio.gather` (and, if needed, `asyncio.to_thread` for sync `city_service`/OpenAI). Build the list of names first, then run the batch.

### 1.4 Defer or parallelize post-optimization work

**Problem:** After the ILP, the code runs sequentially:

- `get_itinerary_smart_tips` (OpenAI)
- `_get_transfer_tips_from_panorama` (AwardTool)
- Many `itinerary_repo.put_item` calls

**Change:**

- Run `get_itinerary_smart_tips` and `_get_transfer_tips_from_panorama` in parallel with `asyncio.gather` if both are used.
- Use **DynamoDB `batch_write_item`** (or a batch helper) instead of a loop of `put_item` for itinerary items. Fewer round-trips and lower latency.

### 1.5 Run sync helpers in threads

**Problem:** `get_flights_serp_only`, `get_bus_and_car_options`, and `ground_options_to_edges` are synchronous. Called from async code, they block the event loop and serialize work.

**Change:** Wrap calls in `asyncio.to_thread(...)` so they don’t block and can be parallelized with other I/O.

---

## 2. Caching (AWS + config)

### 2.1 ElastiCache (Redis) for flight and award cache

**Problem:** `cache_layer` uses in-memory dict when `REDIS_URL` is not set. On **App Runner** this implies:

- Cache is per instance and lost on scale-to-zero or redeploy.
- No reuse across instances or requests.

**Change:**

- Add **Amazon ElastiCache for Redis** (or Memcached) in your VPC.
- Set `REDIS_URL` in App Runner (and Lambda if you use it for itinerary) to point to the cluster.
- Existing `get_json`/`set_json` in `flights.py` and `cache_layer` will use Redis. TTLs are already set (e.g. SERP 90m, Award 6h, Panorama 24h).

**Effect:** Repeat requests for the same route/date/programs can be served from Redis, often saving 5–30+ s per cached O–D pair.

### 2.2 API Gateway / CloudFront caching (optional)

**Problem:** The whole `/itinerary/generate` response is user- and trip-specific, so full response caching is rarely safe. Sub‑requests (e.g. to a flight or hotel microservice) could be cached if you later split the backend.

**Change:** If you introduce a “flight search” or “hotel search” API used by multiple clients, put **API Gateway with cache** or **CloudFront** in front and cache by `(origin, dest, date, …)` with short TTL. Not applied to the current monolithic `generate_optimized_itinerary` endpoint.

---

## 3. Architecture: background / async processing

### 3.1 Generate in background, poll or push when ready

**Problem:** `POST /itinerary/generate` runs the whole pipeline in the HTTP request. For 4+ cities this can exceed 60–120 s. Browsers and load balancers often time out around 30–60 s.

**Change:**

1. **Immediate 202 response:**
   - `POST /itinerary/generate` enqueues a job and returns `202 Accepted` with `job_id` (and optionally `status_url`).
2. **Background worker:**
   - **AWS Lambda** (invoked asynchronously by **EventBridge**, **SQS**, or **Step Functions**), or
   - **ECS/Fargate** or **App Runner** worker that consumes from **SQS**.
   - Worker runs `generate_optimized_itinerary`, writes results to **DynamoDB** (itinerary table keyed by `trip_id` and optionally `job_id`), and can send **SNS** or **WebPush** when done.
3. **Frontend:**
   - Poll `GET /itinerary/status?trip_id=...` or `GET /itinerary/jobs/{job_id}` until `status in ("completed","failed")`, then `GET /itinerary/get`.
   - Or use **WebSockets** (e.g. **API Gateway WebSocket API** + DynamoDB) or **Server-Sent Events** to push “itinerary ready” and then fetch.

**Reuse:** You already have `lambda_background_tasks.py` and patterns for async Lambda. Add a task type, e.g. `"generate_itinerary"`, and wire `trip_id` and `user_id` through the payload.

### 3.2 Step Functions for resiliency and observability

**Problem:** The pipeline has many steps (validate, city→code, fetch flights, OOP, hotels, ILP, tips, DynamoDB). A failure in the middle is hard to retry and to observe.

**Change:** Model the flow as a **Step Functions** state machine:

- Steps: validate → resolve cities (Parallel) → fetch flight edges (Parallel or Map) → OOP+hotels (Parallel) → ILP → post‑process (Parallel) → save.
- Each step can be a Lambda or an activity. Failed steps can be retried with backoff; you get a clear execution graph in the console.

This is more effort than “one Lambda + SQS” but gives better visibility and retry/compensation.

---

## 4. Compute and limits

### 4.1 App Runner: CPU/memory and concurrency

**Problem:** App Runner may be on smaller CPU/memory. ILP (`pulp`) and JSON handling for many edges are CPU‑bound; more memory helps for large `edges_all` and PuLP.

**Change:**

- In **App Runner**, increase **CPU and memory** (e.g. 2 vCPU, 4 GB) if the service is CPU‑ or memory‑bound during ILP.
- Tune **max concurrency** so a few long `generate` requests don’t exhaust workers; combined with async, a single instance can serve more concurrent requests.

### 4.2 Lambda (if used for itinerary)

**Problem:** In `apiStack.ts`, `itinFn` uses `generate_simple_itineraries` and has **30 s** timeout. The full `generate_optimized_itinerary` is not suited to a 30 s Lambda without either:

- Moving it to a background worker (Section 3), or
- Increasing timeout/memory and accepting risk of hitting the 15‑minute Lambda limit.

**Change:**

- Keep **simple** itinerary on Lambda with 30 s if that’s acceptable.
- For **optimized** itinerary, either:
  - Invoke a **background Lambda** (or Step Functions) and return 202 + `job_id`, or
  - Route optimized generation to **App Runner** (or another long‑lived service) and only use Lambda for light handlers.

### 4.3 Outbound concurrency and rate limits

**Problem:** Parallelizing flight fetches and OOP/hotels increases concurrent outbound calls to SERP, AwardTool, and OpenAI. Their rate limits may apply (e.g. SERP, AwardTool, OpenAI RPM).

**Change:**

- Use `asyncio.Semaphore(6)` or `Semaphore(8)` in the flight‑fetch parallelization to cap concurrency.
- If you see 429s, add exponential backoff in `flights.py` / `serp_client` / AwardTool client and possibly reduce the semaphore.

---

## 5. External APIs

### 5.1 Reduce AwardTool and SERP calls where possible

**Current:** For each O–D and each “date” in `get_flights_award_first_with_points_async`, you call AwardTool and SERP. Panorama is also used. Caching (Section 2.1) is the main lever.

**Optional:**

- For **Panorama**, you already cache by `(origin, destination)`. Ensure `REDIS_URL` is set so this is shared.
- If the UI supports a “flexible ±3 days” window, you could prefetch a small set of dates in one batch and cache; this depends on product and quota.

### 5.2 Timeouts and fail-fast

**Problem:** A hung SERP or AwardTool call can delay the whole request.

**Change:** Enforce timeouts in `httpx` (and any other client) per request, e.g. connect 5–10 s, read 20–30 s. You already use `TIMEOUT` in `flights.py`; ensure it’s applied everywhere and consider shortening for the first attempt, with a quick fallback (e.g. skip Award, SERP‑only) if needed.

---

## 6. Suggested order of work

| Priority | Action                                             | Effort | Impact        |
|----------|----------------------------------------------------|--------|---------------|
| 1        | Parallelize flight edge fetches (asyncio.gather)   | Low    | Very high     |
| 2        | ElastiCache Redis + set REDIS_URL                  | Medium | High (repeat) |
| 3        | Run OOP + hotels in parallel with flight fetch     | Low    | Medium        |
| 4        | 202 + background Lambda/SQS + poll or push         | Medium | UX + stability|
| 5        | Parallelize city→code and post‑optimization        | Low    | Medium        |
| 6        | DynamoDB batch writes for itinerary items          | Low    | Low–medium    |
| 7        | Step Functions (optional)                          | High   | Observability |
| 8        | Tune App Runner CPU/memory and Semaphore           | Low    | Medium        |

---

## 7. Summary

- **Largest gains:** parallel flight fetches (done in code) and **ElastiCache Redis** for shared caching.
- **Stability and UX:** move long `generate_optimized_itinerary` to a **background job** (Lambda + SQS/EventBridge) and return **202** with polling or push.
- **Further speed:** parallelize OOP/hotels, city→code, and post‑optimization; run sync helpers in `asyncio.to_thread`; use DynamoDB batch writes; and tune App Runner and a **Semaphore** for external APIs.
