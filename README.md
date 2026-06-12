# TTB Label Reviewer

TTB Label Reviewer is a local-first alcohol label review prototype for comparing TTB/COLA application data against label-image evidence. The current V1 browser demo lives in `browser-demo/` and remains runnable while the project grows toward optional backend and distributed worker modes.

This is an assessment prototype, not an official TTB or Treasury system, and it does not make final legal determinations.

## Evaluator Fast Path

Requires Node 20 or newer. If you use nvm, run `source ~/.nvm/nvm.sh && nvm use 20` first; `./scripts/setup-dev.sh` and `./scripts/check-all.sh` do this automatically when nvm is available.

```bash
npm install
npm run console:dev
```

Open the printed Vite URL, normally `http://127.0.0.1:5174/`, click **Continue as Reviewer**, open the queue, and use **Run automated review** or **Process** when you want OCR/validation to run. Browser Only mode requires no backend and no cloud AI.

For exact click steps, screenshots, backend/worker setup, and expected outcomes, start with [docs/EVALUATOR_GUIDE.md](docs/EVALUATOR_GUIDE.md).

## Guided Launcher

For a menu-driven setup/run path that works in a terminal, SSH session, or headless server, use the dependency-free Python launcher:

```bash
python scripts/ttb_launcher.py
```

The launcher can install dependencies, start Browser Only dev mode, start the FastAPI backend, issue a worker join token, run a local worker, print remote worker commands for cluster mode, open the right URL, tail logs, and stop only the processes it started. It also discovers nvm Node 20+ automatically when launched from a thin desktop/server environment.

Quick non-interactive status check:

```bash
python scripts/ttb_launcher.py --status
```

## Capability Matrix

| Capability | Complete | Browser-only | Backend | Demo/mock | Planned |
|---|---:|---:|---:|---:|---:|
| Browser-only applicant workflow | Yes | Yes | No | No | No |
| Browser-only reviewer workbench | Yes | Yes | No | No | No |
| Browser-only admin demo operations | Yes | Yes | No | Yes, clearly labeled | No |
| Backend persistence | Yes | No | Yes | No | No |
| Backend review jobs | Partial | No | Yes | No | Worker completion depends on running worker |
| Cluster workers | Partial | No | Yes | No | Multi-host polish remains optional |
| Field-level backend reviewer decisions | Partial | No | Partial | No | Broader route parity |
| Correction resubmissions | Partial | Browser workflow complete | Backend transition support | No | Rich backend UI parity |
| Public COLA collector | Yes | N/A | N/A | No | No |
| Real OCR uploads | Yes | Yes | Worker-dependent | No | Slower live OCR tests are opt-in |
| Fixture OCR samples | Yes | Yes, samples only | Benchmark/demo fixtures | Yes, labeled | No |

## Documentation Map

- [Evaluator guide](docs/EVALUATOR_GUIDE.md): fastest path, Browser Only, Backend, Cluster, expected outcomes.
- [Architecture](docs/ARCHITECTURE.md): browser, coordinator, workers, live updates, static serving.
- [Role model](docs/ROLE_MODEL.md): applicant, reviewer, admin, worker identity, permissions.
- [Security model](docs/SECURITY_MODEL.md): CORS, uploads, RBAC, worker secrets, audit, retention.
- [Applicant workflow](docs/APPLICANT_WORKFLOW.md): create/upload/submit/correction resubmission flow.
- [Reviewer workbench](docs/REVIEWER_WORKBENCH.md): queue, image viewer, overrides, notes, PDF export.
- [Admin operations](docs/ADMIN_OPERATIONS.md): workers, jobs, settings, audit, benchmarks, retention.
- [Distributed mode](docs/DISTRIBUTED_MODE.md): coordinator, join token, workers, optional lab hosts.
- [Benchmarks](docs/BENCHMARKS.md): local and cluster benchmark scripts and metrics.
- [Fixtures](docs/FIXTURES.md): bundled public COLA registry records, applicant data import, upload testing.
- [Government-style UI](docs/UI_STYLE_GUIDE.md): USWDS-inspired Ant Design theme, status colors, alerts, and plain language.
- [UI accessibility checklist](docs/UI_ACCESSIBILITY_CHECKLIST.md): manual keyboard, contrast, form, table, and evidence checks.
- [Known limitations](docs/Known_LIMITATIONS.md): explicit prototype boundaries.

## Processing Modes

### Browser-Only Mode

The browser app runs without a backend. It loads bundled real public COLA registry records, performs browser OCR for uploads and multi-image CSV batches, applies deterministic validators, lets reviewers override field decisions with notes, and exports reports. Production browser and console builds load the Tesseract worker, WASM core, and English traineddata from `browser-demo/public/tesseract`; there is no runtime CDN dependency by default.

```bash
cd browser-demo
source ~/.nvm/nvm.sh && nvm use 20
npm install
npm run package:tesseract
npm run dev
```

Current browser mode includes a bounded dedicated Web Worker pool for uploaded image batches, and the worker count is visible and adjustable. The CDN fallback is development-only and must be enabled explicitly with `VITE_ALLOW_TESSERACT_CDN_FALLBACK=1`.

### Local Backend Mode

The optional FastAPI coordinator in `apps/api` can serve the built frontend, persist applications and reviews, store uploaded assets locally, assign review jobs to local worker agents, and back the console admin operations for live workers, jobs, audit events, settings, and retention actions. Browser-only mode remains available when the backend is not running.

```bash
./scripts/dev-local-backend.sh
```

By default this uses a local SQLite fallback at `data/api.sqlite3` so evaluators can run it without Docker. For a Postgres coordinator, set `TTB_API_DATABASE_URL`, for example:

```bash
export TTB_API_DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/ttb_label_reviewer"
./scripts/dev-local-backend.sh
```

The backend serves `apps/console/dist` from `/` when a production console build exists. `TTB_API_STATIC_DIR` can point to another static build, and defaults to `apps/console/dist`.

In the browser, choose **Local Backend** from Processing Mode. The app probes the configured URL, uses demo auth, creates backend applications, uploads image assets, starts backend reviews from the queue, listens to live session updates, and displays backend worker/job/audit resources. If the backend is unavailable, the console offers an explicit **Use Browser Only** action; backend/cluster actions do not silently fake a browser review.

### Distributed Cluster Mode

The Python worker agent in `apps/worker` lets trusted local machines register with the coordinator from Linux, macOS, or Windows. It probes host capabilities, calibrates available OCR engines, heartbeats, claims leased jobs, downloads scoped assets, and completes OCR/evidence/validation tasks. Browser clients never process another browser client's uploaded images.

```bash
./scripts/dev-worker.sh --session-id local-dev-session
```

Worker registration requires a short-lived join token by default. Issue one from `POST /api/cluster/join-token`, or from the Admin cluster view, then pass it as `TTB_WORKER_JOIN_TOKEN` or `--join-token` for the first registration. The worker stores a persistent secret after registration, so later heartbeats, claims, completes, and failures use `Authorization: Bearer <worker secret>`.
The worker starts with `null,tesseract` engines by default: deterministic null OCR is always present, while Tesseract is used when the local binary and Python bindings are installed.
Cluster mode uses the same backend review API while the browser uses demo admin auth to show worker cards, throughput counters, and recent scheduler assignment reasons from `/api/workers/events`.

Backend security defaults are assessment-oriented: CORS is limited to localhost development origins unless `TTB_API_CORS_ORIGINS` is set to an explicit comma-separated list, uploads are size/MIME/magic-byte/decode checked before storage, and LAN binding prints and displays a prominent warning.

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

`browser-demo` remains the compatibility app and should keep passing its existing tests and build. The optional backend is in `apps/api`, the Refine console is in `apps/console`, and the worker agent is in `apps/worker`.

## Refine Console

`apps/console` adds an enterprise-style reviewer console without removing the V1 browser demo. It includes applicant, reviewer, and admin portals; role-based access rules; demo bearer auth for backend calls; browser/backend/cluster mode controls; a Refine resource registry; browser/API/mock data providers; browser and backend live providers; reviewer auto-review backed by the same local Tesseract OCR/validators as the browser demo; a full applicant workflow with multi-image intake, submission, edit-mode correction resubmission, new-version creation, withdrawal, and timeline routes; a routed reviewer dashboard, queue, workbench, batch review, reports, correction requests, approvals, rejections, escalations, keyboard shortcuts, and audit-visible decisions; routed admin operations for users, roles, workers, jobs, engines, benchmarks, audit, retention, fixtures, and settings; detached image zoom/pan; generated Orval API client; PDF exports; Vitest unit tests; and Playwright desktop/mobile accessibility coverage.

### Government-style UI

The console uses a USWDS-inspired visual language implemented with Ant Design tokens. It intentionally avoids official seals, official banners, and any claim of affiliation. The persistent prototype notice makes this clear on every page.

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

For the Phase 16 acceptance matrix, the standalone commands are:

```bash
npm run test:js
python -m pytest -q
npm run build
```

Playwright end-to-end checks are opt-in:

```bash
RUN_E2E=1 ./scripts/check-all.sh
```

The console Playwright suite includes `@axe-core/playwright` WCAG A/AA checks for the reviewer, applicant, and admin core pages. Automated axe checks are a baseline, not a replacement for manual accessibility review.

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

The slower packaged browser OCR smoke is also skipped by default:

```bash
TTB_E2E_BROWSER_OCR=1 npm --prefix browser-demo run test:e2e -- -g "browser-only OCR smoke"
```

## Benchmarks

Phase 17 benchmarks use bundled sample packets and OCR fixtures so they run quickly on CPU-only evaluator machines while still measuring the shared deterministic validators. Results are written to `benchmarks/results`, with `latest.json` updated on each run:

```bash
./scripts/bench-local.sh
./scripts/bench-cluster.sh
```

`bench-local.sh` records 1, 10, and 50 image runs for Browser Only and local backend modes. `bench-cluster.sh` records the same counts for Cluster mode when eligible workers are visible at `TTB_BENCH_BACKEND_URL` or `TTB_WORKER_COORDINATOR`; otherwise it saves skipped cluster runs without failing. Backend/Cluster console mode reads the same JSON through `/api/admin/benchmarks/results`, and the Admin dashboard shows the latest completed benchmark throughput.

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
Applicant workflow is documented in [docs/APPLICANT_WORKFLOW.md](docs/APPLICANT_WORKFLOW.md).
Reviewer workflow is documented in [docs/REVIEWER_WORKBENCH.md](docs/REVIEWER_WORKBENCH.md).
Admin operations are documented in [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md).
Shared deterministic validation and golden fixtures are documented in [docs/VALIDATION_ENGINE.md](docs/VALIDATION_ENGINE.md).
The Phase 5 hardware-aware scheduler is documented in [docs/SCHEDULER.md](docs/SCHEDULER.md).
Phase 6 worker join/discovery is documented in [docs/DISTRIBUTED_MODE.md](docs/DISTRIBUTED_MODE.md).
Phase 7 frontend backend/cluster mode is documented in [docs/EVALUATOR_GUIDE.md](docs/EVALUATOR_GUIDE.md).
The current implementation audit is documented in [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md).
Benchmarks are documented in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).
Fixtures are documented in [docs/FIXTURES.md](docs/FIXTURES.md).
Known limitations are documented in [docs/Known_LIMITATIONS.md](docs/Known_LIMITATIONS.md).
