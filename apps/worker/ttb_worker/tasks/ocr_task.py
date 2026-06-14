from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..engines.base import OcrEngine, OcrResult
from ..transport import CoordinatorClient

OCR_CACHE_VERSION = "ocr-v6"


def process_ocr_job(
    job: dict[str, Any],
    client: CoordinatorClient,
    engines: list[OcrEngine],
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    payload = job.get("payload") or {}
    image_bytes = load_job_image(job, client, cache_dir=cache_dir)
    engine = choose_engine(engines, job)
    cached = load_cached_ocr_result(cache_dir, cache_key_for_job(job, engine.id))
    if cached:
        return ocr_result_payload(cached, payload, cached=True)
    result = engine.recognize(image_bytes, {"payload": payload, "job": job})
    save_cached_ocr_result(cache_dir, cache_key_for_job(job, engine.id), result)
    return ocr_result_payload(result, payload, cached=False)


def load_job_image(job: dict[str, Any], client: CoordinatorClient, cache_dir: Path | None = None) -> bytes:
    payload = job.get("payload") or {}
    asset_id = payload.get("asset_id") or payload.get("assetId")
    session_id = job.get("sessionId") or payload.get("session_id") or payload.get("sessionId")
    if asset_id:
        cached_path = asset_cache_path(cache_dir, asset_id) if cache_dir else None
        if cached_path and cached_path.exists():
            return cached_path.read_bytes()
        try:
            image_bytes = client.get_asset_content(asset_id, session_id=session_id)
            if cached_path:
                cached_path.parent.mkdir(parents=True, exist_ok=True)
                cached_path.write_bytes(image_bytes)
            return image_bytes
        except Exception:
            pass
    storage_path = payload.get("storage_path") or payload.get("storagePath")
    if storage_path and Path(storage_path).exists():
        return Path(storage_path).read_bytes()
    return b""


def asset_cache_path(cache_dir: Path | None, asset_id: str) -> Path | None:
    if not cache_dir:
        return None
    safe_asset_id = "".join(character if character.isalnum() or character in "-_" else "_" for character in asset_id)
    return cache_dir / f"{safe_asset_id}.bin"


def cache_key_for_job(job: dict[str, Any], engine_id: str) -> str | None:
    payload = job.get("payload") or {}
    asset_id = payload.get("asset_id") or payload.get("assetId")
    if asset_id:
        return f"{OCR_CACHE_VERSION}-{engine_id}-{asset_id}"
    storage_path = payload.get("storage_path") or payload.get("storagePath")
    if storage_path:
        return f"{OCR_CACHE_VERSION}-{engine_id}-{storage_path}"
    return None


def ocr_result_cache_path(cache_dir: Path | None, cache_key: str | None) -> Path | None:
    if not cache_dir or not cache_key:
        return None
    safe_key = "".join(character if character.isalnum() or character in "-_." else "_" for character in cache_key)
    return cache_dir / "ocr-results" / f"{safe_key}.json"


def load_cached_ocr_result(cache_dir: Path | None, cache_key: str | None) -> OcrResult | None:
    path = ocr_result_cache_path(cache_dir, cache_key)
    if not path or not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return OcrResult(
            engine_id=str(payload.get("engine_id") or payload.get("engineId") or ""),
            text=str(payload.get("text") or ""),
            confidence=float(payload.get("confidence") or 0.0),
            lines=list(payload.get("lines") or []),
            words=list(payload.get("words") or []),
            elapsed_ms=0,
            metadata={**(payload.get("metadata") or {}), "cacheHit": True},
        )
    except Exception:
        return None


def save_cached_ocr_result(cache_dir: Path | None, cache_key: str | None, result: OcrResult) -> None:
    path = ocr_result_cache_path(cache_dir, cache_key)
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "engine_id": result.engine_id,
        "text": result.text,
        "confidence": result.confidence,
        "lines": result.lines,
        "words": result.words,
        "metadata": result.metadata,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def choose_engine(
    engines: list[OcrEngine],
    job: dict[str, Any],
    preferred_engine: str | None = None,
    *,
    allow_null: bool | None = None,
) -> OcrEngine:
    if not engines:
        raise RuntimeError("No OCR engines are configured.")
    available = [engine for engine in engines if engine.healthcheck().available]
    if not available:
        raise RuntimeError("No OCR engines are available.")
    payload = job.get("payload") or {}
    requested = (
        preferred_engine
        or payload.get("engine_id")
        or payload.get("engineId")
        or payload.get("engine")
        or payload.get("primary_engine")
        or payload.get("primaryEngine")
        or "auto"
    )
    requested = str(requested).strip().lower() if requested else "auto"
    if requested and requested != "auto":
        for engine in available:
            if engine.id == requested:
                return engine
        raise RuntimeError(f"Requested OCR engine {requested} is not available.")

    if allow_null is None:
        allow_null = bool(
            payload.get("allow_fixture_engine")
            or payload.get("allowFixtureEngine")
            or payload.get("fixture_ocr_text")
            or payload.get("fixtureOcrText")
        )
    if not allow_null:
        non_null_engines = [engine for engine in available if engine.id != "null"]
        if non_null_engines:
            available = non_null_engines
    preferred_hint = payload.get("preferred_engine") or payload.get("preferredEngine")
    if requested == "auto" and preferred_hint:
        preferred_hint = str(preferred_hint).strip().lower()
        for engine in available:
            if engine.id == preferred_hint:
                return engine
    return sorted(available, key=lambda engine: engine.estimate(job, {}).estimated_ms)[0]


def ocr_result_payload(result: OcrResult, payload: dict[str, Any], *, cached: bool = False) -> dict[str, Any]:
    return {
        "status": "OCR_DONE",
        "engine": result.engine_id,
        "text": result.text,
        "confidence": result.confidence,
        "lines": result.lines,
        "words": result.words,
        "assetId": payload.get("asset_id") or payload.get("assetId"),
        "fieldKey": payload.get("field_key") or payload.get("fieldKey"),
        "fieldLabel": payload.get("field_label") or payload.get("fieldLabel"),
        "fieldExpected": payload.get("field_expected") or payload.get("fieldExpected"),
        "timings": {"ocrMs": result.elapsed_ms, "cacheHit": cached},
        "metadata": {
            **result.metadata,
            "cacheHit": cached or bool(result.metadata.get("cacheHit")),
            "fieldOcr": bool(payload.get("field_ocr") or payload.get("fieldOcr")),
            "fieldCritical": bool(payload.get("field_critical") or payload.get("fieldCritical")),
        },
    }
