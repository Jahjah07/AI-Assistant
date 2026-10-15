from __future__ import annotations

import asyncio
import io
import json
import time
import wave
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

VOICE_IDS = frozenset(
    voice["id"]
    for group in json.loads(Path(__file__).with_name("kokoro-voices.json").read_text(encoding="utf-8"))
    for voice in group["voices"]
)


@dataclass
class TtsStatus:
    state: str = "not_loaded"
    error: str | None = None
    load_ms: float | None = None


class KokoroTts:
    name = "kokoro"
    sample_rate = 24_000

    def __init__(self, language: str, voice: str, speed: float):
        self.language = language
        self.voice = voice
        self.speed = speed
        self.pipeline = None
        self._pipelines = {}
        self.status = TtsStatus()
        self._lock = asyncio.Lock()
        self._cache: OrderedDict[tuple[str, str], bytes] = OrderedDict()
        self._cache_limit = 32

    async def load(self) -> None:
        if self.status.state in {"loading", "ready"}:
            return

        self.status.state = "loading"
        started = time.perf_counter()
        try:
            self.pipeline = await asyncio.to_thread(self._load_sync)
            wake_audio = await asyncio.to_thread(self._synthesize_sync, "Yes, Sir?")
            self._cache[(self.voice, "Yes, Sir?")] = wake_audio
            self.status.state = "ready"
        except Exception as error:
            self.status.state = "failed"
            self.status.error = f"{type(error).__name__}: {error}"
        finally:
            self.status.load_ms = round((time.perf_counter() - started) * 1000, 1)

    def _load_sync(self):
        from kokoro import KPipeline

        pipeline = KPipeline(
            lang_code=self.language,
            repo_id="hexgrad/Kokoro-82M",
            device="cpu",
        )
        pipeline.load_voice(self.voice)
        return pipeline

    async def synthesize(self, text: str, voice: str | None = None) -> tuple[bytes, float]:
        voice = self.voice if voice is None else voice
        if voice not in VOICE_IDS:
            raise ValueError("Unknown Kokoro voice")
        if self.status.state != "ready" or self.pipeline is None:
            raise RuntimeError(self.status.error or "Kokoro is not ready")

        started = time.perf_counter()
        key = (voice, text)
        async with self._lock:
            wav = self._cache.get(key)
            if wav is not None:
                self._cache.move_to_end(key)
            else:
                wav = await asyncio.to_thread(self._synthesize_sync, text, voice)
                self._cache[key] = wav
                self._cache.move_to_end(key)
                while len(self._cache) > self._cache_limit:
                    self._cache.popitem(last=False)
        return wav, round((time.perf_counter() - started) * 1000, 1)

    def _pipeline_for_voice(self, voice: str):
        language = voice[0]
        if language == self.language:
            return self.pipeline
        if language not in self._pipelines:
            from kokoro import KPipeline

            self._pipelines[language] = KPipeline(
                lang_code=language, repo_id="hexgrad/Kokoro-82M",
                model=self.pipeline.model, device="cpu",
            )
        return self._pipelines[language]

    def _synthesize_sync(self, text: str, voice: str | None = None) -> bytes:
        voice = voice or self.voice
        pipeline = self._pipeline_for_voice(voice)
        chunks: list[np.ndarray] = []
        for result in pipeline(
            text,
            voice=voice,
            speed=self.speed,
            split_pattern=r"\n+",
        ):
            if result.audio is not None:
                chunks.append(
                    result.audio.detach().cpu().numpy().astype(np.float32).reshape(-1)
                )

        if not chunks:
            raise RuntimeError("Kokoro did not generate audio")

        audio = np.concatenate(chunks)
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(self.sample_rate)
            wav.writeframes(pcm)
        return output.getvalue()
