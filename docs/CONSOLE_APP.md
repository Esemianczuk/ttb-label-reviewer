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

- Applicant: one-image upload, expected TTB field entry, submit-and-auto-review, submission PDF export.
- Reviewer: queue-driven workbench that immediately processes the first sample, next/previous navigation with preserved reviewer decisions, field-level pass/fail/review overrides, notes, detached image viewer with zoom and pan, PDF export.
- Admin: coordinator health, worker dashboard, fixture registry, audit log, access matrix, active-packet PDF export.

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

The Playwright suite runs against desktop Chromium and Pixel 7 viewports. It checks first-sample processing, preserved reviewer overrides across previous/next navigation, detached image zoom controls, one-image applicant upload, and an axe accessibility smoke on the reviewer surface.
It also checks that registered resources render through the Browser provider and that Backend mode presents an offline fallback when the configured coordinator is unavailable.
