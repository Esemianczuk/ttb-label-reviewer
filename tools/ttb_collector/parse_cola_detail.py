#!/usr/bin/env python3
"""Parse saved TTB Public COLA Registry detail HTML into metadata JSON."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import (
    build_detail_url,
    normalize_space,
    now_utc_iso,
    safe_filename,
    validate_ttb_id,
    write_json,
)
from tools.ttb_collector.config.constants import PUBLIC_DETAIL_BASE_URL


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"}

FIELD_ALIASES = {
    "status": ["status", "application status", "current status"],
    "approval_date": ["approval date", "date approved", "approved date"],
    "serial_number": ["serial number", "serial no", "serial"],
    "registry_number": ["registry number", "registry no", "registry"],
    "permit_number": ["permit number", "permit no", "basic permit"],
    "applicant_name": ["applicant name", "applicant", "company name", "responsible party"],
    "applicant_address": ["applicant address", "address", "mailing address"],
    "brand_name": ["brand name", "brand"],
    "fanciful_name": ["fanciful name", "fanciful"],
    "product_type": ["product type", "commodity", "product", "type of product"],
    "class_type": ["class/type", "class type", "class/type code", "class type code", "class", "class and type", "designation"],
    "alcohol_content": ["alcohol content", "alc/vol", "alcohol by volume", "abv", "proof"],
    "net_contents": ["net contents", "net content", "container size", "contents"],
    "formula_id": ["formula id", "formula number", "formula"],
    "origin": ["origin", "country of origin", "country", "state of origin"],
    "vintage": ["vintage", "vintage year"],
    "appellation": ["appellation", "wine appellation"],
    "ttb_id": ["ttb id", "ttbid", "ttb cola id", "cola id"],
}


def canonicalize_label(label: str) -> str:
    label = normalize_space(label).lower()
    label = label.replace("\xa0", " ")
    label = re.sub(r"[:*]+$", "", label).strip()
    label = re.sub(r"[^a-z0-9/% ]+", " ", label)
    return normalize_space(label)


def map_field_label(label: str) -> str | None:
    canonical = canonicalize_label(label)
    if not canonical:
        return None
    for field_name, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            alias_canonical = canonicalize_label(alias)
            if canonical == alias_canonical or canonical.endswith(alias_canonical):
                return field_name
    return None


def parse_detail_file(path: Path, detail_url: str | None = None, ttb_id_hint: str | None = None) -> dict[str, Any]:
    html = path.read_text(encoding="utf-8", errors="replace")
    return parse_detail_html(html, detail_url=detail_url, ttb_id_hint=ttb_id_hint)


def parse_detail_html(
    html: str,
    *,
    detail_url: str | None = None,
    retrieved_at: str | None = None,
    ttb_id_hint: str | None = None,
) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    raw_fields = extract_raw_fields(soup)
    mapped = map_raw_fields(raw_fields)
    parse_warnings: list[str] = []

    ttb_id = mapped.get("ttb_id") or ttb_id_hint or ttb_id_from_url(detail_url or "")
    if ttb_id:
        try:
            ttb_id = validate_ttb_id(ttb_id)
        except ValueError as exc:
            parse_warnings.append(str(exc))

    if not raw_fields:
        parse_warnings.append("No field/value rows were parsed from the detail HTML.")

    assets = extract_asset_links(soup, detail_url)
    if not assets:
        parse_warnings.append("No printable COLA or label image links were found.")

    application = {
        "brand_name": mapped.get("brand_name"),
        "fanciful_name": mapped.get("fanciful_name"),
        "class_type": mapped.get("class_type"),
        "product_type": mapped.get("product_type"),
        "alcohol_content": mapped.get("alcohol_content"),
        "net_contents": mapped.get("net_contents"),
        "formula_id": mapped.get("formula_id"),
        "origin": mapped.get("origin"),
        "permit_number": mapped.get("permit_number"),
        "applicant_name": mapped.get("applicant_name"),
        "applicant_address": mapped.get("applicant_address"),
        "vintage": mapped.get("vintage"),
        "appellation": mapped.get("appellation"),
    }

    return {
        "source": {
            "system": "TTB Public COLA Registry",
            "detail_url": detail_url,
            "retrieved_at": retrieved_at or now_utc_iso(),
        },
        "ttb_id": ttb_id,
        "status": mapped.get("status"),
        "approval_date": mapped.get("approval_date"),
        "serial_number": mapped.get("serial_number"),
        "registry_number": mapped.get("registry_number"),
        "permit_number": mapped.get("permit_number"),
        "applicant_name": mapped.get("applicant_name"),
        "applicant_address": mapped.get("applicant_address"),
        "application": application,
        "assets": assets,
        "raw_fields": raw_fields,
        "parse_warnings": parse_warnings,
    }


def extract_raw_fields(soup: BeautifulSoup) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    extract_strong_label_fields(soup, fields, seen)

    for row in soup.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if len(cells) < 2:
            cells = row.find_all(["th", "td"])
        if len(cells) >= 2:
            label = clean_label(cells[0].get_text(" ", strip=True))
            value = normalize_space(" ".join(cell.get_text(" ", strip=True) for cell in cells[1:]))
            _append_field(fields, seen, label, value)

    for dl in soup.find_all("dl"):
        pending_label: str | None = None
        for child in dl.find_all(["dt", "dd"], recursive=False):
            if child.name == "dt":
                pending_label = clean_label(child.get_text(" ", strip=True))
            elif child.name == "dd" and pending_label:
                value = normalize_space(child.get_text(" ", strip=True))
                _append_field(fields, seen, pending_label, value)
                pending_label = None

    for element in soup.find_all(["div", "p", "li"]):
        text = normalize_space(element.get_text(" ", strip=True))
        if not text or ":" not in text or len(text) > 240:
            continue
        label, value = text.split(":", 1)
        if 1 <= len(label) <= 80:
            _append_field(fields, seen, clean_label(label), normalize_space(value))

    return fields


def extract_strong_label_fields(soup: BeautifulSoup, fields: list[dict[str, str]], seen: set[tuple[str, str]]) -> None:
    """Extract legacy COLAs Online rows shaped as ``<strong>Label:</strong> value``."""
    for strong in soup.find_all("strong"):
        label = clean_label(strong.get_text(" ", strip=True))
        if not label or ":" not in strong.get_text(" ", strip=True):
            continue
        container = strong.find_parent(["td", "div", "p", "li"])
        if not container:
            continue
        full_text = normalize_space(container.get_text(" ", strip=True))
        if not full_text:
            continue
        value = full_text
        strong_text = normalize_space(strong.get_text(" ", strip=True))
        if value.startswith(strong_text):
            value = normalize_space(value[len(strong_text) :])
        else:
            value = re.sub(rf"^{re.escape(label)}:?", "", value, count=1).strip()
        _append_field(fields, seen, label, value)


def _append_field(fields: list[dict[str, str]], seen: set[tuple[str, str]], label: str, value: str) -> None:
    if not label or not value:
        return
    if len(label) > 140 or label.count(":") > 2:
        return
    pair = (label, value)
    if pair in seen:
        return
    seen.add(pair)
    fields.append({"label": label, "value": value})


def clean_label(label: str) -> str:
    return re.sub(r"[:*]+$", "", normalize_space(label)).strip()


def map_raw_fields(raw_fields: list[dict[str, str]]) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for field in raw_fields:
        key = map_field_label(field.get("label", ""))
        value = normalize_space(field.get("value", ""))
        if key and value and key not in mapped:
            mapped[key] = value
    return mapped


def extract_asset_links(soup: BeautifulSoup, detail_url: str | None = None) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    label_index = 1

    for element in soup.find_all(["a", "img"]):
        for raw_url in candidate_urls_for_element(element):
            raw_url = raw_url.strip()
            if not raw_url or raw_url.lower().startswith(("mailto:", "#")):
                continue
            url = urljoin(detail_url, raw_url) if detail_url else raw_url
            if url in seen_urls:
                continue
            link_text = normalize_space(element.get_text(" ", strip=True))
            alt_text = normalize_space(element.get("alt", ""))
            title_text = normalize_space(element.get("title", ""))
            context = " ".join([url, link_text, alt_text, title_text, element.name or ""]).lower()
            kind = classify_asset_link(url, context, element.name)
            if not kind:
                continue
            seen_urls.add(url)
            local_path = default_local_asset_path(kind, url, label_index)
            if kind == "label_image":
                label_index += 1
            assets.append(
                {
                    "kind": kind,
                    "url": url,
                    "local_path": local_path,
                    "content_type": guessed_content_type(url),
                }
            )
    return assets


def candidate_urls_for_element(element: Any) -> list[str]:
    urls: list[str] = []
    if element.name == "a" and element.get("href") and not element.get("href", "").lower().startswith("javascript:"):
        urls.append(element["href"])
    if element.name == "img" and element.get("src"):
        urls.append(element["src"])
    onclick = element.get("onclick") or ""
    urls.extend(re.findall(r"(?:popup|window\.open)\(['\"]([^'\"]+)['\"]", onclick))
    return urls


def classify_asset_link(url: str, context: str, tag_name: str) -> str | None:
    suffix = Path(urlparse(url).path).suffix.lower()
    parsed_path = urlparse(url).path.lower()
    if "publicviewsignature.do" in parsed_path:
        return None
    if "publicformdisplay" in context or "printable" in context:
        return "printable_cola"
    if "publicviewattachment.do" in parsed_path or "label image" in context:
        return "label_image"
    if "/images/" in parsed_path:
        return None
    if tag_name == "img" or suffix in IMAGE_EXTENSIONS:
        return "label_image"
    if suffix == ".pdf":
        return "printable_cola"
    if any(token in context for token in ["printable", "print version", "print cola", "application print", "pdf"]):
        return "printable_cola"
    if any(token in context for token in ["label image", "view label", "front label", "back label", "neck label"]):
        return "label_image"
    return None


def default_local_asset_path(kind: str, url: str, label_index: int) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix == ".jpeg":
        suffix = ".jpg"
    if kind == "printable_cola":
        ext = suffix if suffix in {".pdf", ".html", ".htm", ".jpg", ".jpeg", ".png"} else ".html"
        return f"assets/printable_cola{ext}"
    ext = suffix if suffix in IMAGE_EXTENSIONS else ".bin"
    return f"assets/label_{label_index:02d}{ext}"


def guessed_content_type(url: str) -> str | None:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".html", ".htm"}:
        return "text/html"
    return None


def ttb_id_from_url(url: str) -> str | None:
    match = re.search(r"(?:ttbid|ttb_id)=([A-Za-z0-9]{14})", url or "", flags=re.IGNORECASE)
    return match.group(1) if match else None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html_file", type=Path, help="Saved public COLA detail HTML file")
    parser.add_argument("--detail-url", help="Public registry detail URL for relative link resolution")
    parser.add_argument("--ttb-id", help="Known 14-character TTB ID")
    parser.add_argument("--out", type=Path, help="Output metadata JSON path")
    parser.add_argument("--base-url", default=PUBLIC_DETAIL_BASE_URL, help="Public detail endpoint base URL")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    detail_url = args.detail_url
    if not detail_url and args.ttb_id:
        detail_url = build_detail_url(args.ttb_id, args.base_url)
    metadata = parse_detail_file(args.html_file, detail_url=detail_url, ttb_id_hint=args.ttb_id)
    if args.out:
        write_json(args.out, metadata)
    else:
        import json

        print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
