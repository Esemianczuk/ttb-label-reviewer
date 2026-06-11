#!/usr/bin/env python3
"""Best-effort discovery of candidate public COLA TTB IDs from search pages."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space, now_utc_iso, safe_filename, write_json
from tools.ttb_collector.config.constants import (
    DEFAULT_SEARCH_CACHE_DIR,
    PUBLIC_SEARCH_BASE_URL,
    REQUEST_TIMEOUT_SECONDS,
    USER_AGENT,
)


TTB_ID_LINK_RE = re.compile(r"(?:ttbid|ttb_id)=([A-Za-z0-9]{14})", re.IGNORECASE)


def discover_candidates(
    query: dict[str, Any],
    *,
    max_results: int,
    cache_dir: Path = DEFAULT_SEARCH_CACHE_DIR,
    use_browser: bool = False,
    html_file: Path | None = None,
    search_base_url: str = PUBLIC_SEARCH_BASE_URL,
) -> dict[str, Any]:
    if html_file:
        html = html_file.read_text(encoding="utf-8", errors="replace")
        source_url = html_file.expanduser().resolve().as_uri()
    elif use_browser:
        html, source_url = fetch_search_with_browser(query, search_base_url=search_base_url)
    else:
        html, source_url = fetch_search_static(query, cache_dir=cache_dir, search_base_url=search_base_url)

    candidates = extract_candidates_from_html(html, base_url=source_url)
    return {
        "generated_at": now_utc_iso(),
        "query": query,
        "source_url": source_url,
        "candidates": candidates[:max_results],
    }


def fetch_search_static(query: dict[str, Any], *, cache_dir: Path, search_base_url: str) -> tuple[str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    url = build_search_url(query, search_base_url)
    cache_name = safe_filename(urlparse(url).query or "search", "search") + ".html"
    cache_path = cache_dir / cache_name
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="replace"), url

    response = requests.get(
        url,
        timeout=REQUEST_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
    )
    response.raise_for_status()
    cache_path.write_text(response.text, encoding="utf-8")
    return response.text, response.url


def build_search_url(query: dict[str, Any], search_base_url: str = PUBLIC_SEARCH_BASE_URL) -> str:
    parsed = urlparse(search_base_url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params.setdefault("action", "search")
    if query.get("commodity"):
        params["commodity"] = query["commodity"]
    if query.get("brand"):
        params["brandName"] = query["brand"]
    if query.get("status"):
        params["status"] = query["status"]
    if query.get("class_type"):
        params["classType"] = query["class_type"]
    return urlunparse(parsed._replace(query=urlencode(params)))


def fetch_search_with_browser(query: dict[str, Any], *, search_base_url: str) -> tuple[str, str]:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - depends on optional install
        raise RuntimeError("Playwright fallback requested but playwright is not installed.") from exc

    url = build_search_url(query, search_base_url)
    with sync_playwright() as playwright:  # pragma: no cover - intentionally optional
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(user_agent=USER_AGENT)
        page.goto(url, wait_until="networkidle", timeout=REQUEST_TIMEOUT_SECONDS * 1000)
        html = page.content()
        final_url = page.url
        browser.close()
    return html, final_url


def extract_candidates_from_html(html: str, *, base_url: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for link in soup.find_all("a", href=True):
        href = link["href"]
        match = TTB_ID_LINK_RE.search(href)
        if not match:
            continue
        ttb_id = match.group(1)
        if ttb_id in seen_ids:
            continue
        seen_ids.add(ttb_id)
        row = link.find_parent("tr")
        row_text = normalize_space(row.get_text(" ", strip=True)) if row else normalize_space(link.get_text(" ", strip=True))
        candidates.append(
            {
                "ttb_id": ttb_id,
                "brand_name": extract_table_value(row, ["brand", "brand name"]) if row else None,
                "serial_number": extract_table_value(row, ["serial", "serial number"]) if row else None,
                "origin": "registry_search",
                "detail_url": urljoin(base_url, href),
                "summary": row_text or None,
            }
        )

    if not candidates:
        for match in TTB_ID_LINK_RE.finditer(html):
            ttb_id = match.group(1)
            if ttb_id in seen_ids:
                continue
            seen_ids.add(ttb_id)
            candidates.append(
                {
                    "ttb_id": ttb_id,
                    "brand_name": None,
                    "serial_number": None,
                    "origin": "registry_search",
                    "detail_url": urljoin(base_url, match.group(0)),
                }
            )

    return candidates


def extract_table_value(row: Any, possible_headers: list[str]) -> str | None:
    cells = row.find_all(["td", "th"]) if row else []
    if not cells:
        return None
    texts = [normalize_space(cell.get_text(" ", strip=True)) for cell in cells]
    for index, text in enumerate(texts[:-1]):
        label = text.lower().rstrip(":")
        if any(header == label or header in label for header in possible_headers):
            return texts[index + 1] or None
    if possible_headers[0].startswith("brand") and len(texts) >= 2:
        return texts[1] or None
    if possible_headers[0].startswith("serial") and len(texts) >= 3:
        return texts[2] or None
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commodity")
    parser.add_argument("--brand")
    parser.add_argument("--status")
    parser.add_argument("--class-type")
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--use-browser", action="store_true", help="Use optional Playwright fallback")
    parser.add_argument("--html-file", type=Path, help="Parse a saved search-results HTML file")
    parser.add_argument("--search-base-url", default=PUBLIC_SEARCH_BASE_URL)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    query = {
        "commodity": args.commodity,
        "brand": args.brand,
        "status": args.status,
        "class_type": args.class_type,
    }
    result = discover_candidates(
        query,
        max_results=args.max_results,
        use_browser=args.use_browser,
        html_file=args.html_file,
        search_base_url=args.search_base_url,
    )
    write_json(args.out, result)
    if not result["candidates"]:
        print(
            "Automatic discovery could not parse the registry search results. "
            "Use manual_capture_helper.py or provide known TTB IDs.",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
