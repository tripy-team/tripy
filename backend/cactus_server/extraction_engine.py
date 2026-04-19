"""Real-time profile extraction using Gemma 4 (on-device Cactus + Gemini fallback).

See gemma_client.py for setup instructions.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .gemma_client import DEFAULT_GEMMA_MODEL, GemmaClient

logger = logging.getLogger(__name__)


class ExtractionEngine:
    """Extracts client preferences from transcript text using Gemma 4."""

    def __init__(self, model_name: str = DEFAULT_GEMMA_MODEL):
        self.model_name = model_name
        self._client = GemmaClient(model_name=model_name)

    @property
    def loaded(self) -> bool:
        return self._client.loaded

    def load(self) -> None:
        self._client.load()

    def extract(
        self,
        recent_text: str,
        client_name: str,
        existing_profile: str,
    ) -> list[dict[str, Any]]:
        from .prompts import EXTRACTION_PROMPT, TRAVEL_PREFERENCE_FIELDS

        prompt = EXTRACTION_PROMPT.format(
            client_name=client_name,
            existing_profile=existing_profile,
            recent_text=recent_text,
            field_definitions=TRAVEL_PREFERENCE_FIELDS,
        )

        raw = self._client.complete(prompt, max_tokens=800, temperature=0.3)
        return self._parse_json_array(raw)

    def keyword_extract(
        self,
        client_text: str,
        client_name: str,
        existing_profile: str,
        prior_question: str = "",
    ) -> list[dict[str, Any]]:
        """Spot preference keywords in a single client transcript chunk.

        Designed for the live-call path where transcription often arrives as
        a few stray words ("business class", "Marriott") rather than full
        sentences. Uses a tighter prompt and shorter generation budget than
        ``extract`` so it stays under the per-chunk inference deadline.

        ``prior_question`` is the advisor's most recent utterance. Short
        client answers ("yeah", "business") only map to a field when paired
        with the question that prompted them.
        """
        from .prompts import KEYWORD_EXTRACTION_PROMPT, TRAVEL_PREFERENCE_FIELDS

        prompt = KEYWORD_EXTRACTION_PROMPT.format(
            client_name=client_name,
            existing_profile=existing_profile,
            prior_question=prior_question.strip() or "(none)",
            client_text=client_text,
            field_definitions=TRAVEL_PREFERENCE_FIELDS,
        )

        raw = self._client.complete(prompt, max_tokens=200, temperature=0.2)
        return self._parse_json_array(raw)

    def analyze_fused(
        self,
        recent_text: str,
        client_name: str,
        existing_profile: str,
        missing_fields: str,
        asked_questions: str,
        trip_context: dict[str, Any] | None = None,
        visual_insight: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Run extraction + question generation in a single LLM call.

        Halves the per-analysis round trips compared to calling ``extract`` and
        ``question_engine.generate`` sequentially. Returns a dict with
        "extractions" and "questions" lists; either may be empty.
        """
        from .prompts import FUSED_ANALYSIS_SYSTEM, FUSED_ANALYSIS_USER_TEMPLATE

        trip_block = ""
        if trip_context:
            trip_block = (
                "\nTrip context (prioritize questions specific to this trip):\n"
                f"- Destination: {trip_context.get('destinations', 'Unknown')}\n"
                f"- Dates: {trip_context.get('travelDates', 'Unknown')}\n"
                f"- Travelers: {trip_context.get('travelerNames', 'Unknown')}\n"
                f"- Status: {trip_context.get('status', 'planning')}\n"
            )

        insight_block = ""
        if visual_insight:
            insight_block = (
                "\nLive visual context from the client's video (Gemma 4 vision, may be noisy):\n"
                f"{visual_insight}\n"
                "If the visual context suggests a concrete detail worth probing, fold it into ONE question.\n"
            )

        user = FUSED_ANALYSIS_USER_TEMPLATE.format(
            client_name=client_name,
            existing_profile=existing_profile,
            recent_text=recent_text,
            missing_fields=missing_fields,
            asked_questions=asked_questions,
            trip_context_block=trip_block,
            visual_insight_block=insight_block,
        )

        raw = self._client.complete_structured(
            FUSED_ANALYSIS_SYSTEM, user, max_tokens=1000, temperature=0.4
        )
        return self._parse_fused_json(raw)

    def _parse_fused_json(self, raw: str) -> dict[str, list[dict[str, Any]]]:
        raw = raw.strip()
        start = raw.find("{")
        end = raw.rfind("}")
        empty: dict[str, list[dict[str, Any]]] = {"extractions": [], "questions": []}
        if start == -1 or end == -1:
            return empty
        try:
            result = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            logger.warning("Failed to parse fused JSON: %s", raw[:200])
            return empty
        if not isinstance(result, dict):
            return empty
        extractions = result.get("extractions")
        questions = result.get("questions")
        return {
            "extractions": extractions if isinstance(extractions, list) else [],
            "questions": questions if isinstance(questions, list) else [],
        }

    def _parse_json_array(self, raw: str) -> list[dict[str, Any]]:
        raw = raw.strip()
        start = raw.find("[")
        end = raw.rfind("]")
        if start == -1 or end == -1:
            return []
        try:
            result = json.loads(raw[start : end + 1])
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            logger.warning("Failed to parse extraction JSON: %s", raw[:200])
        return []
