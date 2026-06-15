# Admin Operations

The admin portal monitors the local demo system without exposing technical controls to applicant or reviewer pages.

## Pages

| Page | What It Shows |
|---|---|
| Dashboard | Backend health, queue depth, active workers, throughput, failures, and latest benchmark. |
| Users / Roles | Demo identities and RBAC matrix. |
| Workers | Local worker heartbeat, engine status, concurrency, drain/disable/recalibrate controls. |
| Jobs | OCR, evidence, validation, and report jobs with retry/cancel/priority controls. |
| OCR Engines | PaddleOCR status, LayoutLMv3 model status, and baseline weak-alignment warnings. |
| Benchmarks | Latest browser/backend benchmark JSON and one-click local runs. |
| Audit Log | Auth, permission failures, review transitions, overrides, purges, and retention actions. |
| Data Retention | Purge raw assets or all demo data. |
| Settings | Backend URL, OCR policy, concurrency, upload/security settings. |

## Worker Token

Workers register through:

```bash
POST /api/workers/join-token
```

The token is short-lived. After first registration the worker stores a persistent worker secret and uses that for heartbeat, claim, complete, and fail calls.
