from __future__ import annotations

from pathlib import Path
from typing import Any
import json


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_summary(path: Path, payload: dict[str, Any]) -> None:
    rows = []
    for result in payload["results"]:
        fields = result["scores"].get("field_scores", {})
        field_bits = []
        for name, score in fields.items():
            field_bits.append(f"{name}:{score['score']:.2f}")
        rows.append(
            {
                "engine": result["engine"],
                "case": result["case_id"],
                "kind": result["kind"],
                "score": result["scores"]["score"],
                "ms": result["duration_ms"],
                "chars": result["scores"]["char_count"],
                "fields": " ".join(field_bits),
                "status": result["status"],
            }
        )

    rows.sort(key=lambda row: (row["status"] != "ok", -row["score"], row["ms"]))

    lines = [
        "# OCR Stage-One Benchmark",
        "",
        f"Run ID: `{payload['run_id']}`",
        "",
        "## Environment",
        "",
    ]
    for key, value in payload["environment"].items():
        lines.append(f"- `{key}`: {value}")
    lines.extend(
        [
            "",
            "## Results",
            "",
            "| Engine | Case | Kind | Score | Time ms | Chars | Status | Field Scores |",
            "|---|---|---|---:|---:|---:|---|---|",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['engine']} | {row['case']} | {row['kind']} | {row['score']:.3f} | "
            f"{row['ms']} | {row['chars']} | {row['status']} | {row['fields']} |"
        )
    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Scores are stage-one OCR evaluation signals, not final validation decisions.",
            "- A strong OCR candidate should score high without relying on aggressive downstream fuzzy matching.",
            "- Review `results.json` for raw OCR text and per-image metadata.",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
