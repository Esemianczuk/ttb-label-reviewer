from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any

from ttb_validation import validate_label_packet

from ..engines.base import OcrEngine
from ..transport import CoordinatorClient
from .ocr_task import choose_engine, load_job_image


def process_validation_job(
    job: dict[str, Any],
    client: CoordinatorClient,
    engines: list[OcrEngine],
    worker_id: str,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    started = monotonic()
    payload = job.get("payload") or {}
    expected_fields = payload.get("expected_fields") or payload.get("expectedFields") or {}
    asset_ids = payload.get("asset_ids") or payload.get("assetIds") or []
    engine = choose_engine(engines, job)
    ocr_results = []
    ocr_payloads = []

    if asset_ids:
        for index, asset_id in enumerate(asset_ids):
            asset_job = {
                **job,
                "payload": {
                    **payload,
                    "asset_id": asset_id,
                    "expected_fields": expected_fields,
                },
            }
            image_bytes = load_job_image(asset_job, client, cache_dir=cache_dir)
            result = engine.recognize(image_bytes, {"payload": asset_job["payload"], "job": asset_job})
            ocr_results.append(result)
            ocr_payloads.append(ocr_result_to_validator_payload(result, asset_id=asset_id, image_index=index, worker_id=worker_id))
    else:
        image_bytes = load_job_image(job, client, cache_dir=cache_dir)
        result = engine.recognize(image_bytes, {"payload": payload, "job": job})
        ocr_results.append(result)
        ocr_payloads.append(ocr_result_to_validator_payload(result, asset_id=payload.get("asset_id") or payload.get("assetId"), image_index=0, worker_id=worker_id))

    validation = validate_label_packet(expected_fields, ocr_payloads)
    fields = validation["fields"]
    overall_status = validation["overallStatus"]
    combined_text = validation["combinedOcr"]["rawText"]
    total_ms = max(0, int((monotonic() - started) * 1000))

    review_result = {
        "id": f"review-result-{job['id']}",
        "packetId": job["applicationId"],
        "applicationId": job["applicationId"],
        "mode": "distributed",
        "overallStatus": overall_status,
        "fields": fields,
        "files": file_reviews(job, payload, asset_ids, ocr_results, worker_id),
        "timings": {
            "totalMs": total_ms,
            "ocrMs": sum(result.elapsed_ms for result in ocr_results),
            "validationMs": total_ms,
        },
        "enginesUsed": [{"engineId": engine.id, "displayName": engine.display_name, "timingMs": sum(result.elapsed_ms for result in ocr_results)}],
        "workersUsed": [{"workerId": worker_id, "mode": "distributed"}],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "combinedText": combined_text,
    }
    return {
        "overallStatus": overall_status,
        "review_result": review_result,
    }


def ocr_result_to_validator_payload(result, *, asset_id: str | None, image_index: int, worker_id: str) -> dict[str, Any]:
    def annotate(items: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
        annotated = []
        for item in items:
            if not isinstance(item, dict):
                continue
            annotated.append(
                {
                    **item,
                    "assetId": asset_id or item.get("assetId") or "",
                    "imageId": asset_id or item.get("imageId") or f"image-{image_index}",
                    "engine": result.engine_id,
                    "workerId": worker_id,
                    "kind": kind,
                }
            )
        return annotated

    return {
        "rawText": result.text,
        "blocks": [*annotate(result.lines, "line"), *annotate(result.words, "word")],
        "processingTimeMs": result.elapsed_ms,
        "engine": result.engine_id,
        "assetId": asset_id,
        "imageId": asset_id or f"image-{image_index}",
    }


def file_reviews(job: dict[str, Any], payload: dict[str, Any], asset_ids: list[str], ocr_results: list, worker_id: str) -> list[dict[str, Any]]:
    ids = asset_ids or [payload.get("asset_id") or payload.get("assetId") or ""]
    reviews = []
    for index, result in enumerate(ocr_results):
        asset_id = ids[index] if index < len(ids) else ""
        reviews.append(
            {
                "imageId": asset_id or f"image-{index}",
                "assetId": asset_id,
                "filename": payload.get("filename") or payload.get("original_filename") or f"{asset_id or job['id']}.image",
                "engine": result.engine_id,
                "workerId": worker_id,
                "timingMs": result.elapsed_ms,
                "warnings": list(result.metadata.get("warnings") or []),
            }
        )
    return reviews
