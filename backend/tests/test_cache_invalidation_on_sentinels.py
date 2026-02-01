import importlib


def test_cache_layer_invalidates_negative_values_in_memory(monkeypatch):
    """
    If cache contains negative numeric values, it must be treated as miss and invalidated.
    """
    # Ensure we exercise memory cache path
    monkeypatch.delenv("REDIS_URL", raising=False)

    # Reload module to re-evaluate REDIS_URL at import time.
    import src.utils.cache_layer as cache_layer
    importlib.reload(cache_layer)

    # Write a bad cached value directly into mem cache
    k = cache_layer._ns("bad_key")
    with cache_layer._mem_lock:
        cache_layer._mem_cache[k] = ({"x": -1}, 10**12)

    assert cache_layer.get_json("bad_key") is None
    with cache_layer._mem_lock:
        assert k not in cache_layer._mem_cache


def test_solo_trip_cache_invalidates_negative_payload(monkeypatch):
    """
    If a solo trip's optimizationCache contains negatives, delete that entry and treat as miss.
    """
    from src.services import solo_trip_service

    trip_id = "t1"
    cache_key = "k1"

    trip = {
        "tripId": trip_id,
        "optimizationCache": {
            cache_key: {"result": {"cash_price": -1}, "computed_at": "x", "expires_at": "y"}
        },
    }

    written = {}

    def fake_get_solo_trip(tid, user_id=None):
        assert tid == trip_id
        return trip

    def fake_put_item(table, item):
        written["trip"] = item

    monkeypatch.setattr(solo_trip_service, "get_solo_trip", fake_get_solo_trip)
    monkeypatch.setattr(solo_trip_service, "put_item", fake_put_item)
    monkeypatch.setattr(solo_trip_service, "get_solo_table", lambda: object())

    assert solo_trip_service.get_cached_optimization(trip_id, cache_key) is None
    assert cache_key not in written["trip"].get("optimizationCache", {})

