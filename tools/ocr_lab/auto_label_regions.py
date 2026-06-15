#!/usr/bin/env python3
"""Create conservative weak labels for candidate OCR crops.

The output is still review material, not production training truth. Rows are
marked under `weakLabel`; `export_paddleocr_manifests.py --accept-weak` can use
only those explicit weak labels for experiments.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space


NON_ALNUM = re.compile(r"[^A-Z0-9]+")


def load_record_targets(manifest_path: Path) -> dict[str, dict[str, str]]:
    targets: dict[str, dict[str, str]] = {}
    with manifest_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            record_id = str(row.get("recordId") or "")
            if not record_id:
                continue
            by_field = targets.setdefault(record_id, {})
            for target in row.get("weakTargets") or []:
                if isinstance(target, dict):
                    field = normalize_space(target.get("field"))
                    text = normalize_space(target.get("text"))
                    if field and text:
                        by_field[field] = text
    return targets


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=False) + "\n")


def best_candidate_text(row: dict[str, Any]) -> tuple[str, float, str]:
    candidates: list[tuple[str, float, str]] = []
    region = row.get("region") if isinstance(row.get("region"), dict) else {}
    region_text = normalize_space(region.get("text"))
    if region_text:
        candidates.append((region_text, float_or_default(region.get("confidence"), 0.0), "region"))
    crop_ocr = row.get("cropOcr") if isinstance(row.get("cropOcr"), dict) else {}
    for engine, value in crop_ocr.items():
        if isinstance(value, dict):
            text = normalize_space(value.get("text"))
            if text:
                candidates.append((text, float_or_default(value.get("confidence"), 0.0), f"cropOcr.{engine}"))
    if not candidates:
        return "", 0.0, "none"
    return sorted(candidates, key=lambda item: (item[1], len(item[0])), reverse=True)[0]


def auto_label(
    rows: list[dict[str, Any]],
    targets_by_record: dict[str, dict[str, str]],
    *,
    min_confidence: float,
    min_similarity: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    output: list[dict[str, Any]] = []
    accepted = 0
    by_field: dict[str, int] = {}
    for row in rows:
        row = dict(row)
        text, ocr_confidence, text_source = best_candidate_text(row)
        record_targets = targets_by_record.get(str(row.get("recordId") or ""), {})
        best = best_target_match(text, record_targets, row.get("matchedFields") or [])
        if text and best and ocr_confidence >= min_confidence and best["score"] >= min_similarity:
            row["weakLabel"] = {
                "accepted": True,
                "source": "auto_high_confidence_expected_match",
                "text": text,
                "textSource": text_source,
                "fieldKey": best["field"],
                "expectedText": best["target"],
                "score": round(float(best["score"]), 4),
                "ocrConfidence": round(float(ocr_confidence), 4),
                "requiresHumanReview": True,
            }
            accepted += 1
            by_field[best["field"]] = by_field.get(best["field"], 0) + 1
        output.append(row)
    summary = {"regions": len(rows), "weakAccepted": accepted, "byField": dict(sorted(by_field.items()))}
    return output, summary


def best_target_match(text: str, targets: dict[str, str], hinted_fields: list[Any]) -> dict[str, Any] | None:
    if not text or not targets:
        return None
    hinted = {str(value) for value in hinted_fields}
    candidates = []
    for field, target in targets.items():
        if hinted and field not in hinted:
            continue
        score = target_similarity(text, target, field)
        if score > 0:
            candidates.append({"field": field, "target": target, "score": score})
    if not candidates and not hinted:
        return None
    if not candidates:
        for field, target in targets.items():
            score = target_similarity(text, target, field)
            if score > 0:
                candidates.append({"field": field, "target": target, "score": score})
    return sorted(candidates, key=lambda item: item["score"], reverse=True)[0] if candidates else None


def target_similarity(text: str, target: str, field: str) -> float:
    normalized_text = normalize_for_match(text)
    normalized_target = normalize_for_match(target)
    if not normalized_text or not normalized_target:
        return 0.0
    if field == "alcoholContent":
        return alcohol_similarity(text, target)
    if field == "netContents":
        return net_contents_similarity(text, target)
    if field == "governmentWarning":
        warning_terms = {"GOVERNMENT", "WARNING", "SURGEON", "PREGNANCY", "MACHINERY", "HEALTH"}
        tokens = set(normalized_text.split())
        hits = len(tokens & warning_terms)
        return min(1.0, hits / 3) if hits >= 2 else 0.0
    if normalized_text == normalized_target:
        return 1.0
    if normalized_text in normalized_target or normalized_target in normalized_text:
        short = min(len(normalized_text), len(normalized_target))
        return 0.98 if short >= 5 else 0.0
    text_tokens = set(normalized_text.split())
    target_tokens = set(normalized_target.split())
    overlap = len(text_tokens & target_tokens) / max(1, min(len(text_tokens), len(target_tokens)))
    sequence = SequenceMatcher(a=normalized_text, b=normalized_target).ratio()
    return max(overlap, sequence)


def alcohol_similarity(text: str, target: str) -> float:
    text_upper = str(text or "").upper()
    target_upper = str(target or "").upper()
    if not any(token in text_upper for token in ["%", "ALC", "VOL", "PROOF"]):
        return 0.0
    text_percents = numbers_near_alcohol_terms(text_upper)
    target_percents = numbers_near_alcohol_terms(target_upper)
    if numbers_overlap(text_percents, target_percents, tolerance=0.25):
        return 0.98
    text_proof = proof_numbers(text_upper)
    target_proof = proof_numbers(target_upper)
    if numbers_overlap(text_proof, target_proof, tolerance=1.0):
        return 0.96
    return 0.0


def net_contents_similarity(text: str, target: str) -> float:
    text_upper = str(text or "").upper()
    target_upper = str(target or "").upper()
    if not any(token in text_upper for token in ["ML", "L", "OZ", "GAL", "PINT", "PT", "CL"]):
        return 0.0
    text_numbers = [value for value, _unit in unit_numbers(text_upper)]
    target_numbers = [value for value, _unit in unit_numbers(target_upper)]
    return 0.98 if numbers_overlap(text_numbers, target_numbers, tolerance=1.0) else 0.0


def numbers_near_alcohol_terms(value: str) -> list[float]:
    matches = []
    for pattern in [
        r"(\d+(?:\.\d+)?)\s*%?",
        r"ALC[^0-9]{0,8}(\d+(?:\.\d+)?)",
    ]:
        for match in re.finditer(pattern, value):
            number = float_or_default(match.group(1), -1.0)
            if number >= 0 and ("ALC" in value[max(0, match.start() - 12) : match.end() + 12] or "%" in match.group(0) or "VOL" in value[max(0, match.start() - 12) : match.end() + 12]):
                matches.append(number)
    return matches


def proof_numbers(value: str) -> list[float]:
    return [float_or_default(match.group(1), -1.0) for match in re.finditer(r"(\d+(?:\.\d+)?)\s*PROOF", value)]


def unit_numbers(value: str) -> list[tuple[float, str]]:
    return [
        (float_or_default(match.group(1), -1.0), match.group(2))
        for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(ML|L|OZ|GAL|PINT|PT|CL)", value)
    ]


def numbers_overlap(left: list[float], right: list[float], *, tolerance: float) -> bool:
    return any(a >= 0 and b >= 0 and abs(a - b) <= tolerance for a in left for b in right)


def normalize_for_match(value: Any) -> str:
    return NON_ALNUM.sub(" ", str(value or "").upper()).strip()


def float_or_default(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", type=Path, default=Path("artifacts/ocr-lab/oriented-text/regions.jsonl"))
    parser.add_argument("--dataset-manifest", type=Path, default=Path("artifacts/ocr-lab/dataset-expanded/manifest.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl"))
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--min-confidence", type=float, default=0.9)
    parser.add_argument("--min-similarity", type=float, default=0.92)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.regions.exists():
        raise SystemExit(f"Missing regions file: {args.regions}")
    if not args.dataset_manifest.exists():
        raise SystemExit(f"Missing dataset manifest: {args.dataset_manifest}")
    rows, summary = auto_label(
        read_jsonl(args.regions),
        load_record_targets(args.dataset_manifest),
        min_confidence=args.min_confidence,
        min_similarity=args.min_similarity,
    )
    write_jsonl(args.out, rows)
    summary_path = args.summary or args.out.with_suffix(".summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
