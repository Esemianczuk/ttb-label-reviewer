#!/usr/bin/env python3
"""Promote selected high-signal bulk records into the bundled demo fixture set."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.build_manifest import build_manifest, write_manifest_files
from tools.ttb_collector.common import read_json, write_json


def selected_by_id(selection_path: Path) -> dict[str, dict[str, Any]]:
    payload = read_json(selection_path)
    return {str(record["ttb_id"]): record for record in payload.get("selected") or [] if record.get("ttb_id")}


def promote_records(
    *,
    source_root: Path,
    dest_root: Path,
    selection_path: Path,
    limit: int,
    min_score: int,
    dry_run: bool,
) -> list[dict[str, Any]]:
    selection = selected_by_id(selection_path)
    promoted: list[dict[str, Any]] = []
    dest_records = dest_root / "records"
    for ttb_id, selected in sorted(selection.items(), key=lambda item: (-int(item[1].get("score") or 0), item[0])):
        if limit and len(promoted) >= limit:
            break
        if int(selected.get("score") or 0) < min_score:
            continue
        source_dir = source_root / "records" / ttb_id
        dest_dir = dest_records / ttb_id
        if not source_dir.exists():
            continue
        promoted.append({"ttb_id": ttb_id, "score": selected.get("score"), "source": source_dir.as_posix(), "dest": dest_dir.as_posix()})
        if dry_run:
            continue
        if dest_dir.exists():
            shutil.rmtree(dest_dir)
        shutil.copytree(source_dir, dest_dir)
        annotate_expected(dest_dir / "expected.json", selected)
    if not dry_run:
        write_manifest_files(dest_root, build_manifest(dest_root))
    return promoted


def annotate_expected(expected_path: Path, selected: dict[str, Any]) -> None:
    expected = read_json(expected_path)
    expected["demo_ready"] = True
    expected["signal"] = {
        "score": selected.get("score"),
        "searchTerm": selected.get("search_term"),
        "scoreReasons": selected.get("score_reasons") or [],
        "ocrHints": selected.get("ocr_hints") or {},
    }
    existing_limitations = list(expected.get("known_limitations") or [])
    existing_limitations.append(f"High-signal expansion score {selected.get('score')} from search term {selected.get('search_term')}.")
    expected["known_limitations"] = existing_limitations
    expected["demo_audit"] = {
        "status": "ready",
        "source": "high_signal_ocr_preflight",
        "reason": "Public registry metadata plus OCR preflight found the common required label evidence targets.",
        "reviewed_common_fields": reviewed_fields(selected),
    }
    write_json(expected_path, expected)


def reviewed_fields(selected: dict[str, Any]) -> list[str]:
    reasons = " ".join(selected.get("score_reasons") or []).lower()
    fields = ["brandName", "classType"]
    if "alcohol" in reasons:
        fields.append("alcoholContent")
    if "net contents" in reasons:
        fields.append("netContents")
    if "responsible" in reasons:
        fields.append("producerName")
    if "country" in reasons:
        fields.append("countryOfOrigin")
    if "warning" in reasons:
        fields.append("governmentWarning")
    return sorted(set(fields))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("fixtures/public-cola-registry/bulk/high-signal-records"))
    parser.add_argument("--dest-root", type=Path, default=Path("fixtures/public-cola-registry"))
    parser.add_argument("--selection", type=Path, default=Path("fixtures/public-cola-registry/bulk/high-signal-selection.json"))
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--min-score", type=int, default=90)
    parser.add_argument("--apply", action="store_true", help="Actually copy records; default is dry-run")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    promoted = promote_records(
        source_root=args.source_root,
        dest_root=args.dest_root,
        selection_path=args.selection,
        limit=args.limit,
        min_score=args.min_score,
        dry_run=not args.apply,
    )
    for record in promoted:
        print(f"{record['ttb_id']}: score={record['score']} {record['source']} -> {record['dest']}")
    print(f"{'Would promote' if not args.apply else 'Promoted'} {len(promoted)} record(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
