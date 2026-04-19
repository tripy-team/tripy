"""Cactus live-call inference server.

Accepts audio via WebSocket, runs real-time transcription with Cactus,
and streams back transcript chunks, profile extractions, and suggested questions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .extraction_engine import ExtractionEngine
from .gemma_client import DEFAULT_GEMMA_MODEL
from .learning_state import SessionLearningState
from .question_engine import QuestionEngine
from .speaker_detection import detect_speaker_from_channel_tag
from .transcription import CactusTranscriber
from .vision_engine import VisionEngine

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Cactus Live Call Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instances (loaded once at startup)
transcriber = CactusTranscriber(
    model_name=os.environ.get("CACTUS_STT_MODEL", "openai/whisper-small")
)
extraction_engine = ExtractionEngine(
    model_name=os.environ.get("CACTUS_LLM_MODEL", DEFAULT_GEMMA_MODEL)
)
question_engine = QuestionEngine(
    model_name=os.environ.get("CACTUS_LLM_MODEL", DEFAULT_GEMMA_MODEL)
)
vision_engine = VisionEngine(
    model_name=os.environ.get("CACTUS_VISION_MODEL", DEFAULT_GEMMA_MODEL)
)


@app.on_event("startup")
async def startup() -> None:
    logger.info("Loading Gemma 4 stack (Cactus + Gemini fallback)...")
    transcriber.load()
    extraction_engine.load()
    question_engine.load()
    vision_engine.load()
    logger.info("Models ready")


class LiveSession:
    """Manages state for a single live transcription session."""

    def __init__(
        self,
        ws: WebSocket,
        client_name: str,
        existing_preferences: dict[str, Any],
        trip_context: dict[str, Any] | None = None,
    ):
        self.ws = ws
        self.client_name = client_name
        self.trip_context = trip_context
        self.learning_state = SessionLearningState(existing=existing_preferences)
        self.full_transcript: list[dict[str, Any]] = []
        self.unprocessed_text = ""
        self.unprocessed_speaker = "unknown"
        self._analysis_lock = asyncio.Lock()
        self._sentence_count = 0
        self._latest_visual_insight: str = ""
        self._vision_lock = asyncio.Lock()
        self._last_vision_at: float = 0.0
        # Per-speaker transcribers share the loaded model but keep independent
        # audio buffers — otherwise advisor and client audio would interleave
        # in one stream and the transcriber couldn't tell them apart.
        self._transcribers: dict[str, CactusTranscriber] = {}

    def _get_transcriber(self, speaker: str) -> CactusTranscriber:
        t = self._transcribers.get(speaker)
        if t is None:
            t = CactusTranscriber(transcriber.model_name)
            # Share loaded weights + inference callable across sessions so we
            # don't reload the model per speaker. Copy both — only copying
            # _model would leave _cactus_transcribe as None and every call
            # would no-op silently.
            t._model = transcriber._model
            t._cactus_init = transcriber._cactus_init
            t._cactus_transcribe = transcriber._cactus_transcribe
            self._transcribers[speaker] = t
        return t

    async def process_audio(
        self, pcm_bytes: bytes, speaker: str = "unknown"
    ) -> None:
        """Transcribe an audio chunk and stream results back."""
        session_transcriber = self._get_transcriber(speaker)
        buf_before = len(session_transcriber._buffer)
        results = session_transcriber.feed_audio(pcm_bytes)
        buf_after = len(session_transcriber._buffer)
        logger.info(
            "audio chunk: speaker=%s in=%d buf=%d->%d (thresh=%d) results=%d",
            speaker,
            len(pcm_bytes),
            buf_before,
            buf_after,
            session_transcriber._chunk_threshold,
            len(results),
        )

        for result in results:
            chunk = {
                "type": "transcript",
                "speaker": speaker,
                "text": result.text,
                "startMs": result.start_ms,
                "endMs": result.end_ms,
                "confidence": result.confidence,
                "timestamp": time.time(),
            }
            self.full_transcript.append(chunk)
            self.unprocessed_text += f" {result.text}"
            self.unprocessed_speaker = speaker

            await self.ws.send_json(chunk)

            # Count sentences for analysis trigger
            self._sentence_count += result.text.count(".") + result.text.count("?") + result.text.count("!")

            if self._should_analyze():
                asyncio.create_task(self._run_analysis())

    def _should_analyze(self) -> bool:
        """Trigger analysis after ~3 sentences or 400+ chars of unprocessed text."""
        return self._sentence_count >= 3 or len(self.unprocessed_text) > 400

    async def _run_analysis(self) -> None:
        """Extract preferences and generate questions from recent transcript."""
        async with self._analysis_lock:
            text = self.unprocessed_text.strip()
            if not text:
                return

            self.unprocessed_text = ""
            self._sentence_count = 0

            profile_summary = self.learning_state.to_profile_summary()

            # Run extraction
            try:
                extractions = await asyncio.get_event_loop().run_in_executor(
                    None,
                    extraction_engine.extract,
                    text,
                    self.client_name,
                    profile_summary,
                )

                if extractions:
                    self.learning_state.ingest(extractions)
                    await self.ws.send_json({
                        "type": "extraction",
                        "data": extractions,
                    })
            except Exception:
                logger.exception("Extraction error")
                extractions = []

            # Run question generation (only when client is speaking)
            if self.unprocessed_speaker in ("client", "both", "unknown"):
                try:
                    missing = ", ".join(self.learning_state.get_missing_fields()[:15])
                    extraction_summary = json.dumps(extractions[:5]) if extractions else "None"
                    asked = ", ".join(self.learning_state.asked_questions[-20:])

                    loop = asyncio.get_event_loop()
                    questions = await loop.run_in_executor(
                        None,
                        lambda: question_engine.generate(
                            text,
                            profile_summary,
                            extraction_summary,
                            missing,
                            asked,
                            self.trip_context,
                            self._latest_visual_insight or None,
                        ),
                    )

                    if questions:
                        for q in questions:
                            self.learning_state.asked_questions.append(
                                q.get("questionText", "")
                            )
                        await self.ws.send_json({
                            "type": "questions",
                            "data": questions,
                        })
                except Exception:
                    logger.exception("Question generation error")

    async def process_video_frame(self, frame_data_url: str) -> None:
        """Analyse a single frame with Gemma 4 vision and stream back insight."""
        # Throttle: at most one vision call in flight, and no more than one
        # every ~4s (frames are expensive; insight rarely changes faster).
        now = time.time()
        if self._vision_lock.locked() or now - self._last_vision_at < 4.0:
            return
        self._last_vision_at = now

        async with self._vision_lock:
            try:
                result = await asyncio.get_event_loop().run_in_executor(
                    None, vision_engine.analyse_frame, frame_data_url
                )
            except Exception:
                logger.exception("Vision analysis error")
                return

            insight = (result.get("insight") or "").strip()
            signals = result.get("signals") or []

            if insight:
                self._latest_visual_insight = insight
                await self.ws.send_json({
                    "type": "visualInsight",
                    "insight": insight,
                    "timestamp": time.time(),
                })

            if signals:
                self.learning_state.ingest(signals)
                await self.ws.send_json({
                    "type": "extraction",
                    "data": signals,
                    "source": "vision",
                })

    async def flush_and_finalize(self) -> dict[str, Any]:
        """Flush remaining audio and return final session state."""
        if self.unprocessed_text.strip():
            await self._run_analysis()

        return {
            "transcript": self.full_transcript,
            "learned": self.learning_state.learned,
            "confidenceMap": self.learning_state.confidence_map,
            "evidenceMap": self.learning_state.evidence_map,
            "contradictions": [
                {
                    "field": c.field,
                    "previous": c.previous,
                    "new": c.new,
                    "evidence": c.evidence,
                }
                for c in self.learning_state.contradictions
            ],
            "commitReady": self.learning_state.get_commit_ready(),
        }


@app.websocket("/ws/live-transcribe")
async def live_transcribe(ws: WebSocket) -> None:
    await ws.accept()
    logger.info("WebSocket connection accepted")

    # First message is config
    try:
        config = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except Exception:
        await ws.close(code=1008, reason="Expected config JSON as first message")
        return

    session = LiveSession(
        ws=ws,
        client_name=config.get("clientName", "Client"),
        existing_preferences=config.get("existingPreferences", {}),
        trip_context=config.get("tripContext"),
    )

    await ws.send_json({"type": "status", "status": "ready"})

    try:
        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message:
                # Binary audio data with channel tag in first byte
                raw = message["bytes"]
                if len(raw) < 2:
                    continue
                # First byte indicates channel: 0=local/advisor, 1=remote/client
                channel_byte = raw[0]
                pcm_data = raw[1:]
                speaker = "advisor" if channel_byte == 0 else "client"
                await session.process_audio(pcm_data, speaker)

            elif "text" in message:
                # JSON control messages
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")
                if msg_type == "audio":
                    # Base64-encoded audio with speaker tag
                    import base64

                    audio_bytes = base64.b64decode(msg.get("audio", ""))
                    speaker = detect_speaker_from_channel_tag(
                        msg.get("channel", "unknown")
                    )
                    await session.process_audio(audio_bytes, speaker)

                elif msg_type == "video_frame":
                    frame = msg.get("frame", "")
                    if frame:
                        asyncio.create_task(session.process_video_frame(frame))

                elif msg_type == "stop":
                    final = await session.flush_and_finalize()
                    await ws.send_json({"type": "final", **final})
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception:
        logger.exception("WebSocket error")
    finally:
        try:
            final = await session.flush_and_finalize()
            await ws.send_json({"type": "final", **final})
        except Exception:
            pass


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool


@app.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        models_loaded=transcriber.loaded,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("CACTUS_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port)
