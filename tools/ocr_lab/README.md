# OCR Lab

This folder contains offline tooling for improving COLA label evidence extraction. The current preferred path is full-image PaddleOCR followed by LayoutLMv3 token classification, with deterministic validators still making the final pass/fail decision.

## Local GPU Setup

On the RTX 4090 workstation, the working CUDA 12.6 install is:

```bash
source .venv/bin/activate

python -m pip install --upgrade "paddlepaddle-gpu==3.3.1" \
  -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ \
  --extra-index-url https://pypi.org/simple

python -m pip install --upgrade \
  "paddleocr==3.7.0" \
  "transformers>=4.40,<6" \
  "datasets>=2.18" \
  "accelerate>=0.28" \
  "evaluate>=0.4" \
  "seqeval>=1.2" \
  "Pillow>=10,<12"

python -m pip install --force-reinstall --no-cache-dir \
  "torch==2.12.0+cu126" \
  "torchvision==0.27.0+cu126" \
  --index-url https://download.pytorch.org/whl/cu126 \
  --extra-index-url https://pypi.org/simple
```

`paddlepaddle-gpu` and PyTorch CUDA wheels currently declare different exact versions for a few `nvidia-*` companion packages in one shared venv. Runtime smoke tests pass for both frameworks on this machine, but `pip check` reports those metadata conflicts. If strict dependency isolation is required, keep PaddleOCR inference in the worker venv and train LayoutLMv3 in a separate training venv.

Useful checks:

```bash
python - <<'PY'
import paddle, torch
print("paddle", paddle.__version__, paddle.is_compiled_with_cuda(), paddle.device.cuda.device_count())
print("torch", torch.__version__, torch.cuda.is_available())
PY
```

## Stage Splits

```bash
python tools/ocr_lab/stage_training_data.py \
  --fixture-root fixtures/public-cola-registry \
  --fixture-root fixtures/public-cola-registry/bulk/high-signal-records \
  --out artifacts/ocr-lab/dataset
```

The split unit is the public COLA record, not the individual image, so front/back images from one application cannot leak across train/validation/test.

## Full-Image PaddleOCR + LayoutLMv3

Fast path for a full local run:

```bash
./scripts/train-field-extractor.sh
./scripts/eval-field-extractor.sh
TTB_FIELD_RUN_DIR=artifacts/ocr-lab/layoutlmv3/<run-id>/train ./scripts/promote-field-extractor.sh
```

Promotion is intentionally gated. A candidate must improve field recall, avoid increasing false-pass rate, and stay under the p95 latency budget. Large model weights stay local under `models/field-extractor/layoutlmv3-cola/current` and should not be committed.

Current backend default is guarded hybrid extraction only when a promoted local model is staged: PaddleOCR reads the full image, LayoutLMv3 proposes spans, deterministic plausibility checks accept only spans that match the submitted field context, and weak alignment backfills fields the model misses. Unpromoted or failed candidate artifacts are blocked at runtime; use offline eval scripts for lab debugging. Pure token-classifier metrics remain diagnostic until reviewed BIO annotations are available.

Run full-image OCR:

```bash
python tools/ocr_lab/paddle_full_image_pipeline.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/paddle-full-image/ocr.jsonl \
  --limit 50
```

Build token-classification rows:

```bash
python tools/ocr_lab/build_layoutlmv3_ner_dataset.py \
  --ocr-jsonl artifacts/ocr-lab/paddle-full-image/ocr.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/dataset.jsonl
```

Dry-run training data:

```bash
python tools/ocr_lab/train_layoutlmv3_token_classifier.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --dry-run
```

Train after review:

```bash
python tools/ocr_lab/train_layoutlmv3_token_classifier.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/run-001
```

Training uses weighted token loss by default so ABV, net contents, producer, country, brand, and class/type are not drowned out by long warning-statement spans. Add `--disable-weighted-loss` only when comparing against the unweighted baseline.

Synthetic augmentation, using local Ollama when available:

```bash
python tools/ocr_lab/generate_layoutlm_synthetic_corpus.py \
  --out artifacts/ocr-lab/layoutlmv3/synthetic-ocr.jsonl \
  --ollama \
  --model deepseek-r1:1.5b
```

Synthetic data is for pretraining and stress testing only. Keep untouched test metrics on real reviewed records.

Create and apply the annotation queue:

```bash
python tools/ocr_lab/build_field_annotation_queue.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/annotation-queue.jsonl

python tools/ocr_lab/apply_field_annotations.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --annotations artifacts/ocr-lab/layoutlmv3/annotation-queue.reviewed.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/reviewed-dataset.jsonl
```

Annotation rows use one BIO label per OCR token. Set `accepted=true` to keep weak labels, or fill `reviewedNerLabels` to correct them. Splits are preserved from the source dataset.

Evaluate and promote:

```bash
python tools/ocr_lab/eval_field_extractor.py \
  --dataset artifacts/ocr-lab/layoutlmv3/reviewed-dataset.jsonl \
  --model-dir artifacts/ocr-lab/layoutlmv3/run-001/model \
  --out artifacts/ocr-lab/layoutlmv3/run-001/eval-metrics.json

python tools/ocr_lab/promote_field_extractor.py \
  --candidate-model-dir artifacts/ocr-lab/layoutlmv3/run-001/model \
  --metrics artifacts/ocr-lab/layoutlmv3/run-001/eval-metrics.json \
  --model-card artifacts/ocr-lab/layoutlmv3/run-001/model-card.json
```

## Extract Oriented Text Regions

The crop-oriented lab remains available for analysis, but it is no longer the primary architecture.

```bash
python tools/ocr_lab/oriented_text_pipeline.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/oriented-text \
  --limit 20 \
  --engines easyocr,tesseract \
  --opencv
```

Outputs:

- `summary.json`: count of images, regions, matched regions, and engines.
- `regions.jsonl`: detected polygon, angle, crop path, OCR comparison, and likely field matches.
- `crops/`: perspective-corrected text crops for review and future labeling.

## Workflow

1. Expand the public fixture pool with `tools/ttb_collector/expand_high_signal_pool.py`.
2. Collect selected records under ignored `fixtures/public-cola-registry/bulk/`.
3. Stage splits with `stage_training_data.py`.
4. Run full-image OCR with `paddle_full_image_pipeline.py`.
5. Build LayoutLMv3 BIO rows with `build_layoutlmv3_ner_dataset.py`.
6. Review weak BIO labels before final training.
7. Train the LayoutLMv3 token classifier and stage it at `models/field-extractor/layoutlmv3-cola/current`.
8. Use the crop-oriented tools below only for annotation support, debugging, or PaddleOCR detector/recognizer experiments.
9. Pre-label obvious high-confidence crop matches:

```bash
python tools/ocr_lab/auto_label_regions.py \
  --regions artifacts/ocr-lab/oriented-text/regions.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl
```

Weak labels are suggestions, not ground truth. They are marked with `weakLabel.requiresHumanReview=true`.

10. Review/label the crops. For production training, add `review.accepted=true` and `review.text="actual crop transcript"` after inspection.

11. Export reviewed labels to PaddleOCR format:

```bash
python tools/ocr_lab/export_paddleocr_manifests.py \
  --regions artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/paddleocr
```

Use `--accept-weak` only for experiments; production training should use reviewed transcripts. Use `--accept-all-ocr` only for smoke-testing the export format.

12. Train PaddleOCR/EasyOCR/Tesseract or a CLIP-style crop ranker from reviewed labels.
13. Train a lightweight field-region ranker as an analysis experiment:

```bash
python tools/ocr_lab/train_region_ranker.py \
  --regions artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/region-ranker
```

This model ranks which OCR crop likely belongs to each TTB field. It is not an OCR recognizer and is not the final validator, but it can improve evidence crop selection and guide the PaddleOCR training set.

14. Promote a PaddleOCR recognizer/detector only when validation and untouched test metrics improve without increasing false passes:

```bash
python tools/ocr_lab/promote_paddleocr_model.py \
  --candidate-dir artifacts/ocr-lab/paddleocr/exported-model \
  --metrics artifacts/ocr-lab/paddleocr/eval-metrics.json \
  --target-dir models/ocr/paddle-cola/current
```

The key target is reviewer-quality evidence: the right crop beside the right field.
