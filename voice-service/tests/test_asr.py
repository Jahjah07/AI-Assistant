import unittest
from types import SimpleNamespace

import numpy as np

from app.asr import MoonshineAsr


class FakeStream:
    def __init__(self):
        self.audio = []
        self.closed = False

    def start(self):
        pass

    def add_audio(self, audio, sample_rate):
        assert sample_rate == 16000
        self.audio.extend(audio)

    def update_transcription(self):
        return SimpleNamespace(lines=[SimpleNamespace(text="hello")])

    def stop(self):
        return SimpleNamespace(lines=[SimpleNamespace(text="hello world")])

    def close(self):
        self.closed = True


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.streams = []
        self.asr = MoonshineAsr("UsefulSensors/moonshine-streaming-small", "/tmp")
        self.asr.status.state = "ready"

        def create_stream(**kwargs):
            stream = FakeStream()
            self.streams.append(stream)
            return stream

        self.asr.model = SimpleNamespace(create_stream=create_stream)

    async def test_incremental_audio_final_and_next_turn(self):
        audio = np.arange(100, dtype=np.float32)
        self.assertEqual(await self.asr.transcribe(audio[:40]), "hello")
        await self.asr.transcribe(audio[:70])
        self.assertEqual(await self.asr.transcribe(audio, final=True), "hello world")
        self.assertEqual(self.streams[0].audio, audio.tolist())
        self.assertTrue(self.streams[0].closed)
        await self.asr.transcribe(audio[:20], final=True)
        self.assertEqual(self.streams[1].audio, audio[:20].tolist())

    async def test_disconnect_reset_discards_previous_turn(self):
        await self.asr.transcribe(np.ones(30))
        await self.asr.reset()
        self.assertTrue(self.streams[0].closed)
        self.assertEqual(self.asr.consumed, 0)
        self.assertIsNone(self.asr.stream)

    async def test_final_failure_still_closes_stream(self):
        await self.asr.transcribe(np.ones(30))
        self.streams[0].stop = lambda: None
        with self.assertRaises(RuntimeError):
            await self.asr.transcribe(np.ones(40), final=True)
        self.assertTrue(self.streams[0].closed)
        self.assertIsNone(self.asr.stream)


if __name__ == "__main__":
    unittest.main()
