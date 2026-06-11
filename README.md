# TTB Label Reviewer

TTB Label Reviewer is a local-first alcohol label review prototype for comparing TTB/COLA application data against label-image evidence. The current V1 browser demo lives in `browser-demo/` and remains runnable while the project grows toward optional backend and distributed worker modes.

This is an assessment prototype, not an official TTB or Treasury system, and it does not make final legal determinations.

## Processing Modes

### Browser-Only Mode

The browser app runs without a backend. It loads sample application packets, performs browser OCR for uploads, applies deterministic validators, lets reviewers override field decisions with notes, and exports reports.

```bash
cd browser-demo
source ~/.nvm/nvm.sh && nvm use 20
npm install
npm run dev
```

Current browser mode includes a bounded dedicated Web Worker pool for uploaded image batches. The sample queue remains fixture-backed for deterministic evaluator demos. Phase 7 adds the operations dashboard: Processing Mode, backend URL detection, severity-first application table, filters, reviewer shortcuts, and the expandable image viewer.

### Local Backend Mode

The optional FastAPI coordinator in `apps/api` can serve the built frontend, persist applications and reviews, store uploaded assets locally, and assign review jobs to local worker agents. Browser-only mode remains available when the backend is not running.

```bash
./scripts/dev-local-backend.sh
```

By default this uses a local SQLite fallback at `data/api.sqlite3` so evaluators can run it without Docker. For a Postgres coordinator, set `TTB_API_DATABASE_URL`, for example:

```bash
export TTB_API_DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/ttb_label_reviewer"
./scripts/dev-local-backend.sh
```

The backend serves `browser-demo/dist` from `/` when a production browser build exists.

In the browser, choose **Local Backend** from Processing Mode. The app probes the configured URL, logs in as the demo applicant, uploads the one-image application packet, starts a backend review, listens to the session WebSocket, and polls the review until the worker result is available. If the backend is unavailable, the same Auto Review button falls back to Browser Only.

### Distributed Cluster Mode

The Python worker agent in `apps/worker` lets trusted local machines register with the coordinator from Linux, macOS, or Windows. It probes host capabilities, calibrates available OCR engines, heartbeats, claims leased jobs, downloads scoped assets, and completes OCR/evidence/validation tasks. Browser clients never process another browser client's uploaded images.

```bash
JOIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/cluster/join-token \
  -H 'Content-Type: application/json' \
  -d '{"ttlSeconds":900}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
./scripts/dev-worker.sh --session-id local-dev-session --join-token "$JOIN_TOKEN"
```

The worker always includes a deterministic null OCR engine for demos and tests. If local OCR tooling such as Tesseract is installed, the worker advertises and can use it without making those packages mandatory.
Manual join tokens are short-lived; the worker receives and stores a persistent secret after registration.
Cluster mode uses the same backend review API while the browser uses demo admin auth to show worker cards, throughput counters, and recent scheduler assignment reasons from `/api/workers/events`.

## Current Repository Layout

```text
apps/api/                    Optional FastAPI coordinator
apps/console/                Refine + Ant Design role-based operations console
apps/worker/                 Optional Python worker agent
browser-demo/                 V1 Vite browser app
docs/                         Architecture and evaluator notes
fixtures/public-cola-registry Curated public COLA fixture manifest
packages/shared/schemas       Canonical packet/review/job schemas
tools/ttb_collector           Public COLA fixture collector tooling
tests/                        Python collector and fixture tests
scripts/check-all.sh          Local verification entrypoint
```

The requested future `apps/browser` and `apps/worker` structure will be introduced incrementally. Until then, `browser-demo` is the compatibility app and should keep passing its existing tests and build.

## Refine Console

`apps/console` adds an enterprise-style reviewer console without removing the V1 browser demo. It includes applicant, reviewer, and admin portals; role-based access rules; demo bearer auth for backend calls; browser/backend/cluster mode controls; a Refine resource registry; browser/API/mock data providers; one-image upload intake; immediate sample queue processing; preserved reviewer overrides; detached image zoom/pan; audit tables; worker telemetry; generated Orval API client; PDF exports; Vitest unit tests; and Playwright desktop/mobile accessibility coverage.

```bash
npm install --prefix apps/console
npm --prefix apps/console run dev
```

Regenerate the console API client from the local FastAPI OpenAPI schema with:

```bash
npm --prefix apps/console run generate:api
```

See [docs/CONSOLE_APP.md](docs/CONSOLE_APP.md) for portal behavior and verification commands.

## Quick Checks

Set up the local developer environment from the repository root:

```bash
./scripts/setup-dev.sh
```

The Python portion is defined in `requirements-dev.txt` and installs the API, worker, and collector packages in editable mode:

```bash
python -m pip install -r requirements-dev.txt
```

Equivalent explicit editable command:

```bash
python -m pip install -e "apps/api[test]" -e "apps/worker[test]" -e ".[test]"
```

The default Python test environment includes `pytest`, `httpx`, `alembic`, `sqlalchemy`, `fastapi`, `uvicorn`, and `pydantic`. It does not install optional OCR/CUDA packages; worker tests use the deterministic `null` engine path.

Run the deterministic unit/build checks:

```bash
./scripts/check-all.sh
```

The script runs:

- `npm test` in `browser-demo`
- `npm test` in `apps/console`
- `npm run build` in `browser-demo`
- `npm run build` in `apps/console`
- `python scripts/check-python-env.py`
- `python -m pytest -q` for root Python, backend API, and worker tests

Playwright end-to-end checks are opt-in:

```bash
RUN_E2E=1 ./scripts/check-all.sh
```

You can also run the browser checks directly:

```bash
npm --prefix browser-demo test
npm --prefix browser-demo run test:e2e
npm --prefix browser-demo run build
```

The optional live backend Playwright smoke is skipped by default. To exercise the browser against a running coordinator and worker, set:

```bash
TTB_E2E_BACKEND_URL=http://127.0.0.1:8000 npm --prefix browser-demo run test:e2e -- -g "backend mode completes"
```

Run only the backend tests:

```bash
python -m pytest apps/api/app/tests -q
```

Run only the worker tests:

```bash
python -m pytest apps/worker/tests -q
```

## Validation Approach

OCR/model output is treated as evidence only. Final field status comes from deterministic validators that compare expected application values against extracted evidence for brand, class/type, alcohol content, net contents, government warning text, and optional responsible-party or origin fields.

Every review result should remain auditable: expected value, extracted evidence, status, reason, confidence, engine, worker, timing, and reviewer override fields all have explicit schema support.

## Privacy And Local-First Boundaries

- No cloud AI or external OCR API is required.
- Browser-only mode keeps user images in that browser session.
- Optional backend mode will store uploaded assets in a local content-addressed object store.
- Distributed backend workers process backend queue jobs scoped to a session/application.
- Browser local workers are not backend workers and must not receive other users' images.

## Public COLA Fixtures

`fixtures/public-cola-registry/manifest.json` currently contains curated public fixture metadata. Bulk downloads, caches, and generated datasets are intentionally ignored by git.

## Migration Note

The V1 app remains in `browser-demo/`. New shared contracts start in `packages/shared/schemas/`, the optional backend starts in `apps/api`, and the worker agent starts in `apps/worker`. Browser adapters can consume those contracts before the larger `apps/browser` migration happens. This keeps the demo submit-ready while making the architecture path explicit.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DISTRIBUTED_MODE.md](docs/DISTRIBUTED_MODE.md), and [docs/EVALUATOR_GUIDE.md](docs/EVALUATOR_GUIDE.md) for the coordinator and worker shape.
The Phase 4 enterprise backend tables are documented in [docs/BACKEND_ENTERPRISE_MODEL.md](docs/BACKEND_ENTERPRISE_MODEL.md).
Demo auth and RBAC enforcement are documented in [docs/AUTH_RBAC.md](docs/AUTH_RBAC.md).
Application workflow transitions are documented in [docs/APPLICATION_WORKFLOW.md](docs/APPLICATION_WORKFLOW.md).
Shared deterministic validation and golden fixtures are documented in [docs/VALIDATION_ENGINE.md](docs/VALIDATION_ENGINE.md).
The Phase 5 hardware-aware scheduler is documented in [docs/SCHEDULER.md](docs/SCHEDULER.md).
Phase 6 worker join/discovery is documented in [docs/DISTRIBUTED_MODE.md](docs/DISTRIBUTED_MODE.md).
Phase 7 frontend backend/cluster mode is documented in [docs/EVALUATOR_GUIDE.md](docs/EVALUATOR_GUIDE.md).
The current implementation audit is documented in [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md).
