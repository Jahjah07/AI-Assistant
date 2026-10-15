from __future__ import annotations

import numpy as np
import onnxruntime as ort


class SileroVad:
    """Stateful Silero VAD v6 ONNX inference, always on the CPU."""

    sample_rate = 16_000
    frame_samples = 512
    context_samples = 64

    def __init__(self, model_path: str):
        options = ort.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        self._session = ort.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.reset()

    def reset(self) -> None:
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, self.context_samples), dtype=np.float32)

    def probability(self, frame: np.ndarray) -> float:
        samples = np.asarray(frame, dtype=np.float32).reshape(-1)
        if samples.size != self.frame_samples:
            raise ValueError(f"Silero requires {self.frame_samples} samples per frame")

        combined = np.concatenate((self._context, samples.reshape(1, -1)), axis=1)
        output, state = self._session.run(
            None,
            {
                "input": combined,
                "state": self._state,
                "sr": np.asarray(self.sample_rate, dtype=np.int64),
            },
        )
        self._state = state
        self._context = combined[:, -self.context_samples :]
        return float(np.asarray(output).reshape(-1)[0])

