# Evaluator Guide

## Browser Demo

```bash
cd browser-demo
npm install
npm run dev
```

The browser app remains fully usable without the backend.

## Local Backend Coordinator

From the repository root:

```bash
./scripts/dev-local-backend.sh
```

This starts FastAPI on `http://127.0.0.1:8000` with a SQLite fallback at `data/api.sqlite3`. To use Postgres instead:

```bash
export TTB_API_DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/ttb_label_reviewer"
./scripts/dev-local-backend.sh
```

If `browser-demo/dist/index.html` exists, the backend also serves that static build at `/`.

## Smoke Test

```bash
curl http://127.0.0.1:8000/api/health
```

Core API routes:

- `POST /api/applications`
- `POST /api/applications/{id}/images`
- `POST /api/applications/{id}/review`
- `POST /api/workers/register`
- `POST /api/workers/{worker_id}/claim`
- `POST /api/workers/{worker_id}/complete`
- `GET /api/reviews/{review_id}`
- `GET /api/reports/{review_id}.json`

Use the same `X-Session-Id` header for application, asset, job, review, and report calls.

## Local Worker Agent

Start the backend first, then in another terminal run:

```bash
JOIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:8000/api/cluster/join-token \
  -H 'Content-Type: application/json' \
  -d '{"ttlSeconds":900}' | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
./scripts/dev-worker.sh --session-id local-dev-session --join-token "$JOIN_TOKEN"
```

For a finite smoke run:

```bash
./scripts/dev-worker.sh --session-id local-dev-session --join-token "$JOIN_TOKEN" --once
```

The equivalent module command is:

```bash
python -m ttb_worker \
  --coordinator http://127.0.0.1:8000 \
  --name auto \
  --concurrency auto \
  --engines auto \
  --data-dir ./.worker-cache
```

Use `--probe` to print capability and engine availability JSON without registering.

Use `POST /api/cluster/join-token` whenever you want a fresh manual worker join command. mDNS discovery is optional and skipped when `zeroconf` is not installed.

## Scheduler Smoke

The worker claim response includes a scored assignment decision with `score_ms`, `reason_codes`, and per-component estimates. The scheduler model is documented in [SCHEDULER.md](SCHEDULER.md).

## Verification

Run all checks:

```bash
./scripts/check-all.sh
```

Run only backend API tests:

```bash
python -m pytest apps/api/app/tests -q
```

Run only scheduler tests:

```bash
python -m pytest apps/api/app/tests/test_phase5_scheduler.py -q
```

Run only worker tests:

```bash
python -m pytest apps/worker/tests -q
```
