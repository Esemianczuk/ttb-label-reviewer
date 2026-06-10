#!/usr/bin/env python3
"""Normalize parsed COLA metadata into app-ready expected fixture JSON."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space, read_json, slugify_value, write_json


WINE_TERMS = {
    "wine",
    "cabernet",
    "chardonnay",
    "pinot",
    "merlot",
    "sauvignon",
    "riesling",
    "zinfandel",
    "appellation",
    "vintage",
}
MALT_TERMS = {"beer", "malt", "ale", "lager", "porter", "stout", "seltzer", "hard seltzer", "cider"}
SPIRITS_TERMS = {
    "distilled spirits",
    "spirit",
    "vodka",
    "whiskey",
    "whisky",
    "bourbon",
    "rye",
    "rum",
    "gin",
    "tequila",
    "mezcal",
    "brandy",
    "liqueur",
    "cordial",
}


def normalize_metadata(metadata: dict[str, Any], *, expected_group: str | None = None, notes: str | None = None) -> dict[str, Any]:
    application = metadata.get("application") or {}
    ttb_id = normalize_space(metadata.get("ttb_id")) or "unknown"
    brand_name = nullable_string(application.get("brand_name"))
    product_type = map_product_type(metadata, expected_group=expected_group)
    alcohol_content = nullable_string(application.get("alcohol_content"))
    abv = parse_abv_percent(alcohol_content)
    limitations: list[str] = []

    if alcohol_content and abv is None:
        limitations.append("Alcohol content was present but could not be parsed as ABV or proof.")
    if not alcohol_content:
        limitations.append("Alcohol content was not available in parsed registry metadata; government warning requirement defaults to true.")

    government_warning_required = True if abv is None else abv >= 0.5
    origin = nullable_string(application.get("origin"))
    applicant_name = nullable_string(application.get("applicant_name") or metadata.get("applicant_name"))
    applicant_address = nullable_string(application.get("applicant_address") or metadata.get("applicant_address"))

    if notes:
        limitations.append(f"Collector note: {notes}")

    slug_brand = slugify_value(brand_name or "unknown-brand")
    return {
        "fixture_id": f"ttb_{ttb_id}_{slug_brand}",
        "source_type": "official_public_registry",
        "ttb_id": ttb_id,
        "expected_fields": {
            "brandName": brand_name,
            "fancifulName": nullable_string(application.get("fanciful_name")),
            "classType": nullable_string(application.get("class_type")),
            "productType": product_type,
            "alcoholContent": alcohol_content,
            "netContents": nullable_string(application.get("net_contents")),
            "governmentWarningRequired": government_warning_required,
            "isImported": None,
            "countryOfOrigin": origin,
            "responsibleParty": {"name": applicant_name, "address": applicant_address},
        },
        "assets": normalize_expected_assets(metadata.get("assets") or []),
        "known_limitations": limitations,
    }


def nullable_string(value: Any) -> str | None:
    clean = normalize_space(value)
    return clean or None


def map_product_type(metadata: dict[str, Any], *, expected_group: str | None = None) -> str:
    if expected_group in {"distilled_spirits", "wine", "malt_beverage", "unknown"}:
        return expected_group
    haystack_parts: list[str] = []
    application = metadata.get("application") or {}
    for key in ["product_type", "class_type", "brand_name", "fanciful_name", "origin", "appellation"]:
        haystack_parts.append(normalize_space(application.get(key)))
    for field in metadata.get("raw_fields") or []:
        if isinstance(field, dict):
            haystack_parts.append(normalize_space(field.get("label")))
            haystack_parts.append(normalize_space(field.get("value")))
    haystack = " ".join(haystack_parts).lower()

    if contains_any(haystack, WINE_TERMS):
        return "wine"
    if contains_any(haystack, MALT_TERMS):
        return "malt_beverage"
    if contains_any(haystack, SPIRITS_TERMS):
        return "distilled_spirits"
    return "unknown"


def contains_any(haystack: str, terms: set[str]) -> bool:
    return any(term in haystack for term in terms)


def parse_abv_percent(value: str | None) -> float | None:
    text = normalize_space(value).lower()
    if not text:
        return None

    proof_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:degree\s*)?proof\b", text)
    if proof_match:
        return float(proof_match.group(1)) / 2.0

    percent_candidates = [float(match) for match in re.findall(r"(\d+(?:\.\d+)?)\s*%", text)]
    if percent_candidates:
        return percent_candidates[0]

    abv_match = re.search(r"\b(?:abv|alc(?:ohol)?(?:/vol| by volume)?)\D{0,12}(\d+(?:\.\d+)?)\b", text)
    if abv_match:
        return float(abv_match.group(1))

    trailing_abv_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:abv|alc/vol|alcohol by volume)\b", text)
    if trailing_abv_match:
        return float(trailing_abv_match.group(1))

    return None


def normalize_expected_assets(assets: list[Any]) -> list[dict[str, Any]]:
    expected_assets: list[dict[str, Any]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        local_path = normalize_space(asset.get("local_path"))
        if not local_path:
            continue
        kind = normalize_space(asset.get("kind"))
        role = "unknown_label_image" if kind == "label_image" else kind or "registry_asset"
        expected_assets.append({"file": local_path, "role": role, "expected_ocr_targets": []})
    return expected_assets


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True, help="metadata.json path")
    parser.add_argument("--out", type=Path, help="Output expected.json path; defaults beside metadata")
    parser.add_argument("--expected-group", choices=["distilled_spirits", "wine", "malt_beverage", "unknown"])
    parser.add_argument("--notes")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    metadata = read_json(args.metadata)
    expected = normalize_metadata(metadata, expected_group=args.expected_group, notes=args.notes)
    write_json(args.out or args.metadata.parent / "expected.json", expected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
