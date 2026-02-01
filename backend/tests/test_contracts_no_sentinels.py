import pytest

from src.contracts.sentinel import scrub_sentinels
from src.contracts.validate import assert_no_negative_numbers, find_negative_numbers


def test_find_negative_numbers_reports_nested_paths():
    obj = {
        "flight": {"cash_price": -1},
        "segments": [
            {"taxes": 0},
            {"taxes": -0.01, "meta": {"inner": [-2]}},
        ],
        # bool should not be treated as numeric sentinel
        "flags": {"ok": True, "bad": False},
    }

    negatives = find_negative_numbers(obj)
    paths = {p for p, _ in negatives}

    assert "flight.cash_price" in paths
    assert "segments[1].taxes" in paths
    assert "segments[1].meta.inner[0]" in paths


def test_scrub_sentinels_replaces_negative_numbers_with_none():
    obj = {
        "a": -1,
        "b": 0,
        "c": {"d": [-2, 3, True, False], "e": (-3, 4)},
    }
    scrubbed = scrub_sentinels(obj)

    assert scrubbed["a"] is None
    assert scrubbed["b"] == 0
    assert scrubbed["c"]["d"] == [None, 3, True, False]
    assert scrubbed["c"]["e"] == (None, 4)


def test_assert_no_negative_numbers_raises_with_paths():
    obj = {"x": {"y": [-1]}}

    with pytest.raises(ValueError) as excinfo:
        assert_no_negative_numbers(obj, context="unit-test")

    msg = str(excinfo.value)
    assert "unit-test" in msg
    assert "x.y[0]" in msg

