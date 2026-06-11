# Refine Console

`apps/console` is an additive Refine + Ant Design operations console for the TTB Label Reviewer prototype. It does not replace `browser-demo`; the browser-only OCR demo remains runnable and linked from the console sidebar.

## Run

```bash
cd apps/console
source ~/.nvm/nvm.sh && nvm use 20
npm install
npm run dev
```

Open `http://127.0.0.1:5174/`.

## Portals

- Applicant: dashboard, onboarding, five-step new-application wizard, multi-image upload with per-image roles, readiness/pre-check page, correction response, timeline, withdrawal, resubmission, and packet PDF export.
- Reviewer: dashboard, filterable queue, routed application workbench, batch review table, report list, field-level pass/fail/review overrides with note rules, correction request drawer, approve/reject/conditional approval/escalation actions, audit timeline, detached image viewer with zoom and pan, and PDF export.
- Admin: operations dashboard, user/role views, worker controls, job queue operations, engine/settings persistence, benchmark runs, audit filters/export, retention actions, fixture registry, and coordinator health.

## Applicant Routes

- `/applicant`
- `/applicant/onboarding`
- `/applicant/applications/new`
- `/applicant/applications/:id`
- `/applicant/applications/:id/precheck`
- `/applicant/applications/:id/corrections`
- `/applicant/applications/:id/timeline`

The wizard accepts up to 10 JPG/JPEG/PNG/WebP images in the demo. Each image gets a role: front, back, neck, carton, other, or COLA sheet. The UI flags file-size, dimension, aspect-ratio, and crop/context warnings without blocking submission unless required application data or images are missing.

The applicant correction flow starts from `NEEDS_CORRECTION`, captures a response, marks the packet `RESUBMITTED`, and preserves the correction message, requested fields, and response on the application timeline.

## Reviewer Routes

- `/reviewer`
- `/reviewer/queue`
- `/reviewer/applications/:id`
- `/reviewer/batches`
- `/reviewer/reports`

The reviewer workbench immediately processes a routed application if it has no review yet. Queue filters cover new submissions, critical failures, government-warning issues, ABV/net-content mismatches, low confidence, corrections, resubmissions, assignment state, and high-confidence passes.

Reviewer decisions are stored in the browser snapshot with audit events. Pass-to-fail and fail-to-pass field overrides require a note; approval is blocked while critical failures remain unresolved; correction requests require a message.

## Admin Routes

- `/admin`
- `/admin/users`
- `/admin/roles`
- `/admin/workers`
- `/admin/jobs`
- `/admin/engines`
- `/admin/benchmarks`
- `/admin/audit`
- `/admin/retention`
- `/admin/fixtures`
- `/admin/settings`

The admin dashboard shows applications today, submitted, needs-review, approved, rejected, active workers, queue depth, images/minute, p50/p95 OCR time, failed jobs, and estimated storage. Worker actions support recalibrate, drain, disable, and enable. Job actions support retry, cancel, and raise priority. Settings persist in the browser snapshot across Browser, Backend, and Cluster console modes.

Retention actions are confirmation-gated and can purge raw images, purge old jobs, delete an application packet, or purge all demo data. The audit page filters real audit events by actor, role, event, entity, and application, and exports CSV.

## Processing Modes

- Browser Only: uses the persisted in-browser snapshot, bundled one-image sample packets, and local live-event bus. It does not require or probe a backend coordinator.
- Backend: uses the FastAPI data provider, demo bearer auth, the configured backend URL, and the backend session WebSocket.
- Cluster: uses the same FastAPI data provider as Backend mode, keeps backend live updates active, and enables the cluster dashboard surfaces for worker telemetry.

If Backend or Cluster mode cannot reach the coordinator, the console shows a warning with a `Use Browser Only` action. Browser-only review, uploads, queue navigation, and PDF export remain available offline.

`Reset Demo` clears reviewer decisions, notes, generated uploads, and active queue position back to the first bundled sample.

## Provider Architecture

- `resources`: registers `applications`, `applicationVersions`, `labelAssets`, `reviews`, `reviewDecisions`, `correctionRequests`, `users`, `workers`, `jobs`, `auditEvents`, `settings`, `reports`, `fixtures`, and `benchmarks` for Refine.
- `providers/processing`: mode context that selects the active data provider, live provider, backend health state, and fallback action.
- `providers/auth`: role-switched demo identity provider.
- `providers/access`: explicit applicant/reviewer/admin permission matrix.
- `providers/data`: `browserDataProvider`, `apiDataProvider`, `mockDataProvider`, and the provider registry that maps Browser Only to browser-local data and Backend/Cluster to FastAPI data.
- `providers/audit`: append-only local audit provider for reviewer changes.
- `providers/live`: browser snapshot live provider plus backend WebSocket live provider.
- `providers/notification`: Ant Design notification adapter for Refine.

OpenAPI client generation is configured with Orval. The default command first exports the local FastAPI OpenAPI schema to `openapi.generated.json`, then generates `src/api/generated/ttbApi.ts`:

```bash
npm --prefix apps/console run generate:api
```

To generate from a running coordinator instead, set:

```bash
cd apps/console
TTB_OPENAPI_URL=http://127.0.0.1:8000/openapi.json npm run generate:api
```

## Verification

```bash
npm --prefix apps/console test
npm --prefix apps/console run test:e2e
npm --prefix apps/console run build
```

The Playwright suite runs against desktop Chromium and Pixel 7 viewports. It checks first-sample processing, preserved reviewer overrides across previous/next navigation, detached image zoom controls, reviewer critical-failure approval, reviewer correction requests, reviewer keyboard shortcuts, admin worker/job/benchmark/settings actions, admin audit/retention actions, multi-image applicant submission, applicant correction/resubmission, applicant route access boundaries, and an axe accessibility smoke on the reviewer surface.
It also checks that registered resources render through the Browser provider and that Backend mode presents an offline fallback when the configured coordinator is unavailable.
