# TTB Label Reviewer

TTB Label Reviewer is a local-first prototype for comparing alcohol label images against expected COLA/application fields. It runs OCR in the browser, extracts label evidence, and applies deterministic validation rules for brand name, class/type, alcohol content, net contents, and the required government warning.

The prototype is intentionally zero-API: label images are not uploaded, and no cloud OCR or LLM service is used. OCR results are treated as evidence; final pass/fail/needs-review outcomes are produced by transparent validators so a human reviewer can understand why each field was flagged.

## Quick Start

```bash
git clone https://github.com/Esemianczuk/ttb-label-reviewer.git
cd ttb-label-reviewer
source ~/.nvm/nvm.sh && nvm use 20
npm install
npm run dev
```

Open the local URL shown by Vite, load the sample packet or drag in a label image packet, enter expected application fields, and click **Review Label**.

On Linux, you can also run:

```bash
./open-demo.sh
```

The launcher starts the local Vite server and opens the browser so OCR runs from `localhost` instead of a brittle `file://` page.

For a production-style static check:

```bash
npm run build
npm run preview
```

## What It Validates

- Brand name with OCR-aware fuzzy matching for case, quote, and minor OCR differences.
- Class/type designation with a stricter targeted phrase match.
- Alcohol content by normalizing ABV and proof values.
- Net contents by normalizing mL and liter values.
- Government warning by checking required legal text segments.

Multiple images are reviewed together as one label packet, which lets a front image carry brand/class/ABV/net contents and a back image carry the government warning.

## Sample Packet Library

Sample labels are data-driven. The app loads `public/label-packets/manifest.json`, then reads each packet's images, expected fields, OCR fixture, and expected outcome from that folder.

Current packets include passing labels, alcohol mismatch, missing warning, warning needs review, punctuation/case variance, and a synthetic packet based on text extracted from a local tequila front/back photo set. The public sample images are synthetic.

New samples can be added without changing application logic. See `docs/sample-packets.md`.

## Uploads and Custom Labels

Users can click **Choose Images** or drag images into the label area. New selections are additive, so front/back images can be dropped in separate steps and reviewed as one packet.

The **Create Custom Label Images** button renders a synthetic front/back packet from the expected-fields form. Those generated images stay in the browser session and can be reviewed with the same OCR and validation flow.

## Local-only Privacy Model

Version 1 runs entirely in the browser. Label images are processed locally and are not uploaded to a server. No cloud OCR, LLM, or external inference API is used at runtime.

The app vendors the Tesseract.js worker/core assets and English traineddata under `public/`. The bundled front/back sample is synthetic and has a local OCR fixture so the sample review is effectively instant while arbitrary uploads still go through Tesseract.js.

## Approach

The app does not ask AI to decide whether a label passes. The pipeline is:

1. Load one or more label images in the browser.
2. Preprocess images with deterministic resizing, grayscale conversion, and contrast enhancement.
3. Run browser-local OCR using Tesseract.js with a small worker pool.
4. Search OCR output for targeted evidence related to the expected application fields.
5. Apply deterministic validators.
6. Show field, expected value, extracted evidence, status, reason, and confidence hint.
7. Export JSON or CSV summary.

## Future COLA Integration

Version 1 uses manual entry for expected application fields. The internal data shape mirrors a COLA/application record, so a future implementation can populate the same object from COLAs Online, a database view, CSV export, or internal service adapter without changing OCR or validation logic.

## Future OCR / Model Path

The OCR interface is isolated in `src/ocr/`. A future Version 2 could add a PaddleOCR/ONNX Runtime Web engine for stronger document OCR while preserving the same validation layer.

## Out of Scope for Version 1

- PDF packet processing
- Direct COLAs Online integration
- Cloud OCR or hosted LLM calls
- Final legal determination
- Full regulatory coverage for every alcohol commodity
- Login, database, document retention, or federal production deployment concerns

## Testing

```bash
npm test
npm run build
```

Unit tests cover normalization, extraction, validators, and overall status logic. Tests use hand-authored OCR fixtures so they do not depend on live OCR results.

## Known Limitations

- Browser OCR can struggle with glare, curved bottles, small print, and skewed photos.
- The government warning validator checks legal text segments but does not verify bold styling or font size.
- Local OCR workers generally need the app to be served from `localhost`; direct file double-click can open static pages in some browsers, but OCR workers are more reliable through `npm run dev` or `npm run preview`.

## Assessment Scope and License

This repository is an assessment prototype and is not an official TTB or Treasury system. No license is granted for reuse unless one is added later.
