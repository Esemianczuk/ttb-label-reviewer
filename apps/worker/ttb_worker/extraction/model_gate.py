from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


PROMOTED_STATUSES = {"promoted", "production", "production-ready"}


def model_quality_gate(model_dir: Path) -> dict[str, Any]:
    model_card = read_json(model_dir / "model-card.json") or {}
    metrics = read_json(model_dir / "eval-metrics.json") or model_card.get("metrics") or {}
    status = str(model_card.get("status") or "").strip().lower()
    if status not in PROMOTED_STATUSES:
        return {
            "allowed": False,
            "reason": "LayoutLMv3 artifact is present but is not promoted; runtime will use PaddleOCR weak alignment.",
            "modelCard": model_card,
            "metrics": metrics,
        }

    baseline_recall = metric(metrics, "baseline", "fieldRecall")
    candidate_recall = metric(metrics, "candidate", "fieldRecall")
    baseline_false_pass = metric(metrics, "baseline", "falsePassRate")
    candidate_false_pass = metric(metrics, "candidate", "falsePassRate")
    if candidate_recall < baseline_recall:
        return {
            "allowed": False,
            "reason": f"LayoutLMv3 promotion gate failed: candidate fieldRecall {candidate_recall:.4f} is below baseline {baseline_recall:.4f}.",
            "modelCard": model_card,
            "metrics": metrics,
        }
    if candidate_false_pass > baseline_false_pass:
        return {
            "allowed": False,
            "reason": f"LayoutLMv3 promotion gate failed: candidate falsePassRate {candidate_false_pass:.4f} exceeds baseline {baseline_false_pass:.4f}.",
            "modelCard": model_card,
            "metrics": metrics,
        }
    return {
        "allowed": True,
        "reason": "Promoted LayoutLMv3 model passed runtime quality gates.",
        "modelCard": model_card,
        "metrics": metrics,
    }


def model_files_present(model_dir: Path) -> bool:
    return (model_dir / "config.json").exists() and any((model_dir / name).exists() for name in ("model.safetensors", "pytorch_model.bin"))


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        return {"error": str(error), "path": str(path)}


def metric(metrics: dict[str, Any], section: str, name: str) -> float:
    try:
        return float((metrics.get(section) or {}).get(name))
    except (TypeError, ValueError):
        return 0.0
