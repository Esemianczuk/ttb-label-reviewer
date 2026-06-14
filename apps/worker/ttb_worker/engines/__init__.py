from __future__ import annotations

import os
import importlib.util
from typing import Iterable

from .base import EngineHealth, OcrEngine
from .easyocr_engine import EasyOcrEngine
from .null_engine import NullOcrEngine
from .onnx_engine import OnnxOcrEngine
from .paddleocr_engine import PaddleOcrEngine
from .tesseract_engine import TesseractEngine


def build_engines(selection: str | Iterable[str] = "auto", capabilities: dict | None = None) -> list[OcrEngine]:
    requested = _normalize_selection(selection)
    explicit_null_only = requested != ["auto"] and set(requested) == {"null"}
    candidates = _engine_candidates(
        capabilities,
        include_heavy=requested != ["auto"] or _heavy_ocr_enabled(),
        include_null=explicit_null_only,
    )
    if requested != ["auto"]:
        candidates = [engine for engine in candidates if engine.id in requested]

    available = [engine for engine in candidates if engine.healthcheck().available]
    production = [engine for engine in available if not _fixture_engine(engine.id)]
    if production:
        return _dedupe(production)
    return _dedupe(available or [NullOcrEngine()])


def inspect_engines(selection: str | Iterable[str] = "auto", capabilities: dict | None = None) -> dict:
    requested = _normalize_selection(selection)
    candidates = _engine_candidates(capabilities, include_heavy=True, include_null="null" in requested)
    if requested != ["auto"]:
        candidates = [engine for engine in candidates if engine.id in requested]
    health = {engine.id: _health_to_dict(engine.healthcheck()) for engine in _dedupe(candidates)}
    production_available = any(engine_id != "null" and value.get("available") for engine_id, value in health.items())
    if production_available:
        health.pop("null", None)
    elif "null" not in health:
        health["null"] = _health_to_dict(NullOcrEngine().healthcheck())
    return health


def _normalize_selection(selection: str | Iterable[str]) -> list[str]:
    if isinstance(selection, str):
        values = [value.strip().lower() for value in selection.split(",") if value.strip()]
        return values or ["auto"]
    return [str(value).strip().lower() for value in selection if str(value).strip()] or ["auto"]


def _gpu_requested(capabilities: dict | None) -> bool:
    accelerators = (capabilities or {}).get("accelerators") or {}
    return bool(accelerators.get("cuda", {}).get("available") or accelerators.get("appleMps", {}).get("available"))


def _accelerator_device(capabilities: dict | None) -> str:
    accelerators = (capabilities or {}).get("accelerators") or {}
    if accelerators.get("cuda", {}).get("available"):
        return "cuda"
    if accelerators.get("appleMps", {}).get("available"):
        return "mps"
    return "cpu"


def _engine_candidates(capabilities: dict | None, *, include_heavy: bool, include_null: bool = False) -> list[OcrEngine]:
    candidates: list[OcrEngine] = [TesseractEngine()]
    if include_heavy or _paddleocr_installed() or _paddleocr_custom_configured():
        candidates.append(PaddleOcrEngine(use_gpu=_gpu_requested(capabilities)))
    if include_heavy or _easyocr_installed():
        candidates.append(EasyOcrEngine(use_gpu=_gpu_requested(capabilities), device=_accelerator_device(capabilities)))
    candidates.append(OnnxOcrEngine())
    if include_null:
        candidates.append(NullOcrEngine())
    return candidates


def _heavy_ocr_enabled() -> bool:
    return os.environ.get("TTB_WORKER_ENABLE_HEAVY_OCR", "0") == "1"


def _easyocr_installed() -> bool:
    return importlib.util.find_spec("easyocr") is not None


def _paddleocr_installed() -> bool:
    return importlib.util.find_spec("paddleocr") is not None


def _paddleocr_custom_configured() -> bool:
    keys = {
        "TTB_PADDLEOCR_MODEL_ROOT",
        "TTB_PADDLEOCR_DET_MODEL_DIR",
        "TTB_PADDLEOCR_REC_MODEL_DIR",
        "TTB_PADDLEOCR_CLS_MODEL_DIR",
        "TTB_PADDLEOCR_REQUIRE_CUSTOM",
    }
    return any(os.environ.get(key) for key in keys)


def _fixture_engine(engine_id: str) -> bool:
    return engine_id in {"null", "null-engine"}


def _health_to_dict(health: EngineHealth) -> dict:
    return {
        "available": health.available,
        "status": health.status,
        "detail": health.detail,
        "version": health.version,
    }


def _dedupe(engines: Iterable[OcrEngine]) -> list[OcrEngine]:
    seen = set()
    deduped = []
    for engine in engines:
        if engine.id in seen:
            continue
        seen.add(engine.id)
        deduped.append(engine)
    return deduped
