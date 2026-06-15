#!/usr/bin/env python3
"""Create a human-reviewable LayoutLMv3 field annotation queue."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.build_layoutlmv3_ner_dataset import read_jsonl, write_jsonl
from tools.ocr_lab.field_extractor_metrics import spans_from_labels


def build_queue(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    queue = []
    by_split: dict[str, int] = {}
    by_status = {"needs_review": 0}
    for row in rows:
        labels = list(row.get("ner_labels") or [])
        split = str(row.get("split") or "train")
        by_split[split] = by_split.get(split, 0) + 1
        by_status["needs_review"] += 1
        queue.append(
            {
                "id": row.get("id"),
                "recordId": row.get("recordId"),
                "split": split,
                "image": row.get("image"),
                "status": "needs_review",
                "instructions": (
                    "Review weak BIO labels. Set accepted=true to keep them, or provide reviewedNerLabels with one "
                    "BIO label per token. Do not change train/val/test split."
                ),
                "expectedFields": row.get("expectedFields") or {},
                "words": row.get("words") or [],
                "bboxes": row.get("bboxes") or [],
                "weakNerLabels": labels,
                "weakSpans": [span_to_review(span, row.get("words") or []) for span in spans_from_labels(labels)],
                "accepted": False,
                "reviewedNerLabels": [],
                "reviewNotes": "",
            }
        )
    return queue, {"examples": len(queue), "bySplit": dict(sorted(by_split.items())), "byStatus": by_status}


def span_to_review(span: tuple[str, int, int], words: list[str]) -> dict[str, Any]:
    entity, start, end = span
    return {"entity": entity, "start": start, "end": end, "text": " ".join(words[start:end])}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/dataset.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/annotation-queue.jsonl"))
    parser.add_argument("--summary", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.dataset.exists():
        raise SystemExit(f"Missing dataset: {args.dataset}")
    queue, summary = build_queue(read_jsonl(args.dataset))
    write_jsonl(args.out, queue)
    summary_path = args.summary or args.out.with_suffix(".summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
