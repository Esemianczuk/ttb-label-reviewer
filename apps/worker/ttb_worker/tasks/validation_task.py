from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any

from ttb_validation import validate_label_packet
from ttb_validation.field_entities import attach_weak_field_entities

from ..engines.base import OcrEngine, OcrResult
from ..transport import CoordinatorClient
from .ocr_task import choose_engine, load_job_image

REVIEW_HARD_STATUSES = {"FAIL", "NEEDS_REVIEW", "NOT_FOUND", "WARNING"}
REVIEW_LOW_CONFIDENCE_THRESHOLD = 0.86
DEFAULT_TARGET_LATENCY_MS = 5000


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
    asset_jobs = validation_asset_jobs(job, payload, expected_fields, asset_ids)
    primary_engine = choose_primary_validation_engine(engines, job)
    completed_results = completed_ocr_results_from_payload(payload)
    primary_results = completed_results
    if not completed_results:
        primary_results = recognize_asset_jobs(primary_engine, asset_jobs, client, cache_dir=cache_dir)
    primary_candidate = build_validation_candidate(
        "backend-field-ocr" if completed_results else "primary",
        expected_fields,
        primary_results,
        asset_jobs=asset_jobs,
        worker_id=worker_id,
        policy=hard_field_policy(),
    )
    selected = primary_candidate
    validation = selected["validation"]
    ocr_results = selected["results"]
    fields = validation["fields"]
    overall_status = validation["overallStatus"]
    combined_text = validation["combinedOcr"]["rawText"]
    total_ms = max(0, int((monotonic() - started) * 1000))
    engine_usage = summarize_engine_usage(ocr_results)
    escalation_summary = escalation_metadata(primary_candidate, selected, payload)

    review_result = {
        "id": f"review-result-{job['id']}",
        "packetId": job["applicationId"],
        "applicationId": job["applicationId"],
        "mode": "backend",
        "overallStatus": overall_status,
        "fields": fields,
        "files": file_reviews(job, payload, asset_ids, ocr_results, worker_id),
        "timings": {
            "totalMs": total_ms,
            "ocrMs": sum(result.elapsed_ms for result in ocr_results),
            "validationMs": total_ms,
        },
        "enginesUsed": engine_usage,
        "workersUsed": [{"workerId": worker_id, "mode": "backend"}],
        "fieldExtractor": selected.get("fieldExtractor"),
        "escalation": escalation_summary,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "combinedText": combined_text,
    }
    return {
        "overallStatus": overall_status,
        "review_result": review_result,
    }


def validation_asset_jobs(job: dict[str, Any], payload: dict[str, Any], expected_fields: dict[str, Any], asset_ids: list[str]) -> list[dict[str, Any]]:
    if asset_ids:
        return [
            {
                **job,
                "payload": {
                    **payload,
                    "asset_id": asset_id,
                    "expected_fields": expected_fields,
                },
                "_image_index": index,
            }
            for index, asset_id in enumerate(asset_ids)
        ]
    return [{**job, "_image_index": 0}]


def choose_primary_validation_engine(engines: list[OcrEngine], job: dict[str, Any]) -> OcrEngine:
    payload = job.get("payload") or {}
    preferred = payload.get("primary_engine") or payload.get("primaryEngine") or "paddleocr"
    try:
        return choose_engine(engines, job, preferred_engine=str(preferred), allow_null=False)
    except RuntimeError:
        return choose_engine(engines, job, preferred_engine="auto", allow_null=None)


def recognize_asset_jobs(
    engine: OcrEngine,
    asset_jobs: list[dict[str, Any]],
    client: CoordinatorClient,
    *,
    cache_dir: Path | None,
) -> list[OcrResult]:
    results: list[OcrResult] = []
    for asset_job in asset_jobs:
        image_bytes = load_job_image(asset_job, client, cache_dir=cache_dir)
        results.append(engine.recognize(image_bytes, {"payload": asset_job.get("payload") or {}, "job": asset_job}))
    return results


def completed_ocr_results_from_payload(payload: dict[str, Any]) -> list[OcrResult]:
    entries = payload.get("completed_ocr_results") or payload.get("completedOcrResults") or []
    results: list[OcrResult] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        raw_result = entry.get("result") if isinstance(entry.get("result"), dict) else entry
        text = str(raw_result.get("text") or raw_result.get("rawText") or "")
        lines = normalize_ocr_items(raw_result.get("lines"), default_text=text)
        words = normalize_ocr_items(raw_result.get("words"))
        timings = raw_result.get("timings") if isinstance(raw_result.get("timings"), dict) else {}
        elapsed_ms = int(timings.get("ocrMs") or raw_result.get("elapsedMs") or raw_result.get("processingTimeMs") or 0)
        confidence = float_or_default(raw_result.get("confidence"), 0.0)
        results.append(
            OcrResult(
                engine_id=str(raw_result.get("engine") or entry.get("engine") or "backend"),
                text=text,
                confidence=confidence,
                lines=lines,
                words=words,
                elapsed_ms=elapsed_ms,
                metadata={
                    **(raw_result.get("metadata") if isinstance(raw_result.get("metadata"), dict) else {}),
                    "assetId": entry.get("assetId") or raw_result.get("assetId"),
                    "fieldKey": entry.get("fieldKey"),
                    "fieldLabel": entry.get("fieldLabel"),
                    "workerId": entry.get("workerId"),
                    "backendOcr": True,
                    "backendOcrIndex": index,
                },
            )
        )
    return results


def normalize_ocr_items(items: Any, *, default_text: str = "") -> list[dict[str, Any]]:
    if isinstance(items, list):
        normalized = [item for item in items if isinstance(item, dict)]
        if normalized:
            return normalized
    return [{"text": default_text, "confidence": 0.0}] if default_text else []


def float_or_default(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_validation_candidate(
    label: str,
    expected_fields: dict[str, Any],
    results: list[OcrResult],
    *,
    asset_jobs: list[dict[str, Any]],
    worker_id: str,
    policy: dict[str, Any],
) -> dict[str, Any]:
    ocr_payloads = []
    for index, result in enumerate(results):
        asset_job = asset_jobs[index % len(asset_jobs)] if asset_jobs else {"payload": {}, "_image_index": index}
        asset_payload = asset_job.get("payload") or {}
        asset_id = (
            result.metadata.get("assetId")
            or asset_payload.get("asset_id")
            or asset_payload.get("assetId")
            or ""
        )
        ocr_payloads.append(
            ocr_result_to_validator_payload(
                result,
                asset_id=asset_id,
                image_index=int(asset_job.get("_image_index") or index),
                worker_id=worker_id,
            )
        )
    ocr_payloads = attach_field_extractor_entities(expected_fields, ocr_payloads, payload_label=label)
    validation = validate_label_packet(expected_fields, ocr_payloads)
    hard = hard_validation_fields(validation["fields"], policy=policy)
    return {
        "label": label,
        "validation": validation,
        "results": results,
        "hardFields": hard,
        "hardFieldCount": len(hard),
        "averageConfidence": average_field_confidence(validation["fields"]),
        "fieldExtractor": field_extractor_summary(ocr_payloads),
    }


def hard_field_policy() -> dict[str, Any]:
    return {"hard_statuses": REVIEW_HARD_STATUSES, "min_confidence": REVIEW_LOW_CONFIDENCE_THRESHOLD}


def hard_validation_fields(fields: list[dict[str, Any]], *, policy: dict[str, Any]) -> list[dict[str, Any]]:
    hard_statuses = policy["hard_statuses"]
    min_confidence = float(policy["min_confidence"])
    hard: list[dict[str, Any]] = []
    for field in fields:
        status = str(field.get("status") or "").upper()
        confidence = field.get("confidence")
        try:
            confidence_value = float(confidence)
        except (TypeError, ValueError):
            confidence_value = 1.0
        if status in hard_statuses or confidence_value < min_confidence:
            hard.append(field)
    return hard


def average_field_confidence(fields: list[dict[str, Any]]) -> float:
    confidences = []
    for field in fields:
        try:
            confidences.append(float(field.get("confidence")))
        except (TypeError, ValueError):
            continue
    return sum(confidences) / len(confidences) if confidences else 0.0


def validation_candidate_sort_key(candidate: dict[str, Any]) -> tuple[int, int, float]:
    status_penalty = 0 if str(candidate["validation"].get("overallStatus", "")).upper() == "PASS" else 1
    return (candidate["hardFieldCount"], status_penalty, -candidate["averageConfidence"])


def summarize_engine_usage(results: list[OcrResult]) -> list[dict[str, Any]]:
    by_engine: dict[str, dict[str, Any]] = {}
    for result in results:
        entry = by_engine.setdefault(
            result.engine_id,
            {
                "engineId": result.engine_id,
                "displayName": engine_display_name(result.engine_id),
                "timingMs": 0,
            },
        )
        entry["timingMs"] += result.elapsed_ms
    return list(by_engine.values())


def engine_display_name(engine_id: str) -> str:
    return {
        "null": "Deterministic Null OCR",
        "paddleocr": "PaddleOCR COLA",
    }.get(engine_id, engine_id)


def escalation_metadata(primary_candidate: dict[str, Any], selected: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "strategy": payload.get("ocr_strategy") or payload.get("ocrStrategy") or "paddleocr_authoritative",
        "targetLatencyMs": int(payload.get("target_latency_ms") or payload.get("targetLatencyMs") or DEFAULT_TARGET_LATENCY_MS),
        "attempted": False,
        "selected": selected["label"],
        "primaryHardFieldCount": primary_candidate["hardFieldCount"],
        "selectedHardFieldCount": selected["hardFieldCount"],
        "hardFields": [field.get("field") for field in selected["hardFields"]],
    }


def ocr_result_to_validator_payload(result: OcrResult, *, asset_id: str | None, image_index: int, worker_id: str) -> dict[str, Any]:
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
        "metadata": result.metadata,
    }


def attach_field_extractor_entities(expected_fields: dict[str, Any], ocr_payloads: list[dict[str, Any]], *, payload_label: str) -> list[dict[str, Any]]:
    if not expected_fields:
        return ocr_payloads
    return attach_weak_field_entities(expected_fields, ocr_payloads, source=f"paddleocr-weak-field-alignment:{payload_label}")


def field_extractor_summary(ocr_payloads: list[dict[str, Any]]) -> dict[str, Any]:
    entities = [entity for payload in ocr_payloads for entity in payload.get("fieldEntities") or [] if isinstance(entity, dict)]
    by_field: dict[str, int] = {}
    for entity in entities:
        key = str(entity.get("fieldKey") or "")
        if key:
            by_field[key] = by_field.get(key, 0) + 1
    methods = sorted({str(entity.get("method") or "") for entity in entities if entity.get("method")})
    return {
        "name": "PaddleOCR field extraction",
        "entityCount": len(entities),
        "byField": dict(sorted(by_field.items())),
        "methods": methods,
        "trainedModelActive": False,
        "note": "PaddleOCR reads the full image; conservative field alignment labels OCR tokens as evidence. Deterministic validators still decide pass/fail.",
    }


def file_reviews(job: dict[str, Any], payload: dict[str, Any], asset_ids: list[str], ocr_results: list, worker_id: str) -> list[dict[str, Any]]:
    ids = asset_ids or [payload.get("asset_id") or payload.get("assetId") or ""]
    reviews = []
    for index, result in enumerate(ocr_results):
        asset_id = ids[index % len(ids)] if ids else ""
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
