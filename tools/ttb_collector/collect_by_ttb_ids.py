#!/usr/bin/env python3
"""Collect a small curated fixture set from known public TTB COLA IDs."""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.build_manifest import build_manifest, write_manifest_files
from tools.ttb_collector.common import (
    build_detail_url,
    load_records_input,
    normalize_space,
    now_utc_iso,
    validate_ttb_id,
    write_json,
)
from tools.ttb_collector.config.constants import (
    DEFAULT_DELAY_SECONDS,
    PUBLIC_DETAIL_BASE_URL,
    REQUEST_TIMEOUT_SECONDS,
    USER_AGENT,
)
from tools.ttb_collector.download_assets import build_session, download_assets_for_record
from tools.ttb_collector.normalize_metadata import normalize_metadata
from tools.ttb_collector.parse_cola_detail import parse_detail_html


@dataclass
class CollectionResult:
    ttb_id: str
    status: str
    message: str


def collect_records(
    records: list[dict[str, Any]],
    *,
    out_dir: Path,
    limit: int | None,
    delay_seconds: float,
    respect_cache: bool,
    refresh: bool,
    base_url: str,
    local_html: Path | None = None,
    skip_assets: bool = False,
) -> list[CollectionResult]:
    out_dir.mkdir(parents=True, exist_ok=True)
    selected_records = records[:limit] if limit else records
    results: list[CollectionResult] = []
    session = build_session()
    try:
        for index, record in enumerate(selected_records):
            try:
                result = collect_one_record(
                    record,
                    out_dir=out_dir,
                    respect_cache=respect_cache,
                    refresh=refresh,
                    base_url=base_url,
                    local_html=local_html,
                    session=session,
                    skip_assets=skip_assets,
                )
            except Exception as exc:
                ttb_id = normalize_space(record.get("ttb_id")) or "unknown"
                result = CollectionResult(ttb_id=ttb_id, status="failed", message=str(exc))
                write_failure_note(out_dir, ttb_id, str(exc))
            results.append(result)
            if index < len(selected_records) - 1 and delay_seconds > 0:
                time.sleep(delay_seconds)
    finally:
        session.close()

    manifest = build_manifest(out_dir)
    write_manifest_files(out_dir, manifest)
    return results


def collect_one_record(
    record: dict[str, Any],
    *,
    out_dir: Path,
    respect_cache: bool,
    refresh: bool,
    base_url: str,
    local_html: Path | None,
    session: requests.Session,
    skip_assets: bool,
) -> CollectionResult:
    ttb_id = validate_ttb_id(record.get("ttb_id", ""))
    record_dir = out_dir / "records" / ttb_id
    raw_html_path = record_dir / "metadata.raw.html"
    metadata_path = record_dir / "metadata.json"
    expected_path = record_dir / "expected.json"
    notes_path = record_dir / "notes.md"
    source_path = record_dir / "source.txt"
    detail_url = build_detail_url(ttb_id, base_url)

    if expected_path.exists() and metadata_path.exists() and not refresh:
        return CollectionResult(ttb_id=ttb_id, status="skipped", message="Record already exists; use --refresh to rebuild.")

    record_dir.mkdir(parents=True, exist_ok=True)

    if local_html:
        html = local_html.read_text(encoding="utf-8", errors="replace")
        final_url = detail_url
        source_kind = f"local_html={local_html.expanduser().resolve()}"
        raw_html_path.write_text(html, encoding="utf-8")
    elif raw_html_path.exists() and respect_cache and not refresh:
        html = raw_html_path.read_text(encoding="utf-8", errors="replace")
        final_url = detail_url
        source_kind = "cached_raw_html"
    else:
        html, final_url = fetch_detail_html(detail_url, session=session)
        source_kind = "public_registry"
        raw_html_path.write_text(html, encoding="utf-8")

    metadata = parse_detail_html(html, detail_url=final_url, ttb_id_hint=ttb_id)
    if skip_assets:
        discovered_assets = metadata.get("assets") or []
        metadata["discovered_assets"] = discovered_assets
        metadata["assets"] = []
        metadata.setdefault("parse_warnings", []).append("Asset download skipped by --skip-assets.")
    else:
        merge_printable_page_assets(metadata, session=session)
        discovered_assets = metadata.get("assets") or []
        downloaded_assets, asset_warnings = download_assets_for_record(metadata, record_dir, refresh=refresh, session=session)
        metadata["discovered_assets"] = discovered_assets
        metadata["assets"] = downloaded_assets
        metadata.setdefault("parse_warnings", []).extend(asset_warnings)

    write_json(metadata_path, metadata)
    expected = normalize_metadata(
        metadata,
        expected_group=record.get("expected_group"),
        notes=record.get("notes"),
    )
    write_json(expected_path, expected)
    write_source_file(
        source_path,
        ttb_id=ttb_id,
        detail_url=detail_url,
        final_url=final_url,
        source_kind=source_kind,
        asset_urls=[asset.get("url") for asset in metadata.get("assets") or [] if isinstance(asset, dict)],
    )
    write_notes_file(notes_path, record=record, metadata=metadata)
    return CollectionResult(ttb_id=ttb_id, status="collected", message=f"Wrote {record_dir}")


def merge_printable_page_assets(metadata: dict[str, Any], *, session: requests.Session) -> None:
    """Fetch printable public HTML once to discover label attachments embedded there."""
    assets = metadata.get("assets") or []
    printable_urls = [asset.get("url") for asset in assets if isinstance(asset, dict) and asset.get("kind") == "printable_cola"]
    if not printable_urls:
        return
    known_urls = {asset.get("url") for asset in assets if isinstance(asset, dict)}
    for printable_url in printable_urls[:1]:
        try:
            response = session.get(printable_url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            printable_metadata = parse_detail_html(
                response.text,
                detail_url=response.url,
                ttb_id_hint=metadata.get("ttb_id"),
                retrieved_at=(metadata.get("source") or {}).get("retrieved_at"),
            )
        except Exception as exc:
            metadata.setdefault("parse_warnings", []).append(f"Could not inspect printable page for label assets: {exc}")
            continue
        for asset in printable_metadata.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            if asset.get("url") in known_urls:
                continue
            if asset.get("kind") == "label_image":
                assets.append(asset)
                known_urls.add(asset.get("url"))
    metadata["assets"] = assets


def fetch_detail_html(detail_url: str, *, session: requests.Session) -> tuple[str, str]:
    response = session.get(
        detail_url,
        timeout=REQUEST_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
    )
    response.raise_for_status()
    if "text/html" not in response.headers.get("Content-Type", "") and response.text.lstrip().startswith("<") is False:
        raise ValueError(f"Detail URL did not return HTML: {response.headers.get('Content-Type')}")
    return response.text, response.url


def write_source_file(
    path: Path,
    *,
    ttb_id: str,
    detail_url: str,
    final_url: str,
    source_kind: str,
    asset_urls: list[str],
) -> None:
    lines = [
        f"retrieved_at: {now_utc_iso()}",
        "system: TTB Public COLA Registry",
        f"ttb_id: {ttb_id}",
        f"source_kind: {source_kind}",
        f"detail_url: {detail_url}",
        f"final_url: {final_url}",
        "asset_urls:",
    ]
    lines.extend(f"  - {url}" for url in asset_urls)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_notes_file(path: Path, *, record: dict[str, Any], metadata: dict[str, Any]) -> None:
    lines = [f"# Notes for {record.get('ttb_id')}", ""]
    if record.get("expected_group"):
        lines.append(f"- expected_group: {record['expected_group']}")
    if record.get("notes"):
        lines.append(f"- input_notes: {record['notes']}")
    warnings = metadata.get("parse_warnings") or []
    if warnings:
        lines.append("- parser_warnings:")
        lines.extend(f"  - {warning}" for warning in warnings)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def write_failure_note(out_dir: Path, ttb_id: str, message: str) -> None:
    safe_id = normalize_space(ttb_id) or "unknown"
    record_dir = out_dir / "records" / safe_id
    record_dir.mkdir(parents=True, exist_ok=True)
    (record_dir / "notes.md").write_text(f"# Collection failure\n\n{message}\n", encoding="utf-8")
    (record_dir / "source.txt").write_text(f"retrieved_at: {now_utc_iso()}\nerror: {message}\n", encoding="utf-8")


def load_cli_records(args: argparse.Namespace) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if args.input:
        records.extend(load_records_input(args.input))
    for ttb_id in args.ttb_id or []:
        records.append({"ttb_id": ttb_id})
    if not records:
        raise ValueError("Provide --input or at least one --ttb-id.")
    return records


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="YAML/JSON file containing records")
    parser.add_argument("--ttb-id", action="append", help="Known 14-character TTB ID; can be repeated")
    parser.add_argument("--out", type=Path, default=Path("fixtures/public-cola-registry"), help="Fixture output root")
    parser.add_argument("--limit", type=int, default=25, help="Maximum records to process")
    parser.add_argument("--delay-seconds", type=float, default=DEFAULT_DELAY_SECONDS, help="Delay between records")
    parser.add_argument("--respect-cache", action="store_true", help="Reuse saved raw HTML when present")
    parser.add_argument("--refresh", action="store_true", help="Refetch/rebuild existing records")
    parser.add_argument("--base-url", default=PUBLIC_DETAIL_BASE_URL, help="Public detail endpoint base URL")
    parser.add_argument("--local-html", type=Path, help="Use a saved HTML file instead of fetching the detail page")
    parser.add_argument("--skip-assets", action="store_true", help="Parse metadata without downloading linked assets")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    records = load_cli_records(args)
    results = collect_records(
        records,
        out_dir=args.out,
        limit=args.limit,
        delay_seconds=args.delay_seconds,
        respect_cache=args.respect_cache,
        refresh=args.refresh,
        base_url=args.base_url,
        local_html=args.local_html,
        skip_assets=args.skip_assets,
    )
    for result in results:
        print(f"{result.ttb_id}: {result.status} - {result.message}")
    failures = [result for result in results if result.status == "failed"]
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
