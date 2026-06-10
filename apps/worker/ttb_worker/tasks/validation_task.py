from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any

from ..engines.base import OcrEngine
from ..transport import CoordinatorClient
from .ocr_task import choose_engine, load_job_image


CRITICAL_FIELDS = {"brandName", "classType", "alcoholContent", "netContents", "governmentWarningRequired"}


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

    if asset_ids:
        for asset_id in asset_ids:
            asset_job = {
                **job,
                "payload": {
                    **payload,
                    "asset_id": asset_id,
                    "expected_fields": expected_fields,
                },
            }
            image_bytes = load_job_image(asset_job, client, cache_dir=cache_dir)
            ocr_results.append(engine.recognize(image_bytes, {"payload": asset_job["payload"], "job": asset_job}))
    else:
        image_bytes = load_job_image(job, client, cache_dir=cache_dir)
        ocr_results.append(engine.recognize(image_bytes, {"payload": payload, "job": job}))

    combined_text = "\n".join(result.text for result in ocr_results if result.text)
    fields = [_review_field(key, expected, combined_text, ocr_results) for key, expected in expected_fields.items()]
    critical_failures = [field for field in fields if field["severity"] == "critical" and field["status"] != "PASS"]
    warning_failures = [field for field in fields if field["severity"] == "warning" and field["status"] != "PASS"]
    overall_status = "PASS" if not critical_failures and not warning_failures else "FAIL" if critical_failures else "PASS_WITH_WARNINGS"
    total_ms = max(0, int((monotonic() - started) * 1000))

    review_result = {
        "id": f"review-result-{job['id']}",
        "packetId": job["applicationId"],
        "mode": "distributed",
        "overallStatus": overall_status,
        "fields": fields,
        "files": [
            {
                "assetIds": asset_ids,
                "status": "PROCESSED",
                "engine": engine.id,
                "confidence": _average([result.confidence for result in ocr_results]),
            }
        ],
        "timings": {
            "totalMs": total_ms,
            "ocrMs": sum(result.elapsed_ms for result in ocr_results),
            "validationMs": total_ms,
        },
        "enginesUsed": [{"id": engine.id, "displayName": engine.display_name}],
        "workersUsed": [{"id": worker_id}],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "combinedText": combined_text,
    }
    return {
        "overallStatus": overall_status,
        "review_result": review_result,
    }


def _review_field(key: str, expected: Any, combined_text: str, ocr_results: list) -> dict[str, Any]:
    field_name = _field_label(key)
    severity = "critical" if key in CRITICAL_FIELDS else "warning"
    if expected in (None, ""):
        return {
            "fieldKey": key,
            "field": field_name,
            "expected": "",
            "extracted": None,
            "status": "NOT_APPLICABLE",
            "severity": "info",
            "confidence": 1.0,
            "reason": "No expected value was supplied for this optional field.",
            "evidence": [],
        }

    expected_text = _expected_to_text(key, expected)
    match = _contains_expected(combined_text, expected_text)
    status = "PASS" if match else "NOT_FOUND"
    confidence = _average([result.confidence for result in ocr_results]) if match else 0.0
    return {
        "fieldKey": key,
        "field": field_name,
        "expected": expected_text,
        "extracted": expected_text if match else None,
        "status": status,
        "severity": severity,
        "confidence": confidence,
        "reason": "Expected application value was found in OCR evidence." if match else "Expected application value was not found in OCR evidence.",
        "evidence": _evidence_for(expected_text, combined_text, confidence) if match else [],
        "agentStatus": "auto_reviewed",
    }


def _field_label(key: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", r" \1", key).replace("_", " ").title()


def _expected_to_text(key: str, expected: Any) -> str:
    if isinstance(expected, bool):
        if key == "governmentWarningRequired":
            return "GOVERNMENT WARNING" if expected else "No government warning required"
        return "true" if expected else "false"
    return str(expected)


def _contains_expected(combined_text: str, expected: str) -> bool:
    normalized_text = _normalize(combined_text)
    normalized_expected = _normalize(expected)
    if not normalized_expected:
        return True
    if normalized_expected in normalized_text:
        return True
    expected_tokens = [token for token in normalized_expected.split() if len(token) > 1]
    return bool(expected_tokens) and all(token in normalized_text for token in expected_tokens)


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _evidence_for(expected: str, combined_text: str, confidence: float) -> list[dict[str, Any]]:
    return [
        {
            "text": expected,
            "context": _snippet(combined_text, expected),
            "confidence": confidence,
            "source": "worker_ocr",
        }
    ]


def _snippet(text: str, expected: str) -> str:
    normalized_index = text.lower().find(expected.lower())
    if normalized_index < 0:
        return text[:160]
    start = max(0, normalized_index - 60)
    end = min(len(text), normalized_index + len(expected) + 60)
    return text[start:end]


def _average(values: list[float]) -> float:
    clean = [value for value in values if value is not None]
    return sum(clean) / len(clean) if clean else 0.0
