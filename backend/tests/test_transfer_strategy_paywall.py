import asyncio

import pytest


def test_transfer_strategy_returns_redacted_when_locked(monkeypatch):
    """
    When trip status is not instructions_unlocked, /solo/transfer-strategy must not return steps.
    """
    from src.routes import solo as solo_routes
    from src.schemas.optimize import TransferStrategyRequest

    monkeypatch.setattr(
        solo_routes.solo_trip_service,
        "get_solo_trip",
        lambda trip_id, user_id=None: {"tripId": trip_id, "createdBy": user_id, "status": "selected"},
    )
    monkeypatch.setattr(
        solo_routes.solo_trip_service,
        "get_selection",
        lambda trip_id, user_id: {"ok": True, "itinerary_id": "i1", "itinerary_snapshot": {"id": "i1", "segments": [{"type": "flight"}]}},
    )

    # Minimal stub for the FastAPI `Request` param (only touched on the anon
    # PermissionError fallback, which this test does not exercise).
    class _StubRequest:
        headers: dict = {}

    req = TransferStrategyRequest(trip_id="t1", itinerary_id="i1")
    res = asyncio.run(
        solo_routes.get_transfer_strategy(req, http_request=_StubRequest(), user_id="u1")
    )

    assert res.total_points_to_transfer == 0
    assert res.transfers == []
    assert res.bookings == []
    assert any("locked" in w.lower() for w in res.warnings)

