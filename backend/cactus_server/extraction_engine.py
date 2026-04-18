"""Real-time profile extraction from transcript text using Cactus LLM.

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


class ExtractionEngine:
    """Extracts client preferences from transcript text using Cactus LLM."""

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
            logger.info("Cactus LLM loaded from %s", weights_dir)

        except ImportError as e:
            logger.error(
                "Cannot import cactus. Build it first:\n"
                "  cd %s && source ./setup && cactus build --python\n"
                "Error: %s",
                CACTUS_REPO,
                e,
            )
        except Exception:
            logger.exception("Failed to load Cactus LLM")

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

        raw = self._complete(prompt)
        return self._parse_json_array(raw)

    def _complete(self, prompt: str) -> str:
        if self._model is None or self._cactus_complete is None:
            logger.warning("Cactus LLM not loaded, skipping extraction")
            return "[]"

        try:
            messages = json.dumps([{"role": "user", "content": prompt}])
            options = json.dumps({"max_tokens": 800, "temperature": 0.3})
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
            logger.exception("Cactus LLM extraction error")
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
        # Check weights dir for any LFM folder
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
            logger.warning("Failed to parse extraction JSON: %s", raw[:200])
        return []
