"""Shared helpers for the public COLA fixture collector."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import mimetypes
import re
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    from slugify import slugify as _slugify
except Exception:  # pragma: no cover - exercised when dependency is absent
    _slugify = None


TTB_ID_RE = re.compile(r"^[A-Za-z0-9]{14}$")


def now_utc_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_valid_ttb_id(ttb_id: str) -> bool:
    return bool(TTB_ID_RE.fullmatch(str(ttb_id or "").strip()))


def validate_ttb_id(ttb_id: str) -> str:
    clean = str(ttb_id or "").strip()
    if not is_valid_ttb_id(clean):
        raise ValueError(f"TTB ID must be exactly 14 alphanumeric characters: {ttb_id!r}")
    return clean


def build_detail_url(ttb_id: str, base_url: str) -> str:
    """Build a detail URL using the Data.gov-documented query pattern."""
    clean = validate_ttb_id(ttb_id)
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["action"] = "publicDisplaySearchBasic"
    query["ttbid"] = clean
    return urlunparse(parsed._replace(query=urlencode(query)))


def slugify_value(value: str, fallback: str = "record") -> str:
    value = normalize_space(value)
    if _slugify:
        slug = _slugify(value)
    else:
        slug = re.sub(r"[^A-Za-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_filename(name: str, fallback: str = "asset") -> str:
    """Return a path-segment-safe filename while preserving a useful extension."""
    raw = normalize_space(name)
    raw = raw.replace("\\", "/").split("/")[-1]
    stem = Path(raw).stem
    suffix = Path(raw).suffix.lower()
    if suffix and not re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        suffix = ""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_")
    stem = stem[:80].strip(".-_")
    return f"{stem or fallback}{suffix}"


def extension_from_content_type(content_type: str | None) -> str | None:
    if not content_type:
        return None
    clean = content_type.split(";", 1)[0].strip().lower()
    explicit = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/tiff": ".tif",
        "application/pdf": ".pdf",
        "text/html": ".html",
    }
    if clean in explicit:
        return explicit[clean]
    guessed = mimetypes.guess_extension(clean)
    return ".jpg" if guessed == ".jpe" else guessed


def load_records_input(path: Path) -> list[dict[str, Any]]:
    """Load the small known-ID input file.

    PyYAML is supported when installed. A tiny fallback parser handles the
    documented ``records: - ttb_id: ...`` shape so the tool can still run in a
    minimal Python environment.
    """
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        payload = json.loads(text)
    else:
        payload = _load_yaml_or_simple_records(text)
    records = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError(f"Input file must contain a records list: {path}")
    normalized: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            raise ValueError(f"Record entries must be objects: {record!r}")
        normalized.append(record)
    return normalized


def _load_yaml_or_simple_records(text: str) -> Any:
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text) or {}
    except Exception:
        return _parse_simple_records_yaml(text)


def _parse_simple_records_yaml(text: str) -> dict[str, list[dict[str, str]]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line == "records:":
            continue
        if line.startswith("- "):
            if current:
                records.append(current)
            current = {}
            line = line[2:].strip()
            if not line:
                continue
        if ":" in line and current is not None:
            key, value = line.split(":", 1)
            current[key.strip()] = _strip_yaml_scalar(value.strip())
    if current:
        records.append(current)
    return {"records": records}


def _strip_yaml_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def unique_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            output.append(value)
    return output
