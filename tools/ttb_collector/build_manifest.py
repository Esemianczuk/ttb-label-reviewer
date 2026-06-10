#!/usr/bin/env python3
"""Build dataset-level JSON and CSV manifests for public COLA fixtures."""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import now_utc_iso, read_json, write_json


CSV_COLUMNS = [
    "fixture_id",
    "ttb_id",
    "brand_name",
    "class_type",
    "product_type",
    "asset_count",
    "record_dir",
    "expected_json",
]


def build_manifest(fixture_root: Path, *, generated_at: str | None = None) -> dict[str, Any]:
    records_root = fixture_root / "records"
    records: list[dict[str, Any]] = []
    if records_root.exists():
        for expected_path in sorted(records_root.glob("*/expected.json")):
            record_dir = expected_path.parent
            expected = read_json(expected_path)
            fields = expected.get("expected_fields") or {}
            assets = expected.get("assets") or []
            records.append(
                {
                    "fixture_id": expected.get("fixture_id"),
                    "ttb_id": expected.get("ttb_id"),
                    "brand_name": fields.get("brandName"),
                    "class_type": fields.get("classType"),
                    "product_type": fields.get("productType"),
                    "asset_count": len(assets) if isinstance(assets, list) else 0,
                    "record_dir": record_dir.relative_to(fixture_root).as_posix(),
                    "expected_json": expected_path.relative_to(fixture_root).as_posix(),
                }
            )
    return {
        "generated_at": generated_at or now_utc_iso(),
        "source": "TTB Public COLA Registry",
        "records_count": len(records),
        "records": records,
    }


def write_manifest_files(fixture_root: Path, manifest: dict[str, Any]) -> None:
    fixture_root.mkdir(parents=True, exist_ok=True)
    write_json(fixture_root / "manifest.json", manifest)
    write_manifest_csv(fixture_root / "manifest.csv", manifest.get("records") or [])


def write_manifest_csv(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for record in records:
            writer.writerow({column: record.get(column) for column in CSV_COLUMNS})


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("fixtures/public-cola-registry"), help="Fixture root")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    manifest = build_manifest(args.out)
    write_manifest_files(args.out, manifest)
    print(f"Wrote {manifest['records_count']} records to {args.out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
