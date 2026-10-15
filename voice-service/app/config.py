from __future__ import annotations

import os
from dataclasses import dataclass


def _number(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class Settings:
    secret: str = os.getenv("VOICE_SERVICE_SECRET", "")
    silero_model_path: str = os.getenv(
        "VOICE_SILERO_MODEL_PATH", "/models/silero_vad_16k_op15.onnx"
    )
    asr_provider: str = "moonshine"
    moonshine_model: str = os.getenv("MOONSHINE_MODEL", "UsefulSensors/moonshine-streaming-small")
    moonshine_cache: str = os.getenv("MOONSHINE_CACHE", "/cache/moonshine")
    tts_provider: str = "kokoro"
    tts_lazy_load: bool = os.getenv("VOICE_TTS_LAZY_LOAD", "0") == "1"
    tts_voice: str = os.getenv("KOKORO_VOICE", "am_michael").strip().lower()
    tts_language: str = os.getenv("KOKORO_LANGUAGE", "a").strip().lower()
    tts_speed: float = _number("KOKORO_SPEED", 1.0, 0.5, 2.0)
    vad_threshold: float = _number("VOICE_VAD_THRESHOLD", 0.5, 0.05, 0.95)
    vad_negative_threshold: float = _number(
        "VOICE_VAD_NEGATIVE_THRESHOLD", 0.35, 0.01, 0.9
    )
    pre_roll_ms: int = int(_number("VOICE_PRE_ROLL_MS", 300, 0, 1000))
    endpoint_silence_ms: int = int(
        _number("VOICE_ENDPOINT_SILENCE_MS", 2000, 500, 5000)
    )
    minimum_speech_ms: int = int(_number("VOICE_MINIMUM_SPEECH_MS", 170, 64, 2000))
    maximum_turn_ms: int = int(_number("VOICE_MAXIMUM_TURN_MS", 15000, 1000, 30000))
    partial_interval_ms: int = int(
        _number("VOICE_PARTIAL_INTERVAL_MS", 560, 160, 2000)
    )


settings = Settings()
