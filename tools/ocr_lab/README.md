# OCR Lab

This folder contains offline tooling for improving COLA label evidence extraction. The lab is intentionally separate from the live reviewer UI.

## Stage Splits

```bash
python tools/ocr_lab/stage_training_data.py \
  --fixture-root fixtures/public-cola-registry \
  --fixture-root fixtures/public-cola-registry/bulk/high-signal-records \
  --out artifacts/ocr-lab/dataset
```

The split unit is the public COLA record, not the individual image, so front/back images from one application cannot leak across train/validation/test.

## Extract Oriented Text Regions

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
4. Generate candidate crops with `oriented_text_pipeline.py`.
5. Review/label the crops.
6. Export reviewed labels to PaddleOCR format:

```bash
python tools/ocr_lab/export_paddleocr_manifests.py \
  --regions artifacts/ocr-lab/oriented-text/regions.jsonl \
  --dataset-manifest artifacts/ocr-lab/dataset-expanded/manifest.jsonl \
  --out artifacts/ocr-lab/paddleocr
```

Use `--accept-weak` only for experiments; production training should use reviewed transcripts.

7. Train PaddleOCR/EasyOCR/Tesseract or a CLIP-style crop ranker from reviewed labels.
8. Promote a model only when validation and untouched test metrics improve without increasing false passes.

The key target is reviewer-quality evidence: the right crop beside the right field.
