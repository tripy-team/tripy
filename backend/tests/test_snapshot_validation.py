import pytest


def test_validate_snapshot_missing_keys_fails():
    from src.solo.snapshot_schema import validate_snapshot, normalize_snapshot

    errors = validate_snapshot(normalize_snapshot({}))
    assert any("missing required key" in e for e in errors)


def test_validate_snapshot_negative_numbers_fail():
    from src.solo.snapshot_schema import validate_snapshot, normalize_snapshot

    snap = normalize_snapshot({"id": "i1", "segments": [{"cashPrice": -1}]})
    errors = validate_snapshot(snap)
    assert any("negative numeric values" in e for e in errors)


def test_select_itinerary_rejects_invalid_snapshot(monkeypatch):
    from fastapi import HTTPException
    from src.schemas.trip import SelectItineraryRequest
    from src.services import solo_trip_service

    trip = {"tripId": "t1", "createdBy": "u1"}

    monkeypatch.setattr(solo_trip_service, "get_solo_trip", lambda trip_id, user_id=None: trip)
    monkeypatch.setattr(solo_trip_service, "get_solo_table", lambda: object())
    monkeypatch.setattr(solo_trip_service, "put_item", lambda table, item: None)

    req = SelectItineraryRequest(
        itinerary_id="i1",
        itinerary_snapshot={"id": "i1", "segments": [{"cashPrice": -1}]},
        cash_price_at_selection=123.0,
        out_of_pocket_at_selection=123.0,
    )

    with pytest.raises(HTTPException) as excinfo:
        solo_trip_service.select_itinerary("t1", "u1", req)

    assert excinfo.value.status_code == 400

