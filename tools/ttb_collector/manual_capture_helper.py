#!/usr/bin/env python3
"""Create a fixture record from manually saved public COLA HTML/assets."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.build_manifest import build_manifest, write_manifest_files
from tools.ttb_collector.common import now_utc_iso, validate_ttb_id, write_json
from tools.ttb_collector.download_assets import copy_manual_assets, duplicate_sha256_warnings
from tools.ttb_collector.normalize_metadata import normalize_metadata
from tools.ttb_collector.parse_cola_detail import parse_detail_file


def create_manual_record(
    *,
    ttb_id: str,
    detail_url: str,
    html_file: Path,
    assets: list[Path],
    out_dir: Path,
    refresh: bool = False,
) -> Path:
    clean_id = validate_ttb_id(ttb_id)
    record_dir = out_dir / "records" / clean_id
    record_dir.mkdir(parents=True, exist_ok=True)

    raw_html_path = record_dir / "metadata.raw.html"
    if raw_html_path.exists() and not refresh:
        pass
    else:
        shutil.copy2(html_file, raw_html_path)

    metadata = parse_detail_file(raw_html_path, detail_url=detail_url, ttb_id_hint=clean_id)
    discovered_assets = metadata.get("assets") or []
    manual_assets = copy_manual_assets(assets, record_dir, refresh=refresh)
    metadata["discovered_assets"] = discovered_assets
    metadata["assets"] = manual_assets
    metadata.setdefault("parse_warnings", []).extend(duplicate_sha256_warnings(manual_assets))
    metadata.setdefault("parse_warnings", []).append("Record was created through manual capture helper.")

    write_json(record_dir / "metadata.json", metadata)
    expected = normalize_metadata(metadata, notes="Manual capture from public registry page.")
    write_json(record_dir / "expected.json", expected)
    write_source_file(record_dir / "source.txt", ttb_id=clean_id, detail_url=detail_url, html_file=html_file, assets=assets)
    write_notes(record_dir / "notes.md", ttb_id=clean_id, html_file=html_file, assets=assets)

    manifest = build_manifest(out_dir)
    write_manifest_files(out_dir, manifest)
    return record_dir


def write_source_file(path: Path, *, ttb_id: str, detail_url: str, html_file: Path, assets: list[Path]) -> None:
    lines = [
        f"retrieved_at: {now_utc_iso()}",
        "system: TTB Public COLA Registry",
        "source_kind: manual_capture",
        f"ttb_id: {ttb_id}",
        f"detail_url: {detail_url}",
        f"html_file: {html_file.expanduser().resolve()}",
        "assets:",
    ]
    lines.extend(f"  - {asset.expanduser().resolve()}" for asset in assets)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_notes(path: Path, *, ttb_id: str, html_file: Path, assets: list[Path]) -> None:
    lines = [
        f"# Notes for {ttb_id}",
        "",
        "- Created with manual_capture_helper.py from public registry materials.",
        f"- Saved HTML: {html_file.expanduser().resolve()}",
    ]
    if assets:
        lines.append("- Supplied assets:")
        lines.extend(f"  - {asset.expanduser().resolve()}" for asset in assets)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ttb-id", required=True)
    parser.add_argument("--detail-url", required=True)
    parser.add_argument("--html-file", type=Path, required=True)
    parser.add_argument("--assets", type=Path, nargs="*", default=[])
    parser.add_argument("--out", type=Path, default=Path("fixtures/public-cola-registry"))
    parser.add_argument("--refresh", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    record_dir = create_manual_record(
        ttb_id=args.ttb_id,
        detail_url=args.detail_url,
        html_file=args.html_file,
        assets=args.assets,
        out_dir=args.out,
        refresh=args.refresh,
    )
    print(f"Wrote manual fixture record: {record_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
