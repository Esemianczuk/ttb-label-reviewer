#!/usr/bin/env python3
"""Generate synthetic full-image OCR rows for LayoutLMv3 extractor pretraining."""

from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.stage_training_data import fixture_records


def selected_records(fixture_root: Path, limit: int) -> list[dict[str, Any]]:
    records = fixture_records([fixture_root])
    return records[:limit] if limit else records


def generate_rows(records: list[dict[str, Any]], *, model: str, host: str, use_ollama: bool, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    rows = []
    for index, record in enumerate(records):
        fields = record.get("fields") or {}
        generated = generate_with_ollama(fields, model=model, host=host) if use_ollama else None
        if not generated:
            generated = deterministic_template(fields, rng=rng)
        words, lines = layout_words(generated["ocrText"], rng=rng)
        rows.append(
            {
                "id": f"synthetic-{record['recordId']}-{index + 1}",
                "recordId": record["recordId"],
                "split": "train",
                "image": "",
                "expectedFields": fields,
                "engine": "synthetic-ollama" if generated.get("source") == "ollama" else "synthetic-template",
                "text": generated["ocrText"],
                "confidence": 0.9,
                "lines": lines,
                "words": words,
                "metadata": {
                    "imageWidth": 1000,
                    "imageHeight": 1000,
                    "synthetic": True,
                    "source": generated.get("source"),
                    "model": model if generated.get("source") == "ollama" else None,
                    "knownEntities": generated.get("entities") or [],
                    "warning": "Synthetic OCR rows are for pretraining/augmentation only; do not use them as final validation truth.",
                },
            }
        )
    return rows


def generate_with_ollama(fields: dict[str, Any], *, model: str, host: str) -> dict[str, Any] | None:
    prompt = (
        "Return strict JSON only. Create plausible OCR output for an alcohol beverage label. "
        "Use the provided field values exactly when visible. Include OCR-like line breaks and mild OCR noise, "
        "but keep the known values recoverable. JSON shape: "
        '{"ocrText": string, "entities": [{"fieldKey": string, "text": string}]}.\n'
        f"Fields: {json.dumps(fields, ensure_ascii=False)}"
    )
    payload = json.dumps({"model": model, "prompt": prompt, "stream": False, "options": {"temperature": 0.45}}).encode("utf-8")
    request = urllib.request.Request(f"{host.rstrip('/')}/api/generate", data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    text = str(body.get("response") or "").strip()
    parsed = parse_json_object(text)
    if not parsed or not parsed.get("ocrText"):
        return None
    return {"source": "ollama", "ocrText": str(parsed["ocrText"]), "entities": parsed.get("entities") or []}


def parse_json_object(text: str) -> dict[str, Any] | None:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def deterministic_template(fields: dict[str, Any], *, rng: random.Random) -> dict[str, Any]:
    lines = [
        str(fields.get("brandName") or "SAMPLE BRAND"),
        str(fields.get("fancifulName") or ""),
        str(fields.get("classType") or "DISTILLED SPIRITS SPECIALTY"),
        str(fields.get("alcoholContent") or "40% ALC/VOL"),
        str(fields.get("netContents") or "750 mL"),
        str(fields.get("producerName") or ""),
        str(fields.get("countryOfOrigin") or ""),
        "GOVERNMENT WARNING: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy.",
        "Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    ]
    middle = lines[1:5]
    rng.shuffle(middle)
    lines = [lines[0], *middle, *lines[5:]]
    clean_lines = [line for line in lines if line and line.lower() != "none"]
    return {
        "source": "deterministic-template",
        "ocrText": "\n".join(clean_lines),
        "entities": [{"fieldKey": key, "text": str(value)} for key, value in fields.items() if value],
    }


def layout_words(text: str, *, rng: random.Random) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    words = []
    lines = []
    y = 80
    for line in text.splitlines():
        line = " ".join(line.split())
        if not line:
            continue
        x = rng.randint(70, 220)
        height = rng.randint(24, 42)
        width = min(860, max(80, len(line) * rng.randint(9, 14)))
        line_box = {"x": float(x), "y": float(y), "width": float(width), "height": float(height)}
        lines.append({"text": line, "confidence": 0.92, "bbox": line_box})
        tokens = line.split()
        total_chars = max(1, sum(len(token) for token in tokens))
        cursor = float(x)
        for token in tokens:
            token_width = float(width) * (len(token) / total_chars)
            words.append(
                {
                    "text": token,
                    "confidence": round(rng.uniform(0.82, 0.98), 4),
                    "bbox": {"x": cursor, "y": float(y), "width": token_width, "height": float(height)},
                }
            )
            cursor += token_width
        y += height + rng.randint(14, 38)
    return words, lines


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=False) + "\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, default=Path("fixtures/public-cola-registry"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/synthetic-ocr.jsonl"))
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--ollama", action="store_true", help="Use local Ollama when available; falls back to deterministic templates.")
    parser.add_argument("--ollama-host", default="http://127.0.0.1:11434")
    parser.add_argument("--model", default="deepseek-r1:1.5b")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    rows = generate_rows(selected_records(args.fixture_root, args.limit), model=args.model, host=args.ollama_host, use_ollama=args.ollama, seed=args.seed)
    write_jsonl(args.out, rows)
    summary = {
        "rows": len(rows),
        "tokens": sum(len(row.get("words") or []) for row in rows),
        "ollamaRequested": args.ollama,
        "ollamaRows": sum(1 for row in rows if row.get("engine") == "synthetic-ollama"),
        "model": args.model,
    }
    args.out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
