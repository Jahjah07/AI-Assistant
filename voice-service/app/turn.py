from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class TurnEvent:
    kind: str
    audio: np.ndarray | None = None
    reason: str | None = None


class TurnDetector:
    sample_rate = 16_000
    frame_samples = 512
    frame_ms = frame_samples * 1000 / sample_rate

    def __init__(
        self,
        vad,
        *,
        threshold: float = 0.5,
        negative_threshold: float = 0.35,
        pre_roll_ms: int = 300,
        endpoint_silence_ms: int = 2000,
        minimum_speech_ms: int = 170,
        maximum_turn_ms: int = 15_000,
    ):
        self.vad = vad
        self.threshold = threshold
        self.negative_threshold = min(negative_threshold, threshold)
        self.pre_roll_samples = int(pre_roll_ms * self.sample_rate / 1000)
        self.endpoint_silence_ms = endpoint_silence_ms
        self.minimum_speech_ms = minimum_speech_ms
        self.maximum_turn_samples = int(maximum_turn_ms * self.sample_rate / 1000)
        self._pre_roll: deque[np.ndarray] = deque()
        self._pre_roll_count = 0
        self._active = False
        self._positive_ms = 0.0
        self._silence_ms = 0.0
        self._turn: list[np.ndarray] = []
        self.last_probability = 0.0

    @property
    def active(self) -> bool:
        return self._active

    def reset(self) -> None:
        self.vad.reset()
        self._pre_roll.clear()
        self._pre_roll_count = 0
        self._active = False
        self._positive_ms = 0.0
        self._silence_ms = 0.0
        self._turn = []

    def _remember_pre_roll(self, frame: np.ndarray) -> None:
        self._pre_roll.append(frame.copy())
        self._pre_roll_count += frame.size
        while self._pre_roll_count - self._pre_roll[0].size >= self.pre_roll_samples:
            self._pre_roll_count -= self._pre_roll.popleft().size

    def _exact_pre_roll(self) -> np.ndarray:
        joined = np.concatenate(tuple(self._pre_roll))
        return joined[-self.pre_roll_samples :]

    def accept(self, frame: np.ndarray) -> list[TurnEvent]:
        samples = np.asarray(frame, dtype=np.float32).reshape(-1)
        probability = self.vad.probability(samples)
        self.last_probability = probability
        events: list[TurnEvent] = []

        if not self._active:
            self._remember_pre_roll(samples)
            if probability >= self.threshold:
                self._positive_ms += self.frame_ms
            else:
                self._positive_ms = 0.0

            if self._positive_ms >= self.minimum_speech_ms:
                self._active = True
                pre_roll = self._exact_pre_roll()
                self._turn = [pre_roll]
                self._silence_ms = 0.0
                events.append(TurnEvent("speech_start", audio=pre_roll.copy()))
            return events

        self._turn.append(samples.copy())
        if probability < self.negative_threshold:
            self._silence_ms += self.frame_ms
        else:
            self._silence_ms = 0.0

        turn_samples = sum(part.size for part in self._turn)
        endpoint = self._silence_ms >= self.endpoint_silence_ms
        maximum = turn_samples >= self.maximum_turn_samples
        if endpoint or maximum:
            audio = np.concatenate(self._turn)
            reason = "endpoint_silence" if endpoint else "maximum_duration"
            events.append(TurnEvent("speech_end", audio=audio, reason=reason))
            self.reset()
        return events
