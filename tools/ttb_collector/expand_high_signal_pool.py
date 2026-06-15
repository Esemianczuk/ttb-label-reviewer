#!/usr/bin/env python3
"""Discover and optionally collect high-signal public COLA fixture records.

This is intentionally a curated expansion tool, not a registry mirror. It uses
the public basic-search POST flow, scores candidate records for the fields this
project validates, and defaults output to the ignored bulk fixture area so a few
hundred training/evaluation records do not bloat the checked-in console build.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from io import BytesIO
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.collect_by_ttb_ids import collect_records, fetch_detail_html, merge_printable_page_assets
from tools.ttb_collector.common import build_detail_url, normalize_space, now_utc_iso, read_json, safe_filename, write_json
from tools.ttb_collector.config.constants import (
    DEFAULT_DELAY_SECONDS,
    DEFAULT_SEARCH_CACHE_DIR,
    PUBLIC_DETAIL_BASE_URL,
    PUBLIC_SEARCH_BASE_URL,
    REQUEST_TIMEOUT_SECONDS,
    USER_AGENT,
)
from tools.ttb_collector.discover_ttb_ids import extract_candidates_from_html
from tools.ttb_collector.download_assets import build_session
from tools.ttb_collector.normalize_metadata import map_product_type, normalize_metadata
from tools.ttb_collector.parse_cola_detail import parse_detail_html


DEFAULT_SEARCH_TERMS = [
    "vodka%",
    "gin%",
    "rum%",
    "whiskey%",
    "whisky%",
    "bourbon%",
    "tequila%",
    "mezcal%",
    "brandy%",
    "liqueur%",
    "cocktail%",
    "margarita%",
    "tonic%",
    "mule%",
    "cabernet%",
    "chardonnay%",
    "pinot%",
    "merlot%",
    "sauvignon%",
    "riesling%",
    "zinfandel%",
    "moscato%",
    "prosecco%",
    "sparkling%",
    "wine%",
    "beer%",
    "ale%",
    "lager%",
    "stout%",
    "porter%",
    "ipa%",
    "pilsner%",
    "gose%",
    "cider%",
    "seltzer%",
    "hard seltzer%",
]

COMMON_FIELD_KEYS = [
    "brandName",
    "classType",
    "alcoholContent",
    "netContents",
    "producerName",
    "countryOfOrigin",
]

ALCOHOL_HINT_RE = re.compile(
    r"(?:\d{1,3}(?:\.\d+)?\s*%\s*(?:ALC|ABV|ALCOHOL|BY\s+VOL|VOL)?|\d{2,3}(?:\.\d+)?\s*PROOF)",
    re.IGNORECASE,
)
NET_CONTENTS_HINT_RE = re.compile(
    r"(?:\d{1,5}(?:\.\d+)?\s*(?:ML|M\s*L|LITER|LITRE|LITERS|LITRES)\b|"
    r"\d{1,3}(?:\.\d+)?\s*FL\.?\s*OZ\.?|"
    r"\d{1,3}\s*P(?:IN)?T(?:\s+\d{1,3}(?:\.\d+)?\s*FL\.?\s*OZ\.?)?)",
    re.IGNORECASE,
)
WARNING_TERMS = ("GOVERNMENT WARNING", "SURGEON GENERAL", "PREGNANCY", "BIRTH DEFECTS", "OPERATE MACHINERY")
RESPONSIBLE_PARTY_HINT_RE = re.compile(r"\b(?:BOTTLED|PRODUCED|IMPORTED|CANNED|BREWED|DISTILLED)\s+BY\b", re.IGNORECASE)

_EASYOCR_READER: Any | None = None


@dataclass(frozen=True)
class SearchQuery:
    term: str
    date_from: str
    date_to: str
    search_type: str = "B"

    @property
    def cache_key(self) -> str:
        return safe_filename(f"{self.date_from}-{self.date_to}-{self.search_type}-{self.term}", "search")


def discover_high_signal_pool(
    *,
    target: int,
    date_from: str,
    date_to: str,
    terms: list[str],
    cache_dir: Path,
    existing_roots: list[Path],
    delay_seconds: float,
    detail_limit: int,
    include_existing: bool,
    search_base_url: str,
    detail_base_url: str,
    ocr_preflight: bool,
    progress_every: int,
    ocr_max_images: int,
    ocr_max_side: int,
) -> dict[str, Any]:
    session = build_session()
    existing_ids = set() if include_existing else known_record_ids(existing_roots)
    try:
        candidates = discover_candidates(
            session=session,
            terms=terms,
            date_from=date_from,
            date_to=date_to,
            cache_dir=cache_dir,
            search_base_url=search_base_url,
        )
        preflighted: list[dict[str, Any]] = []
        seen_detail_ids: set[str] = set()
        for index, candidate in enumerate(candidates):
            ttb_id = candidate.get("ttb_id")
            if not ttb_id or ttb_id in seen_detail_ids:
                continue
            if ttb_id in existing_ids:
                continue
            seen_detail_ids.add(ttb_id)
            if detail_limit and len(preflighted) >= detail_limit:
                break
            if progress_every and len(preflighted) and len(preflighted) % progress_every == 0:
                print(
                    json.dumps(
                        {
                            "preflighted": len(preflighted),
                            "eligible": sum(1 for item in preflighted if int(item.get("score") or 0) >= 70 and int(item.get("asset_count") or 0) > 0),
                            "latest": preflighted[-1].get("ttb_id"),
                        }
                    ),
                    flush=True,
                )
            try:
                preflighted.append(
                    preflight_candidate(
                        candidate,
                        session=session,
                        detail_base_url=detail_base_url,
                        ocr_preflight=ocr_preflight,
                        ocr_max_images=ocr_max_images,
                        ocr_max_side=ocr_max_side,
                    )
                )
            except Exception as error:
                preflighted.append(
                    {
                        **candidate,
                        "score": 0,
                        "selected": False,
                        "preflight_error": str(error),
                    }
                )
            if index < len(candidates) - 1 and delay_seconds > 0:
                time.sleep(delay_seconds)

        selected = select_balanced(preflighted, target)
        return {
            "generated_at": now_utc_iso(),
            "target": target,
            "date_from": date_from,
            "date_to": date_to,
            "search_terms": terms,
            "candidate_count": len(candidates),
            "preflight_count": len(preflighted),
            "selected_count": len(selected),
            "selected": selected,
            "preflighted": preflighted,
            "counts": counts_by_product_type(selected),
        }
    finally:
        session.close()


def discover_candidates(
    *,
    session: requests.Session,
    terms: list[str],
    date_from: str,
    date_to: str,
    cache_dir: Path,
    search_base_url: str,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for term in terms:
        query = SearchQuery(term=term, date_from=date_from, date_to=date_to)
        html, source_url = fetch_search_results(session, query, cache_dir=cache_dir, search_base_url=search_base_url)
        for candidate in extract_candidates_from_html(html, base_url=source_url):
            ttb_id = candidate.get("ttb_id")
            if not ttb_id or ttb_id in seen_ids:
                continue
            seen_ids.add(ttb_id)
            candidates.append({**candidate, "search_term": term})
    return candidates


def fetch_search_results(
    session: requests.Session,
    query: SearchQuery,
    *,
    cache_dir: Path,
    search_base_url: str,
) -> tuple[str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"high_signal_{query.cache_key}.html"
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="replace"), search_process_url(search_base_url)

    search_url = f"{search_base_url}?action=search"
    response = session.get(search_url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()

    data = {
        "searchCriteria.dateCompletedFrom": query.date_from,
        "searchCriteria.dateCompletedTo": query.date_to,
        "searchCriteria.productOrFancifulName": query.term,
        "searchCriteria.productNameSearchType": query.search_type,
        "searchCriteria.classTypeFrom": "",
        "searchCriteria.classTypeTo": "",
        "searchCriteria.originCode": "",
    }
    post_url = search_process_url(search_base_url)
    response = session.post(
        post_url,
        data=data,
        timeout=REQUEST_TIMEOUT_SECONDS,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": search_url,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    response.raise_for_status()
    cache_path.write_text(response.text, encoding="utf-8")
    return response.text, response.url


def search_process_url(search_base_url: str) -> str:
    return urljoin(search_base_url, "/colasonline/publicSearchColasBasicProcess.do?action=search")


def preflight_candidate(
    candidate: dict[str, Any],
    *,
    session: requests.Session,
    detail_base_url: str,
    ocr_preflight: bool,
    ocr_max_images: int,
    ocr_max_side: int,
) -> dict[str, Any]:
    ttb_id = str(candidate.get("ttb_id") or "")
    detail_url = build_detail_url(ttb_id, detail_base_url)
    html, final_url = fetch_detail_html(detail_url, session=session)
    metadata = parse_detail_html(html, detail_url=final_url, ttb_id_hint=ttb_id)
    merge_printable_page_assets(metadata, session=session)
    expected = normalize_metadata(metadata, expected_group=map_product_type(metadata), notes=f"High-signal expansion candidate: {candidate.get('search_term')}")
    fields = expected.get("expected_fields") or {}
    label_images = [asset for asset in metadata.get("assets") or [] if isinstance(asset, dict) and asset.get("kind") == "label_image"]
    ocr_hints = quick_ocr_asset_hints(label_images, session=session, max_images=ocr_max_images, max_side=ocr_max_side) if ocr_preflight else {}
    score, score_reasons = score_expected_record(expected, metadata, ocr_hints=ocr_hints)
    return {
        **candidate,
        "detail_url": detail_url,
        "status": metadata.get("status"),
        "approval_date": metadata.get("approval_date"),
        "product_type": fields.get("productType"),
        "brand_name": fields.get("brandName"),
        "class_type": fields.get("classType"),
        "alcohol_content": fields.get("alcoholContent"),
        "net_contents": fields.get("netContents"),
        "producer_name": (fields.get("responsibleParty") or {}).get("name") if isinstance(fields.get("responsibleParty"), dict) else None,
        "country_of_origin": fields.get("countryOfOrigin"),
        "is_imported": fields.get("isImported"),
        "asset_count": len(label_images),
        "ocr_hints": ocr_hints,
        "score": score,
        "score_reasons": score_reasons,
        "selected": False,
    }


def score_expected_record(expected: dict[str, Any], metadata: dict[str, Any], *, ocr_hints: dict[str, Any] | None = None) -> tuple[int, list[str]]:
    fields = expected.get("expected_fields") or {}
    responsible = fields.get("responsibleParty") or {}
    ocr_hints = ocr_hints or {}
    reasons: list[str] = []
    score = 0

    score += add_score(fields.get("brandName"), 18, "brand", reasons)
    score += add_score(fields.get("classType"), 18, "class/type", reasons)
    score += add_score(fields.get("alcoholContent"), 18, "alcohol metadata", reasons)
    if not normalize_space(fields.get("alcoholContent")) and ocr_hints.get("alcoholHints"):
        score += 14
        reasons.append("alcohol image hint")
    score += add_score(fields.get("netContents"), 18, "net contents metadata", reasons)
    if not normalize_space(fields.get("netContents")) and ocr_hints.get("netContentsHints"):
        score += 14
        reasons.append("net contents image hint")
    score += add_score(responsible.get("name") if isinstance(responsible, dict) else None, 10, "responsible party name metadata", reasons)
    if not normalize_space(responsible.get("name") if isinstance(responsible, dict) else None) and ocr_hints.get("responsiblePartyHint"):
        score += 6
        reasons.append("responsible party image hint")
    score += add_score(responsible.get("address") if isinstance(responsible, dict) else None, 6, "responsible party address", reasons)
    if ocr_hints.get("warningDetected"):
        score += 10
        reasons.append("government warning image hint")

    is_imported = fields.get("isImported") is True or bool(fields.get("countryOfOrigin"))
    if is_imported:
        score += add_score(fields.get("countryOfOrigin"), 8, "country of origin", reasons)
    else:
        score += 4
        reasons.append("domestic/no country-of-origin requirement")

    label_count = sum(1 for asset in metadata.get("assets") or [] if isinstance(asset, dict) and asset.get("kind") == "label_image")
    if label_count:
        score += min(12, 6 + label_count * 2)
        reasons.append(f"{label_count} label image(s)")
    else:
        reasons.append("missing label images")
        score -= 30

    if str(metadata.get("status") or "").strip().upper() == "APPROVED":
        score += 6
        reasons.append("approved")
    else:
        score -= 10
        reasons.append(f"status={metadata.get('status') or 'unknown'}")

    return max(0, score), reasons


def add_score(value: Any, points: int, label: str, reasons: list[str]) -> int:
    if normalize_space(value):
        reasons.append(label)
        return points
    reasons.append(f"missing {label}")
    return 0


def quick_ocr_asset_hints(label_images: list[dict[str, Any]], *, session: requests.Session, max_images: int = 1, max_side: int = 1200) -> dict[str, Any]:
    try:
        from PIL import Image
    except Exception as error:
        return {"available": False, "error": f"Pillow unavailable: {error}"}

    texts: list[str] = []
    errors: list[str] = []
    engines: set[str] = set()
    for asset in label_images[:max_images]:
        url = normalize_space(asset.get("url"))
        if not url:
            continue
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            if not str(response.headers.get("Content-Type") or "").lower().startswith("image/"):
                errors.append(f"{url} returned {response.headers.get('Content-Type')}")
                continue
            image = Image.open(BytesIO(response.content)).convert("RGB")
            image.thumbnail((max_side, max_side))
            image_text, image_engines, image_errors = quick_ocr_image_text(image)
            texts.append(image_text)
            engines.update(image_engines)
            errors.extend(f"{url}: {error}" for error in image_errors)
        except Exception as error:
            errors.append(f"{url}: {error}")

    text = "\n".join(texts)
    upper = text.upper()
    alcohol_hints = sorted(set(normalize_space(match.group(0)) for match in ALCOHOL_HINT_RE.finditer(text)))[:8]
    net_hints = sorted(set(normalize_space(match.group(0)) for match in NET_CONTENTS_HINT_RE.finditer(text)))[:8]
    warning_score = sum(1 for term in WARNING_TERMS if term in upper)
    return {
        "available": True,
        "engines": sorted(engines),
        "textLength": len(text),
        "alcoholHints": alcohol_hints,
        "netContentsHints": net_hints,
        "warningDetected": warning_score >= 2,
        "warningTermHits": warning_score,
        "responsiblePartyHint": bool(RESPONSIBLE_PARTY_HINT_RE.search(text)),
        "sample": normalize_space(text[:500]),
        "errors": errors,
    }


def quick_ocr_image_text(image: Any) -> tuple[str, set[str], list[str]]:
    errors: list[str] = []
    engines: set[str] = set()
    texts: list[str] = []

    try:
        import pytesseract

        for angle in (0, 90, 180, 270):
            rotated = image.rotate(angle, expand=True) if angle else image
            texts.append(pytesseract.image_to_string(rotated, config="--psm 6"))
        engines.add("tesseract")
    except Exception as error:
        errors.append(f"tesseract: {error}")

    if not normalize_space("\n".join(texts)):
        try:
            import numpy as np

            reader = easyocr_reader()
            results = reader.readtext(np.array(image), detail=1, paragraph=False, rotation_info=[90, 180, 270])
            for _bbox, text, _confidence in results:
                texts.append(str(text))
            engines.add("easyocr")
        except Exception as error:
            errors.append(f"easyocr: {error}")
    return "\n".join(texts), engines, errors


def easyocr_reader() -> Any:
    global _EASYOCR_READER
    if _EASYOCR_READER is None:
        import easyocr

        _EASYOCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _EASYOCR_READER


def select_balanced(preflighted: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    eligible = [item for item in preflighted if int(item.get("score") or 0) >= 70 and int(item.get("asset_count") or 0) > 0]
    eligible.sort(key=lambda item: (-int(item.get("score") or 0), str(item.get("ttb_id") or "")))
    buckets: dict[str, list[dict[str, Any]]] = {}
    for item in eligible:
        buckets.setdefault(str(item.get("product_type") or "unknown"), []).append(item)

    selected: list[dict[str, Any]] = []
    product_order = sorted(buckets, key=lambda key: (key == "unknown", key))
    while len(selected) < target and any(buckets.values()):
        for product_type in product_order:
            bucket = buckets.get(product_type) or []
            if not bucket:
                continue
            item = bucket.pop(0)
            item["selected"] = True
            selected.append(item)
            if len(selected) >= target:
                break
    return selected


def counts_by_product_type(records: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        key = str(record.get("product_type") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return counts


def known_record_ids(roots: list[Path]) -> set[str]:
    ids: set[str] = set()
    for root in roots:
        for expected_path in root.glob("records/*/expected.json"):
            try:
                expected = read_json(expected_path)
                if expected.get("ttb_id"):
                    ids.add(str(expected["ttb_id"]))
            except Exception:
                continue
    return ids


def write_seed_yaml(path: Path, records: list[dict[str, Any]]) -> None:
    lines = ["records:"]
    for record in records:
        product_type = record.get("product_type") or "unknown"
        notes = (
            f"High-signal expansion; term={record.get('search_term')}; "
            f"score={record.get('score')}; brand={record.get('brand_name') or 'unknown'}; "
            f"label_images={record.get('asset_count') or 0}."
        )
        lines.append(f'  - ttb_id: "{record["ttb_id"]}"')
        lines.append(f'    expected_group: "{product_type}"')
        lines.append(f'    notes: "{notes.replace(chr(34), chr(39))}"')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_terms(args: argparse.Namespace) -> list[str]:
    terms = list(DEFAULT_SEARCH_TERMS)
    if args.terms_file:
        terms = [line.strip() for line in args.terms_file.read_text(encoding="utf-8").splitlines() if line.strip() and not line.strip().startswith("#")]
    if args.term:
        terms.extend(args.term)
    seen: set[str] = set()
    output: list[str] = []
    for term in terms:
        if term not in seen:
            seen.add(term)
            output.append(term)
    return output


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=int, default=240, help="Number of high-signal records to select")
    parser.add_argument("--detail-limit", type=int, default=0, help="Maximum candidate details to preflight; 0 means all discovered")
    parser.add_argument("--date-from", default="01/01/2024")
    parser.add_argument("--date-to", default="06/13/2026")
    parser.add_argument("--term", action="append", help="Additional product/fanciful search term, e.g. vodka%")
    parser.add_argument("--terms-file", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_SEARCH_CACHE_DIR)
    parser.add_argument("--existing-root", type=Path, action="append", help="Fixture root to exclude from candidate selection; can repeat")
    parser.add_argument("--out-summary", type=Path, default=Path("fixtures/public-cola-registry/bulk/high-signal-selection.json"))
    parser.add_argument("--out-seed", type=Path, default=Path("fixtures/public-cola-registry/bulk/high-signal-seed.yaml"))
    parser.add_argument("--collect", action="store_true", help="Collect selected records after writing the seed")
    parser.add_argument("--collect-out", type=Path, default=Path("fixtures/public-cola-registry/bulk/high-signal-records"))
    parser.add_argument("--delay-seconds", type=float, default=DEFAULT_DELAY_SECONDS)
    parser.add_argument("--include-existing", action="store_true", help="Allow records already in fixtures/public-cola-registry")
    parser.add_argument("--ocr-preflight", action="store_true", help="Run a lightweight Tesseract image preflight to score ABV/net/warning evidence")
    parser.add_argument("--ocr-max-images", type=int, default=1, help="Maximum label images per candidate to OCR during preflight")
    parser.add_argument("--ocr-max-side", type=int, default=1200, help="Maximum image side length for OCR preflight thumbnails")
    parser.add_argument("--progress-every", type=int, default=10, help="Print progress every N preflighted records")
    parser.add_argument("--search-base-url", default=PUBLIC_SEARCH_BASE_URL)
    parser.add_argument("--detail-base-url", default=PUBLIC_DETAIL_BASE_URL)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    terms = parse_terms(args)
    summary = discover_high_signal_pool(
        target=args.target,
        date_from=args.date_from,
        date_to=args.date_to,
        terms=terms,
        cache_dir=args.cache_dir,
        existing_roots=args.existing_root or [Path("fixtures/public-cola-registry"), Path("fixtures/public-cola-registry/bulk/high-signal-records")],
        delay_seconds=args.delay_seconds,
        detail_limit=args.detail_limit,
        include_existing=args.include_existing,
        search_base_url=args.search_base_url,
        detail_base_url=args.detail_base_url,
        ocr_preflight=args.ocr_preflight,
        progress_every=args.progress_every,
        ocr_max_images=args.ocr_max_images,
        ocr_max_side=args.ocr_max_side,
    )
    write_json(args.out_summary, summary)
    write_seed_yaml(args.out_seed, summary["selected"])
    print(json.dumps({key: summary[key] for key in ["candidate_count", "preflight_count", "selected_count", "counts"]}, indent=2))
    print(f"Wrote {args.out_summary}")
    print(f"Wrote {args.out_seed}")

    if args.collect and summary["selected"]:
        records = [
            {
                "ttb_id": record["ttb_id"],
                "expected_group": record.get("product_type") or "unknown",
                "notes": f"High-signal expansion score={record.get('score')}; term={record.get('search_term')}; {', '.join(record.get('score_reasons') or [])}",
            }
            for record in summary["selected"]
        ]
        results = collect_records(
            records,
            out_dir=args.collect_out,
            limit=args.target,
            delay_seconds=args.delay_seconds,
            respect_cache=True,
            refresh=False,
            base_url=args.detail_base_url,
        )
        failures = [result for result in results if result.status == "failed"]
        if failures:
            print(f"{len(failures)} collection failures; see notes.md files under {args.collect_out}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
