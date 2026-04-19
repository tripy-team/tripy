"""Gemma 4 client with hybrid routing: local Cactus first, OpenAI cloud fallback.

Setup:
    git clone https://github.com/cactus-compute/cactus && cd cactus
    source ./setup && cactus build --python
    cactus download google/gemma-4-E2B-it --reconvert
    cactus auth   # paste token from https://dashboard.cactus.dev
    pip install openai
    export OPENAI_API_KEY="..."    # or OPENAI_ADMIN_KEY — either works

E2B (2.3B effective params) is the right size for live keyword spotting:
~660 tok/s prefill, ~40 tok/s decode on M-series silicon. See
https://docs.cactuscompute.com/latest/blog/gemma4/ for full numbers.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

CACTUS_REPO = os.environ.get("CACTUS_REPO", os.path.expanduser("~/cactus"))
DEFAULT_GEMMA_MODEL = os.environ.get("CACTUS_LLM_MODEL", "google/gemma-4-E2B-it")
DEFAULT_OPENAI_CLOUD_MODEL = os.environ.get("OPENAI_CLOUD_MODEL", "gpt-4o-mini")


def _ensure_cactus_importable() -> None:
    import sys

    py_dir = os.path.join(CACTUS_REPO, "python")
    src_dir = os.path.join(py_dir, "src")
    for d in (py_dir, src_dir):
        if os.path.isdir(d) and d not in sys.path:
            sys.path.insert(0, d)


def _resolve_openai_api_key() -> str | None:
    """Tripy historically uses OPENAI_ADMIN_KEY; OpenAI SDK defaults to OPENAI_API_KEY.
    Accept either so this works in both dev envs."""
    return (
        os.environ.get("OPENAI_API_KEY")
        or os.environ.get("OPENAI_ADMIN_KEY")
    )


class GemmaClient:
    """Hybrid Gemma 4 client.

    Prefers on-device Cactus inference. Falls back to the OpenAI API when
    Cactus is unavailable or the request requires multimodal (vision) input
    and the local build does not have a vision-capable runtime.
    """

    def __init__(
        self,
        model_name: str = DEFAULT_GEMMA_MODEL,
        cloud_model: str = DEFAULT_OPENAI_CLOUD_MODEL,
    ):
        self.model_name = model_name
        self.cloud_model = cloud_model
        self._local_model: Any = None
        self._cactus_complete: Callable | None = None
        self._openai_client: Any = None
        # cactus_complete mutates KV cache on the model handle; concurrent
        # invocations from the FastAPI executor pool corrupt mid-generation
        # state. Serialize all local calls per-client.
        self._local_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._local_model is not None or self._openai_client is not None

    def load(self) -> None:
        self._load_local()
        self._load_cloud()
        if not self.loaded:
            logger.warning(
                "Gemma 4 unavailable locally and no OPENAI_API_KEY/OPENAI_ADMIN_KEY "
                "set; engine will return empty results."
            )

    def _load_local(self) -> None:
        _ensure_cactus_importable()
        try:
            from cactus import cactus_init, cactus_complete  # type: ignore[import-untyped]

            self._cactus_complete = cactus_complete
            weights_dir = self._find_weights()
            if not weights_dir:
                logger.info(
                    "Gemma 4 weights not found locally. "
                    "Run: cactus download %s --reconvert",
                    self.model_name,
                )
                return
            self._local_model = cactus_init(weights_dir, None, False)
            logger.info("Cactus Gemma 4 loaded from %s", weights_dir)
        except ImportError:
            logger.info("Cactus not built; relying on OpenAI cloud fallback.")
        except Exception:
            logger.exception("Failed to load local Gemma 4")

    def _load_cloud(self) -> None:
        api_key = _resolve_openai_api_key()
        if not api_key:
            return
        try:
            from openai import OpenAI  # type: ignore[import-untyped]

            self._openai_client = OpenAI(api_key=api_key)
            logger.info("OpenAI cloud fallback ready (model=%s)", self.cloud_model)
        except ImportError:
            logger.warning("openai package not installed; run: pip install openai")
        except Exception:
            logger.exception("Failed to initialise OpenAI cloud client")

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 500,
        temperature: float = 0.7,
        image_bytes: bytes | None = None,
        image_mime: str = "image/jpeg",
    ) -> str:
        """Run a single-turn completion. Returns raw model text (may be empty)."""
        if image_bytes is not None:
            return self._complete_cloud_multimodal(
                prompt, image_bytes, image_mime, max_tokens, temperature
            )
        # Prefer OpenAI cloud for live-call latency — Gemma 4 CPU decode on
        # Graviton is ~15 tok/s, which makes per-analysis latency ~20s. Cloud
        # is ~1-2s and matches conversation pace. Fall back to on-device
        # Gemma if OpenAI is unreachable so the demo degrades gracefully.
        cloud = self._complete_cloud_text(prompt, max_tokens, temperature)
        if cloud:
            return cloud
        return self._complete_local(prompt, max_tokens, temperature)

    def _complete_local(
        self, prompt: str, max_tokens: int, temperature: float
    ) -> str:
        if self._local_model is None or self._cactus_complete is None:
            return ""
        try:
            messages = json.dumps([{"role": "user", "content": prompt}])
            options = json.dumps(
                {"max_tokens": max_tokens, "temperature": temperature}
            )
            with self._local_lock:
                raw = self._cactus_complete(
                    self._local_model, messages, options, None, None
                )
            result = json.loads(raw) if isinstance(raw, str) else raw
            return result.get("response", "") or ""
        except Exception:
            logger.exception("Local Gemma 4 completion failed")
            return ""

    def _complete_cloud_text(
        self, prompt: str, max_tokens: int, temperature: float
    ) -> str:
        if self._openai_client is None:
            return ""
        try:
            response = self._openai_client.chat.completions.create(
                model=self.cloud_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response.choices[0].message.content or ""
        except Exception:
            logger.exception("OpenAI cloud completion failed")
            return ""

    def _complete_cloud_multimodal(
        self,
        prompt: str,
        image_bytes: bytes,
        mime: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        if self._openai_client is None:
            logger.warning(
                "Multimodal request needs OpenAI cloud but no API key is set"
            )
            return ""
        try:
            image_b64 = base64.b64encode(image_bytes).decode("ascii")
            data_url = f"data:{mime};base64,{image_b64}"
            response = self._openai_client.chat.completions.create(
                model=self.cloud_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": data_url, "detail": "low"},
                            },
                        ],
                    }
                ],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response.choices[0].message.content or ""
        except Exception:
            logger.exception("OpenAI multimodal completion failed")
            return ""

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
                if "gemma" in entry.lower():
                    return os.path.join(weights_root, entry)
        return None


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    """Decode a base64 data URL (data:image/jpeg;base64,...) into (bytes, mime)."""
    if data_url.startswith("data:"):
        header, _, payload = data_url.partition(",")
        mime = header[5:].split(";")[0] or "image/jpeg"
        return base64.b64decode(payload), mime
    return base64.b64decode(data_url), "image/jpeg"
