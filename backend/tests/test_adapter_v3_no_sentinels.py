import os

import pytest


def test_adapter_v3_strict_mode_raises_on_negative_numbers(monkeypatch):
    from src.optimization import adapter_v3

    monkeypatch.setenv("TRIPY_STRICT_CONTRACTS", "true")
    payload = [{"id": "i1", "cash_price": -1}]

    with pytest.raises(ValueError) as excinfo:
        adapter_v3._enforce_no_negative_numbers(payload, context="adapter_v3 output")

    assert "adapter_v3 output" in str(excinfo.value)


def test_adapter_v3_non_strict_scrubs_negative_numbers(monkeypatch):
    from src.optimization import adapter_v3

    monkeypatch.delenv("TRIPY_STRICT_CONTRACTS", raising=False)
    payload = [{"id": "i1", "cash_price": -1, "nested": {"x": -0.01}}]

    scrubbed = adapter_v3._enforce_no_negative_numbers(payload, context="adapter_v3 output")

    assert scrubbed[0]["cash_price"] is None
    assert scrubbed[0]["nested"]["x"] is None

