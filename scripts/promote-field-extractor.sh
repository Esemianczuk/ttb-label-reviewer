#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python}"
CANDIDATE_MODEL_DIR="${TTB_FIELD_CANDIDATE_MODEL_DIR:-}"
RUN_DIR="${TTB_FIELD_RUN_DIR:-}"
TARGET_DIR="${TTB_FIELD_TARGET_DIR:-models/field-extractor/layoutlmv3-cola/current}"
MIN_RECALL_GAIN="${TTB_FIELD_MIN_RECALL_GAIN:-0.01}"
MAX_FALSE_PASS_DELTA="${TTB_FIELD_MAX_FALSE_PASS_DELTA:-0.0}"
MAX_P95_MS="${TTB_FIELD_MAX_P95_MS:-5000}"
DRY_RUN_ARGS=()

if [[ -z "$CANDIDATE_MODEL_DIR" && -n "$RUN_DIR" ]]; then
  CANDIDATE_MODEL_DIR="$RUN_DIR/model"
fi
if [[ -z "$CANDIDATE_MODEL_DIR" ]]; then
  echo "Set TTB_FIELD_RUN_DIR=/path/to/train-run or TTB_FIELD_CANDIDATE_MODEL_DIR=/path/to/model" >&2
  exit 2
fi
if [[ "${TTB_FIELD_PROMOTE_DRY_RUN:-0}" == "1" ]]; then
  DRY_RUN_ARGS=(--dry-run)
fi

METRICS="${TTB_FIELD_METRICS:-${RUN_DIR:-$(dirname "$CANDIDATE_MODEL_DIR")}/eval-metrics.json}"
MODEL_CARD="${TTB_FIELD_MODEL_CARD:-${RUN_DIR:-$(dirname "$CANDIDATE_MODEL_DIR")}/model-card.json}"

"$PYTHON" tools/ocr_lab/promote_field_extractor.py \
  --candidate-model-dir "$CANDIDATE_MODEL_DIR" \
  --metrics "$METRICS" \
  --model-card "$MODEL_CARD" \
  --target-dir "$TARGET_DIR" \
  --min-recall-gain "$MIN_RECALL_GAIN" \
  --max-false-pass-delta "$MAX_FALSE_PASS_DELTA" \
  --max-p95-ms "$MAX_P95_MS" \
  "${DRY_RUN_ARGS[@]}"

if [[ "${TTB_FIELD_PROMOTE_DRY_RUN:-0}" == "1" ]]; then
  echo "Promotion dry run passed for $TARGET_DIR"
else
  echo "Promoted field extractor to $TARGET_DIR"
fi
