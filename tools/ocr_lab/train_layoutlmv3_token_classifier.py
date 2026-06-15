#!/usr/bin/env python3
"""Train or dry-run a LayoutLMv3 token classifier for COLA field extraction."""

from __future__ import annotations

import argparse
import json
import shlex
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ocr_lab.build_layoutlmv3_ner_dataset import LABELS, read_jsonl
from tools.ocr_lab.field_extractor_metrics import (
    dataset_hash,
    labels_from_tags,
    summarize_label_predictions,
    write_json,
)


def dataset_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_split: dict[str, int] = {}
    label_counts: dict[str, int] = {}
    for row in rows:
        split = str(row.get("split") or "train")
        by_split[split] = by_split.get(split, 0) + 1
        for label in row.get("ner_labels") or []:
            label_counts[str(label)] = label_counts.get(str(label), 0) + 1
    return {
        "examples": len(rows),
        "splits": dict(sorted(by_split.items())),
        "tokens": sum(len(row.get("words") or []) for row in rows),
        "labels": dict(sorted(label_counts.items())),
        "labelList": LABELS,
    }


def train(
    rows: list[dict[str, Any]],
    *,
    dataset_path: Path,
    model_name: str,
    out_dir: Path,
    epochs: float,
    batch_size: int,
    max_length: int,
    weighted_loss: bool,
) -> dict[str, Any]:
    import torch
    from transformers import AutoProcessor, LayoutLMv3ForTokenClassification, Trainer, TrainingArguments

    label_to_id = {label: index for index, label in enumerate(LABELS)}
    id_to_label = {index: label for label, index in label_to_id.items()}
    processor = AutoProcessor.from_pretrained(model_name, apply_ocr=False)
    model = LayoutLMv3ForTokenClassification.from_pretrained(
        model_name,
        num_labels=len(LABELS),
        id2label=id_to_label,
        label2id=label_to_id,
        ignore_mismatched_sizes=True,
    )
    train_rows = [row for row in rows if str(row.get("split") or "train") == "train"]
    eval_rows = [row for row in rows if str(row.get("split") or "") in {"val", "validation"}]
    test_rows = [row for row in rows if str(row.get("split") or "") == "test"]
    if not train_rows:
        raise SystemExit("No train rows found.")
    if not eval_rows:
        eval_rows = train_rows[: max(1, min(8, len(train_rows)))]

    train_dataset = LayoutLmRows(train_rows, processor=processor, max_length=max_length)
    eval_dataset = LayoutLmRows(eval_rows, processor=processor, max_length=max_length)
    loss_weights = label_loss_weights(train_rows, torch=torch) if weighted_loss else None
    out_dir.mkdir(parents=True, exist_ok=True)
    args = TrainingArguments(
        output_dir=str(out_dir),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=10,
        report_to=[],
        remove_unused_columns=False,
    )
    if loss_weights is not None:
        weighted_trainer = weighted_trainer_class(Trainer)
        trainer = weighted_trainer(
            model=model,
            args=args,
            train_dataset=train_dataset,
            eval_dataset=eval_dataset,
            label_loss_weights=loss_weights,
        )
    else:
        trainer = Trainer(model=model, args=args, train_dataset=train_dataset, eval_dataset=eval_dataset)
    trainer.train()
    trainer_metrics = trainer.evaluate()
    trainer.save_model(str(out_dir / "model"))
    processor.save_pretrained(str(out_dir / "model"))
    eval_metrics = evaluate_trained_model(
        model,
        processor,
        rows,
        validation_rows=eval_rows,
        test_rows=test_rows,
        max_length=max_length,
        torch=torch,
    )
    command = " ".join(shlex.quote(arg) for arg in sys.argv)
    summary = {
        "model": model_name,
        "outputModel": str(out_dir / "model"),
        "dataset": str(dataset_path),
        "datasetSha256": dataset_hash(dataset_path),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "trainerMetrics": trainer_metrics,
        "weightedLoss": bool(weighted_loss),
        "labelLossWeights": label_loss_weight_summary(loss_weights),
        "metrics": eval_metrics,
        **dataset_summary(rows),
    }
    write_json(out_dir / "training-summary.json", summary)
    write_json(out_dir / "eval-metrics.json", eval_metrics)
    write_json(out_dir / "failure-report.json", {"failures": eval_metrics.get("candidate", {}).get("failures", [])})
    write_json(
        out_dir / "model-card.json",
        {
            "name": "TTB COLA LayoutLMv3 field extractor",
            "baseModel": model_name,
            "status": "candidate",
            "trainedAt": summary["trainedAt"],
            "dataset": str(dataset_path),
            "datasetSha256": summary["datasetSha256"],
            "intendedUse": "Extract field evidence from PaddleOCR words and boxes. Deterministic validators make pass/fail decisions.",
            "limitations": [
                "Weak or accepted weak labels require human review before production promotion.",
                "OCR recognition errors remain PaddleOCR responsibility.",
                "This is not an official TTB determination system.",
            ],
            "training": {
                "weightedLoss": bool(weighted_loss),
                "labelLossWeights": summary.get("labelLossWeights"),
            },
            "metrics": {
                "baseline": eval_metrics.get("baseline"),
                "candidate": eval_metrics.get("candidate"),
            },
        },
    )
    return summary


def weighted_trainer_class(base_trainer: Any) -> Any:
    class WeightedTokenClassificationTrainer(base_trainer):
        def __init__(self, *args: Any, label_loss_weights: Any = None, **kwargs: Any):
            super().__init__(*args, **kwargs)
            self.label_loss_weights = label_loss_weights

        def compute_loss(self, model: Any, inputs: dict[str, Any], return_outputs: bool = False, **kwargs: Any) -> Any:
            import torch

            labels = inputs.get("labels")
            outputs = model(**inputs)
            logits = outputs.get("logits")
            weights = self.label_loss_weights.to(logits.device) if self.label_loss_weights is not None else None
            loss_fct = torch.nn.CrossEntropyLoss(weight=weights, ignore_index=-100)
            loss = loss_fct(logits.view(-1, model.config.num_labels), labels.view(-1))
            return (loss, outputs) if return_outputs else loss

    return WeightedTokenClassificationTrainer


def label_loss_weights(rows: list[dict[str, Any]], *, torch: Any) -> Any:
    counts: Counter[int] = Counter()
    for row in rows:
        for tag in row.get("ner_tags") or []:
            if isinstance(tag, int) and 0 <= tag < len(LABELS):
                counts[tag] += 1
    positive_total = sum(count for tag, count in counts.items() if tag != 0)
    weights: list[float] = []
    for tag, label in enumerate(LABELS):
        count = max(1, counts.get(tag, 0))
        if tag == 0:
            weight = 0.12
        elif "GOVERNMENT_WARNING" in label:
            weight = 0.45
        else:
            weight = min(8.0, max(1.0, (max(positive_total, 1) / count) ** 0.35))
        weights.append(float(weight))
    return torch.tensor(weights, dtype=torch.float)


def label_loss_weight_summary(weights: Any | None) -> dict[str, float]:
    if weights is None:
        return {}
    return {label: round(float(weights[index].item()), 4) for index, label in enumerate(LABELS)}


class LayoutLmRows:
    def __init__(self, rows: list[dict[str, Any]], *, processor: Any, max_length: int):
        self.rows = rows
        self.processor = processor
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, Any]:
        import torch
        from PIL import Image

        row = self.rows[index]
        image_path = Path(row.get("image") or "")
        image = Image.open(image_path).convert("RGB") if image_path.exists() else Image.new("RGB", (1000, 1000), "white")
        encoding = self.processor(
            image,
            row.get("words") or [],
            boxes=row.get("bboxes") or [],
            word_labels=row.get("ner_tags") or [],
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )
        return {key: value.squeeze(0) for key, value in encoding.items()}


def evaluate_trained_model(
    model: Any,
    processor: Any,
    rows: list[dict[str, Any]],
    *,
    validation_rows: list[dict[str, Any]],
    test_rows: list[dict[str, Any]],
    max_length: int,
    torch: Any,
) -> dict[str, Any]:
    eval_rows = test_rows or validation_rows
    candidate_predictions, latency = predict_labels(model, processor, eval_rows, max_length=max_length, torch=torch)
    baseline_predictions = {
        str(row.get("id") or ""): labels_from_tags(row.get("weak_ner_labels") or row.get("ner_labels") or row.get("ner_tags") or [])
        for row in eval_rows
    }
    return {
        "evaluationSplit": "test" if test_rows else "validation",
        "baseline": summarize_label_predictions(eval_rows, baseline_predictions),
        "candidate": summarize_label_predictions(eval_rows, candidate_predictions, latency_ms_by_id=latency),
        "validation": summarize_label_predictions(validation_rows, predict_labels(model, processor, validation_rows, max_length=max_length, torch=torch)[0]),
    }


def predict_labels(
    model: Any,
    processor: Any,
    rows: list[dict[str, Any]],
    *,
    max_length: int,
    torch: Any,
) -> tuple[dict[str, list[str]], dict[str, float]]:
    from PIL import Image

    id_to_label = {int(key): value for key, value in model.config.id2label.items()}
    predictions: dict[str, list[str]] = {}
    latency: dict[str, float] = {}
    device = next(model.parameters()).device
    model.eval()
    for row in rows:
        row_id = str(row.get("id") or "")
        words = row.get("words") or []
        if not words:
            predictions[row_id] = []
            latency[row_id] = 0
            continue
        image_path = Path(row.get("image") or "")
        image = Image.open(image_path).convert("RGB") if image_path.exists() else Image.new("RGB", (1000, 1000), "white")
        started = monotonic()
        encoding = processor(
            image,
            words,
            boxes=row.get("bboxes") or [],
            truncation=True,
            padding="max_length",
            max_length=max_length,
            return_tensors="pt",
        )
        model_inputs = {key: value.to(device) if hasattr(value, "to") else value for key, value in encoding.items()}
        with torch.no_grad():
            logits = model(**model_inputs).logits
        predicted_ids = logits.argmax(-1).squeeze(0).tolist()
        word_ids = encoding.word_ids(0)
        labels = ["O"] * len(words)
        for position, word_id in enumerate(word_ids):
            if word_id is None or word_id >= len(labels) or labels[word_id] != "O":
                continue
            labels[word_id] = id_to_label.get(int(predicted_ids[position]), "O")
        predictions[row_id] = labels
        latency[row_id] = (monotonic() - started) * 1000
    return predictions, latency


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/dataset.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/layoutlmv3/run"))
    parser.add_argument("--model", default="microsoft/layoutlmv3-base")
    parser.add_argument("--epochs", type=float, default=2.0)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--disable-weighted-loss", action="store_true", help="Use the stock unweighted token-classification loss.")
    parser.add_argument("--dry-run", action="store_true", help="Validate the dataset shape without downloading or training a model.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.dataset.exists():
        raise SystemExit(f"Missing dataset: {args.dataset}")
    rows = read_jsonl(args.dataset)
    summary = dataset_summary(rows)
    if args.dry_run:
        print(json.dumps(summary, indent=2))
        return 0
    result = train(
        rows,
        dataset_path=args.dataset,
        model_name=args.model,
        out_dir=args.out,
        epochs=args.epochs,
        batch_size=args.batch_size,
        max_length=args.max_length,
        weighted_loss=not args.disable_weighted_loss,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
