# OCR Training And Evidence Extraction Plan

This project should not become a black-box approval model. The model pipeline should find and read evidence; deterministic validators remain the authority for pass/fail.

## Current Finding

The largest accuracy gaps are not only OCR recognition mistakes. They are often region problems:

- important text is vertical, diagonal, curved, or upside down
- the evidence crop is near the right area but not on the actual text
- public registry metadata omits ABV/net contents even when the label image contains them
- a single full-image OCR pass mixes unrelated text and weakens field assignment

The right path is a two-stage evidence system:

1. Detect and normalize candidate text regions.
2. Read each region with OCR engines.
3. Rank candidate regions against expected fields.
4. Run deterministic validators.
5. Show reviewer-facing evidence crops and raw text.

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

## Oriented Text Region Lab

Generate rotated/perspective-corrected text crops:

```bash
python tools/ocr_lab/oriented_text_pipeline.py \
  --fixture-root fixtures/public-cola-registry \
  --out artifacts/ocr-lab/oriented-text \
  --limit 20 \
  --engines easyocr,tesseract \
  --opencv
```

This lab uses EasyOCR polygons to create upright crops and can add OpenCV gradient proposals. The output is a reviewable `regions.jsonl` plus crop images. Those reviewed crops become training material for PaddleOCR/EasyOCR/Tesseract and candidate labels for a CLIP-style region ranker.

After human review, export PaddleOCR manifests with:

```bash
python tools/ocr_lab/export_paddleocr_manifests.py \
  --regions artifacts/ocr-lab/oriented-text/regions.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/paddleocr
```

The exporter ignores unreviewed regions by default. Use `--accept-weak` only for lab experiments, because OCR-derived transcripts should not become production training truth without review.

## Model Options

### PaddleOCR

Best long-term training path for detection, recognition, and angle classification. Use it when we have reviewed quadrilateral text boxes and line transcripts. It is the production backend/cluster default because it directly targets the detector/recognizer/angle problem. Reference: <https://github.com/PaddlePaddle/PaddleOCR>.

The worker defaults to the PaddleOCR adapter for backend/cluster reviews. If exported trained weights are staged at `models/ocr/paddle-cola/current/{det,rec,cls}` or supplied with `TTB_PADDLEOCR_DET_MODEL_DIR`, `TTB_PADDLEOCR_REC_MODEL_DIR`, and `TTB_PADDLEOCR_CLS_MODEL_DIR`, the adapter uses those dirs automatically. If the dirs are absent, it uses the pretrained PaddleOCR baseline. Set `TTB_PADDLEOCR_REQUIRE_CUSTOM=1` on a production worker when a run must fail closed unless the custom recognition model is present.

### EasyOCR

Useful backend fallback. It already works well on real labels in this project, but PaddleOCR is now the authoritative backend path because it gives us a cleaner detector/recognizer/angle-training route. Custom EasyOCR recognition models are possible, but recognition training alone does not solve field-region selection. Reference: <https://github.com/JaidedAI/EasyOCR/blob/master/custom_model.md>.

### Tesseract

Good browser/CPU baseline and narrow line-recognition finetuning candidate. It is not a modern layout detector. Use it on reviewed upright line crops, not whole wild labels. Reference: <https://tesseract-ocr.github.io/tessdoc/TrainingTesseract-4.00.html>.

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

The first serious target is not “perfect OCR.” It is “reviewers consistently see the right evidence crop beside the right field.”
