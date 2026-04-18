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
