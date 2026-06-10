from __future__ import annotations

import os
from typing import Iterable

from .base import EngineHealth, OcrEngine
from .easyocr_engine import EasyOcrEngine
from .null_engine import NullOcrEngine
from .onnx_engine import OnnxOcrEngine
from .paddleocr_engine import PaddleOcrEngine
from .tesseract_engine import TesseractEngine


def build_engines(selection: str | Iterable[str] = "auto", capabilities: dict | None = None) -> list[OcrEngine]:
    requested = _normalize_selection(selection)
    candidates = _engine_candidates(capabilities, include_heavy=requested != ["auto"] or _heavy_ocr_enabled())
    if requested != ["auto"]:
        candidates = [engine for engine in candidates if engine.id in requested]
        if "null" not in requested:
            candidates.append(NullOcrEngine())

    available = [engine for engine in candidates if engine.healthcheck().available]
    if not any(engine.id == "null" for engine in available):
        available.append(NullOcrEngine())
    return _dedupe(available)


def inspect_engines(selection: str | Iterable[str] = "auto", capabilities: dict | None = None) -> dict:
    requested = _normalize_selection(selection)
    candidates = _engine_candidates(capabilities, include_heavy=True)
    if requested != ["auto"]:
        candidates = [engine for engine in candidates if engine.id in requested or engine.id == "null"]
    return {engine.id: _health_to_dict(engine.healthcheck()) for engine in _dedupe(candidates)}


def _normalize_selection(selection: str | Iterable[str]) -> list[str]:
    if isinstance(selection, str):
        values = [value.strip().lower() for value in selection.split(",") if value.strip()]
        return values or ["auto"]
    return [str(value).strip().lower() for value in selection if str(value).strip()] or ["auto"]


def _gpu_requested(capabilities: dict | None) -> bool:
    accelerators = (capabilities or {}).get("accelerators") or {}
    return bool(accelerators.get("cuda", {}).get("available") or accelerators.get("appleMps", {}).get("available"))


def _engine_candidates(capabilities: dict | None, *, include_heavy: bool) -> list[OcrEngine]:
    candidates: list[OcrEngine] = [TesseractEngine(), OnnxOcrEngine(), NullOcrEngine()]
    if include_heavy:
        candidates.insert(1, EasyOcrEngine(use_gpu=_gpu_requested(capabilities)))
        candidates.insert(2, PaddleOcrEngine(use_gpu=_gpu_requested(capabilities)))
    return candidates


def _heavy_ocr_enabled() -> bool:
    return os.environ.get("TTB_WORKER_ENABLE_HEAVY_OCR", "0") == "1"


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
