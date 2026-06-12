# Security Model

This project is hardened for assessment and local evaluation. It is not a production identity, compliance, or records-retention system.

## Local-First Defaults

- Browser Only mode does not send uploaded images to a backend.
- Backend mode stores uploaded assets under the local `data/assets` object store.
- No cloud AI or external OCR API is required.
- Production browser and console builds use packaged Tesseract assets by default.

## CORS And LAN Mode

The FastAPI coordinator no longer allows all origins by default. Local development origins on `localhost` and `127.0.0.1` are allowed. For LAN or hosted evaluation, set explicit origins:

```bash
TTB_API_CORS_ORIGINS=http://127.0.0.1:5174,http://<coordinator-lan-ip>:8000
```

When `TTB_API_HOST=0.0.0.0` or `TTB_API_HOST=::`, the backend prints a LAN warning, `/api/health` returns the warning, and the console displays it prominently.

## Upload Validation

Backend uploads are validated before storage:

- Maximum size uses `TTB_API_MAX_UPLOAD_BYTES`, defaulting to 25 MB.
- Declared MIME must be `image/png`, `image/jpeg`, or `image/webp`.
- Filename extension is normalized and checked.
- Magic bytes are checked for PNG, JPEG, and WebP.
- Pillow decodes and verifies the image type and dimensions.
- Filenames are sanitized and are never used as storage paths.
- Stored objects use content-addressed paths: `data/assets/{sha256[:2]}/{sha256}.ext`.
- Reads and purge operations refuse paths outside the configured asset root.

## Session, Ownership, And Roles

Backend human routes require signed demo bearer tokens. Applicants are scoped to applications they own. Reviewers can review applications but cannot manage workers or retention. Admins can manage coordinator operations.

Sensitive denials write `authz.denied` audit events where the API has an authenticated actor. Sensitive transitions and overrides also create audit events.

## Worker Security

Worker registration requires a join token by default:

```bash
TTB_REQUIRE_WORKER_JOIN_TOKEN=1
```

After first registration, a worker stores a persistent secret in `.worker-cache/worker-secret.txt` unless another path is provided. Heartbeat, claim, complete, fail, and recalibrate calls require that worker secret or a still-valid join token.

Additional worker guards:

- Stale workers are marked lost after the configured timeout.
- Stale workers must heartbeat before claiming jobs.
- Unauthenticated claims return 401.
- Permission failures are audited.
- Worker secrets cannot call human auth/admin/application endpoints.

## Audit

Audit events cover:

- Demo login/logout/authz checks.
- Permission failures for sensitive actions.
- Application transitions.
- Reviewer overrides, final decisions, and correction requests.
- Worker registration, heartbeat loss, claim failures, and admin worker actions.
- Job retry/cancel/priority actions.
- Benchmark runs.
- Retention purges and packet deletion.

## Retention

Admin retention actions are confirmation-gated in the console:

- Purge raw images.
- Purge completed/failed jobs.
- Delete one application packet.
- Purge all demo data.

Backend retention endpoints require the admin role and write audit events.

## Security Tests

Representative tests live in `apps/api/app/tests/test_phase15_security.py` and cover:

- Path traversal prevention.
- MIME spoofing and invalid image rejection.
- Unauthorized access.
- Applicant cross-read prevention.
- Worker unauthorized claim rejection.
- Stale worker claim rejection.
- Admin-only purge-all behavior.

Run:

```bash
python -m pytest apps/api/app/tests/test_phase15_security.py -q
```
