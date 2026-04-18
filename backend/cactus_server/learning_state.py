"""Session learning state — tracks what we've learned during a live call."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Contradiction:
    field: str
    previous: Any
    new: Any
    evidence: str


@dataclass
class SessionLearningState:
    """Accumulates preference extractions during a single live call."""

    existing: dict[str, Any] = field(default_factory=dict)
    learned: dict[str, Any] = field(default_factory=dict)
    confidence_map: dict[str, float] = field(default_factory=dict)
    evidence_map: dict[str, list[str]] = field(default_factory=dict)
    contradictions: list[Contradiction] = field(default_factory=list)
    asked_questions: list[str] = field(default_factory=list)

    def ingest(self, extractions: list[dict[str, Any]]) -> None:
        for ext in extractions:
            f = ext["targetField"]
            value = ext["suggestedValue"]
            confidence = ext.get("confidence", 0.5)
            evidence = ext.get("evidence", "")

            if f in self.learned and self.learned[f] != value:
                self.contradictions.append(
                    Contradiction(
                        field=f,
                        previous=self.learned[f],
                        new=value,
                        evidence=evidence,
                    )
                )
                if confidence > self.confidence_map.get(f, 0):
                    self.learned[f] = value
                    self.confidence_map[f] = confidence
            else:
                self.learned[f] = value
                self.confidence_map[f] = max(
                    confidence, self.confidence_map.get(f, 0)
                )

            self.evidence_map.setdefault(f, []).append(evidence)

    def get_commit_ready(self, min_confidence: float = 0.7) -> list[dict[str, Any]]:
        return [
            {
                "targetField": f,
                "suggestedValue": value,
                "confidence": self.confidence_map[f],
                "evidence": "; ".join(self.evidence_map[f]),
                "status": "pending",
            }
            for f, value in self.learned.items()
            if self.confidence_map[f] >= min_confidence
        ]

    def get_missing_fields(self) -> list[str]:
        """Return profile fields that are still empty (not in existing or learned)."""
        from .prompts import TRAVEL_PREFERENCE_FIELDS

        all_fields = []
        for line in TRAVEL_PREFERENCE_FIELDS.strip().split("\n"):
            line = line.strip()
            if line.startswith("- ") and ":" in line:
                field_name = line[2:].split(":")[0].strip()
                all_fields.append(field_name)

        filled = set(self.existing.keys()) | set(self.learned.keys())
        return [f for f in all_fields if f not in filled]

    def to_profile_summary(self) -> str:
        combined = {**self.existing, **self.learned}
        if not combined:
            return "No preferences known yet."
        lines = [f"- {k}: {v}" for k, v in combined.items() if v is not None]
        return "\n".join(lines) if lines else "No preferences known yet."
