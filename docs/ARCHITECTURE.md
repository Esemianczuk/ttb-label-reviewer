# Architecture

TTB Label Reviewer is intentionally local-first. The browser demo remains the compatibility surface, and `apps/api` is an optional coordinator that can persist applications, store uploaded images, and assign review work to local or distributed workers.

## Modes

- Browser-only: `browser-demo` runs by itself with local samples, browser OCR, deterministic validation, reviewer edits, and report export.
- Local backend: FastAPI serves API routes and the built frontend when `browser-demo/dist` exists. Uploaded images are stored under `data/assets`.
- Distributed coordinator: backend workers register, heartbeat, claim scored leased jobs, and complete OCR/evidence/validation work.

## Phase 3 Backend

`apps/api` contains a FastAPI application with SQLAlchemy 2.x models and Alembic migrations.

- `applications`: session-scoped application packets and expected TTB fields.
- `assets`: content-addressed local image storage metadata.
- `reviews`: review runs and final deterministic results.
- `jobs`: queued OCR, evidence crop, and validation tasks.
- `workers`: registered worker capabilities, capacity, and heartbeat state.
- `worker_events`: append-only worker/job audit trail.

The model layer uses PostgreSQL `jsonb` when the database URL points to Postgres and SQLite-compatible JSON for local tests.

## Job Lifecycle

1. A browser or API client creates an application packet.
2. The client uploads one or more label images.
3. `POST /api/applications/{id}/review` creates OCR and evidence-crop jobs for each asset, plus one validation job.
4. A worker registers capabilities and claims a queued job with a short lease.
5. Heartbeats extend active leases.
6. Expired leases return to the queue.
7. Completion is idempotent. OCR/evidence jobs move the review to processing, while validation/review-result jobs finalize the review.

The coordinator uses `SELECT ... FOR UPDATE SKIP LOCKED` for databases that support row locking. SQLite remains the no-Docker fallback for tests and local evaluator runs.

## Phase 5 Scheduler

The coordinator now scores every eligible queued job against every eligible backend worker when a worker calls `POST /api/workers/{worker_id}/claim`.

The scored assignment uses:

- worker active job count and max concurrency
- worker capability flags and supported job types
- engine availability and warm-engine state
- calibration metrics per engine
- asset size and worker asset cache state
- network latency and download throughput
- worker cache disk write throughput
- recent failure and expired-lease events
- session pressure for weighted fairness

Jobs with `depends_on` metadata are not scored until predecessor stages finish, so OCR runs before evidence extraction, and validation runs after both OCR and evidence extraction.

The assignment response includes `worker_id`, `engine_id`, `score_ms`, `reason_codes`, and the score components documented in `packages/shared/schemas/assignment-decision.schema.json`.

## Phase 6 Worker Join

Workers now join the coordinator through a short-lived manual token:

1. Coordinator issues a token from `POST /api/cluster/join-token`.
2. The response includes a copyable `python -m ttb_worker --coordinator ... --join-token ...` command.
3. Worker registration requires a valid token for first join.
4. Coordinator returns a persistent worker secret once.
5. Worker stores that secret in `.worker-cache/worker-secret.txt`.
6. Subsequent heartbeat, claim, complete, fail, and recalibrate calls require `Authorization: Bearer <worker secret>` or the still-valid join token.

mDNS discovery is optional through `zeroconf`. The coordinator does not bind beyond localhost unless `TTB_API_HOST=0.0.0.0` or another explicit host is supplied, and the scripts print a LAN warning in that mode.

## Demo Auth And RBAC

The backend coordinator now protects human API routes with signed demo bearer tokens. `POST /api/auth/demo-login` issues role-scoped tokens for applicant, reviewer, and admin demo users; `GET /api/auth/me`, `POST /api/auth/logout`, and `POST /api/authz/can` provide the small auth surface needed by the browser demo and console.

RBAC is enforced in the API, not only in UI controls. Applicants are scoped to applications they own, reviewers cannot manage workers, admins can manage all coordinator resources, and worker secrets cannot call human endpoints. See [AUTH_RBAC.md](AUTH_RBAC.md) for the route contract and verification checks.

## Application Workflow

Applications now move through canonical workflow states with `POST /api/applications/{id}/transition`. The transition service enforces legal state changes, actor permissions, applicant ownership, image requirements, correction notes, resubmission versioning, approval override rules, and audit events. See [APPLICATION_WORKFLOW.md](APPLICATION_WORKFLOW.md) for the transition table.

## Phase 4 Worker Agent

`apps/worker` contains a Python worker package runnable with:

```bash
python -m ttb_worker --coordinator http://127.0.0.1:8000 --name auto --concurrency auto --engines auto --data-dir ./.worker-cache
```

From the repository root, `./scripts/dev-worker.sh` sets the package path and runs that same module.

The worker lifecycle is:

1. Probe hostname, OS, architecture, Python version, CPU count, memory, disk throughput, coordinator latency, local accelerators, OCR dependencies, ONNX providers, model cache size, and supported image formats.
2. Build the engine set. The deterministic null engine is always available; Tesseract/EasyOCR/PaddleOCR/ONNX adapters are optional.
3. Calibrate available engines and save `.worker-cache/calibration.json`.
4. Register with the coordinator, including boolean scheduler capabilities for `ocr`, `evidence_crop`, and `validation`.
5. Heartbeat every five seconds and extend leased jobs.
6. Claim session-scoped work, download needed assets through coordinator routes, process the task, and complete or fail with structured results.

The current worker intentionally avoids bundling model weights or requiring native OCR packages. Tesseract is used only when `pytesseract`, Pillow, and the local `tesseract` binary are available. EasyOCR and PaddleOCR report availability but are warmed only when explicitly selected or when `TTB_WORKER_ENABLE_HEAVY_OCR=1` is set, because those libraries may need local model files. ONNX reports unavailable unless a local model path is configured.

## Security Boundaries

- Browser-only mode never sends images to another browser.
- Backend human routes require signed demo bearer tokens; `X-Session-Id` is retained as a session/work queue hint.
- Applicant assets and reports are scoped by application ownership.
- Application state changes must go through the transition service.
- Uploaded filenames are sanitized and never used as storage paths.
- MIME type and upload size are validated before object-store writes.
- The object store is content-addressed as `data/assets/{sha256[:2]}/{sha256}.ext`.
