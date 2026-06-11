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

- Browser: uses the persisted in-browser snapshot and bundled one-image sample packets.
- Backend: points at the optional FastAPI coordinator URL and keeps the same session-header shape as the V1 browser demo.
- Cluster: presents the distributed-worker review path and worker telemetry surfaces while still falling back to browser-local demo state when no coordinator is running.

`Reset Demo` clears reviewer decisions, notes, generated uploads, and active queue position back to the first bundled sample.

## Provider Architecture

- `providers/auth`: role-switched demo identity provider.
- `providers/access`: explicit applicant/reviewer/admin permission matrix.
- `providers/data`: browser-local Refine data provider plus FastAPI-backed provider helpers.
- `providers/audit`: append-only local audit provider for reviewer changes.
- `providers/live`: snapshot subscription bridge for Refine live updates.
- `providers/notification`: Ant Design notification adapter for Refine.

OpenAPI client generation is configured with Orval:

```bash
TTB_OPENAPI_URL=http://127.0.0.1:8000/openapi.json npm run generate:api
```

## Verification

```bash
npm --prefix apps/console test
npm --prefix apps/console run test:e2e
npm --prefix apps/console run build
```

The Playwright suite runs against desktop Chromium and Pixel 7 viewports. It checks first-sample processing, preserved reviewer overrides across previous/next navigation, detached image zoom controls, one-image applicant upload, and an axe accessibility smoke on the reviewer surface.
