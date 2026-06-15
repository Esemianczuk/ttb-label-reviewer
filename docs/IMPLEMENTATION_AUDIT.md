# Implementation Audit

Current shippable direction:

- Browser fallback remains private and local.
- Backend mode is FastAPI plus one local PaddleOCR worker.
- LayoutLMv3 field extraction is active when a local promoted model exists.
- Conservative weak alignment is the backend fallback when the trained extractor is absent.
- Alternate OCR fallback engines and multi-host processing selectors have been removed from the supported path.
- Deterministic validators remain the authority for pass/fail decisions.
- Reviewer PDFs, evidence crops, notes, audit trail, and role model remain active.

Primary verification commands:

```bash
npm run test:js
python -m pytest -q
npm run build
./scripts/bench-local.sh
```

One-command demo:

```bash
./scripts/smart-demo.sh
```
