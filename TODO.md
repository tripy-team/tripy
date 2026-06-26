# TODO

## Flight detail coverage on solo-results / optimizer itineraries

The solo-results cards (and any optimizer-driven itinerary) show real flight
**times, flight numbers, and stops** for award segments only when the data is
available. Coverage currently depends on **AwardTool**:

- **AwardTool V1 (`fare.products`)** — when AwardTool returns the nested
  per-leg format, we parse real segment times/flight numbers directly
  (`search_awardtool_flights` in `backend/src/handlers/flights.py`).
- **AwardTool V2 (flat `airline_code`)** — this format usually has **no
  schedule**. We backfill times/flight numbers from a **same-airline SerpAPI
  cash flight** on the same route (`FlightAgent` enrichment in
  `backend/src/agents/flight_agent.py`).

### Gaps / follow-ups
- If AwardTool returns V2-without-times **and** no same-airline SerpAPI cash
  flight exists for the route, award segments still render `--:--` (we
  deliberately do not fabricate a different carrier's flight). Coverage is
  therefore bounded by what AwardTool returns + SerpAPI route overlap.
- Consider a second award source (e.g. seats.aero `/trips`, already used on the
  frontend) to reduce dependence on AwardTool for backend optimizer segments.
- Optional: relax the enrichment to show a clearly-labeled *representative*
  schedule (any same-route cash flight) when no same-airline match exists.
- Operational reminder: changes only show after a **backend restart** + a
  **fresh (non-cached) optimization** — the solo optimizer caches results.
