from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .model_gate import model_files_present, model_quality_gate, read_json


def layoutlmv3_model_status() -> dict[str, Any]:
    default_dir = Path(__file__).resolve().parents[4] / "models" / "field-extractor" / "layoutlmv3-cola" / "current"
    configured = os.environ.get("TTB_LAYOUTLMV3_MODEL_DIR")
    model_dir = Path(configured).expanduser().resolve() if configured else default_dir
    if not model_dir.exists() or not model_dir.is_dir():
        return {
            "id": "layoutlmv3-cola",
            "status": "baseline",
            "trainedModelLoaded": False,
            "mode": "paddleocr-baseline-weak-alignment",
            "modelDir": str(model_dir),
            "message": "No trained LayoutLMv3 model is staged; worker will use conservative weak token alignment.",
            "modelCard": None,
            "metrics": None,
            "failureReport": None,
        }
    if not model_files_present(model_dir):
        return {
            "id": "layoutlmv3-cola",
            "status": "baseline",
            "trainedModelLoaded": False,
            "mode": "paddleocr-baseline-weak-alignment",
            "modelDir": str(model_dir),
            "message": "A field extractor directory exists, but required LayoutLMv3 model files are missing; worker will use weak token alignment.",
            "modelCard": read_json(model_dir / "model-card.json"),
            "metrics": read_json(model_dir / "eval-metrics.json"),
            "failureReport": summarize_failure_report(read_json(model_dir / "failure-report.json")),
        }
    gate = model_quality_gate(model_dir)
    model_card = gate.get("modelCard") or read_json(model_dir / "model-card.json")
    metrics = gate.get("metrics") or read_json(model_dir / "eval-metrics.json")
    failure_report = read_json(model_dir / "failure-report.json")
    if not gate["allowed"]:
        return {
            "id": "layoutlmv3-cola",
            "status": "baseline",
            "trainedModelLoaded": False,
            "mode": "paddleocr-baseline-weak-alignment",
            "modelDir": str(model_dir),
            "message": str(gate["reason"]),
            "modelCard": model_card,
            "metrics": metrics,
            "failureReport": summarize_failure_report(failure_report),
        }
    return {
        "id": "layoutlmv3-cola",
        "status": "trained",
        "trainedModelLoaded": True,
        "mode": "enhanced-ocr-field-extraction-hybrid-guarded",
        "modelDir": str(model_dir),
        "message": str(gate["reason"]),
        "modelCard": model_card,
        "metrics": metrics,
        "failureReport": summarize_failure_report(failure_report),
    }


def summarize_failure_report(report: dict[str, Any] | None) -> dict[str, Any] | None:
    if not report:
        return None
    failures = report.get("failures") if isinstance(report, dict) else None
    if not isinstance(failures, list):
        return report
    return {"failureCount": len(failures), "topFailures": failures[:10]}
