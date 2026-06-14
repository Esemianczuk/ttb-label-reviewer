from __future__ import annotations

import os
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from time import monotonic
from typing import Any

from .base import EngineEstimate, EngineHealth, OcrEngine, OcrResult


@dataclass(frozen=True)
class PaddleModelConfig:
    root: Path | None
    det_model_dir: str | None
    rec_model_dir: str | None
    cls_model_dir: str | None
    require_custom: bool = False

    @property
    def custom(self) -> bool:
        return bool(self.det_model_dir or self.rec_model_dir or self.cls_model_dir)

    @property
    def custom_recognition(self) -> bool:
        return bool(self.rec_model_dir)

    @property
    def kwargs(self) -> dict[str, str]:
        values: dict[str, str] = {}
        if self.det_model_dir:
            values["det_model_dir"] = self.det_model_dir
        if self.rec_model_dir:
            values["rec_model_dir"] = self.rec_model_dir
        if self.cls_model_dir:
            values["cls_model_dir"] = self.cls_model_dir
        return values


class PaddleOcrEngine(OcrEngine):
    id = "paddleocr"
    display_name = "PaddleOCR COLA"
    supports_gpu = True
    supports_cpu = True

    def __init__(self, use_gpu: bool = False, model_config: PaddleModelConfig | None = None):
        self.use_gpu = use_gpu
        self.model_config = model_config or resolve_model_config()
        self._ocr = None

    def warmup(self) -> None:
        if not self.healthcheck().available:
            return None
        self._ocr = self._ocr or self._create_ocr()

    def estimate(self, task: dict[str, Any], capabilities: dict[str, Any]) -> EngineEstimate:
        estimated_ms = 1200 if self.use_gpu else 2300
        confidence = 0.94 if self.model_config.custom_recognition else 0.88
        reason_codes = ["authoritative_backend", "angle_classifier"]
        if self.model_config.custom:
            reason_codes.append("custom_cola_model")
        else:
            reason_codes.append("pretrained_baseline")
        if self.use_gpu:
            reason_codes.append("accelerated")
        return EngineEstimate(self.id, estimated_ms, confidence, reason_codes)

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
                words.append({"text": clean, "confidence": confidence, "bbox": polygon_to_rect(bbox)})
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
            metadata={
                "gpu": self.use_gpu,
                "customModel": self.model_config.custom,
                "customRecognition": self.model_config.custom_recognition,
                "modelRoot": str(self.model_config.root) if self.model_config.root else None,
                "modelDirs": self.model_config.kwargs,
            },
        )

    def healthcheck(self) -> EngineHealth:
        try:
            import paddleocr  # noqa: F401
            import numpy  # noqa: F401
            import PIL  # noqa: F401
        except Exception as error:
            return EngineHealth(self.id, False, "unavailable", f"Missing PaddleOCR dependency: {error}")
        if self.model_config.require_custom and not self.model_config.custom_recognition:
            return EngineHealth(
                self.id,
                False,
                "unavailable",
                "TTB_PADDLEOCR_REQUIRE_CUSTOM=1 but no exported custom recognition model was found.",
            )
        model_note = (
            f"custom COLA model dirs: {', '.join(self.model_config.kwargs)}"
            if self.model_config.custom
            else "pretrained PaddleOCR baseline; custom model dirs not configured"
        )
        return EngineHealth(self.id, True, "ok", f"PaddleOCR dependencies are importable; using {model_note}.")

    def _create_ocr(self):
        from paddleocr import PaddleOCR

        kwargs: dict[str, Any] = {
            "use_angle_cls": True,
            "lang": "en",
            "use_gpu": self.use_gpu,
            "show_log": False,
            **self.model_config.kwargs,
        }
        try:
            return PaddleOCR(**kwargs)
        except TypeError:
            kwargs.pop("show_log", None)
            try:
                return PaddleOCR(**kwargs)
            except TypeError:
                kwargs.pop("use_gpu", None)
                return PaddleOCR(**kwargs)


def resolve_model_config() -> PaddleModelConfig:
    root_value = os.environ.get("TTB_PADDLEOCR_MODEL_ROOT")
    default_root = Path(__file__).resolve().parents[4] / "models" / "ocr" / "paddle-cola" / "current"
    root = Path(root_value).expanduser().resolve() if root_value else default_root
    require_custom = os.environ.get("TTB_PADDLEOCR_REQUIRE_CUSTOM", "0") == "1"
    return PaddleModelConfig(
        root=root,
        det_model_dir=_model_dir("TTB_PADDLEOCR_DET_MODEL_DIR", root / "det"),
        rec_model_dir=_model_dir("TTB_PADDLEOCR_REC_MODEL_DIR", root / "rec"),
        cls_model_dir=_model_dir("TTB_PADDLEOCR_CLS_MODEL_DIR", root / "cls"),
        require_custom=require_custom,
    )


def _model_dir(env_key: str, default_path: Path) -> str | None:
    raw = os.environ.get(env_key)
    candidate = Path(raw).expanduser().resolve() if raw else default_path
    return str(candidate) if candidate.exists() and candidate.is_dir() else None


def polygon_to_rect(bbox: Any) -> dict[str, float] | None:
    points: list[tuple[float, float]] = []
    if isinstance(bbox, (list, tuple)):
        for point in bbox:
            if isinstance(point, dict) and {"x", "y"}.issubset(point):
                points.append((float(point["x"]), float(point["y"])))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append((float(point[0]), float(point[1])))
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = min(xs)
    top = min(ys)
    return {"x": left, "y": top, "width": max(xs) - left, "height": max(ys) - top}
