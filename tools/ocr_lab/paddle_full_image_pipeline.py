#!/usr/bin/env python3
"""Run full-image PaddleOCR and preserve line/token boxes for LayoutLMv3."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from time import monotonic
from typing import Any

if __package__ in {None, ""}:
    repo_root = Path(__file__).resolve().parents[2]
    sys.path.append(str(repo_root))
    sys.path.append(str(repo_root / "apps" / "worker"))

from ttb_worker.engines.paddleocr_engine import PaddleOcrEngine
from tools.ocr_lab.stage_training_data import fixture_records, records_by_split, split_records


def image_rows(fixture_roots: list[Path], limit: int) -> list[dict[str, Any]]:
    records = fixture_records(fixture_roots)
    split_order = {"train": 0, "val": 1, "test": 2}
    records = records_by_split(records, split_records(records))
    records.sort(key=lambda record: (split_order.get(str(record.get("split") or "train"), 9), record["recordId"]))
    rows: list[dict[str, Any]] = []
    for record in records:
        for image in record["images"]:
            rows.append(
                {
                    "recordId": record["recordId"],
                    "fixtureId": record.get("fixtureId"),
                    "split": record.get("split"),
                    "image": image["path"],
                    "expectedFields": record["fields"],
                }
            )
            if limit and len(rows) >= limit:
                return rows
    return rows


def run_full_image_ocr(rows: list[dict[str, Any]], *, use_gpu: bool) -> list[dict[str, Any]]:
    engine = PaddleOcrEngine(use_gpu=use_gpu)
    health = engine.healthcheck()
    if not health.available:
        raise SystemExit(health.detail or "PaddleOCR is unavailable.")
    output = []
    for index, row in enumerate(rows):
        image_path = Path(row["image"])
        started = monotonic()
        result = engine.recognize(image_path.read_bytes(), {"payload": {"recordId": row["recordId"]}})
        output.append(
            {
                "id": f"{row['recordId']}-{image_path.stem}-{index + 1}",
                "recordId": row["recordId"],
                "fixtureId": row.get("fixtureId"),
                "split": row.get("split"),
                "image": image_path.as_posix(),
                "expectedFields": row.get("expectedFields") or {},
                "engine": result.engine_id,
                "text": result.text,
                "confidence": result.confidence,
                "lines": result.lines,
                "words": result.words,
                "metadata": {
                    **result.metadata,
                    "fullImageOcrMs": int((monotonic() - started) * 1000),
                },
            }
        )
    return output


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=False) + "\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, action="append")
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/paddle-full-image/ocr.jsonl"))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--gpu", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    rows = image_rows(args.fixture_root or [Path("fixtures/public-cola-registry")], args.limit)
    output = run_full_image_ocr(rows, use_gpu=args.gpu)
    write_jsonl(args.out, output)
    summary = {
        "images": len(output),
        "tokens": sum(len(row.get("words") or []) for row in output),
        "lines": sum(len(row.get("lines") or []) for row in output),
        "engine": "paddleocr",
    }
    summary_path = args.out.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
