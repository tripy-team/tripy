"""Reactive question generation from client speech using Cactus LLM.

Requires Cactus to be built with Python support:
    git clone https://github.com/cactus-compute/cactus && cd cactus
    source ./setup
    cactus build --python
    cactus download LiquidAI/LFM2-1.2B
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

logger = logging.getLogger(__name__)

CACTUS_REPO = os.environ.get("CACTUS_REPO", os.path.expanduser("~/cactus"))


def _ensure_cactus_importable() -> None:
    import sys

    py_dir = os.path.join(CACTUS_REPO, "python")
    src_dir = os.path.join(py_dir, "src")
    for d in (py_dir, src_dir):
        if os.path.isdir(d) and d not in sys.path:
            sys.path.insert(0, d)


class QuestionEngine:
    """Generates follow-up questions based on what the client just said."""

    def __init__(self, model_name: str = "LiquidAI/LFM2-1.2B"):
        self.model_name = model_name
        self._model: Any = None
        self._cactus_complete: Callable | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        _ensure_cactus_importable()
        try:
            from cactus import cactus_init, cactus_complete  # type: ignore[import-untyped]

            self._cactus_complete = cactus_complete

            weights_dir = self._find_weights()
            if not weights_dir:
                logger.error(
                    "LLM weights not found. Run: cactus download %s",
                    self.model_name,
                )
                return

            self._model = cactus_init(weights_dir, None, False)
            logger.info("Cactus question engine loaded from %s", weights_dir)

        except ImportError as e:
            logger.error(
                "Cannot import cactus. Build it first:\n"
                "  cd %s && source ./setup && cactus build --python\n"
                "Error: %s",
                CACTUS_REPO,
                e,
            )
        except Exception:
            logger.exception("Failed to load Cactus LLM for questions")

    def generate(
        self,
        client_utterance: str,
        existing_profile: str,
        new_extractions: str,
        missing_fields: str,
        asked_questions: str,
        trip_context: dict[str, Any] | None = None,
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

        raw = self._complete(prompt)
        return self._parse_json_array(raw)

    def _complete(self, prompt: str) -> str:
        if self._model is None or self._cactus_complete is None:
            logger.warning("Cactus LLM not loaded, skipping question generation")
            return "[]"

        try:
            messages = json.dumps([{"role": "user", "content": prompt}])
            options = json.dumps({"max_tokens": 500, "temperature": 0.7})
            raw = self._cactus_complete(
                self._model,
                messages,
                options,
                None,  # grammar
                None,  # token callback
            )
            result = json.loads(raw) if isinstance(raw, str) else raw
            return result.get("response", "[]")
        except Exception:
            logger.exception("Cactus LLM question generation error")
            return "[]"

    def _find_weights(self) -> str | None:
        candidates = [
            os.path.join(CACTUS_REPO, "weights", self.model_name),
            os.path.join(CACTUS_REPO, "weights", self.model_name.replace("/", "_")),
            os.path.join(CACTUS_REPO, "weights", os.path.basename(self.model_name)),
            os.environ.get("CACTUS_LLM_PATH", ""),
        ]
        for path in candidates:
            if path and os.path.isdir(path):
                return path
        weights_root = os.path.join(CACTUS_REPO, "weights")
        if os.path.isdir(weights_root):
            for entry in os.listdir(weights_root):
                if "lfm" in entry.lower() or "gemma" in entry.lower() or "qwen" in entry.lower():
                    return os.path.join(weights_root, entry)
        return None

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
