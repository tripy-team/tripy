"""Speech-to-text transcription using Cactus on-device inference.

Uses the Cactus streaming API so Parakeet maintains hidden state across audio
chunks — produces sub-second partial transcripts and no word-boundary cuts.

Requires Cactus to be built with Python support:
    git clone https://github.com/cactus-compute/cactus && cd cactus
    source ./setup
    cactus build --python
    cactus download nvidia/parakeet-tdt-0.6b-v3
"""

from __future__ import annotations

import json
import logging
import os
import struct
from collections import deque
from dataclasses import dataclass
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


@dataclass
class TranscriptionResult:
    text: str
    start_ms: int
    end_ms: int
    confidence: float
    # Peak RMS of the recent audio window when this chunk was decoded.
    # Lets the frontend distinguish phantom fillers (decoded from quiet
    # audio) from real short answers (decoded from speech-level audio).
    recent_peak_rms: float = 0.0


@dataclass
class StreamUpdate:
    """One pass through the streaming decoder's output.

    - `confirmed_new`: stabilized text emitted since the last call. Each
      entry is a new chunk the frontend should append to the transcript.
    - `pending`: Parakeet's current unstable best guess for the audio
      being decoded right now. The frontend replaces any previous pending
      text with this.
    - `pending_changed`: only set to True when `pending` differs from the
      last call, so callers can skip sending redundant frames.
    """

    confirmed_new: list["TranscriptionResult"]
    pending: str
    pending_changed: bool


# Auto-gain: target RMS is ~20% of int16 full-scale (normal speaking volume).
# Cap at 12x so we don't amplify pure room noise into fake "speech".
# Skip gain entirely below the floor — quiet noise amplified to speech levels
# makes Parakeet hallucinate filler words ("yeah", "uh", "mm").
_AUTO_GAIN_TARGET_RMS = 6500.0
_AUTO_GAIN_MAX = 12.0
_AUTO_GAIN_MIN_RMS = 1000.0

# Parakeet's pending buffer often contains a hallucinated filler word that
# never stabilized into confirmed. A silence-triggered flush promotes that
# pending text to confirmed, which is how "yeah" leaks into the transcript
# during quiet periods. Real client "yeah" answers stabilize during active
# audio and are emitted mid-stream, so filtering flush-only emissions that
# match this set is safe.
_HALLUCINATION_FILLERS = frozenset(
    {
        "yeah", "yep", "yup", "ya",
        "uh", "uhh", "um", "umm", "er", "erm",
        "hmm", "hm", "mm", "mmm", "mhm", "mm-hmm", "mmhmm", "uh-huh", "uhhuh",
        "ok", "okay", "k",
        "you", "the", "a", "i",
        "bye", "hi", "hello", "thanks", "thank you",
    }
)


def _is_filler_only(text: str) -> bool:
    """True if `text` is just a known Parakeet hallucination filler."""
    cleaned = text.strip().strip(".,!?;:-").lower()
    return cleaned in _HALLUCINATION_FILLERS


def _apply_auto_gain(pcm_bytes: bytes) -> bytes:
    """Boost quiet PCM audio toward a consistent target loudness."""
    num_samples = len(pcm_bytes) // 2
    if num_samples == 0:
        return pcm_bytes
    samples = struct.unpack(f"<{num_samples}h", pcm_bytes)
    rms = (sum(s * s for s in samples) / num_samples) ** 0.5
    if rms < _AUTO_GAIN_MIN_RMS or rms >= _AUTO_GAIN_TARGET_RMS:
        return pcm_bytes
    gain = min(_AUTO_GAIN_TARGET_RMS / rms, _AUTO_GAIN_MAX)
    boosted = bytearray(num_samples * 2)
    for i in range(num_samples):
        v = int(samples[i] * gain)
        v = 32767 if v > 32767 else -32768 if v < -32768 else v
        struct.pack_into("<h", boosted, i * 2, v)
    return bytes(boosted)


class CactusTranscriber:
    """Streaming audio transcriber using Cactus Parakeet.

    Instantiate once with load(). Reuse one instance per speaker per session:
    the underlying stream keeps hidden state so the decoder can stitch
    together words that span chunk boundaries.
    """

    def __init__(self, model_name: str = "nvidia/parakeet-ctc-1.1b"):
        self.model_name = model_name
        self._model: Any = None
        self._cactus_init: Callable | None = None
        self._cactus_stream_start: Callable | None = None
        self._cactus_stream_process: Callable | None = None
        self._cactus_stream_stop: Callable | None = None

        # Stream-level state.
        self._stream: Any = None
        # Last cumulative "confirmed" text Parakeet returned. We diff each
        # call to emit only the newly-stabilized text.
        self._confirmed_total: str = ""
        # Last pending text we told the caller about, used to suppress
        # duplicate partial events when the decoder hasn't changed its mind.
        self._last_pending: str = ""
        self._offset_ms: int = 0
        # VAD state: track consecutive silent audio time per stream. When
        # the speaker pauses for longer than _silence_flush_ms we finalize
        # the current stream so any remaining pending text becomes confirmed,
        # and the next non-silent audio opens a fresh decoder. This yields
        # natural utterance boundaries instead of one endless transcript.
        self._silent_ms: int = 0
        self._silence_flush_ms: int = 800
        self._silence_rms_threshold: float = 900.0
        # Require this many consecutive non-silent chunks before opening a
        # new Parakeet stream. Isolated noise bursts (keyboard click, HVAC
        # puff) can briefly clear the RMS gate; if we spin up a stream on
        # one of those, Parakeet hallucinates a filler word mid-stream
        # before any silence flush has a chance to run. Requiring sustained
        # energy means a genuine utterance has to begin before we commit.
        self._nonsilent_run: int = 0
        self._stream_open_min_chunks: int = 2
        # Prefix buffer: hold the first non-silent chunk so when the second
        # arrives and we decide this is real speech, we can feed both and
        # not lose the leading audio.
        self._prefix_pcm: bytes = b""
        # Rolling window of recent chunk RMS values, used as evidence of
        # whether audio in the last ~1.5s actually contained speech-level
        # energy. When a confirmed chunk is just a filler word and recent
        # audio never peaked above _speech_rms_threshold, treat the filler
        # as hallucination and drop it.
        self._recent_rms: deque[float] = deque(maxlen=6)
        self._speech_rms_threshold: float = 2500.0
        # Config passed to the streaming decoder. min_chunk_size is the
        # amount of audio Parakeet buffers internally before emitting
        # updates — lower = lower latency, higher = more context per decode.
        # 2000 samples = 125ms gives near-real-time partial updates.
        self._stream_options: str = json.dumps(
            {"min_chunk_size": 2000, "language": "en"}
        )

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        _ensure_cactus_importable()
        try:
            from cactus import (  # type: ignore[import-untyped]
                cactus_init,
                cactus_stream_transcribe_start,
                cactus_stream_transcribe_process,
                cactus_stream_transcribe_stop,
            )

            self._cactus_init = cactus_init
            self._cactus_stream_start = cactus_stream_transcribe_start
            self._cactus_stream_process = cactus_stream_transcribe_process
            self._cactus_stream_stop = cactus_stream_transcribe_stop

            weights_dir = self._find_weights()
            if not weights_dir:
                logger.error(
                    "Parakeet weights not found. Run: cactus download %s",
                    self.model_name,
                )
                return

            self._model = cactus_init(weights_dir, None, False)
            logger.info("Cactus streaming ASR loaded from %s", weights_dir)

        except ImportError as e:
            logger.error(
                "Cannot import cactus. Build it first:\n"
                "  cd %s && source ./setup && cactus build --python\n"
                "Error: %s",
                CACTUS_REPO,
                e,
            )
        except Exception:
            logger.exception("Failed to load Cactus Parakeet model")

    def _ensure_stream(self) -> bool:
        """Start a new streaming session if one isn't open. Returns success."""
        if self._stream is not None:
            return True
        if self._model is None or self._cactus_stream_start is None:
            return False
        try:
            self._stream = self._cactus_stream_start(
                self._model, self._stream_options
            )
            self._confirmed_total = ""
            return True
        except Exception:
            logger.exception("Failed to open Cactus stream")
            return False

    def feed_audio(self, pcm_bytes: bytes) -> StreamUpdate:
        """Feed PCM. Returns any newly-confirmed text + current pending text."""
        duration_ms = (len(pcm_bytes) // 2) * 1000 // 16000

        # VAD: if this chunk is silence, extend the silent-run counter. If
        # we've been silent long enough AND we have an active stream, flush
        # it so any pending text becomes confirmed at the utterance boundary.
        chunk_rms = self._chunk_rms(pcm_bytes)
        self._recent_rms.append(chunk_rms)
        chunk_is_silent = chunk_rms < self._silence_rms_threshold
        if chunk_is_silent:
            self._silent_ms += duration_ms
            self._nonsilent_run = 0
            self._prefix_pcm = b""
            if (
                self._stream is not None
                and self._silent_ms >= self._silence_flush_ms
            ):
                flush_update = self.flush()
                flush_update = self._filter_hallucinations(flush_update, "flush")
                # reset silent counter so we don't keep flushing while quiet
                self._silent_ms = 0
                self._offset_ms += duration_ms
                return flush_update
            self._offset_ms += duration_ms
            return StreamUpdate([], "", False)

        self._silent_ms = 0

        # Sustained-audio gate: if no stream is open yet, wait until we've
        # seen enough non-silent chunks in a row before committing to open
        # one. Buffer the prefix so we don't lose the leading audio.
        if self._stream is None:
            self._nonsilent_run += 1
            if self._nonsilent_run < self._stream_open_min_chunks:
                self._prefix_pcm = pcm_bytes
                self._offset_ms += duration_ms
                return StreamUpdate([], "", False)
            pcm_bytes = self._prefix_pcm + pcm_bytes
            self._prefix_pcm = b""

        if not self._ensure_stream() or self._cactus_stream_process is None:
            self._offset_ms += duration_ms
            return StreamUpdate([], "", False)

        pcm_bytes = _apply_auto_gain(pcm_bytes)

        try:
            raw = self._cactus_stream_process(self._stream, pcm_bytes)
        except Exception:
            logger.exception("stream_process failed")
            self._offset_ms += duration_ms
            return StreamUpdate([], "", False)

        update = self._extract_update(raw, duration_ms)
        update = self._filter_hallucinations(update, "stream")
        self._offset_ms += duration_ms
        return update

    @staticmethod
    def _chunk_rms(pcm_bytes: bytes) -> float:
        n = len(pcm_bytes) // 2
        if n == 0:
            return 0.0
        samples = struct.unpack(f"<{n}h", pcm_bytes)
        return (sum(s * s for s in samples) / n) ** 0.5

    def flush(self) -> StreamUpdate:
        """Finalize the current stream and emit any remaining confirmed text."""
        if self._stream is None or self._cactus_stream_stop is None:
            return StreamUpdate([], "", False)
        try:
            raw = self._cactus_stream_stop(self._stream)
        except Exception:
            logger.exception("stream_stop failed")
            raw = ""
        finally:
            self._stream = None

        return self._extract_update(raw, 0)

    def _filter_hallucinations(
        self, update: StreamUpdate, source: str
    ) -> StreamUpdate:
        """Drop filler-only confirmed chunks when recent audio lacked speech energy.

        A real client "yeah" comes with speech-level RMS in the recent window;
        a hallucinated "yeah" comes during quiet/noisy audio where the recent
        peak stayed below the speech threshold. We log both kept and dropped
        emissions so the thresholds can be tuned from real call data.
        """
        logger.info(
            "[transcribe] filter_called src=%s n_confirmed=%d pending=%r",
            source, len(update.confirmed_new), update.pending[:60] if update.pending else "",
        )
        if not update.confirmed_new:
            return update
        recent_peak = max(self._recent_rms) if self._recent_rms else 0.0
        kept: list[TranscriptionResult] = []
        for r in update.confirmed_new:
            if _is_filler_only(r.text) and recent_peak < self._speech_rms_threshold:
                logger.info(
                    "[transcribe] DROP filler=%r src=%s recent_peak_rms=%.0f threshold=%.0f",
                    r.text, source, recent_peak, self._speech_rms_threshold,
                )
                continue
            logger.info(
                "[transcribe] KEEP text=%r src=%s recent_peak_rms=%.0f",
                r.text, source, recent_peak,
            )
            kept.append(r)
        return StreamUpdate(
            confirmed_new=kept,
            pending=update.pending,
            pending_changed=update.pending_changed,
        )

    def reset(self) -> None:
        """Close any open stream and clear incremental state."""
        if self._stream is not None and self._cactus_stream_stop is not None:
            try:
                self._cactus_stream_stop(self._stream)
            except Exception:
                pass
        self._stream = None
        self._confirmed_total = ""
        self._last_pending = ""
        self._offset_ms = 0
        self._silent_ms = 0
        self._nonsilent_run = 0
        self._prefix_pcm = b""
        self._recent_rms.clear()

    def _extract_update(self, raw: Any, duration_ms: int) -> StreamUpdate:
        """Diff the streaming output against what we've already emitted."""
        if not raw:
            return StreamUpdate([], "", False)
        try:
            out = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            logger.warning("Cactus stream returned non-JSON: %r", raw[:200])
            return StreamUpdate([], "", False)

        confirmed = (out.get("confirmed") or "").strip()
        pending = (out.get("pending") or "").strip()

        confirmed_new: list[TranscriptionResult] = []
        if confirmed and confirmed != self._confirmed_total:
            if confirmed.startswith(self._confirmed_total):
                new_text = confirmed[len(self._confirmed_total) :].strip()
            else:
                new_text = confirmed
            self._confirmed_total = confirmed
            if new_text:
                recent_peak = max(self._recent_rms) if self._recent_rms else 0.0
                confirmed_new.append(
                    TranscriptionResult(
                        text=new_text,
                        start_ms=max(self._offset_ms - duration_ms, 0),
                        end_ms=self._offset_ms,
                        confidence=0.9,
                        recent_peak_rms=recent_peak,
                    )
                )

        pending_changed = pending != self._last_pending
        if pending_changed:
            self._last_pending = pending

        return StreamUpdate(
            confirmed_new=confirmed_new,
            pending=pending,
            pending_changed=pending_changed,
        )

    def _find_weights(self) -> str | None:
        candidates = [
            os.path.join(CACTUS_REPO, "weights", self.model_name),
            os.path.join(CACTUS_REPO, "weights", self.model_name.replace("/", "_")),
            os.path.join(CACTUS_REPO, "weights", os.path.basename(self.model_name)),
            os.environ.get("CACTUS_MODEL_PATH", ""),
        ]
        for path in candidates:
            if path and os.path.isdir(path):
                return path
        weights_root = os.path.join(CACTUS_REPO, "weights")
        if os.path.isdir(weights_root):
            basename = os.path.basename(self.model_name).lower()
            for entry in os.listdir(weights_root):
                if basename in entry.lower():
                    return os.path.join(weights_root, entry)
        return None
