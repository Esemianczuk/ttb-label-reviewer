from __future__ import annotations

from io import BytesIO
from time import monotonic
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


class PaddleOcrEngine(OcrEngine):
    id = "paddleocr"
    display_name = "PaddleOCR"
    supports_gpu = True
    supports_cpu = True

    def __init__(self, use_gpu: bool = False):
        self.use_gpu = use_gpu
        self._ocr = None

    def warmup(self) -> None:
        if not self.healthcheck().available:
            return None
        self._ocr = self._ocr or self._create_ocr()

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        return EngineEstimate(self.id, 1700 if self.use_gpu else 2800, 0.78, ["optional_engine"])

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        health = self.healthcheck()
        if not health.available:
            raise RuntimeError(health.detail or "PaddleOCR is unavailable.")

        from PIL import Image
        import numpy as np

        started = monotonic()
        ocr = self._ocr or self._create_ocr()
        self._ocr = ocr
        image = np.array(Image.open(BytesIO(image_bytes)))
        raw_results = ocr.ocr(image, cls=True)
        words = []
        text_parts = []
        confidences = []
        for page in raw_results or []:
            for item in page or []:
                bbox, value = item
                text, confidence = value
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
            import paddleocr  # noqa: F401
            import numpy  # noqa: F401
            import PIL  # noqa: F401
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing PaddleOCR dependency: {error}")
        return EngineHealth(self.id, True, "ok", "PaddleOCR dependencies are importable.")

    def _create_ocr(self):
        from paddleocr import PaddleOCR

        return PaddleOCR(use_angle_cls=True, lang="en", use_gpu=self.use_gpu, show_log=False)
