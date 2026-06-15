#!/usr/bin/env python3
"""Evaluate weak alignment and optional LayoutLMv3 field extractor candidates."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.build_layoutlmv3_ner_dataset import read_jsonl
from tools.ocr_lab.field_extractor_metrics import dataset_hash, labels_from_tags, summarize_label_predictions, write_json
from tools.ocr_lab.train_layoutlmv3_token_classifier import predict_labels


def evaluate(rows: list[dict[str, Any]], *, dataset_path: Path, model_dir: Path | None, max_length: int) -> dict[str, Any]:
    eval_rows = [row for row in rows if str(row.get("split") or "") == "test"] or [row for row in rows if str(row.get("split") or "") in {"val", "validation"}] or rows
    baseline_predictions = {
        str(row.get("id") or ""): labels_from_tags(row.get("weak_ner_labels") or row.get("ner_labels") or row.get("ner_tags") or [])
        for row in eval_rows
    }
    baseline = summarize_label_predictions(eval_rows, baseline_predictions)
    candidate = baseline
    model_status = {"available": False, "status": "not_configured", "modelDir": str(model_dir) if model_dir else None}
    if model_dir:
        if not model_dir.exists():
            raise SystemExit(f"Missing model dir: {model_dir}")
        import torch
        from transformers import AutoProcessor, LayoutLMv3ForTokenClassification

        processor = AutoProcessor.from_pretrained(str(model_dir), apply_ocr=False)
        model = LayoutLMv3ForTokenClassification.from_pretrained(str(model_dir))
        model.eval()
        predicted, latency = predict_labels(model, processor, eval_rows, max_length=max_length, torch=torch)
        candidate = summarize_label_predictions(eval_rows, predicted, latency_ms_by_id=latency)
        model_status = {"available": True, "status": "loaded", "modelDir": str(model_dir)}
    return {
        "dataset": str(dataset_path),
        "datasetSha256": dataset_hash(dataset_path),
        "evaluationSplit": str(eval_rows[0].get("split") or "all") if eval_rows else "empty",
        "model": model_status,
        "baseline": baseline,
        "candidate": candidate,
        "summary": {
            "candidateBeatsBaselineRecall": candidate["fieldRecall"] > baseline["fieldRecall"],
            "falsePassDelta": round(candidate["falsePassRate"] - baseline["falsePassRate"], 6),
            "p95TotalMs": candidate.get("latencyMs", {}).get("p95", 0),
        },
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/reviewed-dataset.jsonl"))
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/eval-metrics.json"))
    parser.add_argument("--failure-report", type=Path)
    parser.add_argument("--max-length", type=int, default=512)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.dataset.exists():
        raise SystemExit(f"Missing dataset: {args.dataset}")
    metrics = evaluate(read_jsonl(args.dataset), dataset_path=args.dataset, model_dir=args.model_dir, max_length=args.max_length)
    write_json(args.out, metrics)
    failure_report = args.failure_report or args.out.with_name("failure-report.json")
    write_json(
        failure_report,
        {
            "dataset": str(args.dataset),
            "modelDir": str(args.model_dir) if args.model_dir else None,
            "failures": metrics.get("candidate", {}).get("failures", []),
        },
    )
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
