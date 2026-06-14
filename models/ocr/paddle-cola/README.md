# PaddleOCR COLA Model Directory

Backend and cluster workers prefer PaddleOCR for authoritative OCR. Trained exported PaddleOCR inference models should be staged under:

```text
models/ocr/paddle-cola/current/
  det/
  rec/
  cls/
```

The worker automatically passes any existing `det`, `rec`, or `cls` directory to PaddleOCR. If no custom dirs are present, it uses PaddleOCR's pretrained baseline.

Useful environment overrides:

```bash
TTB_PADDLEOCR_MODEL_ROOT=/path/to/exported/current
TTB_PADDLEOCR_DET_MODEL_DIR=/path/to/det
TTB_PADDLEOCR_REC_MODEL_DIR=/path/to/rec
TTB_PADDLEOCR_CLS_MODEL_DIR=/path/to/cls
TTB_PADDLEOCR_REQUIRE_CUSTOM=1
```

Do not commit large model weights to the public repo. Commit a model card and reproduction notes, then distribute weights through the chosen release artifact path.
