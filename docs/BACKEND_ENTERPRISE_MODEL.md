# Backend Enterprise Model

Phase 4 adds the database layer for the enterprise workflow. Phase 5 uses those tables for demo authentication and API-enforced RBAC.

## Migration

Alembic revision:

```text
apps/api/alembic/versions/0004_enterprise_workflow_tables.py
```

The migration is additive. It creates the enterprise workflow tables and adds nullable ownership columns to `applications`:

- `owner_user_id`
- `organization_id`

Fresh evaluator databases still work through `Base.metadata.create_all`. Existing databases should run Alembic to head.

Phase 5 seed migration:

```text
apps/api/alembic/versions/0005_seed_demo_auth_users.py
```

It inserts the demo organization and users used by `/api/auth/demo-login`.

## Tables

`organizations`

- Applicant/reviewer/admin organization records.

`users`

- Demo and future authenticated users.
- Includes email, display name, role, status, optional organization, and timestamps.

`application_versions`

- Immutable application snapshots.
- `POST /api/applications` now creates version `1` automatically.
- Correction/resubmission workflows append versions instead of overwriting prior submissions.

`review_decisions`

- Field-level automatic status, reviewer override status, effective status, note, reviewer, and timestamps.

`correction_requests`

- Reviewer/admin requests back to applicants with status, message, field keys, and resolution timestamp.
- `request_correction` creates open requests; `resubmit` resolves them.

`audit_events`

- Append-only human/system action records with actor, entity, before/after JSON, metadata, and timestamp.

`settings`

- Keyed JSON settings for retention, engines, benchmark policy, and operational toggles.

## Compatibility

Human routes now require `Authorization: Bearer <demo token>`. `X-Session-Id` is still accepted for compatibility and worker/session routing, but applicant access is enforced through `owner_user_id`.

`ApplicationRead` also returns:

- `ownerUserId`
- `organizationId`
- `versionCount`
- `currentVersionNumber`

These fields are nullable or derived, but new application creates set owner and organization from the authenticated user.

Application status changes are canonical and audited through `POST /api/applications/{id}/transition`; see [APPLICATION_WORKFLOW.md](APPLICATION_WORKFLOW.md).

## Verification

Focused Phase 4 checks:

```bash
python -m pytest apps/api/app/tests/test_phase4_enterprise_models.py -q
python -m pytest apps/api/app/tests/test_phase5_auth_rbac.py -q
python -m pytest apps/api/app/tests/test_phase6_workflow.py -q
```

Full backend and repo checks:

```bash
python -m pytest apps/api/app/tests -q
RUN_E2E=1 ./scripts/check-all.sh
```
