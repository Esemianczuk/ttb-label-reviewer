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

## Deterministic Validation

Browser and backend worker validation now share golden JSON fixtures and equivalent deterministic rules. The Python module `ttb_validation` mirrors the browser validators for fuzzy brand/class matching, ABV/proof equivalence, mL/liter equivalence, required government-warning segments, and optional producer/country/fanciful fields. See [VALIDATION_ENGINE.md](VALIDATION_ENGINE.md).

## Phase 8 Console Providers

The Refine console now registers the core operational resources up front: applications, versions, assets, reviews, review decisions, corrections, users, workers, jobs, audit events, settings, reports, fixtures, and benchmarks.

`ProcessingModeProvider` selects the active provider set:

- Browser Only uses `browserDataProvider` and the local snapshot live provider. It does not require backend health checks.
- Backend uses `apiDataProvider`, demo bearer auth, and the backend session WebSocket.
- Cluster uses the same API and live providers as Backend while enabling cluster-specific dashboard surfaces.

The console also includes `mockDataProvider` for isolated tests and demos. The generated Orval client in `apps/console/src/api/generated/ttbApi.ts` is produced from the FastAPI OpenAPI schema by `npm --prefix apps/console run generate:api`.

## Phase 9 Applicant Portal

The applicant console now has guarded routes for onboarding, new application intake, application detail, pre-check, corrections, and timeline views. Applicants can create multi-image packets with up to 10 label images, assign each image a role, run deterministic pre-checks, submit ready packets, withdraw submissions, and respond to correction requests.

Browser-only applicant state is stored in the same console snapshot as reviewer/admin state. Applicant actions create audit events, preserve correction messages/responses in application metadata, and reuse the shared workflow statuses (`DRAFT`, `PRECHECK_RUNNING`, `APPLICANT_FIX_REQUIRED`, `READY_TO_SUBMIT`, `SUBMITTED`, `NEEDS_CORRECTION`, `RESUBMITTED`, `APPROVED`, `REJECTED`, and related terminal states).

Route guards enforce the role boundary in the console: applicant role can open applicant routes and correction/timeline resources, but cannot open reviewer or admin workspaces.

## Phase 10 Reviewer Portal

The reviewer console now exposes `/reviewer`, `/reviewer/queue`, `/reviewer/applications/:id`, `/reviewer/batches`, and `/reviewer/reports`. The routed workbench keeps the evidence-first layout: image thumbnails and zoomable viewer, evidence excerpts, OCR text, expected/extracted field table, reviewer override controls, decision panel, correction request drawer, and audit timeline.

Browser-only reviewer decisions are stored in the same console snapshot and audit stream as applicant actions. Field overrides enforce a note when a reviewer flips `PASS` to `FAIL` or `FAIL` to `PASS`; approval is blocked until critical failures are resolved; correction requests require an applicant-facing message. Reviewer actions can accept the automated result, conditionally approve, approve, reject, escalate, request correction, batch-process pending records, and export reports.

The reviewer status model mirrors the TTB-facing flow without letting model output decide compliance: OCR/model output remains evidence, deterministic validators produce field statuses, and human decisions are explicitly audited.

## Phase 11 Admin Operations

The admin console now exposes `/admin`, `/admin/users`, `/admin/roles`, `/admin/workers`, `/admin/jobs`, `/admin/engines`, `/admin/benchmarks`, `/admin/audit`, `/admin/retention`, `/admin/fixtures`, and `/admin/settings`.

Browser-only operations state includes worker hardware/engine metadata, scheduler-style jobs, persisted admin settings, benchmark runs, and retention actions. Backend/Cluster mode uses FastAPI admin routes for live worker/job lists, audit events, server-side settings, worker recalibration/drain/disable/enable, job retry/cancel/priority changes, and retention actions.

Admin actions create audit events for settings updates, worker operations, job operations, benchmark runs, raw-image purges, old-job purges, packet deletion, and full demo-data purge where the active provider supports the operation.

## Phase 12 Live Updates

The backend exposes `/api/ws/sessions/{sessionId}` for session-scoped application, review, job, worker, and audit updates, plus `/api/ws/workers/{workerId}` for worker-focused heartbeat/job diagnostics. The session socket still emits `session_snapshot` messages for the V1 browser dashboard, and now also emits `live_events` with Refine channels such as `resources/applications`, `resources/reviews`, `resources/jobs`, `resources/workers`, and `resources/auditEvents`.

Backend live events derive from database diffs and use stable domain names: `application.created`, `application.updated`, `review.started`, `review.progress`, `review.completed`, `job.queued`, `job.assigned`, `job.progress`, `job.completed`, `job.failed`, `worker.registered`, `worker.heartbeat`, `worker.lost`, and `audit.created`. Browser Only mode diffs the local console snapshot and emits the same channel/event interface without opening a backend connection.

The console enables Refine `liveMode: "auto"` so resource list hooks refetch when a matching live event arrives. The admin operations adapter and backend-mode reviewer queue also subscribe directly so dashboard metrics, worker heartbeat state, job status, audit rows, and queue applications update without a manual refresh.

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
- OCR/model output is treated as evidence; deterministic validators decide statuses.
- Uploaded filenames are sanitized and never used as storage paths.
- MIME type and upload size are validated before object-store writes.
- The object store is content-addressed as `data/assets/{sha256[:2]}/{sha256}.ext`.
