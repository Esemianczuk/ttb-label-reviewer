# TTB Label Reviewer

TTB Label Reviewer is a local-first alcohol label review assessment project for comparing TTB/COLA-style application data against label-image evidence. It is not an official TTB or Treasury system and it does not make legal determinations.

The project now has one recommended run path plus one fallback:

- **Backend primary**: FastAPI coordinator plus one local PaddleOCR worker. A promoted LayoutLMv3 field extractor is used only when it passes the runtime gate; otherwise the backend uses conservative weak alignment.
- **Browser fallback**: private local fallback with packaged browser OCR assets and deterministic validators when the backend is not reachable.

No cloud AI service is required.

## Fastest Path

For evaluator machines with Docker, use the Docker launcher:

```bash
./scripts/docker-demo.sh
```

It starts the backend-served console at:

```text
http://127.0.0.1:8000/
```

Linux auto-detects CUDA-capable Docker GPU access and otherwise uses the CPU PaddleOCR worker. macOS uses `scripts/docker-mac-metal.sh`, which runs the API in Docker and the worker natively so a promoted LayoutLMv3 extractor can use Apple Metal/MPS.

Detailed Docker paths are in [Docker Quick Start](docs/DOCKER.md).

## Local Python Path

From the repository root:

```bash
./scripts/smart-demo.sh
```

The script creates/uses `.venv`, installs missing backend and PaddleOCR/LayoutLMv3 runtime dependencies, builds the console, starts FastAPI, issues a worker token, starts one local PaddleOCR worker, and opens the backend-served console.

Default URL:

```text
http://127.0.0.1:8000/
```

What to click:

1. Continue as **Reviewer**.
2. Open a submitted packet.
3. Use **Run automation** or **Next Application** with auto-run enabled.
4. Review expected values against extracted label evidence.
5. Toggle field or final decisions between pass/fail, add notes if useful, and export the PDF report.

If you only want to exercise the offline frontend fallback:

```bash
npm install
npm run console:dev
```

Open the printed Vite URL, normally `http://127.0.0.1:5174/`.

## Backend Worker

Manual backend startup remains available:

```bash
./scripts/dev-local-backend.sh
```

In another terminal:

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

Backend reviews use PaddleOCR full-image OCR. If `models/field-extractor/layoutlmv3-cola/current` contains a promoted model that passes `model_gate.py`, workers use LayoutLMv3 token classification for field evidence. Otherwise they use conservative weak alignment. Deterministic validators remain the authority for pass/fail decisions.

## Documentation

- [Evaluator guide](docs/EVALUATOR_GUIDE.md): exact demo paths and expected outcomes.
- [Architecture](docs/ARCHITECTURE.md): browser, API, worker, OCR, and validation boundaries.
- [Role model](docs/ROLE_MODEL.md): applicant, reviewer, admin, and worker identity.
- [Security model](docs/SECURITY_MODEL.md): CORS, uploads, RBAC, worker secrets, audit, and retention.
- [Applicant workflow](docs/APPLICANT_WORKFLOW.md): create, upload, submit, edit, archive.
- [Reviewer workbench](docs/REVIEWER_WORKBENCH.md): queue, evidence table, image viewer, notes, reports.
- [Admin operations](docs/ADMIN_OPERATIONS.md): workers, jobs, settings, audit, benchmarks, retention.
- [Backend worker mode](docs/DISTRIBUTED_MODE.md): local worker lifecycle and token flow.
- [Docker quick start](docs/DOCKER.md): Linux CPU, Linux CUDA, and macOS Metal launch paths.
- [Benchmarks](docs/BENCHMARKS.md): browser/backend benchmark JSON and admin display.
- [Fixtures](docs/FIXTURES.md): public COLA registry records and upload testing.
- [Known limitations](docs/Known_LIMITATIONS.md): explicit assessment boundaries.

## Verification

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm run test:js
python -m pytest -q
npm run build
```

Playwright checks are opt-in:

```bash
RUN_E2E=1 ./scripts/check-all.sh
```

Benchmarks:

```bash
./scripts/bench-local.sh
```

Results are written to `benchmarks/results/latest.json` and can be viewed from Admin -> Benchmarks.

## Repository Layout

```text
apps/api/                     FastAPI coordinator
apps/console/                 Refine + Ant Design role-based console
apps/worker/                  Local PaddleOCR worker
browser-demo/                 Browser-only compatibility app and OCR assets
docs/                         Evaluator and architecture docs
fixtures/public-cola-registry Public COLA fixture records
packages/shared/              Shared schemas and golden fixtures
scripts/                      Setup, demo, benchmark, and check scripts
tools/                        COLA collection and OCR training helpers
ttb_validation/               Deterministic validation package
```

## Troubleshooting

- If npm fails with `Cannot find module 'node:path'`, run `source ~/.nvm/nvm.sh && nvm use 20`.
- If Vite is missing, run `npm install --prefix apps/console` or `npm install` from the repo root.
- If the backend is unavailable, the console falls back to browser-local OCR automatically. Run `./scripts/smart-demo.sh` to return to the primary backend path.
- If the worker cannot register, delete `.worker-cache/worker-secret.txt` and rerun `./scripts/smart-demo.sh` to mint a fresh token.
- If PaddleOCR is not installed, `./scripts/smart-demo.sh` installs the runtime extras automatically; this can take a few minutes on first run.
