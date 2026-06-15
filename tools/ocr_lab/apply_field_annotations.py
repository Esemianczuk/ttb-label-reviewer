#!/usr/bin/env python3
"""Apply reviewed field annotations back to a LayoutLMv3 training dataset."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.build_layoutlmv3_ner_dataset import LABELS, read_jsonl, write_jsonl
from tools.ocr_lab.field_extractor_metrics import labels_from_tags, spans_from_labels, tags_from_labels


def apply_annotations(rows: list[dict[str, Any]], annotations: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    annotation_by_id = {str(row.get("id")): row for row in annotations if row.get("id")}
    output = []
    counts = {"acceptedWeak": 0, "reviewed": 0, "stillNeedsReview": 0, "missingAnnotation": 0}
    for row in rows:
        row_id = str(row.get("id") or "")
        annotation = annotation_by_id.get(row_id)
        weak_labels = labels_from_tags(row.get("weak_ner_labels") or row.get("ner_labels") or row.get("ner_tags") or [])
        next_row = {
            **row,
            "weak_ner_labels": weak_labels,
            "weak_ner_tags": tags_from_labels(weak_labels),
        }
        if not annotation:
            counts["missingAnnotation"] += 1
            counts["stillNeedsReview"] += 1
            output.append({**next_row, "requiresHumanReview": True})
            continue
        reviewed_labels = labels_from_tags(annotation.get("reviewedNerLabels") or annotation.get("reviewedNerTags") or [])
        if reviewed_labels and len(reviewed_labels) != len(row.get("words") or []):
            raise SystemExit(f"Annotation {row_id} has {len(reviewed_labels)} labels for {len(row.get('words') or [])} words.")
        if reviewed_labels:
            counts["reviewed"] += 1
            output.append(
                {
                    **next_row,
                    "ner_labels": reviewed_labels,
                    "ner_tags": tags_from_labels(reviewed_labels),
                    "entities": spans_to_entities(reviewed_labels, row.get("words") or []),
                    "source": "reviewed-layoutlmv3-field-annotations",
                    "requiresHumanReview": False,
                    "reviewNotes": annotation.get("reviewNotes") or "",
                }
            )
        elif annotation.get("accepted") is True:
            counts["acceptedWeak"] += 1
            output.append({**next_row, "requiresHumanReview": False, "source": "accepted-weak-layoutlmv3-field-annotations"})
        else:
            counts["stillNeedsReview"] += 1
            output.append({**next_row, "requiresHumanReview": True})
    summary = {"examples": len(output), **counts}
    return output, summary


def spans_to_entities(labels: list[str], words: list[str]) -> list[dict[str, Any]]:
    entities = []
    for entity, start, end in spans_from_labels(labels):
        entities.append(
            {
                "entity": entity,
                "text": " ".join(words[start:end]),
                "tokenIndexes": list(range(start, end)),
                "reviewed": True,
            }
        )
    return entities


def validate_labels(labels: list[str]) -> None:
    invalid = sorted({label for label in labels if label not in LABELS})
    if invalid:
        raise SystemExit(f"Invalid BIO labels: {', '.join(invalid)}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/dataset.jsonl"))
    parser.add_argument("--annotations", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/annotation-queue.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/reviewed-dataset.jsonl"))
    parser.add_argument("--summary", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.dataset.exists():
        raise SystemExit(f"Missing dataset: {args.dataset}")
    if not args.annotations.exists():
        raise SystemExit(f"Missing annotations: {args.annotations}")
    output, summary = apply_annotations(read_jsonl(args.dataset), read_jsonl(args.annotations))
    for row in output:
        validate_labels(labels_from_tags(row.get("ner_labels") or []))
    write_jsonl(args.out, output)
    summary_path = args.summary or args.out.with_suffix(".summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
