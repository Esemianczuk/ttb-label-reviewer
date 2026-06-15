#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python}"
DATASET="${TTB_FIELD_EVAL_DATASET:-artifacts/ocr-lab/layoutlmv3/reviewed-dataset.jsonl}"
MODEL_DIR="${TTB_FIELD_MODEL_DIR:-models/field-extractor/layoutlmv3-cola/current}"
OUT="${TTB_FIELD_EVAL_OUT:-artifacts/ocr-lab/layoutlmv3/eval-metrics.json}"
MAX_LENGTH="${TTB_FIELD_MAX_LENGTH:-512}"
MODEL_ARGS=()

if [[ -d "$MODEL_DIR" ]]; then
  MODEL_ARGS=(--model-dir "$MODEL_DIR")
else
  echo "Model dir not found at $MODEL_DIR; evaluating baseline weak alignment only."
fi

"$PYTHON" tools/ocr_lab/eval_field_extractor.py \
  --dataset "$DATASET" \
  --out "$OUT" \
  --max-length "$MAX_LENGTH" \
  "${MODEL_ARGS[@]}"

echo "Evaluation written to $OUT"
