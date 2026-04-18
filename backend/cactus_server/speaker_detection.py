"""Channel-based speaker diarization for live calls.

Uses stereo channel separation: left channel = advisor, right channel = client.
For mono audio, falls back to a simple energy-based voice activity detector.
"""

from __future__ import annotations

import struct


def detect_speaker_from_stereo(
    pcm_stereo: bytes, sample_rate: int = 16000
) -> tuple[str, bytes, bytes]:
    """Split stereo PCM into two mono channels and determine active speaker.

    Returns (speaker, left_mono_bytes, right_mono_bytes).
    speaker is "advisor" (left), "client" (right), or "both".
    """
    num_frames = len(pcm_stereo) // 4  # 2 channels * 2 bytes per sample
    if num_frames == 0:
        return "unknown", b"", b""

    samples = struct.unpack(f"<{num_frames * 2}h", pcm_stereo[: num_frames * 4])
    left = samples[0::2]
    right = samples[1::2]

    left_rms = _rms(left)
    right_rms = _rms(right)

    left_bytes = struct.pack(f"<{len(left)}h", *left)
    right_bytes = struct.pack(f"<{len(right)}h", *right)

    silence_threshold = 300
    if left_rms < silence_threshold and right_rms < silence_threshold:
        return "silence", left_bytes, right_bytes
    if left_rms > right_rms * 1.5:
        return "advisor", left_bytes, right_bytes
    if right_rms > left_rms * 1.5:
        return "client", left_bytes, right_bytes
    return "both", left_bytes, right_bytes


def detect_speaker_from_channel_tag(channel: str) -> str:
    """Map a channel tag sent by the client to a speaker label."""
    mapping = {
        "local": "advisor",
        "remote": "client",
        "advisor": "advisor",
        "client": "client",
    }
    return mapping.get(channel, "unknown")


def _rms(samples: tuple[int, ...] | list[int]) -> float:
    if not samples:
        return 0.0
    return (sum(s * s for s in samples) / len(samples)) ** 0.5
