import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app import tts_main


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_synthesis_waits_for_previous_request(self):
        semaphore = asyncio.Semaphore(1)
        await semaphore.acquire()
        model = SimpleNamespace(voice="am_michael", name="kokoro", synthesize=AsyncMock(return_value=(b"wave", 12)))
        with patch.object(tts_main, "settings", SimpleNamespace(secret="test", tts_provider="kokoro")), \
             patch.object(tts_main, "tts", model), patch.object(tts_main, "tts_limit", semaphore), \
             patch.object(tts_main, "ensure_loaded", new_callable=AsyncMock):
            task = asyncio.create_task(tts_main.synthesize_speech(tts_main.TtsRequest(text="Updated plan"), "test"))
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            semaphore.release()
            response = await task
            self.assertEqual(response.status_code, 200)
            self.assertFalse(semaphore.locked())
            model.synthesize.assert_awaited_once()

    async def test_concurrent_wake_loads_once(self):
        model = SimpleNamespace(status=SimpleNamespace(state="not_loaded"))

        async def load():
            await asyncio.sleep(0.01)
            model.status.state = "ready"

        model.load = AsyncMock(side_effect=load)
        with patch.object(tts_main, "tts", model), patch.object(tts_main, "load_task", None):
            await asyncio.gather(tts_main.ensure_loaded(), tts_main.ensure_loaded())
            await tts_main.ensure_loaded()
            model.load.assert_awaited_once()

    async def test_unauthenticated_wake_does_not_load(self):
        with patch.object(tts_main, "ensure_loaded", new_callable=AsyncMock) as load:
            with self.assertRaises(tts_main.HTTPException) as error:
                await tts_main.warm("wrong-secret")
            self.assertEqual(error.exception.status_code, 401)
            load.assert_not_awaited()

    async def test_cold_start_stays_unloaded(self):
        with patch.object(tts_main, "settings", SimpleNamespace(tts_provider="kokoro", tts_lazy_load=True)), \
             patch.object(tts_main.tts, "load", new_callable=AsyncMock) as load:
            await tts_main.startup()
            load.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
