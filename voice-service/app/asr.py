from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import numpy as np


@dataclass
class AsrStatus:
    state: str = "not_loaded"
    error: str | None = None
    load_ms: float | None = None


class MoonshineAsr:
    """Native CPU streaming; each turn sample is submitted exactly once."""

    name = "moonshine"

    def __init__(self, model_name: str, cache_dir: str):
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.model = None
        self.status = AsrStatus()
        self._lock = asyncio.Lock()
        self.stream = None
        self.consumed = 0

    async def load(self) -> None:
        if self.status.state in {"loading", "ready"}:
            return
        self.status.state = "loading"
        started = time.perf_counter()
        try:
            self.model = await asyncio.to_thread(self._load_sync)
            self.status.state = "ready"
        except Exception as error:
            self.status.state = "failed"
            self.status.error = f"{type(error).__name__}: {error}"
        finally:
            self.status.load_ms = round((time.perf_counter() - started) * 1000, 1)

    def _load_sync(self):
        from pathlib import Path
        from moonshine_voice import ModelArch, Transcriber, get_model_for_language

        if self.model_name.lower() not in {
            "usefulsensors/moonshine-streaming-small",
            "moonshine-ai/moonshine-streaming-small",
        }:
            raise ValueError("MOONSHINE_MODEL must identify Moonshine Streaming Small")
        path, arch = get_model_for_language(
            "en", ModelArch.SMALL_STREAMING, cache_root=Path(self.cache_dir)
        )
        return Transcriber(path, arch)

    def _reset_sync(self):
        if self.stream is not None:
            self.stream.close()
        self.stream = None
        self.consumed = 0

    async def reset(self):
        async with self._lock:
            await asyncio.to_thread(self._reset_sync)

    def _transcribe_sync(self, audio: np.ndarray, final: bool) -> str:
        try:
            if self.stream is None:
                # Jimmy controls update cadence and Silero controls turn boundaries.
                self.stream = self.model.create_stream(update_interval=3600)
                self.stream.start()
            if audio.size < self.consumed:
                raise ValueError("Streaming audio shrank within a turn")
            self.stream.add_audio(audio[self.consumed:].tolist(), 16_000)
            self.consumed = audio.size
            result = self.stream.stop() if final else self.stream.update_transcription()
            if result is None:
                raise RuntimeError("Moonshine did not return a transcript")
            return " ".join(line.text.strip() for line in result.lines if line.text.strip())
        finally:
            if final:
                self._reset_sync()

    async def transcribe(self, audio: np.ndarray, *, final: bool = False) -> str:
        if self.status.state != "ready" or self.model is None:
            raise RuntimeError(self.status.error or "Moonshine is not ready")
        async with self._lock:
            return await asyncio.to_thread(
                self._transcribe_sync, np.asarray(audio, dtype=np.float32), final
            )
