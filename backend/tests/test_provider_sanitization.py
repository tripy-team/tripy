import asyncio


def test_awardtool_flights_parser_never_emits_negative_numbers(monkeypatch):
    """
    Provider-boundary contract:
    - negative numeric sentinels (e.g. -1) must not leak into parsed flight options
    """
    from src.contracts.validate import assert_no_negative_numbers
    from src.handlers import flights as flights_mod

    async def _fake_awardtool_realtime(*args, **kwargs):
        return {
            "data": [
                # Should be dropped (invalid points sentinel)
                {
                    "airline_code": "UA",
                    "award_points": -1,
                    "surcharge": -1,
                    "cabin_type": "Economy",
                    "cash_fare": -1,
                    "date": "2026-02-11",
                    "departure_time": "2026-02-11T10:00:00",
                    "arrival_time": "2026-02-11T12:00:00",
                    "duration_minutes": 120,
                    "stops": 0,
                },
                # Should be kept; cash_fare sentinel becomes None, surcharge sentinel becomes 0.0
                {
                    "airline_code": "UA",
                    "award_points": "50000",
                    "surcharge": -1,
                    "cabin_type": "Business",
                    "cash_fare": -1,
                    "date": "2026-02-11",
                    "departure_time": "2026-02-11T10:00:00",
                    "arrival_time": "2026-02-11T12:00:00",
                    "duration_minutes": 120,
                    "stops": 0,
                },
            ]
        }

    monkeypatch.setattr(flights_mod, "_awardtool_realtime", _fake_awardtool_realtime)

    results = asyncio.run(
        flights_mod.search_awardtool_flights(
            origin="JFK",
            destination="LAX",
            date="2026-02-11",
            programs=["UA"],
            cabins=["Business"],
            pax=1,
        )
    )

    # Only the valid-points row survives.
    assert len(results) == 1
    assert results[0]["cash_price"] is None
    assert results[0]["points"] == 50000
    assert results[0]["surcharge"] == 0.0

    assert_no_negative_numbers(results, context="awardtool_flights")


def test_awardtool_hotels_parser_never_emits_negative_numbers():
    from src.contracts.validate import assert_no_negative_numbers
    from src.handlers.hotels import _parse_hotel_results

    body = {
        "data": [
            {
                "hotel_id": "h1",
                "name": "Test Hotel",
                "program_code": "HYATT",
                "cash_cost": -1,
                "points": -1,
                "surcharge": -1,
                "star_rating": 5,
                "address": "Somewhere",
            }
        ]
    }

    parsed = _parse_hotel_results(body)

    assert len(parsed) == 1
    assert parsed[0]["cash_cost"] is None
    assert parsed[0]["points_cost"] is None
    assert parsed[0]["surcharge"] == 0.0

    assert_no_negative_numbers(parsed, context="awardtool_hotels")

