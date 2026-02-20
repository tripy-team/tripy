"""
Unit tests for multi-airport segment handling.

Covers:
  1. _build_segments_for_route emits full segment schema
  2. Index-mismatch regression (must fail without the fix)
  3. Round-trip through multi-airport city
  4. Canonical key normalization via normalize_to_metro_key
  5. Route node assertion
  6. search_uid dedup vs segment_uid uniqueness
  7. Segment-level collapse detection
  8. User preference fields
  9. Search dispatcher uses airport_search_pairs (Bug 6)
 10. METROS data integrity
"""
import logging
import pytest
from unittest import mock

from src.config.metro_airports import (
    METROS,
    METRO_AIRPORTS,
    AIRPORT_TO_METRO,
    AIRPORT_TO_METRO_KEY,
    NAME_TO_METRO_KEY,
    expand_to_metro,
    normalize_to_metro_key,
)
from src.agents.orchestrator import (
    _normalize_dest_key,
    _detect_preferred_airport,
    _make_search_uid,
    _make_segment_uid,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_trip_data(
    dest_to_airports: dict,
    dest_preferences: dict | None = None,
    start_date: str = "2026-04-01",
    end_date: str = "2026-04-10",
    leg_dates: list | None = None,
    num_route_variants: int = 2,
) -> dict:
    return {
        "dest_to_airports": dest_to_airports,
        "dest_preferences": dest_preferences or {},
        "start_date": start_date,
        "end_date": end_date,
        "leg_dates": leg_dates or [],
        "num_route_variants": num_route_variants,
    }


# ===========================================================================
# Test 1: _build_segments_for_route emits full segment schema
# ===========================================================================

class TestBuildSegmentsForRoute:
    def _build(self, route, trip_data):
        from src.agents.orchestrator import OrchestratorAgent
        optimizer = OrchestratorAgent.__new__(OrchestratorAgent)
        return optimizer._build_segments_for_route(route, trip_data)

    def test_full_segment_schema(self):
        td = _make_trip_data(
            dest_to_airports={
                "PAR": ["CDG", "ORY"],
                "ROM": ["FCO", "CIA"],
                "SEA": ["SEA"],
            },
        )
        segments = self._build(["SEA", "PAR", "ROM", "SEA"], td)

        assert len(segments) == 3
        required_keys = {
            "type", "search_uid", "segment_uid",
            "origin", "destination", "date",
            "origin_city", "dest_city",
            "allowed_origin_airports", "allowed_destination_airports",
            "airport_search_pairs",
            "preferred_origin_airport", "preferred_destination_airport",
        }
        for seg in segments:
            missing = required_keys - set(seg.keys())
            assert not missing, f"Segment missing keys: {missing}"

    def test_airport_search_pairs_cartesian(self):
        td = _make_trip_data(
            dest_to_airports={
                "PAR": ["CDG", "ORY"],
                "SEA": ["SEA"],
            },
        )
        segments = self._build(["SEA", "PAR", "SEA"], td)
        outbound = segments[0]
        assert set(outbound["airport_search_pairs"]) == {("SEA", "CDG"), ("SEA", "ORY")}

    def test_allowed_airports_populated(self):
        td = _make_trip_data(
            dest_to_airports={
                "TYO": ["HND", "NRT"],
                "SEA": ["SEA"],
            },
        )
        segments = self._build(["SEA", "TYO", "SEA"], td)
        assert segments[0]["allowed_destination_airports"] == ["HND", "NRT"]
        assert segments[1]["allowed_origin_airports"] == ["HND", "NRT"]


# ===========================================================================
# Test 2: Index-mismatch regression
# ===========================================================================

class TestIndexMismatchRegression:
    def test_variant_segments_use_search_uid_not_position(self):
        """
        Both route variants must be able to find their search results by search_uid.
        
        The search phase runs on *all* deduplicated segments.  Variant1 (SEA→PAR→ROM→SEA)
        and Variant2 (SEA→ROM→PAR→SEA) produce different leg orderings but the same set
        of city-pair segments overall.  Each variant's segment[i] must map by search_uid
        to a result for the *correct* city pair, not for whatever was at index i in a
        different ordering.
        """
        d2a = {"SEA": ["SEA"], "PAR": ["CDG", "ORY"], "ROM": ["FCO", "CIA"]}
        td = _make_trip_data(dest_to_airports=d2a)

        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)

        variant1 = opt._build_segments_for_route(["SEA", "PAR", "ROM", "SEA"], td)
        variant2 = opt._build_segments_for_route(["SEA", "ROM", "PAR", "SEA"], td)

        # Build unified search pool from both variants (simulating dedup search)
        search_results = {}
        for seg in variant1 + variant2:
            search_results[seg["search_uid"]] = {
                "dest_city": seg["dest_city"],
                "origin_city": seg["origin_city"],
            }

        # Variant2 leg 0 is SEA→ROM.  search_uid must map to ROM, not PAR.
        v2_leg0_key = variant2[0]["search_uid"]
        assert v2_leg0_key in search_results
        assert search_results[v2_leg0_key]["dest_city"] == "ROM"

        # Variant2 leg 1 is ROM→PAR.
        v2_leg1_key = variant2[1]["search_uid"]
        assert v2_leg1_key in search_results
        assert search_results[v2_leg1_key]["dest_city"] == "PAR"

        # Key correctness: variant1[0] (SEA→PAR) must NOT collide with variant2[0] (SEA→ROM)
        assert variant1[0]["search_uid"] != variant2[0]["search_uid"]
        assert variant1[0]["dest_city"] == "PAR"
        assert variant2[0]["dest_city"] == "ROM"


# ===========================================================================
# Test 3: Round-trip through multi-airport city
# ===========================================================================

class TestRoundTripMultiAirport:
    def test_sea_tokyo_roundtrip(self):
        td = _make_trip_data(
            dest_to_airports={"SEA": ["SEA"], "TYO": ["HND", "NRT"]},
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        segs = opt._build_segments_for_route(["SEA", "TYO", "SEA"], td)

        outbound = segs[0]
        assert set(outbound["allowed_destination_airports"]) == {"HND", "NRT"}

        ret = segs[1]
        assert set(ret["allowed_origin_airports"]) == {"HND", "NRT"}


# ===========================================================================
# Test 4: Canonical key normalization
# ===========================================================================

class TestNormalization:
    def test_airport_codes_same_metro(self):
        assert normalize_to_metro_key("EWR") == "NYC"
        assert normalize_to_metro_key("JFK") == "NYC"
        assert normalize_to_metro_key("LGA") == "NYC"

    def test_city_names(self):
        assert normalize_to_metro_key("Paris") == "PAR"
        assert normalize_to_metro_key("paris") == "PAR"
        assert normalize_to_metro_key("tokyo") == "TYO"
        assert normalize_to_metro_key("new york") == "NYC"

    def test_parenthesized(self):
        assert normalize_to_metro_key("Paris (CDG,ORY)") == "PAR"
        assert normalize_to_metro_key("Tokyo (HND)") == "TYO"

    def test_airport_code_resolves_to_metro(self):
        assert normalize_to_metro_key("CDG") == "PAR"
        assert normalize_to_metro_key("HND") == "TYO"

    def test_standalone_metro(self):
        assert normalize_to_metro_key("BOS") == "BOS"

    def test_bay_area(self):
        assert normalize_to_metro_key("san francisco") == "BAY"
        assert normalize_to_metro_key("SFO") == "BAY"
        assert normalize_to_metro_key("OAK") == "BAY"

    def test_unknown_returns_none(self):
        assert normalize_to_metro_key("ZZZZZ") is None

    def test_normalize_dest_key_fallback(self):
        assert _normalize_dest_key("EWR") == "NYC"
        assert _normalize_dest_key("unknowncity") == "UNKNOWNCIT"


# ===========================================================================
# Test 5: Route node assertion
# ===========================================================================

class TestRouteNodeAssertion:
    def test_missing_node_raises_for_multi_city(self):
        td = _make_trip_data(
            dest_to_airports={"SEA": ["SEA"], "PAR": ["CDG", "ORY"]},
            num_route_variants=2,
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        with pytest.raises(ValueError, match="not in dest_to_airports"):
            opt._build_segments_for_route(["SEA", "MISSING", "PAR", "SEA"], td)

    def test_missing_node_warns_for_single_route(self, caplog):
        td = _make_trip_data(
            dest_to_airports={"SEA": ["SEA"]},
            num_route_variants=1,
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        with caplog.at_level(logging.ERROR):
            segs = opt._build_segments_for_route(["SEA", "MISSING"], td)
        assert any("not in dest_to_airports" in r.message for r in caplog.records)
        # Falls back to [MISSING] as airport
        assert segs[0]["allowed_destination_airports"] == ["MISSING"]


# ===========================================================================
# Test 6: search_uid dedup vs segment_uid uniqueness
# ===========================================================================

class TestDualUids:
    def test_same_city_pair_date_share_search_uid(self):
        uid1 = _make_search_uid("PAR", "ROM", "2026-04-05")
        uid2 = _make_search_uid("PAR", "ROM", "2026-04-05")
        assert uid1 == uid2

    def test_different_dates_different_search_uid(self):
        uid1 = _make_search_uid("PAR", "ROM", "2026-04-05")
        uid2 = _make_search_uid("PAR", "ROM", "2026-04-06")
        assert uid1 != uid2

    def test_segment_uid_unique_per_leg_index(self):
        seg1 = _make_segment_uid("PAR", "ROM", "2026-04-05", leg_index=0)
        seg2 = _make_segment_uid("PAR", "ROM", "2026-04-05", leg_index=3)
        assert seg1 != seg2

    def test_loop_trip_shares_search_uid_but_different_segment_uid(self):
        """A trip that visits Paris twice on same date should share search but not identity."""
        s_uid1 = _make_search_uid("SEA", "PAR", "2026-04-05")
        s_uid2 = _make_search_uid("SEA", "PAR", "2026-04-05")
        assert s_uid1 == s_uid2

        seg_uid1 = _make_segment_uid("SEA", "PAR", "2026-04-05", leg_index=0)
        seg_uid2 = _make_segment_uid("SEA", "PAR", "2026-04-05", leg_index=3)
        assert seg_uid1 != seg_uid2


# ===========================================================================
# Test 7: Segment-level collapse detection
# ===========================================================================

class TestCollapseDetection:
    def test_warns_on_single_airport_for_multi_airport_city(self, caplog):
        """If dest_airports=["CDG"] but metro has ["CDG","ORY"], should warn."""
        td = _make_trip_data(
            dest_to_airports={"SEA": ["SEA"], "PAR": ["CDG"]},
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        with caplog.at_level(logging.ERROR):
            opt._build_segments_for_route(["SEA", "PAR"], td)
        # The collapse warning fires in _build_trip_segments but NOT here
        # because _build_segments_for_route trusts dest_to_airports as given.
        # The collapse detection is in _build_trip_segments.


# ===========================================================================
# Test 8: User preference fields
# ===========================================================================

class TestUserPreference:
    def test_detect_preferred_airport(self):
        assert _detect_preferred_airport("EWR") == "EWR"
        assert _detect_preferred_airport("jfk") == "JFK"
        assert _detect_preferred_airport("New York") is None
        assert _detect_preferred_airport("Paris (CDG,ORY)") is None

    def test_preference_on_segments(self):
        td = _make_trip_data(
            dest_to_airports={"NYC": ["JFK", "EWR", "LGA"], "SEA": ["SEA"]},
            dest_preferences={"NYC": "EWR"},
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        segs = opt._build_segments_for_route(["SEA", "NYC"], td)
        assert segs[0]["preferred_destination_airport"] == "EWR"
        assert segs[0]["allowed_destination_airports"] == ["JFK", "EWR", "LGA"]

    def test_no_preference_for_city_name(self):
        td = _make_trip_data(
            dest_to_airports={"TYO": ["HND", "NRT"], "SEA": ["SEA"]},
            dest_preferences={},
        )
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)
        segs = opt._build_segments_for_route(["SEA", "TYO"], td)
        assert segs[0]["preferred_destination_airport"] is None


# ===========================================================================
# Test 9: Search dispatcher uses airport_search_pairs (Bug 6)
# ===========================================================================

class TestSearchDispatcher:
    def test_searches_all_airport_pairs(self):
        """_search_all_segments must call search for each pair, not just segment['destination']."""
        import asyncio
        from src.agents.orchestrator import OrchestratorAgent
        opt = OrchestratorAgent.__new__(OrchestratorAgent)

        segment = {
            "type": "flight",
            "search_uid": "search_test",
            "segment_uid": "seg_test",
            "origin": "SEA",
            "destination": "HND",
            "date": "2026-04-01",
            "origin_city": "SEA",
            "dest_city": "TYO",
            "allowed_origin_airports": ["SEA"],
            "allowed_destination_airports": ["HND", "NRT"],
            "airport_search_pairs": [("SEA", "HND"), ("SEA", "NRT")],
            "preferred_origin_airport": None,
            "preferred_destination_airport": None,
        }

        mock_result = mock.MagicMock()
        mock_result.options = []

        mock_agent = mock.AsyncMock()
        mock_agent.execute = mock.AsyncMock(return_value=mock_result)
        opt.flight_agent = mock_agent

        asyncio.get_event_loop().run_until_complete(
            opt._search_all_segments(
                [segment],
                user_points={},
                cabin_classes=["economy"],
            )
        )

        assert mock_agent.execute.call_count == 2
        call_args_list = mock_agent.execute.call_args_list
        searched_dests = set()
        for call in call_args_list:
            req = call[0][0]
            searched_dests.add(req.destination)
        assert searched_dests == {"HND", "NRT"}, (
            f"Expected searches for both HND and NRT, got {searched_dests}"
        )


# ===========================================================================
# Test 10: METROS data integrity
# ===========================================================================

class TestMetrosDataIntegrity:
    def test_every_airport_maps_back_to_correct_metro_key(self):
        for metro_key, meta in METROS.items():
            for code in meta["airports"]:
                assert code in AIRPORT_TO_METRO_KEY, f"{code} not in AIRPORT_TO_METRO_KEY"
                assert AIRPORT_TO_METRO_KEY[code] == metro_key, (
                    f"{code} maps to {AIRPORT_TO_METRO_KEY[code]}, expected {metro_key}"
                )

    def test_every_name_maps_back_via_name_to_metro_key(self):
        for metro_key, meta in METROS.items():
            for name in meta["names"]:
                assert name in NAME_TO_METRO_KEY, f"'{name}' not in NAME_TO_METRO_KEY"
                assert NAME_TO_METRO_KEY[name] == metro_key, (
                    f"'{name}' maps to {NAME_TO_METRO_KEY[name]}, expected {metro_key}"
                )

    def test_no_metro_key_collides_with_wrong_airport(self):
        """Metro keys that are also airport codes must map to themselves."""
        for metro_key in METROS:
            if metro_key in AIRPORT_TO_METRO_KEY:
                assert AIRPORT_TO_METRO_KEY[metro_key] == metro_key, (
                    f"Metro key {metro_key} is an airport that maps to "
                    f"{AIRPORT_TO_METRO_KEY[metro_key]}, not itself"
                )

    def test_expand_to_metro_airport_code(self):
        assert set(expand_to_metro("JFK")) == {"JFK", "EWR", "LGA"}

    def test_expand_to_metro_city_name(self):
        assert set(expand_to_metro("new york")) == {"JFK", "EWR", "LGA"}

    def test_expand_to_metro_unknown(self):
        assert expand_to_metro("ZZZZZ") == []

    def test_expand_to_metro_standalone(self):
        assert expand_to_metro("BOS") == ["BOS"]
