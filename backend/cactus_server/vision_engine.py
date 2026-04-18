"""Live video frame analysis using Gemma 4 multimodal.

Analyses a single JPEG frame captured from the live call to produce:
  - A short natural-language insight about the scene/subject
  - Any auxiliary travel-relevant extractions visible in the frame
    (documents on screen, children present, accessibility indicators, etc.)

The insight is fed into the question-generation prompt so that suggested
follow-up questions can reference what the advisor is actually seeing.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .gemma_client import DEFAULT_GEMMA_MODEL, GemmaClient, decode_data_url

logger = logging.getLogger(__name__)

VISION_PROMPT = """You are assisting a travel advisor on a live video call with a client.

A single frame from the live call is attached (may be either participant's
camera). Describe only what is directly useful for travel planning. Do NOT
guess identity, emotion intensity, or protected attributes.

Return a JSON object with these keys:
- "insight": one short sentence the advisor could quietly act on
  (e.g. "Client is on a boat — may be a frequent cruiser",
   "Young child is visible in the background",
   "A physical passport is on the desk").
- "signals": array of 0-3 travel-relevant observations. Each item has:
    {{"targetField": "<one of the profile fields>",
      "suggestedValue": <value>,
      "confidence": 0.0-1.0,
      "evidence": "<what was visible>"}}
  Allowed fields are limited to: familyConsiderations, accessibilityNeeds,
  activityPreferences, travelPace, specialOccasions.

If the frame shows nothing travel-relevant, return
{{"insight": "", "signals": []}}.
Return ONLY valid JSON.
"""


class VisionEngine:
    """Gemma 4 multimodal analyser for live video frames."""

    def __init__(self, model_name: str = DEFAULT_GEMMA_MODEL):
        self.model_name = model_name
        self._client = GemmaClient(model_name=model_name)

    @property
    def loaded(self) -> bool:
        return self._client.loaded

    def load(self) -> None:
        self._client.load()

    def analyse_frame(self, frame_data_url: str) -> dict[str, Any]:
        """Analyse a single base64-encoded JPEG frame.

        Returns {"insight": str, "signals": list[dict]}. Empty on failure so
        callers can treat this as best-effort augmentation.
        """
        try:
            image_bytes, mime = decode_data_url(frame_data_url)
        except Exception:
            logger.exception("Invalid video frame payload")
            return {"insight": "", "signals": []}

        raw = self._client.complete(
            VISION_PROMPT,
            max_tokens=300,
            temperature=0.2,
            image_bytes=image_bytes,
            image_mime=mime,
        )
        return self._parse_json(raw)

    def _parse_json(self, raw: str) -> dict[str, Any]:
        raw = (raw or "").strip()
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return {"insight": "", "signals": []}
        try:
            parsed = json.loads(raw[start : end + 1])
            if isinstance(parsed, dict):
                parsed.setdefault("insight", "")
                parsed.setdefault("signals", [])
                return parsed
        except json.JSONDecodeError:
            logger.warning("Failed to parse vision JSON: %s", raw[:200])
        return {"insight": "", "signals": []}
