# OCR Training Experiments

The active backend OCR path is:

```text
PaddleOCR full-image OCR -> LayoutLMv3 token classification when staged -> deterministic validators
```

Historical crop-based and alternate OCR experiments are no longer part of the supported demo path. Keep experimental artifacts out of the runtime unless they improve field recall without increasing false passes.

Promotion requirements:

- validation split is held out by COLA record
- field recall improves over weak alignment
- false-pass rate does not increase
- evidence crops come from OCR/entity boxes
- p95 backend single-label review remains under the target budget after warmup
