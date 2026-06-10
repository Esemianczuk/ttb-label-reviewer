#!/usr/bin/env python3
"""Select a small balanced fixture seed list from discovery candidate JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:  # Allow direct script execution.
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.normalize_metadata import map_product_type


DEFAULT_QUOTAS = {
    "distilled_spirits": 5,
    "wine": 5,
    "malt_beverage": 5,
    "unknown": 5,
}


def select_curated_candidates(candidate_files: list[Path], quotas: dict[str, int] | None = None) -> list[dict[str, Any]]:
    quotas = quotas or DEFAULT_QUOTAS
    buckets: dict[str, list[dict[str, Any]]] = {key: [] for key in quotas}
    for candidate_file in candidate_files:
        payload = json.loads(candidate_file.read_text(encoding="utf-8"))
        query = payload.get("query") or {}
        for candidate in payload.get("candidates") or []:
            group = classify_candidate(candidate, query)
            buckets.setdefault(group, []).append(candidate)

    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for group, quota in quotas.items():
        for candidate in buckets.get(group, []):
            ttb_id = candidate.get("ttb_id")
            if not ttb_id or ttb_id in seen_ids:
                continue
            seen_ids.add(ttb_id)
            selected.append(
                {
                    "ttb_id": ttb_id,
                    "expected_group": group,
                    "notes": f"Selected from discovery output; brand={candidate.get('brand_name') or 'unknown'}",
                }
            )
            if len([item for item in selected if item["expected_group"] == group]) >= quota:
                break
    return selected


def classify_candidate(candidate: dict[str, Any], query: dict[str, Any]) -> str:
    fake_metadata = {
        "application": {
            "brand_name": candidate.get("brand_name"),
            "class_type": query.get("class_type"),
            "product_type": query.get("commodity"),
        },
        "raw_fields": [{"label": "summary", "value": candidate.get("summary")}],
    }
    return map_product_type(fake_metadata)


def write_yaml_records(path: Path, records: list[dict[str, Any]]) -> None:
    lines = ["records:"]
    for record in records:
        lines.append(f'  - ttb_id: "{record["ttb_id"]}"')
        lines.append(f'    expected_group: "{record["expected_group"]}"')
        lines.append(f'    notes: "{record["notes"].replace(chr(34), chr(39))}"')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_json", type=Path, nargs="+")
    parser.add_argument("--out", type=Path, default=Path("tools/ttb_collector/fixtures.curated.yaml"))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    records = select_curated_candidates(args.candidate_json)
    write_yaml_records(args.out, records)
    print(f"Wrote {len(records)} curated seed records to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
