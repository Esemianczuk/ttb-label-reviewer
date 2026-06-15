#!/usr/bin/env python3
"""Train a lightweight field-region ranker from reviewed or weak OCR crops."""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.auto_label_regions import best_candidate_text, read_jsonl


OTHER_LABEL = "__other__"


def load_splits(manifest_path: Path) -> dict[str, str]:
    record_to_split: dict[str, str] = {}
    with manifest_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            record_id = str(row.get("recordId") or "")
            split = str(row.get("split") or "train")
            if record_id:
                record_to_split[record_id] = split
    return record_to_split


def build_examples(
    rows: list[dict[str, Any]],
    record_to_split: dict[str, str],
    *,
    include_other: bool,
    other_ratio: float,
    seed: int,
) -> list[dict[str, Any]]:
    positives: list[dict[str, Any]] = []
    negatives: list[dict[str, Any]] = []
    for row in rows:
        weak = row.get("weakLabel") if isinstance(row.get("weakLabel"), dict) else {}
        review = row.get("review") if isinstance(row.get("review"), dict) else {}
        label = ""
        if review.get("accepted") is True:
            label = str(review.get("fieldKey") or row_field_from_matches(row) or "")
        elif weak.get("accepted") is True:
            label = str(weak.get("fieldKey") or "")
        text, confidence, text_source = best_candidate_text(row)
        if not text:
            continue
        example = {
            "recordId": str(row.get("recordId") or ""),
            "split": record_to_split.get(str(row.get("recordId") or ""), "train"),
            "label": label or OTHER_LABEL,
            "text": text,
            "features": region_features(row, text=text, confidence=confidence, text_source=text_source),
        }
        if label:
            positives.append(example)
        elif include_other:
            negatives.append(example)
    if include_other and positives and other_ratio > 0:
        rng = random.Random(seed)
        rng.shuffle(negatives)
        negatives = negatives[: int(len(positives) * other_ratio)]
    else:
        negatives = []
    return positives + negatives


def row_field_from_matches(row: dict[str, Any]) -> str:
    matches = row.get("matchedFields")
    if isinstance(matches, list) and len(matches) == 1:
        return str(matches[0])
    return ""


def region_features(row: dict[str, Any], *, text: str, confidence: float, text_source: str) -> dict[str, Any]:
    region = row.get("region") if isinstance(row.get("region"), dict) else {}
    crop = row.get("crop") if isinstance(row.get("crop"), dict) else {}
    width = number(crop.get("width"))
    height = number(crop.get("height"))
    points = region.get("points") if isinstance(region.get("points"), list) else []
    bbox = bbox_from_points(points)
    text_chars = [char for char in text if not char.isspace()]
    digits = sum(char.isdigit() for char in text_chars)
    alpha = sum(char.isalpha() for char in text_chars)
    return {
        "ocrConfidence": round(confidence, 4),
        "textSource": text_source,
        "detector": str(region.get("detector") or ""),
        "angleBucket": angle_bucket(number(region.get("angle"))),
        "cropAspect": round(width / max(height, 1.0), 3),
        "cropWidthBucket": bucket(width, [40, 120, 240, 480, 960]),
        "cropHeightBucket": bucket(height, [16, 32, 64, 128, 256]),
        "bboxXBucket": bucket(bbox["x"], [100, 300, 600, 900, 1200]),
        "bboxYBucket": bucket(bbox["y"], [100, 300, 600, 900, 1200]),
        "textLengthBucket": bucket(len(text_chars), [4, 8, 16, 32, 64, 128]),
        "digitRatio": round(digits / max(len(text_chars), 1), 3),
        "alphaRatio": round(alpha / max(len(text_chars), 1), 3),
        "hasPercent": "%" in text,
        "hasMl": "ML" in text.upper() or "M L" in text.upper(),
        "hasWarningTerm": any(term in text.upper() for term in ["WARNING", "SURGEON", "PREGNANCY", "MACHINERY"]),
    }


def bbox_from_points(points: list[Any]) -> dict[str, float]:
    xs: list[float] = []
    ys: list[float] = []
    for point in points:
        if isinstance(point, list) and len(point) >= 2:
            xs.append(number(point[0]))
            ys.append(number(point[1]))
    return {"x": min(xs) if xs else 0.0, "y": min(ys) if ys else 0.0}


def angle_bucket(angle: float) -> str:
    normalized = abs(((angle + 180) % 360) - 180)
    if normalized < 8:
        return "flat"
    if normalized < 35:
        return "slanted"
    if normalized < 80:
        return "diagonal"
    return "vertical"


def bucket(value: float, thresholds: list[float]) -> str:
    for threshold in thresholds:
        if value < threshold:
            return f"<{threshold:g}"
    return f">={thresholds[-1]:g}"


def number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def train_and_evaluate(examples: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    import joblib
    import pandas as pd
    from sklearn.compose import ColumnTransformer
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, classification_report, f1_score
    from sklearn.pipeline import Pipeline

    train = [example for example in examples if example["split"] == "train"]
    val = [example for example in examples if example["split"] == "val"]
    test = [example for example in examples if example["split"] == "test"]
    if len({example["label"] for example in train}) < 2:
        raise SystemExit("Need at least two labels in train split to train the region ranker.")
    pipeline = Pipeline(
        [
            (
                "features",
                ColumnTransformer(
                    [
                        ("text", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=1), "text"),
                        ("meta", DictVectorizer(), "features"),
                    ]
                ),
            ),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced")),
        ]
    )
    pipeline.fit(examples_frame(train, pd), [example["label"] for example in train])
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, out_dir / "region-ranker.joblib")
    metrics = {
        "counts": {
            "train": len(train),
            "val": len(val),
            "test": len(test),
            "labels": dict(sorted(Counter(example["label"] for example in examples).items())),
        },
        "val": evaluate_split(pipeline, val, accuracy_score, f1_score, classification_report, pd),
        "test": evaluate_split(pipeline, test, accuracy_score, f1_score, classification_report, pd),
        "note": "Weak/reviewed crop field classifier. This is not an OCR recognizer and should not be treated as final validation authority.",
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    return metrics


def examples_frame(examples: list[dict[str, Any]], pd: Any) -> Any:
    return pd.DataFrame({"text": [example["text"] for example in examples], "features": [example["features"] for example in examples]})


def evaluate_split(pipeline: Any, split: list[dict[str, Any]], accuracy_score: Any, f1_score: Any, classification_report: Any, pd: Any) -> dict[str, Any]:
    if not split:
        return {"count": 0}
    truth = [example["label"] for example in split]
    predictions = list(pipeline.predict(examples_frame(split, pd)))
    return {
        "count": len(split),
        "accuracy": round(float(accuracy_score(truth, predictions)), 4),
        "macroF1": round(float(f1_score(truth, predictions, average="macro", zero_division=0)), 4),
        "report": classification_report(truth, predictions, zero_division=0, output_dict=True),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", type=Path, default=Path("artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl"))
    parser.add_argument("--dataset-manifest", type=Path, default=Path("artifacts/ocr-lab/dataset-expanded/manifest.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/region-ranker"))
    parser.add_argument("--include-other", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--other-ratio", type=float, default=1.5)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.regions.exists():
        raise SystemExit(f"Missing regions file: {args.regions}")
    examples = build_examples(
        read_jsonl(args.regions),
        load_splits(args.dataset_manifest),
        include_other=args.include_other,
        other_ratio=args.other_ratio,
        seed=args.seed,
    )
    metrics = train_and_evaluate(examples, args.out)
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
