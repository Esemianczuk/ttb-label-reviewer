#!/usr/bin/env python3
"""Export reviewed oriented-text regions into PaddleOCR training manifests."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space


SPLITS = ("train", "val", "test")


def load_splits(manifest_path: Path) -> dict[str, str]:
    record_to_split: dict[str, str] = {}
    if not manifest_path.exists():
        return record_to_split
    with manifest_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            record_id = str(row.get("recordId") or "")
            split = str(row.get("split") or "train")
            if record_id and split in SPLITS:
                record_to_split[record_id] = split
    return record_to_split


def iter_regions(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def reviewed_transcript(row: dict[str, Any], *, accept_weak: bool) -> str:
    for key in ("reviewedText", "transcript", "labelText"):
        text = normalize_space(row.get(key))
        if text:
            return text
    review = row.get("review") if isinstance(row.get("review"), dict) else {}
    for key in ("text", "transcript", "label"):
        text = normalize_space(review.get(key))
        if text:
            return text
    if not accept_weak:
        return ""
    region = row.get("region") if isinstance(row.get("region"), dict) else {}
    text = normalize_space(region.get("text"))
    if text:
        return text
    crop_ocr = row.get("cropOcr") if isinstance(row.get("cropOcr"), dict) else {}
    candidates = []
    for value in crop_ocr.values():
        if isinstance(value, dict):
            text = normalize_space(value.get("text"))
            if text:
                candidates.append(text)
    return max(candidates, key=len) if candidates else ""


def is_accepted(row: dict[str, Any], *, accept_weak: bool) -> bool:
    if accept_weak:
        return True
    if row.get("approved") is True or row.get("reviewed") is True:
        return True
    review = row.get("review") if isinstance(row.get("review"), dict) else {}
    return bool(review.get("approved") is True or review.get("accepted") is True)


def crop_path(row: dict[str, Any]) -> str:
    crop = row.get("crop") if isinstance(row.get("crop"), dict) else {}
    return normalize_space(crop.get("path"))


def detection_points(row: dict[str, Any]) -> list[list[float]] | None:
    region = row.get("region") if isinstance(row.get("region"), dict) else {}
    points = region.get("points")
    if not isinstance(points, list) or len(points) != 4:
        return None
    output = []
    for point in points:
        if not isinstance(point, list) or len(point) < 2:
            return None
        output.append([float(point[0]), float(point[1])])
    return output


def export(rows: list[dict[str, Any]], record_to_split: dict[str, str], out_dir: Path, *, accept_weak: bool) -> dict[str, Any]:
    rec_rows: dict[str, list[str]] = {split: [] for split in SPLITS}
    det_by_split_image: dict[str, dict[str, list[dict[str, Any]]]] = {split: defaultdict(list) for split in SPLITS}
    skipped = 0
    for row in rows:
        if not is_accepted(row, accept_weak=accept_weak):
            skipped += 1
            continue
        transcript = reviewed_transcript(row, accept_weak=accept_weak)
        crop = crop_path(row)
        if not transcript or not crop:
            skipped += 1
            continue
        split = record_to_split.get(str(row.get("recordId") or ""), "train")
        rec_rows[split].append(f"{crop}\t{transcript}")
        points = detection_points(row)
        image = normalize_space(row.get("image"))
        if points and image:
            det_by_split_image[split][image].append({"transcription": transcript, "points": points, "ignore": False})

    for split, lines in rec_rows.items():
        path = out_dir / "rec" / f"{split}.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    for split, grouped in det_by_split_image.items():
        lines = [f"{image}\t{json.dumps(boxes, ensure_ascii=False)}" for image, boxes in sorted(grouped.items())]
        path = out_dir / "det" / f"{split}.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    summary = {
        "regions": len(rows),
        "skipped": skipped,
        "acceptWeak": accept_weak,
        "recognitionRows": {split: len(lines) for split, lines in rec_rows.items()},
        "detectionImages": {split: len(grouped) for split, grouped in det_by_split_image.items()},
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", type=Path, default=Path("artifacts/ocr-lab/oriented-text/regions.jsonl"))
    parser.add_argument("--dataset-manifest", type=Path, default=Path("artifacts/ocr-lab/dataset-expanded/manifest.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/paddleocr"))
    parser.add_argument("--accept-weak", action="store_true", help="Export OCR-derived transcripts when reviewed labels are not present.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.regions.exists():
        raise SystemExit(f"Missing regions file: {args.regions}")
    summary = export(iter_regions(args.regions), load_splits(args.dataset_manifest), args.out, accept_weak=args.accept_weak)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
