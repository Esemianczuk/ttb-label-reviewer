from __future__ import annotations

from typing import Any


def process_evidence_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    expected_fields = payload.get("expected_fields") or payload.get("expectedFields") or {}
    asset_id = payload.get("asset_id") or payload.get("assetId")
    ocr_result = payload.get("ocr_result") or payload.get("ocrResult") or payload.get("result") or {}
    ocr_candidates = extract_ocr_candidates(ocr_result, asset_id)
    evidence = []
    for key, expected in expected_fields.items():
        if expected in (None, ""):
            continue
        candidates = [candidate for candidate in ocr_candidates if expected_matches_candidate(expected, candidate)]
        if not candidates:
            candidates = ocr_candidates[:3]
        evidence.append(
            {
                "fieldKey": key,
                "expected": expected,
                "assetId": asset_id,
                "status": "candidate",
                "confidence": candidates[0]["confidence"] if candidates else 0.75,
                "reason": "OCR line/word evidence preserved for visual review." if candidates else "Field queued for visual evidence review.",
                "candidates": candidates,
            }
        )
    return {
        "status": "EVIDENCE_DONE",
        "assetId": asset_id,
        "evidence": evidence,
        "crops": [],
    }


def extract_ocr_candidates(ocr_result: dict[str, Any], asset_id: str | None) -> list[dict[str, Any]]:
    candidates = []
    for kind in ("lines", "words", "blocks"):
        for item in ocr_result.get(kind) or []:
            if not isinstance(item, dict) or not item.get("text"):
                continue
            candidate = {
                "text": str(item["text"]),
                "method": f"ocr-{kind[:-1] if kind.endswith('s') else kind}",
                "confidence": float(item.get("confidence") if item.get("confidence") is not None else ocr_result.get("confidence") or 0.75),
                "assetId": item.get("assetId") or asset_id,
            }
            bbox = item.get("bbox")
            if isinstance(bbox, dict) and {"x", "y", "width", "height"}.issubset(bbox):
                candidate["bbox"] = {key: float(bbox[key]) for key in ("x", "y", "width", "height")}
            candidates.append(candidate)
    return candidates


def expected_matches_candidate(expected: Any, candidate: dict[str, Any]) -> bool:
    expected_tokens = normalize(expected).split()
    candidate_text = normalize(candidate.get("text") or "")
    if not expected_tokens or not candidate_text:
        return False
    return any(token in candidate_text for token in expected_tokens if len(token) > 2)


def normalize(value: Any) -> str:
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in str(value)).split())
