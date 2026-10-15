"""Run inside the Compose network against live voice and Kokoro services."""
import asyncio
import hashlib
import hmac
import io
import json
import os
import time
import uuid
import wave

import numpy as np
import requests
from websockets.asyncio.client import connect


async def main():
    secret = os.environ["VOICE_SERVICE_SECRET"]
    response = requests.post(
        "http://tts:8766/tts",
        headers={"X-Voice-Service-Secret": secret},
        json={"text": "Hello Jimmy. Please tell me what the weather is like today."},
        timeout=120,
    )
    response.raise_for_status()
    with wave.open(io.BytesIO(response.content)) as wav:
        assert wav.getsampwidth() == 2 and wav.getnchannels() == 1
        rate = wav.getframerate()
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    audio = np.interp(np.arange(0, len(audio), rate / 16000), np.arange(len(audio)), audio)
    audio = np.concatenate([np.zeros(8000), audio, np.zeros(16000)]).astype("<i2")
    expires, nonce = str(int(time.time()) + 60), uuid.uuid4().hex
    signature = hmac.new(secret.encode(), f"{expires}.{nonce}".encode(), hashlib.sha256).hexdigest()
    url = f"ws://voice:8765/ws/voice?expires={expires}&nonce={nonce}&signature={signature}"
    async with connect(url) as ws:
        ready = json.loads(await ws.recv())
        assert ready["provider"] == "moonshine", ready
        print(ready, flush=True)

        async def feed():
            for offset in range(0, len(audio), 512):
                frame = audio[offset:offset + 512]
                frame = np.pad(frame, (0, 512 - len(frame)))
                await ws.send(frame.tobytes())
                await asyncio.sleep(0.032)

        for turn in range(2):
            feeder = asyncio.create_task(feed())
            partials, finals = [], []
            try:
                while True:
                    event = json.loads(await asyncio.wait_for(ws.recv(), 30))
                    print(json.dumps(event), flush=True)
                    assert event["type"] != "fallback", event
                    if event["type"] == "partial":
                        partials.append(event["text"])
                    if event["type"] == "final":
                        finals.append(event["text"])
                        if "today" in event["text"].lower():
                            break
                assert partials, "No partial transcript received"
                assert "weather" in " ".join(finals).lower(), finals
            finally:
                await feeder
            print(f"Turn {turn + 1} passed", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
