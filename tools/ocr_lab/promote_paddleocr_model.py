#!/usr/bin/env python3
"""Promote exported PaddleOCR model dirs only when metrics beat baseline."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


REQUIRED_DIRS = ("rec",)
OPTIONAL_DIRS = ("det", "cls")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def metric(payload: dict[str, Any], group: str, key: str, default: float = 0.0) -> float:
    value = (payload.get(group) or {}).get(key)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def validate_candidate_dirs(candidate_dir: Path) -> None:
    missing = [name for name in REQUIRED_DIRS if not (candidate_dir / name).is_dir()]
    if missing:
        raise SystemExit(f"Candidate model is missing required exported dirs: {', '.join(missing)}")


def promotion_allowed(metrics: dict[str, Any], *, min_recall_gain: float, max_false_pass_delta: float) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    baseline_recall = metric(metrics, "baseline", "fieldRecall")
    candidate_recall = metric(metrics, "candidate", "fieldRecall")
    baseline_false_pass = metric(metrics, "baseline", "falsePassRate")
    candidate_false_pass = metric(metrics, "candidate", "falsePassRate")
    recall_gain = candidate_recall - baseline_recall
    false_pass_delta = candidate_false_pass - baseline_false_pass
    if recall_gain < min_recall_gain:
        reasons.append(f"fieldRecall gain {recall_gain:.4f} is below required {min_recall_gain:.4f}")
    if false_pass_delta > max_false_pass_delta:
        reasons.append(f"falsePassRate delta {false_pass_delta:.4f} exceeds allowed {max_false_pass_delta:.4f}")
    return not reasons, reasons


def promote(candidate_dir: Path, target_dir: Path, metrics_path: Path, metrics: dict[str, Any]) -> None:
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = target_dir.with_name(target_dir.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for dirname in (*REQUIRED_DIRS, *OPTIONAL_DIRS):
        source = candidate_dir / dirname
        if source.is_dir():
            shutil.copytree(source, staging / dirname)
    shutil.copy2(metrics_path, staging / "promotion-metrics.json")
    model_card = {
        "source": str(candidate_dir),
        "metrics": metrics,
        "status": "promoted",
        "note": "Promoted by tools/ocr_lab/promote_paddleocr_model.py after metrics guard passed.",
    }
    (staging / "model-card.json").write_text(json.dumps(model_card, indent=2) + "\n", encoding="utf-8")
    if target_dir.exists():
        backup = target_dir.with_name(target_dir.name + ".previous")
        if backup.exists():
            shutil.rmtree(backup)
        target_dir.rename(backup)
    staging.rename(target_dir)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--target-dir", type=Path, default=Path("models/ocr/paddle-cola/current"))
    parser.add_argument("--min-recall-gain", type=float, default=0.01)
    parser.add_argument("--max-false-pass-delta", type=float, default=0.0)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    validate_candidate_dirs(args.candidate_dir)
    metrics = read_json(args.metrics)
    allowed, reasons = promotion_allowed(
        metrics,
        min_recall_gain=args.min_recall_gain,
        max_false_pass_delta=args.max_false_pass_delta,
    )
    if not allowed:
        raise SystemExit("Promotion blocked: " + "; ".join(reasons))
    if args.dry_run:
        print(json.dumps({"ok": True, "dryRun": True, "targetDir": str(args.target_dir)}, indent=2))
        return 0
    promote(args.candidate_dir, args.target_dir, args.metrics, metrics)
    print(json.dumps({"ok": True, "promoted": str(args.target_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
