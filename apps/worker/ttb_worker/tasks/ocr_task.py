from __future__ import annotations

from pathlib import Path
from typing import Any

from ..engines.base import OcrEngine, OcrResult
from ..transport import CoordinatorClient


def process_ocr_job(
    job: dict[str, Any],
    client: CoordinatorClient,
    engines: list[OcrEngine],
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    payload = job.get("payload") or {}
    image_bytes = load_job_image(job, client, cache_dir=cache_dir)
    engine = choose_engine(engines, job)
    result = engine.recognize(image_bytes, {"payload": payload, "job": job})
    return ocr_result_payload(result, payload)


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


def choose_engine(engines: list[OcrEngine], job: dict[str, Any]) -> OcrEngine:
    if not engines:
        raise RuntimeError("No OCR engines are configured.")
    available = [engine for engine in engines if engine.healthcheck().available]
    if not available:
        raise RuntimeError("No OCR engines are available.")
    return sorted(available, key=lambda engine: engine.estimate(job, {}).estimated_ms)[0]


def ocr_result_payload(result: OcrResult, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "OCR_DONE",
        "engine": result.engine_id,
        "text": result.text,
        "confidence": result.confidence,
        "lines": result.lines,
        "words": result.words,
        "assetId": payload.get("asset_id") or payload.get("assetId"),
        "timings": {"ocrMs": result.elapsed_ms},
        "metadata": result.metadata,
    }
