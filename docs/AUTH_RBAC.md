# Demo Auth And RBAC

This phase adds a small demo-auth layer around the backend coordinator. It is intentionally not SSO: local evaluators can switch roles quickly, while the API still enforces ownership and role permissions on direct calls.

## Demo Users

Fresh databases and Alembic-upgraded databases seed:

| Role | Email | Purpose |
| --- | --- | --- |
| applicant | `applicant@example.local` | Create/upload/run precheck/submit own applications and view own review reports. |
| reviewer | `reviewer@example.local` | Review submitted or in-progress work, create reviews, request corrections, override decisions, and export reviewed reports. |
| admin | `admin@example.local` | Manage users, workers, cluster settings, audit, purge/benchmark operations, and view all applications. |

`Base.metadata.create_all` paths call the same seeding helper that the `0005_seed_demo_auth_users` Alembic migration uses, so evaluator SQLite databases and migrated databases converge on the same identities.

## Routes

Login as one of the demo users:

```http
POST /api/auth/demo-login
Content-Type: application/json

{ "role": "reviewer" }
```

Response:

```json
{
  "user": {
    "id": "00000000-0000-0000-0000-000000000002",
    "email": "reviewer@example.local",
    "displayName": "Demo Reviewer",
    "role": "reviewer",
    "status": "active",
    "organizationId": null,
    "createdAt": "2026-06-11T10:00:00Z",
    "updatedAt": "2026-06-11T10:00:00Z"
  },
  "token": "ttb_demo_...",
  "tokenType": "bearer",
  "expiresAt": "2026-06-11T22:00:00Z"
}
```

Use the token on human API routes:

```http
Authorization: Bearer ttb_demo_...
X-Session-Id: browser-local-session
```

Other auth routes:

- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/authz/can`

`/api/authz/can` accepts:

```json
{ "resource": "workers", "action": "manage", "entityId": null, "params": {} }
```

and returns:

```json
{ "can": false, "reason": "Reviewers cannot manage workers." }
```

## Enforcement

Backend checks are deny-by-default in `apps/api/app/core/rbac.py`.

- Applicants are scoped by `Application.owner_user_id`, not only `X-Session-Id`.
- Reviewers can read/review application work but cannot manage workers.
- Admins can perform all coordinator actions.
- Worker secrets remain separate from human bearer tokens. Worker secrets can heartbeat, claim, complete, fail, and recalibrate worker jobs, but cannot call human routes such as `GET /api/applications`.
- Access-control checks and denials are recorded in `audit_events`.

Frontend controls are only a convenience layer. The browser demo and Refine console now acquire demo bearer tokens before calling backend routes, but backend RBAC is the source of truth.

## Verification

Focused checks:

```bash
python -m pytest apps/api/app/tests/test_phase5_auth_rbac.py -q
python -m pytest apps/api/app/tests/test_phase3_api.py apps/worker/tests/test_worker_agent.py -q
npm --prefix browser-demo test -- src/tests/hybrid-mode.test.js
npm --prefix apps/console test -- --run
```

Full local checks:

```bash
./scripts/check-all.sh
```
