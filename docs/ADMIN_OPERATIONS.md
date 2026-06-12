# Admin Operations

The admin portal is the operations surface for workers, jobs, settings, benchmarks, audit, fixtures, and retention. Browser Only mode shows demo operations data. Backend and Cluster modes use FastAPI admin routes when the coordinator is available.

## Entry

What to click:

1. Open the console.
2. Click `Continue as Admin`, or switch `Signed in as` to `Admin`.
3. Confirm the dashboard shows metrics for applications, submitted packets, active workers, queue depth, OCR timing, failed jobs, and storage.
4. Use the route buttons for `Users`, `Roles`, `Workers`, `Jobs`, `Engines`, `Benchmarks`, `Audit`, `Retention`, `Fixtures`, and `Settings`.

## Pages

| Page | What it shows | Backend/Cluster behavior |
| --- | --- | --- |
| Users | Demo identities and roles. | Reads seeded users through provider data where available. |
| Roles | Console permission matrix. | Documents local role boundaries. |
| Workers | Hostname, status, CPU/RAM/GPU, active jobs, engines, heartbeat, recalibrate/drain/disable/enable. | Uses `/api/workers` and worker admin actions. |
| Jobs | Job id, application, type, status, priority, worker, engine, attempts, duration, scheduler reason, retry/cancel/raise. | Uses `/api/jobs` and admin job routes. |
| Engines | Preferred OCR engine, browser/backend/GPU/distributed toggles, concurrency. | Persists settings through admin settings endpoints. |
| Benchmarks | 1, 10, and 50 image benchmark buttons and latest JSON results. | Reads and runs benchmark JSON via backend admin benchmark routes. |
| Audit | Filter by actor, role, event, entity, application; export CSV. | Reads server audit events. |
| Retention | Raw image purge, old job purge, delete packet, purge all demo data. | Requires admin role and writes audit events. |
| Fixtures | Sample application registry and paths. | Shows bundled or provider-backed fixture/application rows. |
| Settings | Validator threshold, warning strictness, retention defaults. | Persists server-side settings where supported. |

## Live Updates

Backend and Cluster modes subscribe to:

- `resources/applications`
- `resources/reviews`
- `resources/jobs`
- `resources/workers`
- `resources/auditEvents`

Expected outcome:

- Worker heartbeat changes update the dashboard.
- Job status changes appear without refresh.
- Audit events arrive after sensitive actions.

## Join Tokens

Workers require a join token for first registration by default. Issue one with an admin token:

```bash
ADMIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/auth/demo-login \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

curl -sS -X POST http://127.0.0.1:8000/api/cluster/join-token \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlSeconds":900}' | python -m json.tool
```

## Retention Safety

Retention buttons are confirmation-gated. They are intended for demo data cleanup, not production record retention.

## Verification

```bash
python -m pytest apps/api/app/tests/test_phase16_api_matrix.py -q
npm --prefix apps/console test -- --run
RUN_E2E=1 ./scripts/check-all.sh
```
