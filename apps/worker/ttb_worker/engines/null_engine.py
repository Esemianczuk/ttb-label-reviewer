from __future__ import annotations

from time import monotonic
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


class NullOcrEngine(OcrEngine):
    id = "null"
    display_name = "Deterministic Null OCR"
    supports_gpu = False
    supports_cpu = True

    def warmup(self) -> None:
        return None

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        return EngineEstimate(
            engine_id=self.id,
            estimated_ms=1,
            confidence=0.99,
            reason_codes=["deterministic_fixture_engine", "always_available"],
        )

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        started = monotonic()
        payload = (options or {}).get("payload") or {}
        text = (
            payload.get("fixture_ocr_text")
            or payload.get("fixtureOcrText")
            or payload.get("text")
            or _expected_fields_text(payload.get("expected_fields") or payload.get("expectedFields") or {})
        )
        lines = [
            {"text": line, "confidence": 1.0, "source": "fixture"}
            for line in text.splitlines()
            if line.strip()
        ]
        elapsed_ms = max(0, int((monotonic() - started) * 1000))
        return OcrResult(
            engine_id=self.id,
            text=text,
            confidence=1.0,
            lines=lines,
            elapsed_ms=elapsed_ms,
            metadata={"fixture": True, "bytes_seen": len(image_bytes)},
        )

    def healthcheck(self) -> EngineHealth:
        return EngineHealth(engine_id=self.id, available=True, status="ok", detail="Always available for tests and demos.")


def _expected_fields_text(expected_fields: dict[str, Any]) -> str:
    ordered_keys = [
        "productType",
        "brandName",
        "fancifulName",
        "classType",
        "alcoholContent",
        "netContents",
        "producerName",
        "countryOfOrigin",
        "applicationId",
        "labelId",
    ]
    lines = [str(expected_fields[key]) for key in ordered_keys if expected_fields.get(key)]
    if expected_fields.get("governmentWarningRequired"):
        lines.append("GOVERNMENT WARNING")
    return "\n".join(lines) or "NO FIXTURE OCR TEXT SUPPLIED"
