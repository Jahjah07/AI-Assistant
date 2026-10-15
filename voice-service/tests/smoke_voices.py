"""Run with python -m tests.smoke_voices to verify English voice assets and speech."""
import asyncio
import io
import json
from pathlib import Path
import wave

from app.tts import KokoroTts


async def main():
    catalog = json.loads(Path("app/kokoro-voices.json").read_text(encoding="utf-8"))
    tts = KokoroTts("a", "am_michael", 1.0)
    await tts.load()
    assert tts.status.state == "ready", tts.status.error
    for group in catalog:
        first = group["voices"][0]["id"]
        wav_bytes, elapsed = await tts.synthesize(group["preview"], first)
        with wave.open(io.BytesIO(wav_bytes)) as wav:
            assert wav.getframerate() == 24000 and wav.getnframes() > 2400
        pipeline = tts._pipeline_for_voice(first)
        assert pipeline.model is tts.pipeline.model, "Language duplicated the model"
        for voice in group["voices"]:
            pack = pipeline.load_voice(voice["id"])
            assert pack.numel() > 0
        print(f"{group['language']}: {len(group['voices'])} voices loaded, speech generated ({elapsed} ms)", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
