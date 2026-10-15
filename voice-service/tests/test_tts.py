import io
import asyncio
import unittest
import wave
from unittest.mock import patch

import numpy as np

from app.tts import KokoroTts, VOICE_IDS


class FakeAudio:
    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return np.asarray([0.0, 0.25, -0.25], dtype=np.float32)


class FakePipeline:
    def __call__(self, *_args, **_kwargs):
        return [type("Result", (), {"audio": FakeAudio()})()]


class KokoroTtsTests(unittest.TestCase):
    def test_generates_24_khz_mono_wav(self):
        tts = KokoroTts("a", "am_michael", 1.0)
        tts.pipeline = FakePipeline()

        audio = tts._synthesize_sync("Hello")
        with wave.open(io.BytesIO(audio), "rb") as wav:
            self.assertEqual(wav.getframerate(), 24_000)
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertEqual(wav.getnframes(), 3)

    def test_reuses_cached_audio(self):
        tts = KokoroTts("a", "am_michael", 1.0)
        tts.pipeline = FakePipeline()
        tts.status.state = "ready"
        cached = b"cached wav"
        tts._cache[("am_michael", "Yes, Sir?")] = cached

        audio, _generation_ms = asyncio.run(tts.synthesize("Yes, Sir?"))

        self.assertIs(audio, cached)

    def test_voice_choice_separates_cache_entries(self):
        tts = KokoroTts("a", "am_michael", 1.0)
        tts.pipeline = FakePipeline()
        tts.status.state = "ready"
        with patch.object(tts, "_synthesize_sync", side_effect=[b"michael", b"bella"]) as synth:
            async def run():
                self.assertEqual((await tts.synthesize("Hello"))[0], b"michael")
                self.assertEqual((await tts.synthesize("Hello", "af_bella"))[0], b"bella")
                self.assertEqual((await tts.synthesize("Hello"))[0], b"michael")
            asyncio.run(run())
            self.assertEqual(synth.call_count, 2)
            synth.assert_called_with("Hello", "af_bella")

    def test_unknown_voice_is_rejected(self):
        tts = KokoroTts("a", "am_michael", 1.0)
        with self.assertRaises(ValueError):
            asyncio.run(tts.synthesize("Hello", "../../voice.pt"))

    def test_catalogue_has_only_the_28_english_voices(self):
        self.assertEqual(len(VOICE_IDS), 28)
        self.assertEqual({voice[0] for voice in VOICE_IDS}, set("ab"))


if __name__ == "__main__":
    unittest.main()
