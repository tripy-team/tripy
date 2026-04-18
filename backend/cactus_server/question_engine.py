"""Reactive question generation using Gemma 4 (on-device Cactus + Gemini fallback).

See gemma_client.py for setup instructions.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .gemma_client import DEFAULT_GEMMA_MODEL, GemmaClient

logger = logging.getLogger(__name__)


class QuestionEngine:
    """Generates follow-up questions based on what the client just said.

    Optionally grounded in a live visual insight extracted from the call video.
    """

    def __init__(self, model_name: str = DEFAULT_GEMMA_MODEL):
        self.model_name = model_name
        self._client = GemmaClient(model_name=model_name)

    @property
    def loaded(self) -> bool:
        return self._client.loaded

    def load(self) -> None:
        self._client.load()

    def generate(
        self,
        client_utterance: str,
        existing_profile: str,
        new_extractions: str,
        missing_fields: str,
        asked_questions: str,
        trip_context: dict[str, Any] | None = None,
        visual_insight: str | None = None,
    ) -> list[dict[str, Any]]:
        if trip_context:
            from .prompts import TRIP_CONTEXT_QUESTION_PROMPT

            prompt = TRIP_CONTEXT_QUESTION_PROMPT.format(
                destinations=trip_context.get("destinations", "Unknown"),
                travel_dates=trip_context.get("travelDates", "Unknown"),
                traveler_names=trip_context.get("travelerNames", "Unknown"),
                status=trip_context.get("status", "planning"),
                client_utterance=client_utterance,
                existing_profile=existing_profile,
                new_extractions=new_extractions,
                missing_fields=missing_fields,
                asked_questions=asked_questions,
            )
        else:
            from .prompts import REACTIVE_QUESTION_PROMPT

            prompt = REACTIVE_QUESTION_PROMPT.format(
                client_utterance=client_utterance,
                existing_profile=existing_profile,
                new_extractions=new_extractions,
                missing_fields=missing_fields,
                asked_questions=asked_questions,
            )

        if visual_insight:
            prompt += (
                "\n\nLive visual context from the client's video "
                f"(Gemma 4 vision, may be noisy):\n{visual_insight}\n"
                "If the visual context suggests a concrete detail worth probing "
                "(setting, companions, documents, mood), fold it into ONE of the "
                "questions. Otherwise ignore it."
            )

        raw = self._client.complete(prompt, max_tokens=500, temperature=0.7)
        return self._parse_json_array(raw)

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
            logger.warning("Failed to parse question JSON: %s", raw[:200])
        return []
