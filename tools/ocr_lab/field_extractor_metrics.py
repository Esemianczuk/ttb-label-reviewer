from __future__ import annotations

import hashlib
import json
from pathlib import Path
from statistics import median
from typing import Any

from tools.ocr_lab.build_layoutlmv3_ner_dataset import LABELS


def dataset_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def labels_from_tags(tags: list[Any]) -> list[str]:
    output: list[str] = []
    for tag in tags:
        if isinstance(tag, int) and 0 <= tag < len(LABELS):
            output.append(LABELS[tag])
        elif isinstance(tag, str) and tag:
            output.append(tag)
        else:
            output.append("O")
    return output


def tags_from_labels(labels: list[str]) -> list[int]:
    label_to_id = {label: index for index, label in enumerate(LABELS)}
    return [label_to_id.get(label, 0) for label in labels]


def spans_from_labels(labels: list[str]) -> list[tuple[str, int, int]]:
    spans: list[tuple[str, int, int]] = []
    current_entity = ""
    current_start = -1
    for index, label in enumerate([*labels, "O"]):
        if label == "O" or "-" not in label:
            if current_entity:
                spans.append((current_entity, current_start, index))
                current_entity = ""
                current_start = -1
            continue
        prefix, entity = label.split("-", 1)
        if prefix == "B" or entity != current_entity:
            if current_entity:
                spans.append((current_entity, current_start, index))
            current_entity = entity
            current_start = index
    return spans


def summarize_label_predictions(
    rows: list[dict[str, Any]],
    predicted_by_id: dict[str, list[str]],
    *,
    latency_ms_by_id: dict[str, float] | None = None,
) -> dict[str, Any]:
    token_counts: dict[str, dict[str, int]] = {}
    true_spans_total = 0
    predicted_spans_total = 0
    matched_spans_total = 0
    failures: list[dict[str, Any]] = []
    latencies = list((latency_ms_by_id or {}).values())

    for row in rows:
        row_id = str(row.get("id") or "")
        truth = labels_from_tags(row.get("ner_labels") or row.get("ner_tags") or [])
        predicted = predicted_by_id.get(row_id) or ["O"] * len(truth)
        if len(predicted) < len(truth):
            predicted = [*predicted, *(["O"] * (len(truth) - len(predicted)))]
        predicted = predicted[: len(truth)]
        for true_label, predicted_label in zip(truth, predicted):
            if true_label == "O" and predicted_label == "O":
                continue
            key = entity_name(true_label if true_label != "O" else predicted_label)
            counts = token_counts.setdefault(key, {"tp": 0, "fp": 0, "fn": 0})
            if true_label == predicted_label and true_label != "O":
                counts["tp"] += 1
            else:
                if predicted_label != "O":
                    counts["fp"] += 1
                if true_label != "O":
                    counts["fn"] += 1

        truth_spans = set(spans_from_labels(truth))
        predicted_spans = set(spans_from_labels(predicted))
        matched_spans = truth_spans & predicted_spans
        true_spans_total += len(truth_spans)
        predicted_spans_total += len(predicted_spans)
        matched_spans_total += len(matched_spans)
        missed = sorted(truth_spans - predicted_spans)
        extra = sorted(predicted_spans - truth_spans)
        if missed or extra:
            failures.append(
                {
                    "id": row_id,
                    "recordId": row.get("recordId"),
                    "split": row.get("split"),
                    "image": row.get("image"),
                    "missedSpans": [span_to_dict(span, row.get("words") or []) for span in missed],
                    "extraSpans": [span_to_dict(span, row.get("words") or []) for span in extra],
                    "wordPreview": " ".join((row.get("words") or [])[:48]),
                }
            )

    per_field = {
        field: {
            **counts,
            "precision": safe_ratio(counts["tp"], counts["tp"] + counts["fp"]),
            "recall": safe_ratio(counts["tp"], counts["tp"] + counts["fn"]),
            "f1": f1(counts["tp"], counts["fp"], counts["fn"]),
        }
        for field, counts in sorted(token_counts.items())
    }
    tp = sum(counts["tp"] for counts in token_counts.values())
    fp = sum(counts["fp"] for counts in token_counts.values())
    fn = sum(counts["fn"] for counts in token_counts.values())
    field_recall = safe_ratio(matched_spans_total, true_spans_total)
    false_pass_rate = safe_ratio(max(0, predicted_spans_total - matched_spans_total), predicted_spans_total)
    false_fail_rate = safe_ratio(max(0, true_spans_total - matched_spans_total), true_spans_total)
    return {
        "examples": len(rows),
        "tokens": sum(len(row.get("words") or []) for row in rows),
        "fieldRecall": field_recall,
        "falsePassRate": false_pass_rate,
        "falseFailRate": false_fail_rate,
        "spanPrecision": safe_ratio(matched_spans_total, predicted_spans_total),
        "spanRecall": field_recall,
        "tokenPrecision": safe_ratio(tp, tp + fp),
        "tokenRecall": safe_ratio(tp, tp + fn),
        "tokenF1": f1(tp, fp, fn),
        "perField": per_field,
        "latencyMs": latency_summary(latencies),
        "failures": failures[:50],
    }


def latency_summary(values: list[float]) -> dict[str, float]:
    if not values:
        return {"p50": 0, "p95": 0, "max": 0}
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))
    return {"p50": round(float(median(ordered)), 3), "p95": round(float(ordered[p95_index]), 3), "max": round(float(ordered[-1]), 3)}


def span_to_dict(span: tuple[str, int, int], words: list[str]) -> dict[str, Any]:
    entity, start, end = span
    return {"entity": entity, "start": start, "end": end, "text": " ".join(words[start:end])}


def entity_name(label: str) -> str:
    return label.split("-", 1)[1] if "-" in label else label


def safe_ratio(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round(float(numerator) / float(denominator), 6)


def f1(tp: int, fp: int, fn: int) -> float:
    precision = safe_ratio(tp, tp + fp)
    recall = safe_ratio(tp, tp + fn)
    if precision + recall == 0:
        return 0.0
    return round((2 * precision * recall) / (precision + recall), 6)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
