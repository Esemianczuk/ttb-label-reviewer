from __future__ import annotations

import os
import importlib.util
from typing import Iterable

from .base import EngineHealth, OcrEngine
from .null_engine import NullOcrEngine
from .paddleocr_engine import PaddleOcrEngine


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
    if requested != ["auto"] and not available and not explicit_null_only:
        requested_display = ", ".join(requested)
        raise RuntimeError(f"Requested OCR engine(s) are unavailable: {requested_display}")
    production = [engine for engine in available if not _fixture_engine(engine.id)]
    if production:
        return _dedupe(production)
    if explicit_null_only:
        return _dedupe(available or [NullOcrEngine()])
    raise RuntimeError("PaddleOCR is required for backend workers. Use browser fallback only when the backend is unavailable.")


def inspect_engines(selection: str | Iterable[str] = "auto", capabilities: dict | None = None) -> dict:
    requested = _normalize_selection(selection)
    candidates = _engine_candidates(capabilities, include_heavy=True, include_null="null" in requested)
    if requested != ["auto"]:
        candidates = [engine for engine in candidates if engine.id in requested]
    health = {engine.id: _health_to_dict(engine.healthcheck()) for engine in _dedupe(candidates)}
    if any(engine_id != "null" and value.get("available") for engine_id, value in health.items()):
        health.pop("null", None)
    return health


def _normalize_selection(selection: str | Iterable[str]) -> list[str]:
    if isinstance(selection, str):
        values = [value.strip().lower() for value in selection.split(",") if value.strip()]
        return values or ["auto"]
    return [str(value).strip().lower() for value in selection if str(value).strip()] or ["auto"]


def _gpu_requested(capabilities: dict | None) -> bool:
    accelerators = (capabilities or {}).get("accelerators") or {}
    return bool(accelerators.get("cuda", {}).get("available"))


def _engine_candidates(capabilities: dict | None, *, include_heavy: bool, include_null: bool = False) -> list[OcrEngine]:
    candidates: list[OcrEngine] = []
    if include_heavy or _paddleocr_installed() or _paddleocr_custom_configured():
        candidates.append(PaddleOcrEngine(use_gpu=_gpu_requested(capabilities)))
    if include_null:
        candidates.append(NullOcrEngine())
    return candidates


def _heavy_ocr_enabled() -> bool:
    return os.environ.get("TTB_WORKER_ENABLE_HEAVY_OCR", "0") == "1"


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
