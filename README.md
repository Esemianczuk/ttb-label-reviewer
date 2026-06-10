# TTB Label Reviewer

TTB Label Reviewer is a local-first prototype for comparing alcohol label images against expected COLA/application fields. It runs OCR locally, extracts label evidence, and applies deterministic validation rules for brand name, class/type, alcohol content, net contents, and the required government warning.

The prototype avoids cloud APIs: label images are not uploaded, and no cloud OCR or LLM service is used. OCR results are treated as evidence; final pass/fail/needs-review outcomes are produced by transparent validators so a human reviewer can understand why each field was flagged.

## Quick Start

Fast local OCR path:

```bash
git clone https://github.com/Esemianczuk/ttb-label-reviewer.git
cd ttb-label-reviewer
source ~/.nvm/nvm.sh && nvm use 20
npm install
python3 -m pip install --user -r server/requirements-easyocr.txt
./open-demo.sh
```

This starts the Vite app and a localhost EasyOCR service. The service runs on CPU by default, so CUDA is not required. The first OCR request loads the model; later requests use the warm service.

Open the local URL shown by Vite, load the sample packet or drag in a label image packet, enter expected application fields, and click **Review Label**.

The launcher starts the EasyOCR service, starts the local Vite server, and opens the browser.

The EasyOCR service can also be run manually in one terminal:

```bash
npm run easyocr-service
```

CUDA can be enabled explicitly on machines that have it, but the app does not depend on it:

```bash
EASYOCR_GPU=cuda npm run easyocr-service
```

Then run the app in another terminal:

```bash
npm run dev
```

For a production-style frontend build check:

```bash
npm run build
```

## What It Validates

- Brand name with OCR-aware fuzzy matching for case, quote, and minor OCR differences.
- Class/type designation with targeted phrase and token coverage matching.
- Alcohol content by normalizing ABV and proof values.
- Net contents by normalizing mL and liter values, including common OCR substitutions.
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

Version 1 processes label images locally and does not call a cloud OCR, LLM, or external inference API at runtime.

The OCR path uses a CPU localhost EasyOCR service. Its `fast` mode uses native EasyOCR detection on CPU to stay under the time limit, and uses the higher-accuracy targeted crop preset when CUDA is explicitly enabled. CUDA is an opt-in acceleration mode, not a requirement. Uploaded images are sent only to the localhost service, not to a cloud OCR API. The bundled front/back sample is synthetic and has a local OCR fixture so the sample review is effectively instant.

## Approach

The app does not ask AI to decide whether a label passes. The pipeline is:

1. Load one or more label images in the browser.
2. Send selected images to the localhost EasyOCR service.
3. Run local OCR with EasyOCR `fast` mode: native detection on CPU, targeted crop variants when CUDA is explicitly enabled.
4. Merge OCR evidence from all variants and search for targeted evidence related to the expected application fields.
5. Apply deterministic validators with conservative review states for noisy but relevant evidence.
6. Show field, expected value, extracted evidence, status, reason, and confidence hint.
7. Export JSON or CSV summary.

## Future COLA Integration

Version 1 uses manual entry for expected application fields. The internal data shape mirrors a COLA/application record, so a future implementation can populate the same object from COLAs Online, a database view, CSV export, or internal service adapter without changing OCR or validation logic.

## Future OCR / Model Path

The OCR interface is isolated in `src/ocr/`. EasyOCR is currently the local service path. A future version could add PaddleOCR/ONNX Runtime Web or a tuned detector/recognizer while preserving the same validation layer.

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

- OCR can struggle with glare, curved bottles, small print, and skewed photos.
- EasyOCR cold start includes model load time. The sub-five-second target applies to the warm local service path. CUDA can improve speed where available, but the default path is CPU with the faster native EasyOCR pass.
- The government warning validator checks legal text segments but does not verify bold styling or font size.
- EasyOCR mode requires the localhost service. Direct file double-click is not the supported runtime.

## Assessment Scope and License

This repository is an assessment prototype and is not an official TTB or Treasury system. No license is granted for reuse unless one is added later.
