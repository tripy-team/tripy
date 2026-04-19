"""Speech-to-text transcription using Cactus on-device inference.

Requires Cactus to be built with Python support:
    git clone https://github.com/cactus-compute/cactus && cd cactus
    source ./setup
    cactus build --python
    cactus download openai/whisper-small
"""

from __future__ import annotations

import io
import json
import logging
import os
import struct
import tempfile
import wave
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger(__name__)

# Path to the cactus repo — set via env or auto-detect
CACTUS_REPO = os.environ.get("CACTUS_REPO", os.path.expanduser("~/cactus"))


def _ensure_cactus_importable() -> None:
    """Add cactus python dir to sys.path if needed."""
    import sys

    py_dir = os.path.join(CACTUS_REPO, "python")
    src_dir = os.path.join(py_dir, "src")
    for d in (py_dir, src_dir):
        if os.path.isdir(d) and d not in sys.path:
            sys.path.insert(0, d)


@dataclass
class TranscriptionResult:
    text: str
    start_ms: int
    end_ms: int
    confidence: float


class CactusTranscriber:
    """Streaming audio transcriber using Cactus Whisper."""

    def __init__(self, model_name: str = "openai/whisper-small"):
        self.model_name = model_name
        self._model: Any = None
        self._cactus_transcribe: Callable | None = None
        self._cactus_init: Callable | None = None
        self._buffer: bytes = b""
        self._offset_ms: int = 0
        # Accumulate ~5 seconds of audio before transcribing. 2s was too short:
        # Whisper was trained on 30s clips and often returns empty/<|notimestamps|>
        # for sub-3s slices. 5s gives it enough context to decode real speech.
        self._chunk_threshold: int = 16000 * 2 * 5
        self._debug_dump_count: int = 0

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        _ensure_cactus_importable()
        try:
            from cactus import cactus_init, cactus_transcribe  # type: ignore[import-untyped]

            self._cactus_init = cactus_init
            self._cactus_transcribe = cactus_transcribe

            # Resolve weights path
            weights_dir = self._find_weights()
            if not weights_dir:
                logger.error(
                    "Whisper weights not found. Run: cactus download %s",
                    self.model_name,
                )
                return

            self._model = cactus_init(weights_dir, None, False)
            logger.info("Cactus Whisper loaded from %s", weights_dir)

        except ImportError as e:
            logger.error(
                "Cannot import cactus. Build it first:\n"
                "  cd %s && source ./setup && cactus build --python\n"
                "Error: %s",
                CACTUS_REPO,
                e,
            )
        except Exception:
            logger.exception("Failed to load Cactus Whisper model")

    def feed_audio(self, pcm_bytes: bytes) -> list[TranscriptionResult]:
        """Feed raw PCM 16-bit 16kHz mono audio. Returns transcription results."""
        self._buffer += pcm_bytes
        results: list[TranscriptionResult] = []

        while len(self._buffer) >= self._chunk_threshold:
            chunk = self._buffer[: self._chunk_threshold]
            self._buffer = self._buffer[self._chunk_threshold :]

            duration_ms = (len(chunk) // 2) * 1000 // 16000
            result = self._transcribe_chunk(chunk)

            if result and result.text.strip():
                result.start_ms = self._offset_ms
                result.end_ms = self._offset_ms + duration_ms
                results.append(result)

            self._offset_ms += duration_ms

        return results

    def flush(self) -> list[TranscriptionResult]:
        """Flush remaining buffer and return any final transcription."""
        if not self._buffer:
            return []

        duration_ms = (len(self._buffer) // 2) * 1000 // 16000
        result = self._transcribe_chunk(self._buffer)
        self._buffer = b""

        if result and result.text.strip():
            result.start_ms = self._offset_ms
            result.end_ms = self._offset_ms + duration_ms
            self._offset_ms += duration_ms
            return [result]

        self._offset_ms += duration_ms
        return []

    def reset(self) -> None:
        self._buffer = b""
        self._offset_ms = 0

    def _transcribe_chunk(self, pcm_chunk: bytes) -> TranscriptionResult | None:
        silence = self._is_silence(pcm_chunk)
        num_samples = len(pcm_chunk) // 2
        if num_samples > 0:
            import struct as _struct
            _samples = _struct.unpack(f"<{num_samples}h", pcm_chunk)
            _rms = (sum(s * s for s in _samples) / num_samples) ** 0.5
        else:
            _rms = 0.0
        logger.info(
            "_transcribe_chunk: bytes=%d rms=%.1f silence=%s model=%s",
            len(pcm_chunk),
            _rms,
            silence,
            "loaded" if self._model is not None else "None",
        )
        if silence:
            return None

        if self._model is None or self._cactus_transcribe is None:
            logger.warning(
                "_transcribe_chunk: model or callable is None (model=%s, callable=%s)",
                self._model is not None,
                self._cactus_transcribe is not None,
            )
            return None

        # Cactus transcribe expects a WAV file path
        wav_path = self._pcm_to_wav_file(pcm_chunk)

        # Diagnostic: keep the first 3 WAV files around so we can inspect them.
        if self._debug_dump_count < 3:
            import shutil
            dump_path = f"/tmp/cactus_debug_{self._debug_dump_count}.wav"
            shutil.copy(wav_path, dump_path)
            logger.info("dumped WAV for inspection: %s", dump_path)
            self._debug_dump_count += 1
        try:
            raw = self._cactus_transcribe(
                self._model,
                wav_path,
                None,  # grammar
                None,  # options
                None,  # progress callback
                None,  # abort callback
            )
            result = json.loads(raw) if isinstance(raw, str) else raw

            text = result.get("response", "").strip()
            logger.info(
                "_transcribe_chunk: cactus returned text=%r (keys=%s)",
                text[:80],
                list(result.keys()) if isinstance(result, dict) else type(result).__name__,
            )
            if not text:
                return None

            # Use segment timing if available
            segments = result.get("segments", [])
            confidence = 0.9
            if segments:
                first = segments[0]
                return TranscriptionResult(
                    text=text,
                    start_ms=int(first.get("start", 0) * 1000),
                    end_ms=int(segments[-1].get("end", 0) * 1000),
                    confidence=confidence,
                )

            return TranscriptionResult(
                text=text,
                start_ms=0,
                end_ms=0,
                confidence=confidence,
            )
        except Exception:
            logger.exception("Cactus transcription error")
            return None
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass

    def _find_weights(self) -> str | None:
        """Locate downloaded model weights."""
        # Check common locations
        candidates = [
            os.path.join(CACTUS_REPO, "weights", self.model_name),
            os.path.join(CACTUS_REPO, "weights", self.model_name.replace("/", "_")),
            os.path.join(CACTUS_REPO, "weights", os.path.basename(self.model_name)),
            os.environ.get("CACTUS_MODEL_PATH", ""),
        ]
        for path in candidates:
            if path and os.path.isdir(path):
                return path
        # Also check if weights dir has any whisper folder
        weights_root = os.path.join(CACTUS_REPO, "weights")
        if os.path.isdir(weights_root):
            for entry in os.listdir(weights_root):
                if "whisper" in entry.lower():
                    return os.path.join(weights_root, entry)
        return None

    def _is_silence(self, pcm_chunk: bytes) -> bool:
        num_samples = len(pcm_chunk) // 2
        if num_samples < 100:
            return True
        samples = struct.unpack(f"<{num_samples}h", pcm_chunk)
        rms = (sum(s * s for s in samples) / num_samples) ** 0.5
        return rms < 200

    @staticmethod
    def _pcm_to_wav_file(pcm_bytes: bytes) -> str:
        """Write raw PCM 16-bit 16kHz mono to a temporary WAV file."""
        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            with wave.open(path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(pcm_bytes)
        finally:
            os.close(fd)
        return path
