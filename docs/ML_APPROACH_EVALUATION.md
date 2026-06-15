# ML Approach Evaluation

This project uses ML to read label text and find evidence. It does not use ML to approve or reject applications. The final pass/fail authority is deterministic validation plus reviewer action.

## Selected Path

The current supported backend path is:

```text
PaddleOCR full-image OCR -> conservative field alignment -> deterministic TTB validators -> reviewer decision
```

Browser-only mode remains available as a fallback:

```text
Tesseract.js browser OCR -> deterministic validators -> reviewer decision
```

The selected path is intentionally conservative. PaddleOCR supplies text, confidence, line boxes, word boxes, and orientation recovery evidence. The field alignment layer labels OCR token spans as possible evidence for submitted fields. The validators then normalize and compare values. If OCR evidence is weak or missing, the system fails safely into reviewer attention rather than treating the OCR as a legal determination.

Relevant code:

- `apps/worker/ttb_worker/engines/paddleocr_engine.py`
- `ttb_validation/field_entities.py`
- `ttb_validation/label_validators.py`
- `apps/worker/ttb_worker/extraction/model_status.py`
- `apps/worker/ttb_worker/tasks/validation_task.py`

## Current Corpus Stats

Generated with:

```bash
python scripts/ml-eval-summary.py
```

Current checked fixture corpus:

| Metric | Value |
|---|---:|
| Stored public COLA records | 75 |
| Demo-ready records seeded into each session | 66 |
| Initial submitted reviewer-workbench records | 65 |
| Initial correction workflow record | 1 |
| Retained but excluded records | 9 |
| Label image assets | 126 |
| Average label assets per record | 1.68 |

Demo-ready expected field coverage:

| Field | Records |
|---|---:|
| Brand name | 66 |
| Class/type | 66 |
| Product type | 66 |
| Government warning required | 66 |
| Alcohol content | 41 |
| Net contents | 41 |
| Producer/responsible party name | 41 |
| Producer/responsible party address | 41 |
| Fanciful name | 45 |
| Country of origin | 14 |

The active queue intentionally excludes records where the public image/form evidence cannot support the common review criteria. Those excluded records stay in the repository for provenance and collector testing.

## Hosted Reviewer Benchmark Snapshot

Measured on June 15, 2026 against `https://demo.sherpa-map.com` with isolated `console-*` benchmark sessions:

| Run mode | Applications | Median review time | p95 review time | Max review time | Backend OCR path | Browser fallback | Fields | Evidence crops |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| Single reviewer automation | 5 | 4.15 sec | 4.43 sec | 4.43 sec | `paddleocr` / `compose-paddleocr-cuda` | 0 | 25 | 13 |
| Batch review workflow | 5 | 3.57 sec/app | 4.73 sec/app | 4.73 sec/app | `paddleocr` / `compose-paddleocr-cuda` | 0 | 25 | 13 |

The worker reported `paddleocr_cuda_pretrained` on an NVIDIA GeForce RTX 4090. The script measured API wall-clock time from backend review POST until a stored review result was returned. It counted 10 backend review POSTs and 0 browser fallback requests.

Reproduce with:

```bash
node scripts/benchmark-hosted-reviewer.mjs --singleCount 5 --batchCount 5
```

These numbers measure the hosted demo path for tested seeded examples. They should not be described as a guarantee for all possible COLA labels.

## Current Throughput Benchmark

Generated from `benchmarks/results/latest.json`. These are calibrated fixture benchmarks used for the Admin benchmark panel and regression checks. They are useful for throughput comparison, but they are not a raw PaddleOCR model accuracy benchmark.

| Mode | Images | Engine label | Avg ms/image | p50 ms | p95 ms | Images/min | Failures |
|---|---:|---|---:|---:|---:|---:|---:|
| Browser fallback | 1 | tesseract-js-fixture | 1374.5 | 1374.5 | 1374.5 | 43.7 | 0 |
| Browser fallback | 10 | tesseract-js-fixture | 350.1 | 1384.2 | 1489.5 | 171.4 | 0 |
| Browser fallback | 50 | tesseract-js-fixture | 347.3 | 1363.3 | 1499.6 | 172.8 | 0 |
| Backend | 1 | python-validator-fixture | 821.4 | 821.4 | 821.4 | 73.0 | 0 |
| Backend | 10 | python-validator-fixture | 424.4 | 835.9 | 906.1 | 141.4 | 0 |
| Backend | 50 | python-validator-fixture | 420.7 | 818.8 | 923.3 | 142.6 | 0 |

For live OCR runs, p50/p95 depends on first-run model download, warmup, CPU versus CUDA, image dimensions, and number of images in the packet. The evaluator Docker path uses the CUDA PaddleOCR worker when NVIDIA GPU passthrough is available and otherwise falls back to CPU.

## Historical Model And Method Comparison

These results come from the project history and old lab commits. The early lab score was a normalized OCR text coverage score against expected label fields on hard local photo examples. It was not the final validator score, but it was useful for ranking candidate OCR engines.

| Method | Best observed score/time | What worked | What did not work | Current status |
|---|---:|---|---|---|
| Browser Tesseract.js with crop heuristics | Kept as browser fallback. Current fixture benchmark p95 is about 1.5 s/image using calibrated OCR estimates. | Fully local browser mode, no backend dependency, private upload path, easy fallback. | Crop heuristics were brittle on diagonal, vertical, curved, or side-panel text. Browser OCR is weaker on difficult real label images. | Fallback only. |
| EasyOCR local service | Historical hard-photo score 0.976 at 3829 ms with targeted crops, 0.977 at 6307 ms with core crops. | Strong recognition on difficult photos and stylized labels. Useful research baseline. | Extra PyTorch service complexity, slower targeted passes, weaker production packaging story for this demo, and not clearly better once PaddleOCR full-image detection was integrated. | Removed from supported runtime. |
| docTR | Historical hard-photo score 0.985 at 5411 ms targeted, 0.987 at 9704 ms core, 0.988 at 23076 ms multiscale. | Excellent lab accuracy and fast native pass on some images. | Not integrated into the current worker/API/UI path, and multiscale gains were too small for the latency. | Good future benchmark option, not shipped. |
| TrOCR | Historical hard-photo score 0.131 at 2321 ms on core crops. | Potential recognizer for clean line crops. | It is a recognizer, not a full label detector. It performed poorly when asked to solve detection plus recognition. | Not used. |
| CLIP/SigLIP style crop ranking | Not promoted to runtime. | Could rank whether a crop looks like ABV, brand, warning, producer, etc. | Not a text extraction model and not safe for exact numbers or pass/fail. Would still require OCR and deterministic validators. | Future region-ranker idea only. |
| LayoutLMv3 token classification | Local candidate was blocked: field recall 0.398 and false-pass rate 0.818. | Architecturally attractive for token-level field extraction after OCR. | Weak-label training overpredicted or missed important fields. It needed human-reviewed BIO spans before it could safely beat deterministic alignment. | Removed from supported runtime. |
| PaddleOCR full image plus conservative field alignment | Current supported backend. Uses pretrained PaddleOCR baseline unless optional local PaddleOCR model dirs are staged. | Reads full labels, returns text boxes, supports GPU/CPU deployment, handles multi-image packets, and evidence crops are derived from OCR/entity boxes. Deterministic validators prevent OCR from becoming a black-box approval model. | Needs PaddleOCR runtime dependencies. Some highly stylized, vertical, or low-resolution text still requires reviewer confirmation. | Default backend path. |

## Why PaddleOCR Won For The Shippable Demo

PaddleOCR was chosen because it best fits the product constraints after the cleanup phase:

- It reads the full image, so the backend does not depend on hand-authored crop windows.
- It returns geometry, which lets the reviewer see evidence crops from the recognized token boxes.
- It has a practical Docker CPU/CUDA setup and a native Mac/Linux setup path.
- It keeps the ML boundary narrow: OCR produces evidence, deterministic validators decide field pass/fail.
- It supports optional future custom `det/`, `rec/`, and `cls/` model directories without changing the API contract.
- It avoids the biggest risk found in the LayoutLMv3 trial: a learned field extractor creating false confidence before the training labels are good enough.

## Why The Trained LayoutLMv3 Extractor Was Not Kept

The LayoutLMv3 direction was the right architecture for a later production extraction layer, but the available labels were too weak for promotion. The candidate improved some obvious warning-text cases but had unacceptable behavior on other fields. The recorded gate numbers were:

| Metric | Candidate result |
|---|---:|
| Field recall | 0.398 |
| False-pass rate | 0.818 |

That failed the promotion rule: improve hard-field recall without increasing false passes. More weak-label training would likely overfit the same noisy spans. The next credible version would require a human-reviewed BIO span queue with record-level train/validation/test splits.

## Remaining Options

The practical next upgrades are:

1. Build a human-reviewed token/span annotation set from the current public fixtures.
2. Revisit LayoutLMv3 or a lighter token classifier only after the BIO labels are clean.
3. Compare PaddleOCR against docTR on the same real COLA fixture split if a PyTorch-heavy backend is acceptable.
4. Train or fine-tune PaddleOCR recognition only if failure analysis proves recognition, not field selection, is the limiting factor.
5. Keep browser Tesseract as a privacy-preserving offline fallback, not the primary accuracy path.

## Reproduction Commands

Current fixture and benchmark summary:

```bash
python scripts/ml-eval-summary.py
```

Current quick regression set:

```bash
./scripts/regression-fast.sh
```

Current local benchmark:

```bash
./scripts/bench-local.sh
```

If a custom PaddleOCR model is later trained, promote it only when the untouched test split shows better field recall and no higher false-pass rate.
