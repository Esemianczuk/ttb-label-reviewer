#!/usr/bin/env python3
"""Stage public COLA fixtures into reproducible OCR train/val/test manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space, read_json, write_json


FIELD_KEYS = [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "producerName",
    "countryOfOrigin",
    "governmentWarning",
]

SPLIT_RATIOS = {"train": 0.7, "val": 0.15, "test": 0.15}


def fixture_records(roots: list[Path]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for root in roots:
        for expected_path in sorted(root.glob("records/*/expected.json")):
            record_dir = expected_path.parent
            metadata_path = record_dir / "metadata.json"
            if not metadata_path.exists():
                continue
            expected = read_json(expected_path)
            metadata = read_json(metadata_path)
            fields = expected_fields(expected, metadata)
            image_assets = label_assets(record_dir, metadata)
            if not image_assets:
                continue
            records.append(
                {
                    "recordId": record_dir.name,
                    "fixtureId": expected.get("fixture_id") or record_dir.name,
                    "ttbId": expected.get("ttb_id") or metadata.get("ttb_id") or record_dir.name,
                    "productType": fields.get("productType") or "unknown",
                    "status": metadata.get("status"),
                    "approvalDate": metadata.get("approval_date"),
                    "demoReady": expected.get("demo_ready"),
                    "fields": fields,
                    "images": image_assets,
                    "sourceRoot": root.as_posix(),
                    "recordDir": record_dir.as_posix(),
                }
            )
    return records


def expected_fields(expected: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    fields = dict(expected.get("expected_fields") or {})
    responsible = fields.get("responsibleParty") or {}
    application = metadata.get("application") or {}
    fields["productType"] = fields.get("productType") or application.get("product_type")
    fields["producerName"] = responsible.get("name") if isinstance(responsible, dict) else None
    fields["producerAddress"] = responsible.get("address") if isinstance(responsible, dict) else None
    fields["governmentWarning"] = (
        "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during "
        "pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability "
        "to drive a car or operate machinery, and may cause health problems."
    )
    return fields


def label_assets(record_dir: Path, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for asset in metadata.get("assets") or []:
        if not isinstance(asset, dict) or asset.get("kind") != "label_image":
            continue
        local_path = normalize_space(asset.get("local_path"))
        if not local_path:
            continue
        path = record_dir / local_path
        if not path.exists():
            continue
        output.append(
            {
                "path": path.as_posix(),
                "role": role_from_name(path.name, len(output)),
                "bytes": path.stat().st_size,
                "contentType": asset.get("content_type"),
                "sha256": file_sha256(path),
            }
        )
    return output


def role_from_name(name: str, index: int) -> str:
    lower = name.lower()
    if "front" in lower:
        return "front"
    if "back" in lower:
        return "back"
    if "neck" in lower or "collar" in lower:
        return "neck"
    if index == 0:
        return "front"
    if index == 1:
        return "back"
    return "other"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_records(records: list[dict[str, Any]]) -> dict[str, list[str]]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        buckets.setdefault(str(record.get("productType") or "unknown"), []).append(record)

    splits = {"train": [], "val": [], "test": []}
    for bucket in buckets.values():
        bucket.sort(key=lambda record: stable_sort_key(record["ttbId"]))
        total = len(bucket)
        train_end = max(1, int(total * SPLIT_RATIOS["train"])) if total >= 3 else total
        val_end = train_end + max(1, int(total * SPLIT_RATIOS["val"])) if total >= 5 else train_end
        for index, record in enumerate(bucket):
            split = "train" if index < train_end else "val" if index < val_end else "test"
            splits[split].append(record["recordId"])
    return splits


def stable_sort_key(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def records_by_split(records: list[dict[str, Any]], splits: dict[str, list[str]]) -> list[dict[str, Any]]:
    lookup = {record["recordId"]: record for record in records}
    output: list[dict[str, Any]] = []
    for split, record_ids in splits.items():
        for record_id in record_ids:
            record = dict(lookup[record_id])
            record["split"] = split
            record["weakTargets"] = weak_targets(record["fields"])
            output.append(record)
    output.sort(key=lambda record: (record["split"], record["recordId"]))
    return output


def weak_targets(fields: dict[str, Any]) -> list[dict[str, str]]:
    targets = []
    for key in FIELD_KEYS:
        value = normalize_space(fields.get(key))
        if not value:
            continue
        targets.append({"field": key, "text": value})
    return targets


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=False) + "\n")


def write_training_format_notes(out_dir: Path) -> None:
    notes = {
        "paddleocr": {
            "det": "Convert reviewed quadrilateral text regions to PaddleOCR detection train.txt/val.txt format.",
            "rec": "Convert reviewed upright line crops to image_path<TAB>transcript format for PP-OCR recognition training.",
        },
        "easyocr": {
            "rec": "Use reviewed line crops/transcripts to train a compatible recognizer, then install .pth/.yaml/.py as an EasyOCR recog_network.",
        },
        "tesseract": {
            "rec": "Use line crops plus .gt.txt files for tesstrain; this is best for narrow font/style finetuning, not layout detection.",
        },
        "clip": {
            "ranker": "Use full label plus candidate crop boxes with field labels as positives/negatives. It should rank regions, not decide exact text.",
        },
    }
    write_json(out_dir / "training_targets.json", notes)
    (out_dir / "README.md").write_text(
        "# OCR Training Dataset Stage\n\n"
        "This folder is generated from public COLA fixtures. `manifest.jsonl` is grouped by record so train/val/test splits do not leak images from the same application across sets.\n\n"
        "- `weakTargets` are registry/application values, not ground-truth crop transcripts.\n"
        "- Use `oriented_text_pipeline.py` to create candidate crops, then review/label crops before actual detector or recognizer training.\n"
        "- Keep `test` untouched until model selection is complete.\n",
        encoding="utf-8",
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, action="append")
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/dataset"))
    parser.add_argument("--min-images", type=int, default=1)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    fixture_roots = args.fixture_root or [Path("fixtures/public-cola-registry")]
    records = [record for record in fixture_records(fixture_roots) if len(record["images"]) >= args.min_images]
    splits = split_records(records)
    staged = records_by_split(records, splits)
    args.out.mkdir(parents=True, exist_ok=True)
    write_json(args.out / "splits.json", splits)
    write_json(args.out / "summary.json", {"records": len(records), "images": sum(len(record["images"]) for record in records), "splits": {key: len(value) for key, value in splits.items()}})
    write_jsonl(args.out / "manifest.jsonl", staged)
    write_training_format_notes(args.out)
    print(json.dumps(read_json(args.out / "summary.json"), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
