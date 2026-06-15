#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python}"
FIXTURE_ROOT="${TTB_FIELD_FIXTURE_ROOT:-fixtures/public-cola-registry}"
BULK_ROOT="${TTB_FIELD_BULK_ROOT:-fixtures/public-cola-registry/bulk/high-signal-records}"
RUN_ID="${TTB_FIELD_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
WORK_DIR="${TTB_FIELD_WORK_DIR:-artifacts/ocr-lab/layoutlmv3/$RUN_ID}"
OCR_JSONL="${TTB_FIELD_OCR_JSONL:-$WORK_DIR/paddle-full-image.jsonl}"
WEAK_DATASET="${TTB_FIELD_WEAK_DATASET:-$WORK_DIR/weak-dataset.jsonl}"
ANNOTATIONS="${TTB_FIELD_ANNOTATIONS:-$WORK_DIR/annotation-queue.jsonl}"
TRAIN_DATASET="${TTB_FIELD_TRAIN_DATASET:-$WORK_DIR/reviewed-dataset.jsonl}"
OUT_DIR="${TTB_FIELD_OUT_DIR:-$WORK_DIR/train}"
LIMIT="${TTB_FIELD_LIMIT:-0}"
EPOCHS="${TTB_FIELD_EPOCHS:-2}"
BATCH_SIZE="${TTB_FIELD_BATCH_SIZE:-2}"
MAX_LENGTH="${TTB_FIELD_MAX_LENGTH:-512}"
GPU_FLAG=()
FIXTURE_ARGS=(--fixture-root "$FIXTURE_ROOT")

if [[ "${TTB_FIELD_GPU:-1}" == "1" ]]; then
  GPU_FLAG=(--gpu)
fi
if [[ -d "$BULK_ROOT" && "${TTB_FIELD_INCLUDE_BULK:-1}" == "1" ]]; then
  FIXTURE_ARGS+=(--fixture-root "$BULK_ROOT")
fi

mkdir -p "$WORK_DIR"

echo "Writing OCR artifacts to $OCR_JSONL"
"$PYTHON" tools/ocr_lab/paddle_full_image_pipeline.py \
  "${FIXTURE_ARGS[@]}" \
  --out "$OCR_JSONL" \
  --limit "$LIMIT" \
  "${GPU_FLAG[@]}"

"$PYTHON" tools/ocr_lab/build_layoutlmv3_ner_dataset.py \
  --ocr-jsonl "$OCR_JSONL" \
  --out "$WEAK_DATASET"

"$PYTHON" tools/ocr_lab/build_field_annotation_queue.py \
  --dataset "$WEAK_DATASET" \
  --out "$ANNOTATIONS"

if [[ -f "${TTB_FIELD_REVIEWED_ANNOTATIONS:-}" ]]; then
  REVIEWED_ANNOTATIONS="$TTB_FIELD_REVIEWED_ANNOTATIONS"
else
  REVIEWED_ANNOTATIONS="$ANNOTATIONS"
fi

"$PYTHON" tools/ocr_lab/apply_field_annotations.py \
  --dataset "$WEAK_DATASET" \
  --annotations "$REVIEWED_ANNOTATIONS" \
  --out "$TRAIN_DATASET"

"$PYTHON" tools/ocr_lab/train_layoutlmv3_token_classifier.py \
  --dataset "$TRAIN_DATASET" \
  --out "$OUT_DIR" \
  --epochs "$EPOCHS" \
  --batch-size "$BATCH_SIZE" \
  --max-length "$MAX_LENGTH"

echo "Training run complete: $OUT_DIR"
echo "Review metrics: $OUT_DIR/eval-metrics.json"
