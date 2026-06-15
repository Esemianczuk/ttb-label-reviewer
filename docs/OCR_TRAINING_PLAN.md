# OCR Training And Evidence Extraction Plan

This project should not become a black-box approval model. The model pipeline should find and read evidence; deterministic validators remain the authority for pass/fail.

## Current Direction

The preferred backend path is now full-image OCR followed by document-aware field extraction:

```text
PaddleOCR full-image OCR
  -> text lines/tokens with bounding boxes
  -> LayoutLMv3 token classification for field spans
  -> deterministic TTB validators
  -> reviewer evidence crops from the selected OCR token boxes
```

This avoids brittle hand-authored crop windows. PaddleOCR is responsible for reading the whole label and preserving geometry. LayoutLMv3 labels source OCR tokens as `BRAND_NAME`, `ALCOHOL_CONTENT`, `GOVERNMENT_WARNING`, and so on. It does not generate compliance decisions. The deterministic validators remain the authority for pass/fail.

The largest historical accuracy gaps were not only OCR recognition mistakes. They were often region problems:

- important text is vertical, diagonal, curved, or upside down
- the evidence crop is near the right area but not on the actual text
- public registry metadata omits ABV/net contents even when the label image contains them
- a single full-image OCR pass mixes unrelated text and weakens field assignment

The right path is now a two-stage evidence system:

1. Run one full-image OCR pass with PaddleOCR and preserve line/token boxes.
2. Use LayoutLMv3 token classification to identify field spans in those OCR tokens.
3. Run deterministic validators against the extracted field text.
4. Show reviewer-facing evidence crops by taking the union of the selected OCR token boxes.

Older crop/ranker tools remain useful for analysis and annotation, but they are no longer the primary target architecture.

## Dataset Expansion

Use the high-signal public COLA expander:

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem

python tools/ttb_collector/expand_high_signal_pool.py \
  --target 200 \
  --detail-limit 260 \
  --date-from 01/01/2025 \
  --date-to 06/13/2026 \
  --ocr-preflight \
  --out-summary fixtures/public-cola-registry/bulk/high-signal-selection.json \
  --out-seed fixtures/public-cola-registry/bulk/high-signal-seed.yaml
```

The script uses the public basic-search POST flow, scores candidates for brand, class/type, ABV, net contents, responsible party, country of origin for imports, government warning cues, approval status, and public label images. Bulk output stays under `fixtures/public-cola-registry/bulk/`, which is ignored, so large training pools do not bloat the public repo or frontend bundle.

Collect selected records after reviewing the summary:

```bash
python tools/ttb_collector/collect_by_ttb_ids.py \
  --input fixtures/public-cola-registry/bulk/high-signal-seed.yaml \
  --out fixtures/public-cola-registry/bulk/high-signal-records \
  --limit 200 \
  --delay-seconds 2.0 \
  --respect-cache \
  --base-url https://www.ttbonline.gov/colasonline/viewColaDetails.do
```

Promote only a curated subset into `fixtures/public-cola-registry/records/`, because that path is bundled into the console demo.

## Train/Validation/Test Staging

Create record-grouped splits:

```bash
python tools/ocr_lab/stage_training_data.py \
  --fixture-root fixtures/public-cola-registry \
  --fixture-root fixtures/public-cola-registry/bulk/high-signal-records \
  --out artifacts/ocr-lab/dataset
```

The split unit is the COLA record/application, not the image, to prevent leakage from front/back images of the same application.

## Full-Image PaddleOCR Lab

The repeatable local workflow is:

```bash
./scripts/train-field-extractor.sh
./scripts/eval-field-extractor.sh
TTB_FIELD_RUN_DIR=artifacts/ocr-lab/layoutlmv3/<run-id>/train ./scripts/promote-field-extractor.sh
```

The train script writes full-image OCR, weak BIO labels, an annotation queue, a reviewed/accepted training dataset, a candidate LayoutLMv3 model, `training-summary.json`, `model-card.json`, `eval-metrics.json`, and `failure-report.json`. Training uses weighted token loss by default so rare fields such as ABV, net contents, producer, and country are not overwhelmed by long government-warning spans.

The active backend default is guarded hybrid extraction only when a promoted local model is staged: LayoutLMv3 proposes spans, deterministic plausibility checks accept only field-compatible evidence, and weak alignment backfills fields the model misses. Unpromoted or failed candidate artifacts are reported in Admin but blocked at runtime, so workers fall back to PaddleOCR full-image OCR plus weak token alignment. Pure token-classifier metrics remain diagnostic. Promotion as a standalone extractor is still blocked unless the candidate improves field recall without increasing false-pass rate.

Generate full-image PaddleOCR artifacts:

```bash
python tools/ocr_lab/paddle_full_image_pipeline.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/paddle-full-image/ocr.jsonl \
  --limit 50
```

The output rows contain full-image text, line boxes, approximate word boxes, image dimensions, expected application fields, and engine metadata.

Build LayoutLMv3 BIO rows:

```bash
python tools/ocr_lab/build_layoutlmv3_ner_dataset.py \
  --ocr-jsonl artifacts/ocr-lab/paddle-full-image/ocr.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/dataset.jsonl
```

Dry-run the training set without downloading a model:

```bash
python tools/ocr_lab/train_layoutlmv3_token_classifier.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --dry-run
```

Train when the dataset has enough reviewed labels:

```bash
python tools/ocr_lab/train_layoutlmv3_token_classifier.py \
  --dataset artifacts/ocr-lab/layoutlmv3/dataset.jsonl \
  --out artifacts/ocr-lab/layoutlmv3/run-001 \
  --model microsoft/layoutlmv3-base \
  --epochs 3 \
  --batch-size 2
```

Stage the trained model for workers:

```bash
mkdir -p models/field-extractor/layoutlmv3-cola/current
cp -R artifacts/ocr-lab/layoutlmv3/run-001/model/* models/field-extractor/layoutlmv3-cola/current/
```

Workers automatically use `models/field-extractor/layoutlmv3-cola/current` when present. Override with:

```bash
export TTB_LAYOUTLMV3_MODEL_DIR=/path/to/model
```

Set `TTB_LAYOUTLMV3_REQUIRE_MODEL=1` when a worker should fail closed rather than falling back to weak alignment. Runtime loading does not allow unpromoted artifacts; use the offline eval scripts for candidate-model debugging.

## Synthetic OCR Augmentation

Use local Ollama only as weak augmentation, not test truth:

```bash
python tools/ocr_lab/generate_layoutlm_synthetic_corpus.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/layoutlmv3/synthetic-ocr.jsonl \
  --ollama \
  --model deepseek-r1:1.5b \
  --limit 100
```

The script falls back to deterministic templates if Ollama is unavailable. Synthetic rows are marked with `metadata.synthetic=true` and should be used for pretraining/augmentation only. Final validation and promotion must use real reviewed COLA records.

## Oriented Text Region Lab

Generate rotated/perspective-corrected text crops:

```bash
python tools/ocr_lab/oriented_text_pipeline.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/oriented-text \
  --limit 20 \
  --engines paddleocr \
  --opencv
```

This lab uses OCR polygons to create upright crops and can add OpenCV gradient proposals. The output is a reviewable `regions.jsonl` plus crop images. Those reviewed crops become training material for PaddleOCR/Tesseract and candidate labels for a CLIP-style region ranker.

After human review, export PaddleOCR manifests with:

```bash
python tools/ocr_lab/auto_label_regions.py \
  --regions artifacts/ocr-lab/oriented-text/regions.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl

python tools/ocr_lab/export_paddleocr_manifests.py \
  --regions artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/paddleocr
```

The auto-label step only marks high-confidence expected-value matches as weak suggestions. The exporter ignores unreviewed regions by default. Use `--accept-weak` only for lab experiments, because OCR-derived transcripts should not become production training truth without review. Use `--accept-all-ocr` only to smoke-test file formats.

For an immediate training experiment that does not require PaddlePaddle, train the field-region ranker:

```bash
python tools/ocr_lab/train_region_ranker.py \
  --regions artifacts/ocr-lab/reviewed-regions/regions.weak.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/region-ranker
```

This trains a small crop-to-field classifier from reviewed/weak crop labels. It is useful for evidence crop selection and for finding annotation gaps. It does not replace OCR recognition or deterministic validation.

## Model Options

### PaddleOCR

Best long-term training path for detection, recognition, and angle classification. Use it when we have reviewed quadrilateral text boxes and line transcripts. It is the production backend default because it directly targets the detector/recognizer/angle problem. Reference: <https://github.com/PaddlePaddle/PaddleOCR>.

The worker defaults to the PaddleOCR adapter for backend reviews. If exported trained weights are staged at `models/ocr/paddle-cola/current/{det,rec,cls}` or supplied with `TTB_PADDLEOCR_DET_MODEL_DIR`, `TTB_PADDLEOCR_REC_MODEL_DIR`, and `TTB_PADDLEOCR_CLS_MODEL_DIR`, the adapter uses those dirs automatically. If the dirs are absent, it uses the pretrained PaddleOCR baseline. Set `TTB_PADDLEOCR_REQUIRE_CUSTOM=1` on a production worker when a run must fail closed unless the custom recognition model is present.

Promote trained exports only through the metrics guard:

```bash
python tools/ocr_lab/promote_paddleocr_model.py \
  --candidate-dir artifacts/ocr-lab/paddleocr/exported-model \
  --metrics artifacts/ocr-lab/paddleocr/eval-metrics.json \
  --target-dir models/ocr/paddle-cola/current
```

The metrics file should contain `baseline` and `candidate` objects with at least `fieldRecall` and `falsePassRate`. Promotion is blocked unless the candidate improves recall by the configured threshold and does not increase false passes.

### Tesseract

Retired from the backend training path. Browser-local OCR remains available only as an offline fallback when the evaluator runs without the backend.

### CLIP / SigLIP

Use as a field-region ranker: “this crop is likely government warning” or “this crop is likely ABV.” Do not use it to decide exact text, numbers, pass/fail, or compliance. It should point OCR at the right crop. References: <https://github.com/openai/CLIP>, <https://huggingface.co/docs/peft/package_reference/lora>.

### docTR / MMOCR

Useful benchmark alternatives if PaddleOCR packaging becomes awkward. They are worth comparing after the crop dataset exists.

## Promotion Gates

A model can be promoted only if:

- validation recall improves for required fields
- false passes do not increase on intentional mismatch cases
- untouched test-set performance improves
- p50/p95 OCR time stays acceptable
- evidence crops become more reviewer-usable
- deterministic validators still make the final decision

If a trained model helps some fields but raises false positives as a standalone extractor, keep it in guarded hybrid mode and continue annotation review rather than promoting it as pure authority.

The first serious target is not “perfect OCR.” It is “reviewers consistently see the right evidence crop beside the right field.”
