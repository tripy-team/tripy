from datetime import datetime, timedelta, timezone


def test_policy_blocks_negative_layover_timing():
    from src.policy.flight_policy import evaluate_flight_itinerary
    from src.policy.reason_codes import FLIGHT_INVALID_TIMING

    # Arrival is after next departure -> negative layover
    seg1_arr = datetime(2026, 2, 11, 12, 0, tzinfo=timezone.utc)
    seg2_dep = datetime(2026, 2, 11, 10, 0, tzinfo=timezone.utc)

    itinerary = {
        "segments": [
            {"origin": "JFK", "destination": "ORD", "arrival_time": seg1_arr.isoformat()},
            {"origin": "ORD", "destination": "LAX", "departure_time": seg2_dep.isoformat()},
        ],
        "ticketing_type": "single_ticket",
        "connection_type": "protected",
    }

    evaluation = evaluate_flight_itinerary(itinerary)
    assert any(m.code == FLIGHT_INVALID_TIMING for m in evaluation.blocks)


def test_policy_blocks_negative_segment_duration():
    from src.policy.flight_policy import evaluate_flight_itinerary
    from src.policy.reason_codes import FLIGHT_INVALID_TIMING

    itinerary = {
        "segments": [
            {
                "origin": "JFK",
                "destination": "LAX",
                "departure_time": "2026-02-11T08:00:00+00:00",
                "arrival_time": "2026-02-11T10:00:00+00:00",
                "duration_minutes": -5,
            }
        ],
        "ticketing_type": "single_ticket",
        "connection_type": "protected",
    }

    evaluation = evaluate_flight_itinerary(itinerary)
    assert any(m.code == FLIGHT_INVALID_TIMING for m in evaluation.blocks)

