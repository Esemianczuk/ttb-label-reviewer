# Admin Operations

The admin portal monitors the local demo system without exposing technical controls to applicant or reviewer pages.

## Pages

| Page | What It Shows |
|---|---|
| Dashboard | Backend health, queue depth, active workers, throughput, failures, and latest benchmark. |
| Users / Roles | Demo identities and RBAC matrix. |
| Workers | Local worker heartbeat, engine status, concurrency, and capability posture. |
| Jobs | OCR, evidence, validation, and report job state. |
| OCR Engines | PaddleOCR status and the active field-alignment policy. |
| Benchmarks | Latest browser/backend benchmark JSON and one-click local runs. |
| Audit Log | Auth, permission failures, review transitions, overrides, purges, and retention actions. |
| Data Retention | Read-only retention posture for raw assets, reports, and demo data. |
| Settings | Read-only OCR policy, concurrency, upload, and security settings. |

## Worker Token

Workers register through:

```bash
POST /api/workers/join-token
```

The token is short-lived. After first registration the worker stores a persistent worker secret and uses that for heartbeat, claim, complete, and fail calls.
