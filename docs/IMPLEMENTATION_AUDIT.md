# Implementation Audit

Audit date: 2026-06-10

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

## Audit Fixes Applied

- Backend duplicate-image reruns: fixed application uploads so the same content-addressed image can be reused by multiple applications without a 409 conflict on fresh databases.
- Added Alembic migration `0003_allow_reused_asset_hashes` to remove the old `assets.sha256` uniqueness constraint.
- JSON report export now preserves review mode, timings, engines, workers, reviewer overrides, notes, and field history.
- Added explicit field history to the application detail table and export payload.
- Added Playwright coverage for CSV manifest batching and reviewer override/export flow.
- Added signed demo bearer auth, seeded applicant/reviewer/admin users, API-enforced RBAC, ownership checks, worker-token isolation, authz audit events, and frontend demo-token handoff.
- Added canonical application workflow transitions with guards, correction/version side effects, audit events, and console progress tracking.
- Replaced worker substring validation with shared deterministic Python validators, shared JS/Python golden fixtures, schema-shaped worker review results, and OCR evidence candidate preservation.

## Verification Commands

```bash
./scripts/check-all.sh
```

Targeted checks added or rerun during this audit:

```bash
python -m pytest apps/api/app/tests/test_phase3_api.py -q
python -m pytest apps/api/app/tests/test_phase5_auth_rbac.py -q
python -m pytest apps/api/app/tests/test_phase6_workflow.py -q
python -m pytest apps/api/app/tests/test_phase7_validators.py -q
cd browser-demo && node ./node_modules/vitest/vitest.mjs run src/tests/export-report.test.js src/tests/hybrid-mode.test.js
cd browser-demo && node ./node_modules/@playwright/test/cli.js test tests/e2e/phase7.spec.js --project=chromium-desktop
```

Live repeatability check:

```bash
TTB_E2E_BACKEND_URL=http://127.0.0.1:8011 \
  node ./node_modules/@playwright/test/cli.js test tests/e2e/phase7.spec.js \
  -g "backend mode completes" --project=chromium-desktop --repeat-each=2
```

## Known Limits

- Fresh evaluator databases include the duplicate-image upload fix. If reusing an older SQLite database, recreate it or run the Alembic migrations before testing repeat uploads.
- Phase 8+ items are not fully implemented: persisted agent decision audit events, retention/purge UI, benchmarking scripts, and final Phase 14/15 documentation polish remain future work.
- Backend WebSocket currently streams session snapshots rather than per-event push notifications. It is sufficient for dashboard progress but can be made more granular later.
- The cluster dashboard uses compact throughput counters rather than a full charting library.
