#!/usr/bin/env python3
"""Build LayoutLMv3 token-classification rows from full-image OCR JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from ttb_validation.layoutlm_fields import FIELD_TO_ENTITY, ocr_tokens_from_payloads, weak_entities_from_expected

LABELS = [
    "O",
    *[prefix + entity for entity in FIELD_TO_ENTITY.values() for prefix in ("B-", "I-")],
]
LABEL_TO_ID = {label: index for index, label in enumerate(LABELS)}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
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


def build_examples(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    examples = []
    by_label: dict[str, int] = {}
    for row in rows:
        payload = ocr_payload_from_row(row)
        tokens = ocr_tokens_from_payloads([payload])
        if not tokens:
            continue
        entities = weak_entities_from_expected(row.get("expectedFields") or {}, tokens, source="layoutlmv3-training-weak-align")
        labels = labels_for_tokens(len(tokens), entities)
        for label in labels:
            by_label[label] = by_label.get(label, 0) + 1
        width = int((row.get("metadata") or {}).get("imageWidth") or 1000)
        height = int((row.get("metadata") or {}).get("imageHeight") or 1000)
        examples.append(
            {
                "id": row.get("id") or f"{row.get('recordId')}-{len(examples) + 1}",
                "recordId": row.get("recordId"),
                "split": row.get("split") or "train",
                "image": row.get("image"),
                "words": [token.text for token in tokens],
                "bboxes": [normalize_bbox_1000(token.bbox, width=width, height=height) for token in tokens],
                "ner_tags": [LABEL_TO_ID[label] for label in labels],
                "ner_labels": labels,
                "weak_ner_tags": [LABEL_TO_ID[label] for label in labels],
                "weak_ner_labels": labels,
                "entities": entities,
                "expectedFields": row.get("expectedFields") or {},
                "source": "weak-aligned-paddleocr-full-image",
                "requiresHumanReview": True,
            }
        )
    summary = {
        "examples": len(examples),
        "tokens": sum(len(example["words"]) for example in examples),
        "labels": dict(sorted(by_label.items())),
        "labelList": LABELS,
        "note": "Weak BIO labels are bootstrapped from expected fields and OCR text. Review before using for final model promotion.",
    }
    return examples, summary


def ocr_payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "rawText": row.get("text") or "",
        "blocks": [
            *[{**line, "kind": "line", "imageId": row.get("id"), "assetId": row.get("id")} for line in row.get("lines") or [] if isinstance(line, dict)],
            *[{**word, "kind": "word", "imageId": row.get("id"), "assetId": row.get("id")} for word in row.get("words") or [] if isinstance(word, dict)],
        ],
        "assetId": row.get("id"),
        "imageId": row.get("id"),
        "metadata": row.get("metadata") or {},
    }


def labels_for_tokens(token_count: int, entities: list[dict[str, Any]]) -> list[str]:
    labels = ["O"] * token_count
    for entity in entities:
        entity_name = str(entity.get("entity") or "")
        if entity_name not in FIELD_TO_ENTITY.values():
            continue
        indexes = [index for index in entity.get("tokenIndexes") or [] if isinstance(index, int) and 0 <= index < token_count]
        for offset, index in enumerate(indexes):
            labels[index] = f"{'B' if offset == 0 else 'I'}-{entity_name}"
    return labels


def normalize_bbox_1000(bbox: dict[str, Any] | None, *, width: int, height: int) -> list[int]:
    if not bbox:
        return [0, 0, 0, 0]
    left = clamp_1000(float(bbox["x"]) / max(width, 1) * 1000)
    top = clamp_1000(float(bbox["y"]) / max(height, 1) * 1000)
    right = clamp_1000((float(bbox["x"]) + float(bbox["width"])) / max(width, 1) * 1000)
    bottom = clamp_1000((float(bbox["y"]) + float(bbox["height"])) / max(height, 1) * 1000)
    return [left, top, max(left, right), max(top, bottom)]


def clamp_1000(value: float) -> int:
    return max(0, min(1000, int(round(value))))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ocr-jsonl", type=Path, default=Path("artifacts/ocr-lab/paddle-full-image/ocr.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/dataset.jsonl"))
    parser.add_argument("--summary", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.ocr_jsonl.exists():
        raise SystemExit(f"Missing OCR JSONL: {args.ocr_jsonl}")
    examples, summary = build_examples(read_jsonl(args.ocr_jsonl))
    write_jsonl(args.out, examples)
    summary_path = args.summary or args.out.with_suffix(".summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
