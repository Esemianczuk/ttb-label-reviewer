# Validation Engine

Phase 7 replaces the worker's substring-only checks with deterministic validators that mirror the browser review logic. OCR and model output remain evidence only; the validators produce the final field status.

## Shared Golden Fixtures

Golden cases live in:

```text
packages/shared/validation-golden/
```

Current cases cover:

- Brand quote/case normalization: `STONE'S THROW` style OCR matches `Stone's Throw`.
- ABV/proof equivalence: `90 proof` equals `45% ABV`.
- Net contents equivalence: `1 L` equals `1000 mL`.
- Missing government warning fails.
- Heading-only government warning needs review and never passes.
- Class/type fails when a meaningful expected term is missing.

Browser and Python tests read the same JSON files.

## Python Shared Module

The Python implementation lives in:

```text
ttb_validation/
```

It is included in the root editable install and re-exported by `apps/api/app/validation` for backend callers. The worker imports `ttb_validation` directly, avoiding an API-to-worker or worker-to-API package dependency.

Validators include:

- fuzzy brand matching
- class/type token coverage
- ABV/proof parsing
- mL/liter normalization
- government warning segment validation
- optional fanciful name, producer/responsible-party, and country matching

The government warning text and segment checks follow 27 CFR 16.21.

## Worker Output

`apps/worker/ttb_worker/tasks/validation_task.py` now returns a shared-schema-shaped `ReviewResult`:

- `overallStatus`
- `fields[]` with `fieldKey`, `status`, `reason`, confidence, severity, and evidence candidates
- `files[]`
- `timings`
- `enginesUsed[]`
- `workersUsed[]`

`evidence_task.py` preserves OCR line/word candidates and bounding boxes when prior OCR data is available in the job payload.

## Verification

Focused checks:

```bash
python -m pytest apps/api/app/tests/test_phase7_validators.py -q
npm --prefix browser-demo test -- src/tests/validation-golden.test.js src/tests/validation.test.js
python -m pytest apps/worker/tests/test_worker_agent.py -q
```

Full check:

```bash
./scripts/check-all.sh
```
