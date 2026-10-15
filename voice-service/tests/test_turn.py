import unittest

import numpy as np

from app.turn import TurnDetector


class FakeVad:
    def __init__(self, probabilities):
        self.probabilities = iter(probabilities)

    def probability(self, _frame):
        return next(self.probabilities)

    def reset(self):
        pass


class TurnDetectorTests(unittest.TestCase):
    def test_pause_between_phrases_does_not_finish_turn(self):
        detector = TurnDetector(FakeVad([0.8] * 6 + [0.1] * 46 + [0.8] * 6 + [0.1] * 63))
        frame = np.zeros(512, dtype=np.float32)
        events = []
        # Pause for 1.47 seconds, resume speaking, then stop for 2.02 seconds.
        for _ in range(6 + 46 + 6 + 62):
            events.extend(detector.accept(frame))
        self.assertEqual([event.kind for event in events], ["speech_start"])
        self.assertTrue(detector.active)
        end = detector.accept(frame)
        self.assertEqual([event.kind for event in end], ["speech_end"])
        self.assertEqual(end[0].reason, "endpoint_silence")
        self.assertFalse(detector.active)

    def test_emits_one_turn_with_exact_pre_roll(self):
        probabilities = [0.1] * 12 + [0.8] * 6 + [0.8] * 4 + [0.1] * 21
        detector = TurnDetector(
            FakeVad(probabilities), pre_roll_ms=300, minimum_speech_ms=170, endpoint_silence_ms=640
        )
        events = []
        for _ in probabilities:
            events.extend(detector.accept(np.zeros(512, dtype=np.float32)))

        self.assertEqual([event.kind for event in events], ["speech_start", "speech_end"])
        self.assertIsNotNone(events[-1].audio)
        self.assertGreaterEqual(events[-1].audio.size, 4_800)


if __name__ == "__main__":
    unittest.main()
