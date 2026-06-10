from __future__ import annotations

from io import BytesIO
from time import monotonic
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


class EasyOcrEngine(OcrEngine):
    id = "easyocr"
    display_name = "EasyOCR"
    supports_gpu = True
    supports_cpu = True

    def __init__(self, use_gpu: bool = False):
        self.use_gpu = use_gpu
        self._reader = None

    def warmup(self) -> None:
        if not self.healthcheck().available:
            return None
        self._reader = self._reader or self._create_reader()

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        reason_codes = ["optional_engine"]
        if self.use_gpu:
            reason_codes.append("gpu_requested")
        return EngineEstimate(self.id, 1800 if self.use_gpu else 2600, 0.78, reason_codes)

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        health = self.healthcheck()
        if not health.available:
            raise RuntimeError(health.detail or "EasyOCR is unavailable.")

        from PIL import Image
        import numpy as np

        started = monotonic()
        reader = self._reader or self._create_reader()
        self._reader = reader
        image = np.array(Image.open(BytesIO(image_bytes)))
        raw_results = reader.readtext(image)
        words = []
        text_parts = []
        confidences = []
        for bbox, text, confidence in raw_results:
            clean = str(text).strip()
            if not clean:
                continue
            confidence = float(confidence)
            confidences.append(confidence)
            text_parts.append(clean)
            words.append({"text": clean, "confidence": confidence, "bbox": bbox})
        elapsed_ms = max(0, int((monotonic() - started) * 1000))
        confidence = sum(confidences) / len(confidences) if confidences else 0.0
        joined = " ".join(text_parts)
        return OcrResult(
            engine_id=self.id,
            text=joined,
            confidence=confidence,
            words=words,
            lines=[{"text": joined, "confidence": confidence}] if joined else [],
            elapsed_ms=elapsed_ms,
            metadata={"gpu": self.use_gpu},
        )

    def healthcheck(self) -> EngineHealth:
        try:
            import easyocr  # noqa: F401
            import numpy  # noqa: F401
            import PIL  # noqa: F401
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing EasyOCR dependency: {error}")
        return EngineHealth(self.id, True, "ok", "EasyOCR dependencies are importable.")

    def _create_reader(self):
        import easyocr

        return easyocr.Reader(["en"], gpu=self.use_gpu, verbose=False)
