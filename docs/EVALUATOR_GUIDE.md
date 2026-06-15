# Evaluator Guide

TTB Label Reviewer is a local-first assessment prototype. It is not an official TTB or Treasury system and does not make legal determinations.

No cloud AI service is required. Use the backend path for FastAPI persistence plus a local PaddleOCR worker. If the backend is absent, the console falls back to browser-local OCR automatically. Backend workers use PaddleOCR full-image OCR with conservative field alignment from OCR token boxes.

## Fastest Path

Use Docker when available:

```bash
./scripts/docker-demo.sh
```

Expected startup:

- The API image builds the console and serves it from FastAPI.
- Demo public COLA fixtures are seeded into SQLite.
- Each browser/device receives an isolated demo session, so several reviewers can test against the same backend without sharing review state.
- One PaddleOCR worker registers with the coordinator.
- Linux uses CUDA automatically when Docker GPU passthrough works; otherwise it uses CPU.
- macOS starts the API in Docker and the OCR worker natively through `scripts/docker-mac-metal.sh`.

Open:

```text
http://127.0.0.1:8000/
```

Platform-specific Docker details are in [Docker Quick Start](DOCKER.md).

## Local Python Path

```bash
./scripts/smart-demo.sh
```

Expected startup:

- The console is built into `apps/console/dist`.
- FastAPI starts on `http://127.0.0.1:8000`.
- A worker token is issued from `/api/workers/join-token`.
- One local PaddleOCR worker starts.
- The console opens at `http://127.0.0.1:8000/`.

What to click:

1. Click **Continue as Reviewer**.
2. Open a submitted packet from the dashboard or queue.
3. Click **Run automation** if the packet has not been reviewed yet.
4. Compare **Application value** against **Label evidence** in the field table.
5. Expand the label image when needed, zoom/pan, and inspect the evidence.
6. Toggle fields between **Pass** and **Fail** as the reviewer decision requires.
7. Add notes when useful.
8. Export the **PDF** report.
9. Use **Next Application** to continue.
10. Use **Reset Demo** to restore the demo samples.

Expected outcome:

- The first screen is usable without a tutorial.
- Reviewer work centers on evidence, pass/fail decisions, notes, and reports.
- Browser fallback uploads stay in the browser.
- Backend primary mode shows health, workers, jobs, audit, and benchmark data.

## Browser Fallback

```bash
npm install
npm run console:dev
```

Open the Vite URL, usually `http://127.0.0.1:5174/`.

Browser fallback uses packaged Tesseract assets and deterministic validators. The production path has no runtime CDN dependency. The development CDN fallback is disabled unless explicitly enabled:

```bash
VITE_ALLOW_TESSERACT_CDN_FALLBACK=1 npm run console:dev
```

## Backend Mode

The one-command path is preferred:

```bash
./scripts/smart-demo.sh
```

Manual two-terminal path:

```bash
./scripts/dev-local-backend.sh
```

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

Expected backend behavior:

- `/api/health` reports database, asset root, static readiness, and LAN warnings.
- Worker registration requires a join token unless intentionally disabled.
- Registered workers use a persistent worker secret after first registration.
- Review queue, jobs, workers, and audit records update through backend resources.
- If the backend is unavailable, the console falls back to browser-local OCR automatically.

## Admin Checks

Open **Admin**:

- **Workers** should show the local PaddleOCR worker.
- **Jobs** should show OCR, evidence, validation, and report job state.
- **OCR Engines** should show PaddleOCR field alignment as the backend authority.
- **Benchmarks** should read JSON from `benchmarks/results`.
- **Audit Log** should show role changes, review actions, permission failures, and retention operations.

## Verification

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm run test:js
python -m pytest -q
npm run build
```

Optional Playwright matrix:

```bash
RUN_E2E=1 ./scripts/check-all.sh
```

Benchmarks:

```bash
./scripts/bench-local.sh
```

## Troubleshooting

- If npm reports `Cannot find module 'node:path'`, run `source ~/.nvm/nvm.sh && nvm use 20`.
- If Vite is missing, run `npm install --prefix apps/console`.
- If PaddleOCR install is slow, let the first `./scripts/smart-demo.sh` run finish; later runs reuse `.venv`.
- If a worker cannot register, rerun `./scripts/smart-demo.sh` or delete `.worker-cache/worker-secret.txt` and retry.
- If the backend is unavailable, continue in browser fallback or rerun `./scripts/smart-demo.sh`.

Known gaps and prototype boundaries are listed in [Known_LIMITATIONS.md](Known_LIMITATIONS.md).
