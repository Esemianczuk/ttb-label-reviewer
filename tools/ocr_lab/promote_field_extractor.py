#!/usr/bin/env python3
"""Promote a LayoutLMv3 field extractor only when metrics clear the gate."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_MODEL_FILES = ("config.json",)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_model_dir(model_dir: Path) -> None:
    if not model_dir.is_dir():
        raise SystemExit(f"Candidate model dir does not exist: {model_dir}")
    missing = [name for name in REQUIRED_MODEL_FILES if not (model_dir / name).exists()]
    if missing:
        raise SystemExit(f"Candidate model is missing required files: {', '.join(missing)}")
    if not any((model_dir / name).exists() for name in ("model.safetensors", "pytorch_model.bin")):
        raise SystemExit("Candidate model is missing model.safetensors or pytorch_model.bin.")


def metric(metrics: dict[str, Any], group: str, key: str) -> float:
    try:
        return float((metrics.get(group) or {}).get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def promotion_reasons(metrics: dict[str, Any], *, min_recall_gain: float, max_false_pass_delta: float, max_p95_ms: float) -> list[str]:
    baseline_recall = metric(metrics, "baseline", "fieldRecall")
    candidate_recall = metric(metrics, "candidate", "fieldRecall")
    baseline_false_pass = metric(metrics, "baseline", "falsePassRate")
    candidate_false_pass = metric(metrics, "candidate", "falsePassRate")
    p95 = float(((metrics.get("candidate") or {}).get("latencyMs") or {}).get("p95") or 0)
    reasons = []
    if candidate_recall - baseline_recall < min_recall_gain:
        reasons.append(f"fieldRecall gain {candidate_recall - baseline_recall:.4f} is below {min_recall_gain:.4f}")
    if candidate_false_pass - baseline_false_pass > max_false_pass_delta:
        reasons.append(f"falsePassRate delta {candidate_false_pass - baseline_false_pass:.4f} exceeds {max_false_pass_delta:.4f}")
    if p95 and p95 > max_p95_ms:
        reasons.append(f"p95 latency {p95:.1f} ms exceeds {max_p95_ms:.1f} ms")
    return reasons


def promote(candidate_model_dir: Path, target_dir: Path, metrics_path: Path, model_card_path: Path | None, metrics: dict[str, Any]) -> None:
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = target_dir.with_name(target_dir.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(candidate_model_dir, staging)
    shutil.copy2(metrics_path, staging / "eval-metrics.json")
    model_card = read_json(model_card_path) if model_card_path and model_card_path.exists() else {}
    model_card = {
        **model_card,
        "status": "promoted",
        "promotedAt": datetime.now(timezone.utc).isoformat(),
        "sourceModelDir": str(candidate_model_dir),
        "metrics": {"baseline": metrics.get("baseline"), "candidate": metrics.get("candidate")},
        "note": "Promoted only after field recall and false-pass gates passed. Deterministic validators remain authoritative.",
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
    parser.add_argument("--candidate-model-dir", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--model-card", type=Path)
    parser.add_argument("--target-dir", type=Path, default=Path("models/field-extractor/layoutlmv3-cola/current"))
    parser.add_argument("--min-recall-gain", type=float, default=0.01)
    parser.add_argument("--max-false-pass-delta", type=float, default=0.0)
    parser.add_argument("--max-p95-ms", type=float, default=5000)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    validate_model_dir(args.candidate_model_dir)
    metrics = read_json(args.metrics)
    reasons = promotion_reasons(
        metrics,
        min_recall_gain=args.min_recall_gain,
        max_false_pass_delta=args.max_false_pass_delta,
        max_p95_ms=args.max_p95_ms,
    )
    if reasons:
        raise SystemExit("Promotion blocked: " + "; ".join(reasons))
    if args.dry_run:
        print(json.dumps({"ok": True, "dryRun": True, "targetDir": str(args.target_dir)}, indent=2))
        return 0
    promote(args.candidate_model_dir, args.target_dir, args.metrics, args.model_card, metrics)
    print(json.dumps({"ok": True, "promoted": str(args.target_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
