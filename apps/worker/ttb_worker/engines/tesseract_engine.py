from __future__ import annotations

from io import BytesIO
from shutil import which
from time import monotonic
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


class TesseractEngine(OcrEngine):
    id = "tesseract"
    display_name = "Tesseract OCR"
    supports_gpu = False
    supports_cpu = True

    def __init__(self, language: str = "eng"):
        self.language = language

    def warmup(self) -> None:
        if not self.healthcheck().available:
            return None
        return None

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        return EngineEstimate(
            engine_id=self.id,
            estimated_ms=1200,
            confidence=0.82,
            reason_codes=["cpu_baseline", "local_binary"],
        )

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        health = self.healthcheck()
        if not health.available:
            raise RuntimeError(health.detail or "Tesseract is unavailable.")

        import pytesseract
        from PIL import Image
        from pytesseract import Output

        started = monotonic()
        image = Image.open(BytesIO(image_bytes))
        data = pytesseract.image_to_data(image, lang=self.language, output_type=Output.DICT)
        words: list[dict[str, Any]] = []
        text_parts: list[str] = []
        confidences: list[float] = []
        for index, raw_text in enumerate(data.get("text", [])):
            text = str(raw_text).strip()
            if not text:
                continue
            confidence = _parse_confidence(data.get("conf", [None])[index])
            if confidence is not None:
                confidences.append(confidence)
            text_parts.append(text)
            words.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "bbox": {
                        "x": data.get("left", [0])[index],
                        "y": data.get("top", [0])[index],
                        "width": data.get("width", [0])[index],
                        "height": data.get("height", [0])[index],
                    },
                }
            )
        elapsed_ms = max(0, int((monotonic() - started) * 1000))
        confidence = sum(confidences) / len(confidences) if confidences else 0.0
        text = " ".join(text_parts)
        return OcrResult(
            engine_id=self.id,
            text=text,
            confidence=confidence,
            words=words,
            lines=[{"text": text, "confidence": confidence}] if text else [],
            elapsed_ms=elapsed_ms,
            metadata={"language": self.language, "version": health.version},
        )

    def healthcheck(self) -> EngineHealth:
        if which("tesseract") is None:
            return EngineHealth(self.id, False, "unavailable", "The tesseract binary is not on PATH.")
        try:
            import pytesseract
            import PIL  # noqa: F401
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing Python OCR dependency: {error}")
        try:
            version = str(pytesseract.get_tesseract_version())
        except Exception:
            version = None
        return EngineHealth(self.id, True, "ok", "Tesseract is available.", version=version)


def _parse_confidence(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    return max(0.0, min(1.0, parsed / 100.0))
