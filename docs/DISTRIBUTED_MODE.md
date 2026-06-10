# Distributed Mode

Phase 4 adds a Python worker agent that can connect to the local FastAPI coordinator and process queued review jobs.

Phase 5 adds hardware-aware assignment scoring. Workers still pull jobs from the coordinator, but the coordinator scores each queued job against every eligible backend worker and only leases a job to the best candidate.

## Start

Terminal 1:

```bash
./scripts/dev-local-backend.sh
```

Terminal 2:

```bash
./scripts/dev-worker.sh --session-id local-dev-session
```

The worker can also run once and exit:

```bash
./scripts/dev-worker.sh --session-id local-dev-session --once
```

## Capabilities

At startup the worker probes:

- hostname, platform, architecture, and Python version
- CPU count and memory
- worker cache disk read/write speed
- coordinator latency and download throughput
- CUDA and Apple MPS availability when Torch is installed
- ONNX Runtime providers when installed
- Tesseract binary and Python OCR library availability
- EasyOCR and PaddleOCR import availability
- local model cache size
- supported image formats

Use this command to inspect the probe without registering:

```bash
./scripts/dev-worker.sh --probe
```

## Engines

- `null`: deterministic fixture OCR, always available for tests and demos.
- `tesseract`: optional CPU OCR when `tesseract`, `pytesseract`, and Pillow are installed.
- `easyocr`: optional adapter, warmed only when explicitly selected or `TTB_WORKER_ENABLE_HEAVY_OCR=1`.
- `paddleocr`: optional adapter, warmed only when explicitly selected or `TTB_WORKER_ENABLE_HEAVY_OCR=1`.
- `onnx`: placeholder adapter that reports unavailable unless a local model is configured.

The worker does not download model weights or require cloud services.

## Job Flow

1. Worker registers with coordinator capabilities and calibration.
2. Coordinator scores eligible queued jobs across all online backend workers.
3. Coordinator leases a queued session-scoped job only when the claiming worker is the best candidate.
4. Worker downloads needed assets through `/api/assets/{asset_id}/content` with `X-Session-Id`.
5. Downloaded assets are cached locally and reported on future heartbeats.
6. OCR jobs return text, confidence, lines, words, timings, and engine metadata.
7. Evidence jobs return auditable field candidates.
8. Validation jobs rerun OCR over application assets and return a final deterministic `ReviewResult`.
9. Heartbeats keep leases alive; failures are reported with structured errors and retryable jobs return to the queue.

See [SCHEDULER.md](SCHEDULER.md) for the assignment score model.
