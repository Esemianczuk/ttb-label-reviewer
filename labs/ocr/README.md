# OCR Lab

This lab is for stage one of the label-review pipeline: OCR quality. The production app still has three stages:

1. OCR: produce raw text evidence from one or more label images.
2. Normalization: normalize units, alcohol statements, warning text, punctuation, and OCR substitutions.
3. Fuzzy matching: compare normalized evidence against expected COLA/application fields.

The goal here is to cast a wide net on OCR engines, benchmark them against the same image packets, and narrow toward the best local-first option before touching the browser app.

## Current Candidate Set

- Browser baseline: Tesseract.js in the current app.
- PyTorch local: EasyOCR, docTR, and TrOCR.
- Browser deployment path: PyTorch-trained models exported to ONNX, then run with ONNX Runtime Web or Transformers.js/WebGPU.

PyTorch itself is not the practical browser runtime. The realistic browser path is train or tune locally with PyTorch, export to ONNX, and run the exported model in the browser.

## Setup

The machine already has CUDA PyTorch installed. Use a local virtual environment only for the optional OCR candidates:

```bash
cd /home/eric/DocumentsFAST/Take_Home_Project/browser-demo
python3 -m venv --system-site-packages .venv-ocr-lab
source .venv-ocr-lab/bin/activate
python -m pip install -r labs/ocr/requirements-stage1.txt
```

If `python3 -m venv` fails on Ubuntu because `ensurepip` is missing, install the distro venv package first, for example `sudo apt install python3.10-venv`. A user install also works for experimentation:

```bash
python3 -m pip install --user -r labs/ocr/requirements-stage1.txt
```

The harness is optional-engine based. Missing engines are reported and skipped.

## Run

Fast smoke test against the real tequila photos:

```bash
python labs/ocr/run_stage1.py --case real-tequila --engines easyocr,doctr --variant-set native
```

Targeted high-resolution rescue pass:

```bash
python labs/ocr/run_stage1.py --case real-tequila --engines easyocr,doctr --variant-set targeted
```

Adaptive native-then-detail cascade:

```bash
python labs/ocr/run_stage1.py --case real-tequila --engines easyocr,doctr --variant-set cascade
```

Wide local sweep:

```bash
python labs/ocr/run_stage1.py --engines easyocr,doctr,trocr,tesseract-cli --variant-set multiscale
```

Synthetic packet sweep:

```bash
python labs/ocr/run_stage1.py --synthetic-only --engines easyocr,doctr,trocr --variant-set core
```

Each run writes:

- `results.json`: raw results, scores, timings, environment.
- `summary.md`: ranked table for quick review.

Run outputs are written under `labs/ocr/runs/` and ignored by git.

See `labs/ocr/FINDINGS.md` for the current ranking and next-step recommendation.

## Variant Presets

- `native`: original image only. This tests the OCR engine's internal text detector without external crops.
- `minimal`: one upscaled grayscale full-image variant.
- `detail`: lower detail, inverted lower detail, and warning/detail crops.
- `targeted`: original image plus lower detail, inverted lower detail, and warning/detail crops.
- `core`: full upscaled image, central label, lower detail, inverted lower detail, and warning/detail crops.
- `multiscale`: core-style regions plus wide label, horizontal bands, and left/right overlap tiles.
- `wide`: all available variants, including additional quadrant tiles and adaptive thresholding.
- `cascade`: run native first and add detail crops only when field scores are below conservative thresholds.

## How To Interpret Scores

The scorer is intentionally simple. It measures field-token coverage and phrase similarity against expected label fields. That is enough to compare OCR engines, but it is not the final regulatory decision logic.

Good stage-one candidates should:

- Recover the brand, class/type, ABV/proof, net contents, warning heading, producer, and country.
- Stay fast enough on CPU or laptop GPU.
- Work locally without a server-side GPU.
- Have a plausible browser path through ONNX/WebGPU if the accuracy is close.

## Training Direction

Synthetic labels and self-shot photos are worth doing, but CLIP LoRA should be treated as a routing/classification tool, not the main OCR model. For transcription, the stronger path is:

1. Generate synthetic front/back labels with known text.
2. Add distortions: glare, blur, skew, bottle curvature, compression, perspective, uneven lighting.
3. Capture real phone photos and annotate text regions plus expected strings.
4. Fine-tune a text recognizer such as TrOCR or a docTR recognizer on cropped text regions.
5. Export the winner to ONNX and test browser runtime performance.

CLIP or SigLIP can still help classify label type, identify front/back, or choose crop regions before OCR.
