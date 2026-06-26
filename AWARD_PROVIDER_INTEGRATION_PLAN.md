# Award Provider Integration Plan — seats.aero · rooms.aero · AwardWallet

**Status:** Design / proposed. No code changed yet.
**Author:** Claude (planning for self-execution)
**Date:** 2026-06-26

Goal: unify the three award data sources (seats.aero flights, rooms.aero hotels,
AwardWallet flight+hotel) plus the in-repo `award_pricing` engine behind one
backend **Award Provider Layer**, so that callers ask "price this redemption" and
the layer picks the best source, fills gaps with the deterministic engine, and
respects a single shared seats.aero quota.

---

## 0. Assumptions (read first)

These shape everything below. If any is wrong, the design bends.

1. **"awardtool" = AwardWallet.** Per clarification, the third provider is the
   **AwardWallet Flight/Hotel Award Search API** (`awardwallet.com/api`), an
   **asynchronous** submit→poll/webhook service — *not* the existing
   `awardtool-api.com` integration in
   [flight-search.ts](frontend/src/lib/flight-search.ts). The legacy AwardTool
   path is retained only as a degraded sync fallback and will be deprecated once
   AwardWallet is live.
2. **Consolidate in backend.** Flight award search moves out of the frontend
   (today it runs client-side and ships `SEATS_AERO_API_KEY` /
   `AWARDTOOL_API_KEY` in the frontend env). After this, the frontend calls
   backend endpoints only; all provider keys live server-side.
3. **One seats.aero partner key spans flights AND hotels.** `SEATS_AERO_API_KEY`
   is used by both the flight `/partnerapi/search` and rooms.aero hotel calls,
   and the Pro quota (~1,000 calls/day) is **shared**. Today the frontend flight
   limiter and the backend hotel limiter cannot see each other → quota-blowout
   risk. A single shared client fixes this.
4. **rooms.aero contract is unconfirmed.** `rooms_aero.py` states the hotel
   endpoint/params/response are a best-guess and non-commercial. The live hotel
   path stays behind `USE_LIVE_HOTEL_PROVIDER` with a safe engine fallback until
   the real contract is confirmed in writing.
5. **AwardWallet auth + shape** follow its public docs: header
   `X-Authentication: user:password`, `POST /v1/search` → `requestId`,
   `GET /v1/getResults/{requestId}`, optional webhooks, `GET /v1/providers/list`.
   Result `state` codes (0 pending, 1 ok, 2 auth-fail, 9 ok-with-warnings,
   10 2FA, 11 timeout). Pricing/rate limits are "contact us" — treated as unknown
   and guarded behind a concurrency cap + budget counter.
6. **Loyalty balances are persisted server-side** per client (ties into the
   intake-as-training-signal work). Reachable-program filtering moves to the
   backend using the existing `programs.yml` transfer graph.
7. **The `award_pricing` engine stays authoritative for *estimates*.** Live
   providers are authoritative for *bookability + seat counts*; the engine fills
   pricing gaps and supplies confidence-tagged fallbacks. The existing
   chart→cash-derived→dummy layering is unchanged.

---

## 1. Current state (what we're refactoring)

| Concern | Today | Problem |
|---|---|---|
| Flight award search | Frontend `searchAwardFlights*` in [flight-search.ts](frontend/src/lib/flight-search.ts) calls seats.aero / AwardTool directly | Keys in frontend bundle; no shared quota; sync-only |
| Hotel award search | Backend `RoomsAeroHotelProvider` in [rooms_aero.py](backend/src/handlers/rooms_aero.py) → live rooms.aero or `award_pricing` fallback | Separate limiter/cache; can't see flight quota usage |
| Fallback pricing | `award_pricing` engine (`quote_flight` / `quote_hotel`, chart→cash→dummy) | Good; only wired into hotels server-side, not flights |
| Reachable programs | Computed twice: frontend `computeReachablePrograms` + backend `programs.py` transfer graph | Duplicated logic, drift risk |
| Provider metadata | `provider_contracts.py` has a `seats_aero` contract | No contracts for rooms.aero / AwardWallet / engine |

The async nature of AwardWallet is incompatible with the frontend's
`Promise.all([cash, award])` per-route flow — you cannot block a request on a
submit→poll cycle. This alone justifies moving award search to the backend.

---

## 2. Target architecture

```
                         ┌─────────────────────────────────────────┐
 Frontend                │  Backend: Award Provider Layer           │
 ────────                │  src/award_providers/                    │
 POST /api/awards/search │                                          │
   {clientId, legs[],    │   router.resolve(query) ───────────────┐ │
    cabins, kind}        │     │                                  │ │
        │                │     ├─ reachable_programs(clientId)     │ │
        ▼                │     │     (programs.yml transfer graph) │ │
 GET  /api/awards/       │     │                                  │ │
   results/{jobId}  ◄────┼─────┤  for each enabled provider:      │ │
        │                │     │    SeatsAeroProvider  (sync)      │ │
        ▼                │     │    AwardWalletProvider(async)─────┼─┼─► submit/poll
 render cash + award     │     │    EnginePricer       (sync)      │ │   + webhook
                         │     │                                  │ │   POST /webhooks/
                         │     └─ merge + dedupe + rank ──────────┘ │   awardwallet
                         │           (AwardOption[])                 │
                         │   SeatsAeroClient (shared quota/cache) ◄──┤
                         └─────────────────────────────────────────┘
```

Single entry: `router.resolve(AwardQuery) -> AwardJob`. Sync providers fill the
job inline; async (AwardWallet) attach pending sub-jobs completed by webhook/poll.
Frontend polls `GET /api/awards/results/{jobId}` (or subscribes via SSE) and gets
partial→complete results.

---

## 3. New module layout (backend)

```
backend/src/award_providers/
  __init__.py            # public: resolve(), get_job(), register_provider()
  models.py              # AwardQuery, AwardOption, AwardJob, ProviderResult
  router.py              # orchestration: fan-out, merge, rank, gap-fill
  reachable.py           # backend port of computeReachablePrograms (uses programs.yml)
  base.py                # AwardProvider protocol
  seats_aero/
    client.py            # SHARED seats.aero HTTP client (rate-limit, cache, quota)
    flights.py           # SeatsAeroFlightProvider  (/partnerapi/search)
    hotels.py            # SeatsAeroHotelProvider    (rooms.aero, moved from handlers)
  awardwallet/
    client.py            # X-Authentication, submit/getResults/providers
    flights.py           # AwardWalletFlightProvider (async)
    hotels.py            # AwardWalletHotelProvider  (async)
    webhook.py           # FastAPI router: POST /webhooks/awardwallet
  engine_provider.py     # wraps award_pricing.quote_flight/quote_hotel as a provider
  jobs.py                # AwardJob store (in-memory dev, Redis prod)
```

The existing `award_pricing/` package is unchanged and imported by
`engine_provider.py`. `handlers/rooms_aero.py` logic moves into
`seats_aero/hotels.py` (keep a thin shim re-export for one release).

---

## 4. Core data models (`award_providers/models.py`)

Unify flights and hotels under one envelope; `AwardOption` supersedes the
frontend `AwardFlightResult` and the hotel `HotelRecommendation` for award rows.

```python
Kind = Literal["flight", "hotel"]

@dataclass
class AwardLeg:                 # one flight leg or one hotel stay
    origin: str | None          # IATA (flight)
    destination: str            # IATA or city
    date: str                   # YYYY-MM-DD (flight) / check_in (hotel)
    end_date: str | None        # check_out (hotel)

@dataclass
class AwardQuery:
    kind: Kind
    legs: list[AwardLeg]
    cabins: list[str]           # ["business"] etc.; hotels ignore
    client_id: str | None       # drives reachable-program filtering + creds
    programs: list[str] | None  # explicit override; else derived from reachable
    pax: int = 1
    currency: str = "USD"
    deep_verify: bool = False   # opt-in AwardWallet credentialed search

@dataclass
class AwardOption:
    kind: Kind
    program_code: str
    points: int
    points_min: int | None      # range when tier unknown (engine)
    points_max: int | None
    cabin_or_room: str
    surcharge: float            # taxes/fees in `currency`
    currency: str
    source: str                 # "seats_aero" | "awardwallet" | "chart" | "cash_derived" | "dummy"
    confidence: float           # provider trust × engine confidence
    bookable: bool              # True only from live providers with seats
    seats_remaining: int | None
    direct: bool | None
    segments: list[dict]        # flight numbers/times/aircraft/fare class (live only)
    transfer_source: str | None # "Direct" or bank name (from reachable.py)
    as_of: str | None
    notes: str | None

@dataclass
class AwardJob:
    id: str
    query: AwardQuery
    status: Literal["pending", "partial", "complete", "error"]
    options: list[AwardOption]
    pending_providers: list[str] # async providers not yet returned
    created_at: str
```

---

## 5. Provider abstraction (`base.py`)

```python
class AwardProvider(Protocol):
    id: str
    contract: ProviderContract          # from optimization/provider_contracts.py
    def supports(self, kind: Kind) -> bool: ...
    async def search(self, q: AwardQuery, programs: list[str]) -> ProviderResult: ...

@dataclass
class ProviderResult:
    options: list[AwardOption]          # ready now (sync) or [] (async pending)
    pending_ref: str | None             # async handle (AwardWallet requestId), else None
```

Extend `provider_contracts.py` with `rooms_aero`, `awardwallet`, and `engine`
contracts (trust levels: seats_aero=low/discovery already exists; awardwallet=
medium when anonymous, high when credentialed; engine=estimate-only).

---

## 6. Resolution algorithm (`router.py`)

```
resolve(q: AwardQuery) -> AwardJob:
  programs = q.programs or reachable.programs_for(q.client_id, kind=q.kind)
  if programs == []:               # client has no usable loyalty
      return AwardJob(complete, options=[])

  job = jobs.create(q)
  for provider in enabled_providers(q.kind):        # ordered by contract priority
      res = await provider.search(q, programs)
      job.options += res.options                    # sync providers land now
      if res.pending_ref:
          job.pending_providers.append(provider.id)
          register_pending(job.id, provider.id, res.pending_ref)   # await webhook/poll

  job.options = gap_fill_with_engine(job.options, q, programs)
  job.options = merge_dedupe_rank(job.options)
  job.status = "complete" if not job.pending_providers else "partial"
  return job
```

**Merge rules (`merge_dedupe_rank`)**
- Key = `(program_code, cabin_or_room, leg signature, rounded points)`.
- When two sources collide, **prefer live + bookable over estimate**; among live,
  prefer higher `confidence × contract.trust_weight`; keep the richer `segments`.
- Live availability overrides engine bookability; engine only *adds* programs/cabins
  the live providers didn't return (so the user still sees a price even with no live
  space — clearly tagged `bookable=false`, `source="cash_derived"` etc.).
- Rank by the existing CPP/score idea (move `scoreAwardFlight` logic server-side),
  tie-broken by `confidence`.

**Gap-fill** calls `award_pricing.quote_flight` / `quote_hotel` for every
`(program × cabin)` in `programs` not already covered by a live `bookable` option.

---

## 7. Shared seats.aero client (`seats_aero/client.py`) — the quota guardian

The single most important new component. Both flights and rooms.aero hotels go
through it so the shared partner quota is accounted once.

- **Auth:** `Partner-Authorization: <SEATS_AERO_API_KEY>`.
- **Rate limit:** token bucket sized to key tier (default ~4 req/s, matching the
  current frontend `SEATS_MIN_INTERVAL_MS=250`).
- **Cache:** TTL per kind — flights ~5 min (volatile), hotels ~6 h (existing
  `HOTEL_CACHE_TTL`). In-memory for dev, **Redis** in prod so warm serverless
  instances share it (today's per-process caches don't).
- **Daily quota counter:** shared Redis counter; when within N% of the cap, the
  router **degrades to engine fallback** instead of erroring (log the drop — no
  silent truncation).
- **Retry/backoff:** honor `Retry-After`, exp backoff capped at 8 s, 3 retries —
  port the proven logic from `seatsAeroGet` in
  [flight-search.ts](frontend/src/lib/flight-search.ts).

This is a direct Python port of the existing frontend client, made shared.

---

## 8. AwardWallet async provider (`awardwallet/`)

The new capability. Async lifecycle:

```
client.submit(q, programs) -> requestId      # POST /v1/search (webhookUrl set)
   ↓ (background)
POST /webhooks/awardwallet  {requestId, state, results}   # webhook.py
   → jobs.complete_provider(jobId, options)
fallback poller: GET /v1/getResults/{requestId} every 3–5s until state≠0 or timeout
```

- `submit()` sets `webhookUrl` to our public `/webhooks/awardwallet` and stores
  `requestId → jobId`. A **poller** (background task) is the fallback when webhooks
  aren't delivered (dev/headless), bounded by AwardWallet's `timeout` param.
- `state` handling: `1`/`9` → parse results; `2`/`10` → credentialed search needs
  auth/2FA → surface to client as "verify your <program> login"; `11` → timeout,
  fall through to engine; `4` → provider error, skip that provider.
- **Credentialed deep-verify:** when `q.deep_verify` and the client stored loyalty
  creds, pass them so AwardWallet returns the member's real bookable price. This is
  the personalization win seats.aero can't provide and ties into intake training.
- Map AwardWallet's richer segment data (aircraft, fare class, terminals,
  per-segment seats, multi-currency taxes with FX) into `AwardOption.segments` +
  `surcharge`/`currency`. This also fixes today's bug where non-USD seats.aero
  taxes are discarded (`seatsTaxesUsd`).
- **Concurrency/budget guard:** cap in-flight AwardWallet requests and count them
  (pricing unknown) so an optimize run can't fan out unboundedly.

---

## 9. Reachable programs in the backend (`reachable.py`)

Port `computeReachablePrograms` semantics onto the existing transfer graph:

- Input: `client_id` → stored `LoyaltyBalance[]` (or explicit list).
- Use `config/programs.py` `TRANSFER_PARTNERS` / `EXTENDED_TRANSFER_GRAPH` to
  expand bank balances into reachable airline/hotel programs.
- Output: `{programs: [...], annotations: {program: "Direct"|bank_name}}`, applied
  as `AwardOption.transfer_source`. Frontend stops computing this; one source of
  truth, no drift.

---

## 10. HTTP surface (FastAPI, `app.py`)

```
POST /api/awards/search        body: AwardQuery        -> {jobId, status, options}
GET  /api/awards/results/{id}                          -> AwardJob (poll for async)
GET  /api/awards/results/{id}/stream                   -> SSE (optional, nicer UX)
POST /webhooks/awardwallet                             -> 204 (internal)
GET  /api/awards/providers                             -> live provider/program list
```

`POST /api/hotels/search` is reimplemented on top of `resolve(kind="hotel")` but
keeps its current response shape (`cashOptions/awardOptions/...`) for compatibility.

---

## 11. Frontend changes

- Delete client-side `searchAwardFlightsSeatsAero` / `searchAwardFlightsAwardTool`
  and the seats.aero client from [flight-search.ts](frontend/src/lib/flight-search.ts);
  replace with `postAwardSearch()` → poll `GET /api/awards/results/{id}`.
- Remove `SEATS_AERO_API_KEY` / `AWARDTOOL_API_KEY` from frontend env.
- `AwardFlightResult` becomes a thin view-mapping of backend `AwardOption`.
- Cash search can stay where it is; only **award** search moves. The per-route
  `Promise.all([cash, award])` becomes `Promise.all([cash, pollAward])`.

---

## 12. Config / env

| Var | Scope | Purpose |
|---|---|---|
| `SEATS_AERO_API_KEY` | backend only | flights + rooms.aero (shared quota) |
| `AWARDWALLET_USER` / `AWARDWALLET_PASSWORD` | backend | `X-Authentication` |
| `AWARDWALLET_WEBHOOK_SECRET` | backend | verify webhook authenticity |
| `AWARD_PROVIDERS_ENABLED` | backend | `seats_aero,awardwallet,engine` toggle/order |
| `USE_LIVE_HOTEL_PROVIDER` | backend | gate unconfirmed rooms.aero contract |
| `SEATS_AERO_DAILY_QUOTA` | backend | shared counter cap |
| `AWARD_ENGINE_DISABLE` | backend | existing — disable engine fill |
| `REDIS_URL` | backend | shared cache/quota/job store in prod |

Frontend loses `SEATS_AERO_API_KEY`, `AWARDTOOL_API_KEY`.

---

## 13. Phased rollout (each phase shippable)

1. **Shared seats.aero client + provider scaffold.** Port the TS client to
   `seats_aero/client.py`; wrap existing flight `/search` as
   `SeatsAeroFlightProvider`. No behavior change yet (frontend still calls direct).
2. **Backend flight endpoint.** Add `/api/awards/search` (sync, seats_aero+engine
   only). Move `reachable.py`. Switch frontend to it behind a flag; verify parity.
3. **Fold hotels in.** Move `rooms_aero.py` → `seats_aero/hotels.py`; route
   `/api/hotels/search` through `resolve`. Shared quota now real.
4. **AwardWallet async provider.** Add `awardwallet/` + webhook + poller +
   `AwardJob` store; introduce `status: partial`. Anonymous search first.
5. **Credentialed deep-verify.** `deep_verify` path + stored client creds +
   2FA/auth surfacing. Wire to intake training signal.
6. **Cleanup.** Delete frontend award client + keys; deprecate AwardTool path;
   Redis-back cache/quota/jobs for multi-instance.

---

## 14. Testing

- **Unit:** merge/dedupe/rank, gap-fill, reachable expansion, AwardWallet `state`
  handling, quota-degrade path.
- **Contract/golden:** record real seats.aero + AwardWallet responses → fixtures;
  assert `AwardOption` mapping is stable.
- **Integration:** `resolve()` with all providers mocked; assert live-over-estimate
  precedence and that engine fills only uncovered (program×cabin).
- **Webhook:** signed payload → job completion; dropped webhook → poller completes.
- **Quota:** simulate cap → assert degrade-to-engine + a `log()`/metric, no error.

---

## 15. Open questions (need confirmation before Phase 3–5)

1. Real rooms.aero endpoint/params/response (Assumption #4) and **commercial-use
   approval** from seats.aero.
2. AwardWallet exact request/response schema, pricing, and rate limits (Assumption
   #5) — the `getResults` payload field names drive `segments` mapping.
3. Where client loyalty **credentials** are stored and the security model for the
   credentialed deep-verify path (encryption at rest, per-client consent).
4. Is SSE acceptable for the frontend, or is short-poll sufficient for v1?
5. Confirm we are dropping the legacy `awardtool-api.com` integration entirely vs.
   keeping it as a fourth provider.
