#!/usr/bin/env python3
"""Download printable COLA and label assets referenced by parsed metadata."""

from __future__ import annotations

import argparse
import mimetypes
import shutil
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import (
    extension_from_content_type,
    normalize_space,
    now_utc_iso,
    read_json,
    safe_filename,
    sha256_file,
    write_json,
)
from tools.ttb_collector.config.constants import MAX_ASSET_BYTES, REQUEST_TIMEOUT_SECONDS, USER_AGENT


def infer_extension(url: str, content_type: str | None) -> str:
    ext = extension_from_content_type(content_type)
    if ext:
        return ext
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix:
        if suffix == ".jpeg":
            return ".jpg"
        if suffix and len(suffix) <= 9:
            return suffix
    return ".bin"


def sanitize_asset_filename(kind: str, index: int, url: str, content_type: str | None = None) -> str:
    ext = infer_extension(url, content_type)
    if kind == "printable_cola":
        base = "printable_cola"
    elif kind == "label_image":
        base = f"label_{index:02d}"
    else:
        base = safe_filename(Path(urlparse(url).path).name or f"asset_{index:02d}", f"asset_{index:02d}")
        if Path(base).suffix:
            return base
    return safe_filename(f"{base}{ext}", base)


def download_assets_for_record(
    metadata: dict[str, Any],
    record_dir: Path,
    *,
    refresh: bool = False,
    session: requests.Session | None = None,
    max_bytes: int = MAX_ASSET_BYTES,
) -> tuple[list[dict[str, Any]], list[str]]:
    assets = metadata.get("assets") or []
    if not isinstance(assets, list):
        return [], ["metadata.assets is not a list; skipped asset downloads."]

    own_session = session is None
    session = session or build_session()
    downloaded: list[dict[str, Any]] = []
    warnings: list[str] = []
    label_index = 1

    try:
        for asset in assets:
            if not isinstance(asset, dict):
                warnings.append(f"Skipped malformed asset entry: {asset!r}")
                continue
            if asset.get("kind") == "label_image":
                index = label_index
                label_index += 1
            else:
                index = len(downloaded) + 1
            try:
                downloaded.append(
                    download_asset(
                        asset,
                        record_dir,
                        index=index,
                        refresh=refresh,
                        session=session,
                        max_bytes=max_bytes,
                        base_url=(metadata.get("source") or {}).get("detail_url"),
                    )
                )
            except Exception as exc:
                warnings.append(f"Could not download {asset.get('url')}: {exc}")
    finally:
        if own_session:
            session.close()

    duplicate_warnings = duplicate_sha256_warnings(downloaded)
    warnings.extend(duplicate_warnings)
    return downloaded, warnings


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    return session


def download_asset(
    asset: dict[str, Any],
    record_dir: Path,
    *,
    index: int,
    refresh: bool,
    session: requests.Session,
    max_bytes: int = MAX_ASSET_BYTES,
    base_url: str | None = None,
) -> dict[str, Any]:
    raw_url = normalize_space(asset.get("url"))
    if not raw_url:
        raise ValueError("asset is missing url")
    url = urljoin(base_url, raw_url) if base_url else raw_url
    kind = normalize_space(asset.get("kind")) or "asset"
    content_type_hint = asset.get("content_type")
    filename = sanitize_asset_filename(kind, index, url, content_type_hint)
    asset_dir = record_dir / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    local_path = Path(asset.get("local_path") or "")
    if local_path.name:
        filename = safe_filename(local_path.name, filename)
    output_path = asset_dir / filename

    if output_path.exists() and not refresh:
        return build_existing_asset_metadata(asset, output_path, record_dir, url)

    with session.get(url, timeout=REQUEST_TIMEOUT_SECONDS, stream=True) as response:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type") or content_type_hint
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise ValueError(f"asset is larger than configured max size ({content_length} bytes)")

        ext = infer_extension(url, content_type)
        if ext != ".bin" and output_path.suffix.lower() != ext:
            output_path = output_path.with_suffix(ext)

        tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
        bytes_written = 0
        with tmp_path.open("wb") as fh:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    fh.close()
                    tmp_path.unlink(missing_ok=True)
                    raise ValueError(f"asset exceeded configured max size ({max_bytes} bytes)")
                fh.write(chunk)
        tmp_path.replace(output_path)

    return {
        "kind": kind,
        "url": url,
        "local_path": output_path.relative_to(record_dir).as_posix(),
        "content_type": content_type,
        "bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
        "downloaded_at": now_utc_iso(),
    }


def build_existing_asset_metadata(asset: dict[str, Any], output_path: Path, record_dir: Path, url: str) -> dict[str, Any]:
    content_type = asset.get("content_type") or mimetypes.guess_type(output_path.name)[0]
    return {
        "kind": asset.get("kind") or "asset",
        "url": url,
        "local_path": output_path.relative_to(record_dir).as_posix(),
        "content_type": content_type,
        "bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
        "downloaded_at": asset.get("downloaded_at"),
        "cached": True,
    }


def copy_manual_assets(asset_paths: list[Path], record_dir: Path, *, refresh: bool = False) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    asset_dir = record_dir / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    for index, asset_path in enumerate(asset_paths, start=1):
        filename = sanitize_asset_filename("label_image", index, asset_path.name, mimetypes.guess_type(asset_path.name)[0])
        output_path = asset_dir / filename
        if output_path.exists() and not refresh:
            pass
        else:
            shutil.copy2(asset_path, output_path)
        output.append(
            {
                "kind": "label_image",
                "url": asset_path.expanduser().resolve().as_uri(),
                "local_path": output_path.relative_to(record_dir).as_posix(),
                "content_type": mimetypes.guess_type(output_path.name)[0],
                "bytes": output_path.stat().st_size,
                "sha256": sha256_file(output_path),
                "downloaded_at": now_utc_iso(),
                "manual_capture": True,
            }
        )
    return output


def duplicate_sha256_assets(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_hash: dict[str, list[str]] = {}
    for asset in assets:
        sha = asset.get("sha256")
        path = asset.get("local_path") or asset.get("file") or asset.get("url")
        if sha and path:
            by_hash.setdefault(sha, []).append(path)
    return [{"sha256": sha, "files": files} for sha, files in by_hash.items() if len(files) > 1]


def duplicate_sha256_warnings(assets: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    for duplicate in duplicate_sha256_assets(assets):
        files = ", ".join(duplicate["files"])
        warnings.append(f"Duplicate asset SHA256 {duplicate['sha256']}: {files}")
    return warnings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True, help="metadata.json file to read/update")
    parser.add_argument("--record-dir", type=Path, help="Record directory; defaults to metadata parent")
    parser.add_argument("--refresh", action="store_true", help="Overwrite existing asset files")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    metadata = read_json(args.metadata)
    record_dir = args.record_dir or args.metadata.parent
    assets, warnings = download_assets_for_record(metadata, record_dir, refresh=args.refresh)
    metadata["assets"] = assets
    metadata.setdefault("parse_warnings", []).extend(warnings)
    write_json(args.metadata, metadata)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
