from __future__ import annotations

import asyncio
import json
import time

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .asr import MoonshineAsr
from .config import settings
from .security import verify_ticket
from .silero import SileroVad
from .turn import TurnDetector

app = FastAPI(title="Jimmy Voice Service", docs_url=None, redoc_url=None)
asr = MoonshineAsr(settings.moonshine_model, settings.moonshine_cache)
connection_limit = asyncio.Semaphore(1)


def now_ms() -> float:
    return round(time.time() * 1000, 1)


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(asr.load())


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "vad": "silero-onnx-cpu",
        "configured_asr": settings.asr_provider,
        "asr_status": asr.status.__dict__,
        "model": asr.model_name,
    }


async def send(websocket: WebSocket, kind: str, **values) -> None:
    await websocket.send_text(json.dumps({"type": kind, **values}, separators=(",", ":")))


@app.websocket("/ws/voice")
async def voice(websocket: WebSocket) -> None:
    if not verify_ticket(websocket.scope.get("query_string", b""), settings.secret):
        await websocket.close(code=4401, reason="Invalid or expired ticket")
        return
    if connection_limit.locked():
        await websocket.close(code=4429, reason="Voice service is busy")
        return

    await connection_limit.acquire()
    partial_task: asyncio.Task | None = None
    try:
        await websocket.accept()
        if asr.status.state != "ready":
            await send(websocket, "error", reason=asr.status.error or "Moonshine is loading. Reload once the voice service is ready.")
            await websocket.close(code=1013, reason="Moonshine is not ready")
            return
        detector = TurnDetector(
            SileroVad(settings.silero_model_path),
            threshold=settings.vad_threshold,
            negative_threshold=settings.vad_negative_threshold,
            pre_roll_ms=settings.pre_roll_ms,
            endpoint_silence_ms=settings.endpoint_silence_ms,
            minimum_speech_ms=settings.minimum_speech_ms,
            maximum_turn_ms=settings.maximum_turn_ms,
        )
        await send(
            websocket,
            "ready",
            sample_rate=16_000,
            frame_samples=512,
            vad="silero-onnx-cpu",
            provider=asr.name,
            provider_status=asr.status.state,
        )
        pending = bytearray()
        turn_audio: list[np.ndarray] = []
        speech_started_at: float | None = None
        first_partial_at: float | None = None
        last_partial_at = 0.0
        last_partial = ""
        async def emit_partial(audio: np.ndarray) -> None:
            nonlocal first_partial_at, last_partial
            try:
                partial = await asr.transcribe(audio)
                if partial and partial != last_partial:
                    partial_at = now_ms()
                    first_partial_at = first_partial_at or partial_at
                    last_partial = partial
                    await send(
                        websocket,
                        "partial",
                        text=partial,
                        at_ms=partial_at,
                        first_partial_at_ms=first_partial_at,
                    )
            except Exception:
                return

        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            chunk = message.get("bytes")
            if not chunk:
                continue
            if len(chunk) > 64 * 1024:
                await websocket.close(code=4409, reason="Audio chunk too large")
                break
            pending.extend(chunk)

            while len(pending) >= 1024:
                raw = bytes(pending[:1024])
                del pending[:1024]
                frame = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                if detector.active:
                    turn_audio.append(frame.copy())
                events = detector.accept(frame)

                for event in events:
                    if event.kind == "speech_start":
                        speech_started_at = now_ms()
                        first_partial_at = None
                        last_partial_at = time.monotonic()
                        last_partial = ""
                        turn_audio = [event.audio] if event.audio is not None else []
                        await send(websocket, "speech_start", at_ms=speech_started_at)
                    elif event.kind == "speech_end" and event.audio is not None:
                        speech_ended_at = now_ms()
                        audio = event.audio
                        turn_audio = []
                        try:
                            if partial_task is not None:
                                await partial_task
                                partial_task = None
                            final_text = await asr.transcribe(audio, final=True)
                            final_at = now_ms()
                            await send(
                                websocket,
                                "final",
                                text=final_text,
                                provider=asr.name,
                                timing={
                                    "speech_start": speech_started_at,
                                    "speech_end": speech_ended_at,
                                    "asr_first_partial": first_partial_at,
                                    "asr_final": final_at,
                                    "speech_end_to_asr_final_ms": round(final_at - speech_ended_at, 1),
                                },
                            )
                        except Exception as error:
                            await send(
                                websocket,
                                "error",
                                reason=f"{type(error).__name__}: {error}",
                                timing={
                                    "speech_start": speech_started_at,
                                    "speech_end": speech_ended_at,
                                },
                            )

                if detector.active and asr.status.state == "ready":
                    elapsed_ms = (time.monotonic() - last_partial_at) * 1000
                    if elapsed_ms >= settings.partial_interval_ms and (
                        partial_task is None or partial_task.done()
                    ):
                        last_partial_at = time.monotonic()
                        partial_audio = np.concatenate(turn_audio) if turn_audio else frame
                        partial_task = asyncio.create_task(emit_partial(partial_audio))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            # Native work in to_thread must finish before its stream is freed.
            if partial_task is not None:
                await partial_task
            if isinstance(asr, MoonshineAsr):
                await asr.reset()
        finally:
            connection_limit.release()
