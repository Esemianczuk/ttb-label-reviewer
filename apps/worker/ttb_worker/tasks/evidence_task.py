from __future__ import annotations

from typing import Any


def process_evidence_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    expected_fields = payload.get("expected_fields") or payload.get("expectedFields") or {}
    asset_id = payload.get("asset_id") or payload.get("assetId")
    evidence = []
    for key, expected in expected_fields.items():
        if expected in (None, ""):
            continue
        evidence.append(
            {
                "fieldKey": key,
                "expected": expected,
                "assetId": asset_id,
                "status": "candidate",
                "confidence": 0.75,
                "reason": "Field queued for visual evidence review.",
            }
        )
    return {
        "status": "EVIDENCE_DONE",
        "assetId": asset_id,
        "evidence": evidence,
        "crops": [],
    }
