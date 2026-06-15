from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from apps.api.app.validation import validate_label_packet
from ttb_worker.engines.null_engine import NullOcrEngine
from ttb_worker.tasks.evidence_task import process_evidence_job
from ttb_worker.tasks.validation_task import process_validation_job


REPO_ROOT = Path(__file__).resolve().parents[4]
GOLDEN_DIR = REPO_ROOT / "packages/shared/validation-golden"


def load_golden_fixtures() -> list[dict[str, Any]]:
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted(GOLDEN_DIR.glob("*.json"))]


def field_statuses(review: dict[str, Any]) -> dict[str, str]:
    return {field["fieldKey"]: field["status"] for field in review["fields"]}


def test_python_validators_match_shared_golden_fixtures():
    for fixture in load_golden_fixtures():
        review = validate_label_packet(fixture["expectedFields"], [{"rawText": fixture["ocrText"], "blocks": []}])
        assert review["overallStatus"] == fixture["expectedOverallStatus"], fixture["id"]
        statuses = field_statuses(review)
        for field_key, status in fixture["expectedStatuses"].items():
            assert statuses[field_key] == status, f"{fixture['id']} {field_key}"


def test_worker_validation_output_uses_shared_review_schema_shape():
    fixture = next(fixture for fixture in load_golden_fixtures() if fixture["id"] == "abv_proof_equivalence")
    job = {
        "id": "validation-job-1",
        "applicationId": "application-1",
        "payload": {
            "expected_fields": fixture["expectedFields"],
            "fixture_ocr_text": fixture["ocrText"],
            "asset_id": "asset-1",
            "filename": "front.png",
        },
    }
    result = process_validation_job(job, _NoopClient(), [NullOcrEngine()], "worker-golden")
    review = result["review_result"]

    assert result["overallStatus"] == "PASS"
    assert review["applicationId"] == "application-1"
    assert review["packetId"] == "application-1"
    assert review["fields"][2]["fieldKey"] == "alcoholContent"
    assert field_statuses(review)["alcoholContent"] == "PASS"
    assert review["enginesUsed"] == [{"engineId": "null", "displayName": "Deterministic Null OCR", "timingMs": 0}]
    assert review["workersUsed"] == [{"workerId": "worker-golden", "mode": "backend"}]
    assert review["files"][0]["assetId"] == "asset-1"


def test_evidence_task_preserves_ocr_line_word_bbox_candidates():
    result = process_evidence_job(
        {
            "payload": {
                "asset_id": "asset-1",
                "expected_fields": {"brandName": "Hollow Ridge"},
                "ocr_result": {
                    "confidence": 0.88,
                    "lines": [
                        {
                            "text": "HOLLOW RIDGE",
                            "confidence": 0.92,
                            "bbox": {"x": 10, "y": 20, "width": 140, "height": 30},
                        }
                    ],
                    "words": [{"text": "RIDGE", "confidence": 0.9}],
                },
            }
        }
    )

    candidates = result["evidence"][0]["candidates"]
    assert candidates[0]["text"] == "HOLLOW RIDGE"
    assert candidates[0]["bbox"] == {"x": 10.0, "y": 20.0, "width": 140.0, "height": 30.0}
    assert candidates[0]["assetId"] == "asset-1"


def test_evidence_task_normalizes_legacy_bbox_shape():
    result = process_evidence_job(
        {
            "payload": {
                "asset_id": "asset-1",
                "expected_fields": {"brandName": "Devils Backbone"},
                "ocr_result": {
                    "confidence": 0.88,
                    "lines": [
                        {
                            "text": "DEVILS BACKBONE",
                            "confidence": 0.92,
                            "bbox": {"x": 504, "y": 632, "w": 257, "h": 45},
                        }
                    ],
                },
            }
        }
    )

    candidates = result["evidence"][0]["candidates"]
    assert candidates[0]["bbox"] == {"x": 504.0, "y": 632.0, "width": 257.0, "height": 45.0}


class _NoopClient:
    def get_asset_content(self, asset_id: str, session_id: str | None = None) -> bytes:
        return b""
