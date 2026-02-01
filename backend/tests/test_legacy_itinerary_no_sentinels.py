import pytest


def test_legacy_itinerary_strict_mode_raises_on_negative_numbers(monkeypatch):
    from src.services import itinerary_service

    monkeypatch.setenv("TRIPY_STRICT_CONTRACTS", "true")
    payload = {"items": [{"type": "flight", "cash_price": -1}]}

    with pytest.raises(ValueError) as excinfo:
        itinerary_service._enforce_no_negative_numbers(payload, context="legacy itinerary")

    assert "legacy itinerary" in str(excinfo.value)


def test_legacy_itinerary_non_strict_scrubs_negative_numbers(monkeypatch):
    from src.services import itinerary_service

    monkeypatch.delenv("TRIPY_STRICT_CONTRACTS", raising=False)
    payload = {"items": [{"type": "flight", "cash_price": -1, "raw": {"x": -2}}]}

    scrubbed = itinerary_service._enforce_no_negative_numbers(payload, context="legacy itinerary")

    assert scrubbed["items"][0]["cash_price"] is None
    assert scrubbed["items"][0]["raw"]["x"] is None

