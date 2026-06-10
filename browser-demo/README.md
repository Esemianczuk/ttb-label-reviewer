# TTB Label Reviewer

TTB Label Reviewer is a browser-only prototype for comparing alcohol label images against expected COLA/application fields. It runs OCR in the browser, extracts label evidence, and applies deterministic validation rules for brand name, class/type, alcohol content, net contents, and the required government warning.

Migration note: this `browser-demo/` app remains the runnable V1 demo while shared `ApplicationPacket`, review, and job schemas are introduced under `../packages/shared/schemas/`.

The prototype avoids backend services and cloud APIs: label images are not uploaded, and no cloud OCR or LLM service is used. OCR results are treated as evidence; final pass/fail/needs-review outcomes are produced by transparent validators so a human reviewer can understand why each field was flagged.

## Quick Start

Local browser path:

```bash
git clone https://github.com/Esemianczuk/ttb-label-reviewer.git
cd ttb-label-reviewer
source ~/.nvm/nvm.sh && nvm use 20
npm install
./open-demo.sh
```

This starts the Vite app. OCR runs in the browser with Tesseract.js, so no Python service, CUDA setup, or server-side model process is required.

Open the local URL shown by Vite. The first sample application loads and auto-reviews immediately. Use **Next Application** to move through the sample queue, or upload one or more images, enter expected TTB fields, and click **Auto Review**.

The app can also be run manually:

```bash
npm run dev
```

For a production-style frontend build check:

```bash
npm run build
```

The Vite config uses relative asset paths, so the built `dist/` folder can be hosted as a static site, including GitHub Pages.

## What It Validates

- Brand name with OCR-aware fuzzy matching for case, quote, and minor OCR differences.
- Class/type designation with targeted phrase and token coverage matching.
- Alcohol content by normalizing ABV and proof values.
- Net contents by normalizing mL and liter values, including common OCR substitutions.
- Government warning by checking required legal text segments.
- Visual evidence crops from the original application image for matched OCR evidence when OCR bounding boxes are available.
- Agent decisions and notes that can override the automatic field status for the final pass/fail result.

## Sample Packet Library

Sample applications are data-driven. The app loads `public/label-packets/manifest.json`, then reads each application's one image, expected fields, OCR fixture, and expected outcome from that folder.

Current samples include twelve synthetic TTB/COLA-style one-image submission sheets. The UI uses fixtures for the sample queue so the demo behaves like a database-backed agent review workflow and stays fast. Uploaded images still run through browser OCR.

New samples can be added without changing application logic. See `docs/sample-packets.md`.

Public COLA Registry fixtures are included only as a small curated sample for testing. Each record includes source metadata and retrieval timestamp.

## Uploads And Reports

Users can click **Choose Images** or drag one or more images into the label area. Enter the expected TTB fields and click **Auto Review**.

Uploaded batches run through a bounded browser Web Worker pool. The reviewer can keep worker count on **Auto** or force 1-3 workers. Each reviewed application can export JSON, CSV, or a PDF report containing the submission fields, image, automatic matches, extracted evidence, final decisions, and reviewer notes. The image preview can also be expanded into a movable viewer with zoom and pan controls.

## Local-only Privacy Model

Version 1 processes label images in the browser and does not call a cloud OCR, LLM, or backend inference API at runtime.

The OCR path uses Tesseract.js through dedicated browser workers. The current preset uses fast rectangular crops for the product/application fields and label evidence areas on COLA-style sheets. Language data is cached by the browser after first load.

The app first looks for packaged OCR assets under `public/tesseract/`. If those files are not present in development, it falls back to public Tesseract.js CDNs for engine assets only. Uploaded image bytes are still processed inside the browser session and are not sent to those CDNs by this app.

## Approach

The app does not ask AI to decide whether a label passes. The pipeline is:

1. Load one or more application images in the browser.
2. Run in-browser OCR using a bounded dedicated Web Worker pool and fixed COLA-sheet crop regions.
3. Merge OCR evidence from all crop variants and search for targeted evidence related to the expected application fields.
4. Apply deterministic validators with conservative review states for noisy but relevant evidence.
5. Crop matched evidence regions from the original image in the browser.
6. Show field, expected value, extracted evidence, visual crop, automatic status, reason, and confidence hint.
7. Let the agent adjust final pass/fail decisions and notes.
8. Export JSON, CSV, or PDF summary.

## Future COLA Integration

Version 1 uses manual entry for expected application fields. The internal data shape mirrors a COLA/application record, so a future implementation can populate the same object from COLAs Online, a database view, CSV export, or internal service adapter without changing OCR or validation logic.

## Browser OCR Path

The OCR interface is isolated in `src/ocr/`. The active runtime is `src/ocr/browser-tesseract.js`, which uses a reusable Tesseract.js worker and eight targeted COLA-sheet crop variants:

- Top application fields
- Application product fields
- Application summary
- Label image area
- Lower label strip
- Right warning text
- Lower middle warning text
- Can-back warning text

This keeps the hosted demo static while still returning line-level bounding boxes for visual evidence crops.

## Future OCR / Model Path

A future version could add ONNX Runtime Web or a tuned detector/recognizer while preserving the same validation layer.

## Out of Scope for Version 1

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

- OCR can struggle with glare, curved bottles, small print, and skewed photos.
- Tesseract.js has a first-load cost for the worker and English language data. Later runs use the browser cache.
- Development mode may load OCR engine assets from public CDNs unless `public/tesseract/` has been populated with local Tesseract.js assets.
- The government warning validator checks legal text segments but does not verify bold styling or font size.
- Direct file double-click is not the recommended runtime because browser workers and model files need normal HTTP loading. GitHub Pages or `npm run dev` works.

## Assessment Scope and License

This repository is an assessment prototype and is not an official TTB or Treasury system. No license is granted for reuse unless one is added later.
