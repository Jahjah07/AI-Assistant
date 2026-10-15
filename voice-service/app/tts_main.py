from __future__ import annotations

import asyncio
import hmac

from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field

from .config import settings
from .tts import KokoroTts, VOICE_IDS

app = FastAPI(title="Jimmy Kokoro TTS", docs_url=None, redoc_url=None)
tts = KokoroTts(settings.tts_language, settings.tts_voice, settings.tts_speed)
tts_limit = asyncio.Semaphore(1)
load_task: asyncio.Task | None = None


async def ensure_loaded() -> None:
    global load_task
    if tts.status.state == "ready":
        return
    if load_task is None or load_task.done():
        load_task = asyncio.create_task(tts.load())
    await asyncio.shield(load_task)
    if tts.status.state != "ready":
        raise HTTPException(status_code=503, detail="Kokoro could not load")


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1_000)
    voice: str | None = Field(default=None, max_length=40)


@app.on_event("startup")
async def startup() -> None:
    if settings.tts_provider == "kokoro" and not settings.tts_lazy_load:
        global load_task
        load_task = asyncio.create_task(tts.load())


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "configured_tts": settings.tts_provider,
        "voice": settings.tts_voice,
        "sample_rate": tts.sample_rate,
        "status": tts.status.__dict__,
    }


@app.post("/warm")
async def warm(x_voice_service_secret: str = Header(default="")) -> dict:
    if not settings.secret or not hmac.compare_digest(x_voice_service_secret, settings.secret):
        raise HTTPException(status_code=401, detail="Invalid service secret")
    await ensure_loaded()
    return {"state": tts.status.state}


@app.post("/tts")
async def synthesize_speech(
    request: TtsRequest,
    x_voice_service_secret: str = Header(default=""),
) -> Response:
    if not settings.secret or not hmac.compare_digest(
        x_voice_service_secret, settings.secret
    ):
        raise HTTPException(status_code=401, detail="Invalid service secret")
    if settings.tts_provider != "kokoro":
        raise HTTPException(status_code=503, detail="Kokoro is not ready")
    voice = request.voice if request.voice is not None else tts.voice
    if voice not in VOICE_IDS:
        raise HTTPException(status_code=400, detail="Unknown Kokoro voice")
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    # An interrupted HTTP request can leave inference finishing in the worker.
    try:
        await asyncio.wait_for(tts_limit.acquire(), timeout=30)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=429, detail="TTS service is busy; try again shortly")
    try:
        await ensure_loaded()
        audio, generation_ms = await tts.synthesize(text, voice=voice)
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "X-TTS-Provider": tts.name,
                "X-TTS-Voice": voice,
                "X-TTS-Generation-Ms": str(generation_ms),
            },
        )
    finally:
        tts_limit.release()
