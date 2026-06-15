#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "fixtures" / "public-cola-registry" / "records"
BENCHMARK_PATH = ROOT / "benchmarks" / "results" / "latest.json"
CORRECTION_RECORD_ID = "19350001000429"


def expected_field_present(fields: dict, key: str) -> bool:
    if key == "governmentWarningRequired":
        return fields.get(key) is True
    return bool(fields.get(key))


def fixture_summary() -> dict:
    records = []
    field_counts = Counter()
    demo_field_counts = Counter()
    label_assets = 0
    for expected_path in sorted(FIXTURE_ROOT.glob("*/expected.json")):
        expected = json.loads(expected_path.read_text())
        fields = expected.get("expected_fields") or {}
        demo_ready = expected.get("demo_ready") is not False
        assets = expected.get("assets") or []
        label_assets += sum(
            1
            for asset in assets
            if "label" in str(asset.get("role", "")).lower()
            or str(asset.get("file", "")).lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        )
        records.append({"id": expected_path.parent.name, "demoReady": demo_ready})

        for key in (
            "brandName",
            "classType",
            "productType",
            "alcoholContent",
            "netContents",
            "governmentWarningRequired",
            "countryOfOrigin",
            "fancifulName",
        ):
            if expected_field_present(fields, key):
                field_counts[key] += 1
                if demo_ready:
                    demo_field_counts[key] += 1

        party = fields.get("responsibleParty") or {}
        for key in ("name", "address"):
            if party.get(key):
                field = f"responsibleParty.{key}"
                field_counts[field] += 1
                if demo_ready:
                    demo_field_counts[field] += 1

    return {
        "storedRecords": len(records),
        "demoReadyRecords": sum(1 for record in records if record["demoReady"]),
        "initialReviewerSubmittedRecords": sum(
            1 for record in records if record["demoReady"] and record["id"] != CORRECTION_RECORD_ID
        ),
        "initialCorrectionWorkflowRecords": sum(
            1 for record in records if record["demoReady"] and record["id"] == CORRECTION_RECORD_ID
        ),
        "retainedNotDemoReady": sum(1 for record in records if not record["demoReady"]),
        "labelAssets": label_assets,
        "averageLabelAssetsPerRecord": round(label_assets / len(records), 2) if records else 0,
        "fieldCountsAllRecords": dict(sorted(field_counts.items())),
        "fieldCountsDemoReady": dict(sorted(demo_field_counts.items())),
    }


def benchmark_summary() -> list[dict]:
    if not BENCHMARK_PATH.exists():
        return []
    benchmark = json.loads(BENCHMARK_PATH.read_text())
    rows = []
    for run in benchmark.get("runs") or []:
        rows.append(
            {
                "mode": run.get("mode"),
                "images": run.get("imageCount"),
                "engine": run.get("engineUsed"),
                "averageMsPerImage": run.get("averageMsPerImage"),
                "p50MsPerImage": run.get("p50MsPerImage"),
                "p95MsPerImage": run.get("p95MsPerImage"),
                "imagesPerMinute": run.get("imagesPerMinute"),
                "failures": run.get("failures"),
                "notes": run.get("notes"),
            }
        )
    return rows


def main() -> None:
    print(json.dumps({"fixtures": fixture_summary(), "benchmarks": benchmark_summary()}, indent=2))


if __name__ == "__main__":
    main()
