"""
Invariant tests for each pipeline stage.

These tests verify that the pipeline stages behave correctly:
- Contract validation rejects malformed candidates
- Policy filtering asserts on malformed candidates
- Merge gate handles collisions correctly
- Pipeline processes candidates in the correct order

Run with: pytest backend/tests/test_pipeline_invariants.py -v
"""

import pytest
from datetime import date

from optimization.contract_validation import (
    validate_flight_candidate_contract,
    validate_contracts_for_leg,
)
from optimization.policy_filtering import (
    apply_policy_filters_to_candidate,
    apply_policy_filters_with_airports,
)
from optimization.merge_gate import (
    check_merge_gate,
    merge_candidates_with_gate,
    group_by_fingerprint,
)
from optimization.fingerprinting import (
    compute_itinerary_fingerprint,
    add_fingerprint_suffix,
)
from optimization.types import (
    Rejection,
    ContractValidationOutcome,
    PolicyFilterOutcome,
)
from optimization.reason_codes import (
    FLIGHT_MISSING_REQUIRED_FIELD,
    FLIGHT_DATETIME_PARSE_ERROR,
    FLIGHT_DATETIME_NAIVE,
    FLIGHT_AIRPORT_NOT_ALLOWED,
    FLIGHT_FINGERPRINT_COLLISION,
)
from optimization.config_mvp import get_config, set_config, reset_config, OptimizationConfigMVP


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def valid_candidate():
    """A valid flight candidate with all required fields."""
    return {
        "id": "test_1",
        "segments": [
            {
                "origin": "SEA",
                "destination": "JFK",
                "dep_utc": "2024-06-01T10:00:00Z",
                "arr_utc": "2024-06-01T18:00:00Z",
                "operating_carrier": "UA",
                "flight_number": "123",
            }
        ],
        "ticketing": {"type": "SINGLE_TICKET"},
        "provider": "amadeus",
    }


@pytest.fixture
def valid_candidate_2():
    """Another valid candidate with slightly different times."""
    return {
        "id": "test_2",
        "segments": [
            {
                "origin": "SEA",
                "destination": "JFK",
                "dep_utc": "2024-06-01T10:01:00Z",  # 1 minute later
                "arr_utc": "2024-06-01T18:01:00Z",
                "operating_carrier": "UA",
                "flight_number": "123",
            }
        ],
        "ticketing": {"type": "SINGLE_TICKET"},
        "provider": "awardtool",
        "award_quotes": [{"program": "united", "miles": 25000, "surcharge": 50}],
    }


@pytest.fixture
def malformed_candidate_no_segments():
    """Candidate missing segments field."""
    return {"id": "malformed_1"}


@pytest.fixture
def malformed_candidate_empty_segments():
    """Candidate with empty segments list."""
    return {"id": "malformed_2", "segments": []}


@pytest.fixture
def malformed_candidate_naive_datetime():
    """Candidate with naive (no timezone) datetime."""
    return {
        "id": "malformed_3",
        "segments": [
            {
                "origin": "SEA",
                "destination": "JFK",
                "dep_utc": "2024-06-01T10:00:00",  # Missing timezone
                "arr_utc": "2024-06-01T18:00:00Z",
            }
        ],
    }


@pytest.fixture
def malformed_candidate_invalid_datetime():
    """Candidate with unparseable datetime."""
    return {
        "id": "malformed_4",
        "segments": [
            {
                "origin": "SEA",
                "destination": "JFK",
                "dep_utc": "not-a-valid-date",
                "arr_utc": "2024-06-01T18:00:00Z",
            }
        ],
    }


@pytest.fixture(autouse=True)
def reset_config_after_test():
    """Reset config after each test."""
    yield
    reset_config()


# =============================================================================
# CONTRACT VALIDATION INVARIANTS
# =============================================================================

class TestContractValidationInvariants:
    """Invariants for contract validation."""
    
    def test_valid_candidate_passes(self, valid_candidate):
        """Valid candidate should pass contract validation."""
        outcome = validate_flight_candidate_contract(valid_candidate, "leg_0")
        
        assert outcome.is_valid
        assert len(outcome.rejections) == 0
        assert outcome.candidate_id == "test_1"
    
    def test_missing_segments_returns_malformed(self, malformed_candidate_no_segments):
        """Missing segments must return malformed, not crash."""
        outcome = validate_flight_candidate_contract(
            malformed_candidate_no_segments, "leg_0"
        )
        
        assert not outcome.is_valid
        assert any(
            r.reason_code == FLIGHT_MISSING_REQUIRED_FIELD
            for r in outcome.rejections
        )
    
    def test_null_segments_returns_malformed(self):
        """None segments must return malformed, not crash."""
        candidate = {"id": "test_1", "segments": None}
        outcome = validate_flight_candidate_contract(candidate, "leg_0")
        
        assert not outcome.is_valid
        assert any(
            r.reason_code == FLIGHT_MISSING_REQUIRED_FIELD
            for r in outcome.rejections
        )
    
    def test_empty_segments_returns_malformed(self, malformed_candidate_empty_segments):
        """Empty segments list must return malformed."""
        outcome = validate_flight_candidate_contract(
            malformed_candidate_empty_segments, "leg_0"
        )
        
        assert not outcome.is_valid
        assert any(
            r.reason_code == FLIGHT_MISSING_REQUIRED_FIELD
            for r in outcome.rejections
        )
    
    def test_datetime_parse_error_code(self, malformed_candidate_invalid_datetime):
        """Invalid datetime format gets FLIGHT_DATETIME_PARSE_ERROR."""
        outcome = validate_flight_candidate_contract(
            malformed_candidate_invalid_datetime, "leg_0"
        )
        
        assert not outcome.is_valid
        assert any(
            r.reason_code == FLIGHT_DATETIME_PARSE_ERROR
            for r in outcome.rejections
        )
    
    def test_datetime_naive_code(self, malformed_candidate_naive_datetime):
        """Naive datetime gets FLIGHT_DATETIME_NAIVE."""
        outcome = validate_flight_candidate_contract(
            malformed_candidate_naive_datetime, "leg_0"
        )
        
        assert not outcome.is_valid
        assert any(
            r.reason_code == FLIGHT_DATETIME_NAIVE
            for r in outcome.rejections
        )
    
    def test_datetime_parse_error_vs_naive_different_codes(
        self,
        malformed_candidate_invalid_datetime,
        malformed_candidate_naive_datetime,
    ):
        """Parse error and naive datetime have DIFFERENT reason codes."""
        parse_outcome = validate_flight_candidate_contract(
            malformed_candidate_invalid_datetime, "leg_0"
        )
        naive_outcome = validate_flight_candidate_contract(
            malformed_candidate_naive_datetime, "leg_0"
        )
        
        parse_codes = {r.reason_code for r in parse_outcome.rejections}
        naive_codes = {r.reason_code for r in naive_outcome.rejections}
        
        assert FLIGHT_DATETIME_PARSE_ERROR in parse_codes
        assert FLIGHT_DATETIME_NAIVE in naive_codes
        assert FLIGHT_DATETIME_PARSE_ERROR != FLIGHT_DATETIME_NAIVE
    
    def test_missing_id_uses_unknown(self):
        """Candidate without id should use 'unknown' as candidate_id."""
        candidate = {"segments": []}  # No id
        outcome = validate_flight_candidate_contract(candidate, "leg_0")
        
        assert outcome.candidate_id == "unknown"
    
    def test_batch_validation_counts_malformed(
        self, valid_candidate, malformed_candidate_no_segments
    ):
        """validate_contracts_for_leg correctly counts malformed candidates."""
        candidates = [valid_candidate, malformed_candidate_no_segments]
        result = validate_contracts_for_leg(candidates, "0")
        
        assert len(result.contract_valid) == 1
        assert result.malformed_candidate_count == 1
        assert result.contract_valid[0]["id"] == "test_1"


# =============================================================================
# POLICY FILTERING INVARIANTS
# =============================================================================

class TestPolicyFilteringInvariants:
    """Invariants for policy filtering."""
    
    def test_rejects_malformed_candidate_with_assertion(
        self, malformed_candidate_no_segments
    ):
        """Policy filtering should assert on malformed candidates."""
        with pytest.raises(AssertionError):
            apply_policy_filters_to_candidate(
                malformed_candidate_no_segments,
                "leg_0",
                None,
                None,
            )
    
    def test_accepts_contract_valid_candidate(self, valid_candidate):
        """Policy filtering should work on contract-valid candidates."""
        outcome = apply_policy_filters_to_candidate(
            valid_candidate,
            "leg_0",
            None,  # No airport restrictions
            None,
        )
        
        assert isinstance(outcome.is_allowed, bool)
        assert outcome.is_allowed  # Should be allowed with no restrictions
    
    def test_airport_allowlist_rejects_wrong_origin(self, valid_candidate):
        """Candidate with wrong origin airport should be rejected."""
        outcome = apply_policy_filters_to_candidate(
            valid_candidate,
            "leg_0",
            ["LAX", "SFO"],  # SEA not allowed
            None,
        )
        
        assert not outcome.is_allowed
        assert any(
            r.reason_code == FLIGHT_AIRPORT_NOT_ALLOWED
            for r in outcome.rejections
        )
        # Check details
        rejection = next(
            r for r in outcome.rejections
            if r.reason_code == FLIGHT_AIRPORT_NOT_ALLOWED
        )
        assert rejection.details["airport"] == "SEA"
        assert rejection.details["position"] == "origin"
    
    def test_airport_allowlist_allows_matching_origin(self, valid_candidate):
        """Candidate with matching origin airport should be allowed."""
        outcome = apply_policy_filters_to_candidate(
            valid_candidate,
            "leg_0",
            ["SEA", "PDX"],  # SEA is allowed
            None,
        )
        
        assert outcome.is_allowed
    
    def test_batch_filtering_returns_tuple(self, valid_candidate):
        """apply_policy_filters_with_airports returns (allowed, rejections)."""
        candidates = [valid_candidate]
        allowed, rejections = apply_policy_filters_with_airports(
            candidates,
            "0",
            None,
            None,
        )
        
        assert isinstance(allowed, list)
        assert isinstance(rejections, list)
        assert len(allowed) == 1


# =============================================================================
# MERGE GATE INVARIANTS
# =============================================================================

class TestMergeGateInvariants:
    """Invariants for merge gate."""
    
    def test_single_candidate_no_merge_needed(self, valid_candidate):
        """Single candidate should be returned as-is."""
        valid_candidate["_fingerprint"] = "fp_1"
        candidates = [valid_candidate]
        
        merged, warnings, collisions = merge_candidates_with_gate(
            candidates, "leg_0"
        )
        
        assert len(merged) == 1
        assert len(collisions) == 0
        assert len(warnings) == 0
    
    def test_identical_candidates_merge_without_collision(
        self, valid_candidate, valid_candidate_2
    ):
        """Identical candidates (same itinerary) should merge without collision."""
        valid_candidate["_fingerprint"] = "fp_1"
        valid_candidate_2["_fingerprint"] = "fp_1"
        candidates = [valid_candidate, valid_candidate_2]
        
        merged, warnings, collisions = merge_candidates_with_gate(
            candidates, "leg_0"
        )
        
        assert len(merged) == 1  # Merged into one
        assert len(collisions) == 0  # No collision
        # Merged should have award quotes from both
        assert len(merged[0].get("award_quotes", [])) >= 1
    
    def test_first_candidate_no_collision(self, valid_candidate):
        """First candidate starting first group should NOT emit collision."""
        valid_candidate["_fingerprint"] = "fp_1"
        candidates = [valid_candidate]
        
        merged, warnings, collisions = merge_candidates_with_gate(
            candidates, "leg_0"
        )
        
        assert len(collisions) == 0  # First candidate is NOT a collision
        assert len(warnings) == 0
    
    def test_collision_emits_warning_for_second_group(self, valid_candidate):
        """Collision should only be emitted when starting second+ group."""
        # Two candidates with same fingerprint but different destinations
        candidate_1 = valid_candidate.copy()
        candidate_1["_fingerprint"] = "fp_1"
        
        candidate_2 = {
            "id": "test_2",
            "segments": [
                {
                    "origin": "SEA",
                    "destination": "LAX",  # Different destination!
                    "dep_utc": "2024-06-01T10:00:00Z",
                    "arr_utc": "2024-06-01T18:00:00Z",
                }
            ],
            "_fingerprint": "fp_1",  # Same fingerprint
            "provider": "awardtool",
        }
        candidates = [candidate_1, candidate_2]
        
        merged, warnings, collisions = merge_candidates_with_gate(
            candidates, "leg_0"
        )
        
        assert len(merged) == 2  # Kept both (couldn't merge)
        assert len(collisions) == 1  # One collision (for second candidate)
        assert collisions[0].reason_code == FLIGHT_FINGERPRINT_COLLISION
    
    def test_fingerprint_suffix_includes_candidate_id(self, valid_candidate):
        """Fingerprint suffix should include candidate_id for uniqueness."""
        # Two candidates from same provider but different destinations
        candidate_1 = valid_candidate.copy()
        candidate_1["_fingerprint"] = "fp_1"
        candidate_1["provider"] = "amadeus"
        candidate_1["id"] = "cand_1"
        
        candidate_2 = {
            "id": "cand_2",
            "segments": [
                {
                    "origin": "SEA",
                    "destination": "LAX",  # Different destination
                    "dep_utc": "2024-06-01T10:00:00Z",
                    "arr_utc": "2024-06-01T18:00:00Z",
                }
            ],
            "_fingerprint": "fp_1",
            "provider": "amadeus",  # Same provider!
        }
        candidates = [candidate_1, candidate_2]
        
        merged, warnings, collisions = merge_candidates_with_gate(
            candidates, "leg_0"
        )
        
        # Both should have unique fingerprints now
        fps = [c["_fingerprint"] for c in merged]
        assert len(fps) == len(set(fps)), "Fingerprints should be unique"
        # Fingerprints should include candidate_id
        assert any("cand_1" in fp for fp in fps)
        assert any("cand_2" in fp for fp in fps)
    
    def test_merge_gate_checks_segment_count(self, valid_candidate):
        """Merge gate should reject candidates with different segment counts."""
        candidate_1 = valid_candidate.copy()
        
        # Two-segment candidate
        candidate_2 = {
            "id": "test_2",
            "segments": [
                {
                    "origin": "SEA",
                    "destination": "ORD",
                    "dep_utc": "2024-06-01T10:00:00Z",
                    "arr_utc": "2024-06-01T14:00:00Z",
                },
                {
                    "origin": "ORD",
                    "destination": "JFK",
                    "dep_utc": "2024-06-01T15:00:00Z",
                    "arr_utc": "2024-06-01T18:00:00Z",
                },
            ],
            "provider": "awardtool",
        }
        
        outcome = check_merge_gate(candidate_1, candidate_2)
        
        assert not outcome.can_merge
        assert "segment_count" in outcome.reason
    
    def test_merge_gate_checks_time_tolerance(self, valid_candidate, valid_candidate_2):
        """Merge gate should allow candidates within time tolerance."""
        # valid_candidate_2 is 1 minute different - should be within tolerance
        outcome = check_merge_gate(valid_candidate, valid_candidate_2)
        
        assert outcome.can_merge


# =============================================================================
# FINGERPRINTING INVARIANTS
# =============================================================================

class TestFingerprintingInvariants:
    """Invariants for fingerprinting."""
    
    def test_same_itinerary_same_fingerprint(self, valid_candidate, valid_candidate_2):
        """Same itinerary should produce same fingerprint (within floor tolerance)."""
        # These have 1 minute difference, should floor to same 5-minute block
        fp1 = compute_itinerary_fingerprint(valid_candidate["segments"])
        fp2 = compute_itinerary_fingerprint(valid_candidate_2["segments"])
        
        assert fp1 == fp2
    
    def test_different_destination_different_fingerprint(self, valid_candidate):
        """Different destination should produce different fingerprint."""
        other = {
            "id": "test_2",
            "segments": [
                {
                    "origin": "SEA",
                    "destination": "LAX",  # Different!
                    "dep_utc": "2024-06-01T10:00:00Z",
                    "arr_utc": "2024-06-01T18:00:00Z",
                }
            ],
        }
        
        fp1 = compute_itinerary_fingerprint(valid_candidate["segments"])
        fp2 = compute_itinerary_fingerprint(other["segments"])
        
        assert fp1 != fp2
    
    def test_fingerprint_is_deterministic(self, valid_candidate):
        """Same input should always produce same fingerprint."""
        fp1 = compute_itinerary_fingerprint(valid_candidate["segments"])
        fp2 = compute_itinerary_fingerprint(valid_candidate["segments"])
        
        assert fp1 == fp2
    
    def test_add_fingerprint_suffix_creates_unique(self):
        """add_fingerprint_suffix should create unique fingerprints."""
        base_fp = "abc123"
        
        fp1 = add_fingerprint_suffix(base_fp, "provider_a", "id_1")
        fp2 = add_fingerprint_suffix(base_fp, "provider_a", "id_2")
        fp3 = add_fingerprint_suffix(base_fp, "provider_b", "id_1")
        
        assert fp1 != fp2  # Different id
        assert fp1 != fp3  # Different provider
        assert fp2 != fp3


# =============================================================================
# GROUP BY FINGERPRINT INVARIANTS
# =============================================================================

class TestGroupByFingerprint:
    """Tests for group_by_fingerprint function."""
    
    def test_groups_by_fingerprint_correctly(self):
        """Candidates should be grouped by their _fingerprint field."""
        candidates = [
            {"id": "1", "_fingerprint": "fp_a"},
            {"id": "2", "_fingerprint": "fp_a"},
            {"id": "3", "_fingerprint": "fp_b"},
        ]
        
        groups = group_by_fingerprint(candidates)
        
        assert len(groups) == 2
        assert len(groups["fp_a"]) == 2
        assert len(groups["fp_b"]) == 1
    
    def test_handles_missing_fingerprint(self):
        """Candidates without fingerprint should be grouped under empty string."""
        candidates = [
            {"id": "1"},  # No fingerprint
            {"id": "2", "_fingerprint": "fp_a"},
        ]
        
        groups = group_by_fingerprint(candidates)
        
        assert "" in groups
        assert "fp_a" in groups


# =============================================================================
# CONFIG INVARIANTS
# =============================================================================

class TestConfigInvariants:
    """Tests for configuration."""
    
    def test_config_is_frozen(self):
        """Config should be frozen (immutable)."""
        config = get_config()
        
        with pytest.raises(Exception):  # FrozenInstanceError
            config.MAX_STOPS = 999
    
    def test_set_config_for_testing(self):
        """set_config should allow overriding for tests."""
        custom_config = OptimizationConfigMVP(MAX_STOPS=5)
        set_config(custom_config)
        
        config = get_config()
        assert config.MAX_STOPS == 5
    
    def test_reset_config(self):
        """reset_config should restore defaults."""
        custom_config = OptimizationConfigMVP(MAX_STOPS=5)
        set_config(custom_config)
        
        reset_config()
        config = get_config()
        
        # Should be back to default
        assert config.MAX_STOPS == 2  # Default value
