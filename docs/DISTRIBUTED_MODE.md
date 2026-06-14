# Distributed Mode

Phase 4 adds a Python worker agent that can connect to the local FastAPI coordinator and process queued review jobs.

Phase 5 adds hardware-aware assignment scoring. Workers still pull jobs from the coordinator, but the coordinator scores each queued job against every eligible backend worker and only leases a job to the best candidate.

Phase 6 adds secure worker discovery and join. Manual join is the reliable default; mDNS is optional.

Phase 7 exposes those workers in the browser operations dashboard. Admin users can switch between Browser Only, Backend, and Cluster modes without losing the local-only fallback; reviewers stay focused on packet review and inherit the selected processing provider.

## Start

One-command local backend plus worker:

```bash
./scripts/smart-demo.sh
```

Use `./scripts/smart-demo.sh --install-heavy-ocr` if you want the launcher to install optional PaddleOCR/EasyOCR support for a stronger local worker. For manual startup, use two terminals.

Terminal 1:

```bash
./scripts/dev-local-backend.sh
```

Terminal 2:

```bash
ADMIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/auth/demo-login \
  -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

JOIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/cluster/join-token \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ttlSeconds":900}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
./scripts/dev-worker.sh --session-id local-dev-session --join-token "$JOIN_TOKEN"
```

The worker can also run once and exit:

```bash
./scripts/dev-worker.sh --session-id local-dev-session --join-token "$JOIN_TOKEN" --once
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
- PaddleOCR and EasyOCR import availability
- local model cache size
- supported image formats

Use this command to inspect the probe without registering:

```bash
./scripts/dev-worker.sh --probe
```

## Engines

- internal fixture fallback: deterministic OCR used only for tests or when no production OCR engine is available; admin views label this as `fixture fallback only`.
- `tesseract`: optional CPU OCR when `tesseract`, `pytesseract`, and Pillow are installed.
- `paddleocr`: preferred backend OCR adapter. Install with `python -m pip install -e "apps/worker[ocr,paddleocr]"`; workers report whether they are using the pretrained baseline or custom COLA model dirs from `models/ocr/paddle-cola/current`.
- `easyocr`: optional fallback OCR adapter. Install with `python -m pip install -e "apps/worker[ocr,easyocr]"`; workers report it unavailable when the dependency is missing.
- `onnx`: local-model adapter that reports unavailable unless a local model path is configured.

The worker does not download model weights or require cloud services.

Workers default to `TTB_WORKER_ENGINES=auto`. Auto mode advertises the real engines that are importable or installed on that machine and hides the fixture fallback whenever PaddleOCR, EasyOCR, Tesseract, or ONNX OCR is available. CUDA and Apple MPS probes are reported in the worker capability profile. The scheduler gives critical OCR a quality bonus for PaddleOCR and an additional preference for accelerated workers, while ordinary fields can still route to faster available CPU workers when no PaddleOCR worker is online.

Backend review jobs default to `paddleocr_authoritative`. The coordinator creates OCR work before validation, attaches completed OCR results to the validation job, and then applies deterministic validators. `tesseract_first_easyocr_escalation` is still accepted for older saved payloads, but it is no longer the default path. Validation records `enginesUsed[]` plus an `escalation` object; if distributed field OCR results are not present, validation can still fall back to the worker-local OCR path.

## Job Flow

1. Coordinator creates a short-lived join token and displays a copyable `python -m ttb_worker --coordinator ... --join-token ...` command.
2. Worker registers with the join token, capabilities, and calibration.
3. Coordinator returns a persistent worker secret once.
4. Worker saves the secret in `.worker-cache/worker-secret.txt`.
5. Subsequent heartbeat, claim, complete, fail, and recalibrate calls use `Authorization: Bearer <worker secret>`.
6. Coordinator scores eligible queued jobs across all online backend workers.
7. Coordinator leases a queued session-scoped job only when the claiming worker is the best candidate.
8. Worker downloads needed assets through `/api/assets/{asset_id}/content` with `X-Session-Id`.
9. Downloaded assets are cached locally and reported on future heartbeats.
10. OCR jobs are scoped to one asset and one expected field, and return text, confidence, lines, words, timings, field metadata, and engine metadata.
11. Completed OCR jobs are appended to the sibling validation job so validation can aggregate distributed field output.
12. Evidence jobs return auditable field candidates once OCR dependencies are complete.
13. Validation jobs aggregate completed field OCR, apply deterministic validators, optionally escalate when needed, and return a final deterministic `ReviewResult`.
14. Heartbeats keep leases alive; failures are reported with structured errors and retryable jobs return to the queue.
15. Browser dashboards read `/api/workers`, `/api/workers/events`, `/api/cluster/status`, and `WS /api/ws/sessions/{session_id}` for worker cards, scheduler reasons, and live session snapshots.

See [SCHEDULER.md](SCHEDULER.md) for the assignment score model.

## Discovery

Manual join remains the dependable path:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/cluster/join-token \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ttlSeconds":900}' | python -m json.tool
```

The response includes `coordinatorUrl`, `token`, `expiresAt`, and a ready-to-copy command. The request requires an admin bearer token unless the security defaults are explicitly relaxed for local experiments.

mDNS/zeroconf discovery is optional:

```bash
python -m pip install -r requirements-dev.txt
python -m pip install -e "apps/api[discovery]" -e "apps/worker[discovery]"
TTB_ENABLE_MDNS=1 TTB_API_HOST=0.0.0.0 ./scripts/dev-local-backend.sh
python -m ttb_worker --discover --join-token "$JOIN_TOKEN"
```

The coordinator never binds beyond localhost by default. If `TTB_API_HOST=0.0.0.0` or `::` is used, scripts print a LAN-mode warning and `/api/health` returns the same warning for the console. Set `TTB_API_CORS_ORIGINS` to exact trusted frontend origins when validating over a LAN.

## Lab Hosts

Use [scripts/register-lab-hosts.example.sh](../scripts/register-lab-hosts.example.sh) to print copyable commands for:

- `eric@bigbertha.sherpa-map.internal`
- `eric@thevault.sherpa-map.internal`
- `ssh mac`

It does not SSH or install anything automatically.

## Frontend Cluster Smoke

The browser e2e suite includes an optional live backend test. Start a coordinator and a worker for session `phase7-ui`, then run:

```bash
cd browser-demo
TTB_E2E_BACKEND_URL=http://127.0.0.1:8000 npm run test:e2e -- -g "backend mode completes"
```

For LAN validation, bind the coordinator to a trusted interface and pass the LAN URL to workers and Playwright:

```bash
TTB_API_HOST=0.0.0.0 \
TTB_API_PORT=8010 \
TTB_COORDINATOR_URL=http://<coordinator-lan-ip>:8010 \
TTB_API_CORS_ORIGINS=http://<coordinator-lan-ip>:8010,http://127.0.0.1:5173 \
./scripts/dev-local-backend.sh
```
