from __future__ import annotations

import os
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


class OnnxOcrEngine(OcrEngine):
    id = "onnx"
    display_name = "ONNX OCR Local Model"
    supports_gpu = True
    supports_cpu = True

    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or os.environ.get("TTB_WORKER_ONNX_MODEL")

    def warmup(self) -> None:
        return None

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        return EngineEstimate(self.id, 9999, 0.0, ["local_model_required"])

    def recognize(self, image_bytes: bytes, options: dict[str, Any] | None = None) -> OcrResult:
        raise RuntimeError("ONNX OCR requires a configured local model; none is bundled with the prototype.")

    def healthcheck(self) -> EngineHealth:
        try:
            import onnxruntime as ort
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing ONNX Runtime dependency: {error}")
        providers = ", ".join(ort.get_available_providers())
        if not self.model_path:
            return EngineHealth(self.id, False, "unconfigured", f"ONNX Runtime is available ({providers}) but no model is configured.")
        if not os.path.exists(self.model_path):
            return EngineHealth(self.id, False, "unavailable", f"Configured ONNX model does not exist: {self.model_path}")
        return EngineHealth(self.id, True, "ok", f"ONNX Runtime providers: {providers}")
