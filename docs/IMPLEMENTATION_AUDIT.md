# Implementation Audit

Audit date: 2026-06-11

This audit reconciles the take-home prompt, the project phase plan, and the implemented prototype.

## Prompt Coverage

- Fast reviewer workflow: implemented through auto-processing sample queue, one-click Auto Review, reviewer overrides, keyboard shortcuts, and report export.
- Obvious UX for nontechnical agents: implemented with plain status labels, visible next/previous application controls, mode selector, field-level decisions, and expandable image viewer.
- Batch uploads: implemented for multiple images and optional CSV manifest, with one application row per image.
- No required cloud APIs: implemented. Browser-only mode works without backend; backend and distributed workers are optional.
- Government warning matching: implemented with deterministic validator and sample edge cases for missing/partial warning text.
- Explainability: implemented with expected/extracted table, evidence crops, confidence, reason, field history, reviewer notes, engine/worker/timing export metadata.

## Phase Status

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 repo hygiene and baseline | Complete | Root README, root scripts, `.gitignore`, `scripts/check-all.sh`, pytest config. |
| 1 shared schemas and packet model | Complete | `packages/shared/schemas/*`, sample adapter tests. |
| 2 browser worker pool | Complete | Dedicated worker pool, bounded worker count, cancellation, multi-image upload path, worker-pool tests. |
| 3 FastAPI coordinator | Complete for prototype | Application/image/review/job/worker/report routes, migrations, object store, API tests. Postgres URL supported; SQLite remains the default evaluator path. |
| 4 Python worker agent | Complete for prototype | Cross-platform CLI, capability probe, optional engines, null engine smoke path, worker tests. |
| 5 hardware-aware scheduler | Complete for prototype | Scored assignment, dependencies, fairness/cache/network tests, scheduler reason codes. |
| 6 worker discovery and join | Complete | Join-token flow, persistent worker secrets, optional mDNS, LAN warning, lab-host docs. |
| 7 frontend backend/hybrid mode | Complete | Browser/Backend/Cluster mode selector, fallback, backend client, session WebSocket snapshots, cluster dashboard, batch queue, Playwright coverage. |
| 8 console routing and provider consolidation | Complete | Full Refine resource registry, Browser/API/Mock provider registry, mode-selected data/live providers, offline backend fallback, generated Orval API client, unit and Playwright coverage. |
| 9 applicant portal expansion | Complete | Guarded applicant routes, four-step intake wizard, multi-image upload roles/warnings, readiness checks, edit-mode correction resubmission, timeline, export actions, and applicant access tests. |
| 10 reviewer portal full implementation | Complete | Reviewer dashboard, routed queue/workbench/batches/reports, queue filters, image/evidence/OCR panels, note-required overrides, correction drawer, approve/reject/conditional/escalate decisions, audit timeline, keyboard shortcuts, and Playwright coverage. |
| 11 admin operations full implementation | Complete | Routed admin dashboard/users/roles/workers/jobs/engines/benchmarks/audit/retention/fixtures/settings pages, provider-backed Browser/Backend admin data, FastAPI admin operations endpoints, persisted settings, worker/job actions, benchmark runs, retention confirmations, audit CSV surface, unit/API/Playwright coverage. |
| 12 live updates | Complete | Backend session and worker WebSockets emit named resource live events, Refine liveMode auto-refreshes subscribed resources, admin metrics and backend-mode reviewer queue refresh on live events, Browser mode uses a matching local event bus, and API/unit tests cover the event flow. |
| 13 browser mode parity and offline claim | Complete | Packaged Tesseract assets, no default CDN dependency, browser worker pool parity for multi-image/CSV packets, Browser Only console reviewer OCR using validators, and adjustable visible worker count. |
| 14 backend service integration | Complete | FastAPI serves console static builds, backend health display, local backend and worker scripts, and backend/static health smoke coverage. |
| 15 security hardening for assessment | Complete | Explicit CORS defaults, prominent LAN warning, decoded image upload validation, path-safe asset operations, secure-by-default worker joins, stale worker handling, audit denials, retention purge-all, and API security tests. |
| 16 testing matrix | Complete | Browser schema/validator/worker tests, console provider/auth/state/audit/guard tests, API CRUD/workflow/security/admin tests, worker retry/probe/lease tests, Playwright role workflows, Browser Only smoke coverage, and axe WCAG A/AA checks on core console pages. |
| 17 performance/benchmarking | Complete | `bench-local.sh`, `bench-cluster.sh`, fixture OCR plus measured validator benchmark runner, 1/10/50 image browser/backend/cluster runs, JSON saved to `benchmarks/results`, admin API read/run endpoints, and dashboard/table display of latest metrics. |

## Audit Fixes Applied

- Backend duplicate-image reruns: fixed application uploads so the same content-addressed image can be reused by multiple applications without a 409 conflict on fresh databases.
- Added Alembic migration `0003_allow_reused_asset_hashes` to remove the old `assets.sha256` uniqueness constraint.
- JSON report export now preserves review mode, timings, engines, workers, reviewer overrides, notes, and field history.
- Added explicit field history to the application detail table and export payload.
- Added Playwright coverage for CSV manifest batching and reviewer override/export flow.
- Added signed demo bearer auth, seeded applicant/reviewer/admin users, API-enforced RBAC, ownership checks, worker-token isolation, authz audit events, and frontend demo-token handoff.
- Added canonical application workflow transitions with guards, correction/version side effects, audit events, and console progress tracking.
- Replaced worker substring validation with shared deterministic Python validators, shared JS/Python golden fixtures, schema-shaped worker review results, and OCR evidence candidate preservation.
- Added phase 8 console provider consolidation: registered all operational resources, introduced Browser/API/Mock data providers, selected providers through `ProcessingModeProvider`, generated the Orval FastAPI client, and added resource/fallback tests.
- Replaced the console applicant one-image intake with a browser-snapshot applicant workflow: dashboard, four-step new-application wizard, up to 10 image uploads with roles/warnings, readiness checks, submit/withdraw, edit-mode correction resubmission, new-version creation, timeline, and applicant route guards.
- Expanded the reviewer portal to a routed Phase 10 workflow: filterable queue, workbench, batch review, reports, evidence/OCR panels, decision panel, correction drawer, approve blocking on unresolved critical failures, note-required pass/fail overrides, keyboard shortcuts, and audit-visible reviewer actions.
- Expanded the admin portal to a routed Phase 11 operations surface: dashboard metrics, users/roles, worker controls, job queue controls, engine/settings persistence, benchmark runs, filtered audit/export surface, confirmation-gated retention actions, fixture registry, backend admin endpoints, and admin-specific tests.
- Added phase 12 live updates: backend session/worker WebSockets emit named application/review/job/worker/audit events, the console live provider filters Refine resource channels, Browser mode emits the same local event interface, and backend-mode admin/reviewer views refresh from live events.
- Added phase 15 hardening: CORS no longer allows all origins by default, LAN mode is visible in health and the console, uploads are MIME/magic/decode/size/path validated, workers require join tokens and fresh heartbeats, unauthorized worker claims and permission denials are audited, and retention can purge raw assets or all demo data.
- Added phase 16 coverage: shared schema validation in browser packet tests, console auth/provider/audit/state/route-guard tests, API decision/correction/retention tests, worker retry/probe/Tesseract-availability tests, scheduler lease-expiration tests, public/applicant/reviewer/admin E2E flows, and Playwright axe checks for reviewer, applicant, and admin console pages.
- Added phase 17 benchmarking: shared benchmark runner, local and cluster scripts, API read/run routes, generated OpenAPI updates, persisted benchmark JSON, admin table fields for total/p50/p95/image/queue/OCR/validation/failures, and latest benchmark dashboard metrics.

## Verification Commands

```bash
npm run test:js
python -m pytest -q
npm run build
RUN_E2E=1 ./scripts/check-all.sh
./scripts/bench-local.sh
./scripts/bench-cluster.sh
```

Targeted checks added or rerun during this audit:

```bash
./scripts/check-all.sh
python -m pytest apps/api/app/tests/test_phase3_api.py -q
python -m pytest apps/api/app/tests/test_phase5_auth_rbac.py -q
python -m pytest apps/api/app/tests/test_phase6_workflow.py -q
python -m pytest apps/api/app/tests/test_phase7_validators.py -q
python -m pytest apps/api/app/tests/test_phase15_security.py -q
python -m pytest apps/api/app/tests/test_phase16_api_matrix.py -q
python -m pytest apps/api/app/tests/test_phase17_benchmarks.py -q
cd browser-demo && node ./node_modules/vitest/vitest.mjs run src/tests/export-report.test.js src/tests/hybrid-mode.test.js
cd browser-demo && node ./node_modules/@playwright/test/cli.js test tests/e2e/phase7.spec.js --project=chromium-desktop
npm --prefix apps/console run generate:api
npm --prefix apps/console test
npm --prefix apps/console run test:e2e
npm --prefix apps/console run build
```

Optional slow/live Playwright checks:

```bash
TTB_E2E_BACKEND_URL=http://127.0.0.1:8011 \
  node ./node_modules/@playwright/test/cli.js test tests/e2e/phase7.spec.js \
  -g "backend mode completes" --project=chromium-desktop --repeat-each=2

TTB_E2E_BROWSER_OCR=1 npm --prefix browser-demo run test:e2e -- -g "browser-only OCR smoke"
```

## Known Limits

- Fresh evaluator databases include the duplicate-image upload fix. If reusing an older SQLite database, recreate it or run the Alembic migrations before testing repeat uploads.
- The phase 9 applicant workflow is implemented for the console Browser provider. Backend/Cluster modes still need matching backend endpoints for the applicant wizard's draft, edit-mode resubmission, new-version creation, and packet export actions.
- The phase 10 reviewer workflow is implemented for the console Browser provider. Backend/Cluster modes still need matching API endpoints for reviewer field decisions, correction requests, final dispositions, batch review, and report listing.
- Phase 17 quick benchmarks use fixture OCR and calibrated OCR estimates so they run without GPU; validation timings are measured locally. Live OCR benchmarking remains opt-in for slower hardware-specific checks.
- Automated axe checks cover core pages; a manual accessibility pass is still recommended before production use.
- Backend WebSocket live updates are polling-derived database diffs rather than database-triggered push notifications. The emitted event interface is granular and resource-scoped, but the transport still polls once per second.
- The cluster dashboard uses compact throughput counters rather than a full charting library.
