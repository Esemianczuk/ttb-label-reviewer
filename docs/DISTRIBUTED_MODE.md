# Backend Worker Mode

The shippable backend path uses one local FastAPI coordinator and one local PaddleOCR worker. This keeps setup simple while preserving the same worker/job/audit architecture used by the console.

## One Command

Docker evaluator path:

```bash
./scripts/docker-demo.sh
```

Local Python path:

```bash
./scripts/smart-demo.sh
```

This starts:

- FastAPI on `127.0.0.1:8000`
- the built console from `apps/console/dist`
- one local PaddleOCR worker

## Manual Worker Startup

```bash
ADMIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/auth/demo-login \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

JOIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/workers/join-token \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

TTB_WORKER_JOIN_TOKEN="$JOIN_TOKEN" ./scripts/dev-worker.sh
```

## Engines

- `paddleocr`: required backend OCR engine for the local worker.
- Browser-local OCR is packaged in the frontend only and is used when the coordinator is unavailable.
- Test fixture fallbacks are kept out of the evaluator runtime; explicit PaddleOCR worker startup fails if PaddleOCR is unavailable.

If `models/field-extractor/layoutlmv3-cola/current` exists, validation attaches trained LayoutLMv3 field entities. If not, validation uses conservative weak alignment and clearly reports baseline mode in Admin -> OCR Engines.

## Job Flow

1. Admin demo auth issues a short-lived worker join token from `/api/workers/join-token`.
2. Worker registers with token, capabilities, calibration, and engine status.
3. Coordinator returns a persistent worker secret.
4. Worker heartbeats with `Authorization: Bearer <worker secret>`.
5. Reviewer automation creates OCR, evidence, validation, and report work.
6. Worker claims eligible jobs, downloads scoped assets, and returns OCR text/boxes.
7. Validation aggregates OCR output, field entities, and deterministic validators.
8. Reviewer sees evidence crops from OCR/entity boxes and records final pass/fail decisions.

## Security Defaults

- Worker join token required by default.
- Persistent worker secret required after registration.
- Stale workers time out and leases return to the queue.
- Uploads are MIME, magic-byte, size, path, and decode checked.
- LAN binding shows a prominent warning.
