# Backend Enterprise Model

Phase 4 adds the database layer for the enterprise workflow while preserving the current session-scoped API behavior.

## Migration

Alembic revision:

```text
apps/api/alembic/versions/0004_enterprise_workflow_tables.py
```

The migration is additive. It creates the enterprise workflow tables and adds nullable ownership columns to `applications`:

- `owner_user_id`
- `organization_id`

Fresh evaluator databases still work through `Base.metadata.create_all`. Existing databases should run Alembic to head.

## Tables

`organizations`

- Applicant/reviewer/admin organization records.

`users`

- Demo and future authenticated users.
- Includes email, display name, role, status, optional organization, and timestamps.

`application_versions`

- Immutable application snapshots.
- `POST /api/applications` now creates version `1` automatically.
- Future correction/resubmission workflows should append versions instead of overwriting prior submissions.

`review_decisions`

- Field-level automatic status, reviewer override status, effective status, note, reviewer, and timestamps.

`correction_requests`

- Reviewer/admin requests back to applicants with status, message, field keys, and resolution timestamp.

`audit_events`

- Append-only human/system action records with actor, entity, before/after JSON, metadata, and timestamp.

`settings`

- Keyed JSON settings for retention, engines, benchmark policy, and operational toggles.

## Compatibility

Existing routes remain session-scoped and continue to pass the same request contracts. `ApplicationRead` now also returns:

- `ownerUserId`
- `organizationId`
- `versionCount`
- `currentVersionNumber`

These fields are nullable or derived and do not require auth yet.

## Verification

Focused Phase 4 checks:

```bash
python -m pytest apps/api/app/tests/test_phase4_enterprise_models.py -q
```

Full backend and repo checks:

```bash
python -m pytest apps/api/app/tests -q
RUN_E2E=1 ./scripts/check-all.sh
```
