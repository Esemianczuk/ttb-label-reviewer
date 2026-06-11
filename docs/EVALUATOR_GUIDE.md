# Evaluator Guide

## Browser Demo

```bash
cd browser-demo
npm install
npm run dev
```

The browser app remains fully usable without the backend.

The top-right Processing Mode control has three modes:

- **Browser Only** uses the browser worker pool and never requires a backend.
- **Local Backend** uploads the current one-image application packet to FastAPI and waits for a local worker/coordinator result.
- **Cluster** uses the same backend review API while showing worker cards, throughput, and scheduler assignment reasons.

If the configured backend URL is offline, Auto Review falls back to Browser Only.

The queue table accepts the bundled sample packet queue or uploaded images with an optional CSV manifest. CSV rows are matched to image files by `filename`, `image`, `file`, `labelId`, or row order. Filters cover fail, needs review, warning, pass, missing warning, ABV mismatch, and low OCR confidence.

Keyboard shortcuts:

- `N` next application
- `P` previous application
- `A` mark visible review fields pass
- `R` mark visible review fields needs review
- `F` mark visible review fields fail
- `E` expand the current image
- `/` focus queue search

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
- `GET /api/workers`
- `GET /api/workers/events`
- `GET /api/cluster/status`
- `WS /api/ws/sessions/{session_id}`

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

Set up dependencies once from the repository root:

```bash
./scripts/setup-dev.sh
```

For Python-only setup, use the same editable requirements file:

```bash
python -m pip install -r requirements-dev.txt
```

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

Run only browser unit and e2e tests:

```bash
cd browser-demo
npm test
npm run test:e2e
```

Run the optional live browser/backend smoke after starting a coordinator and at least one worker for session `phase7-ui`:

```bash
cd browser-demo
TTB_E2E_BACKEND_URL=http://127.0.0.1:8000 npm run test:e2e -- -g "backend mode completes"
```
