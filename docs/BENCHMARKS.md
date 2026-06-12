# Benchmarks

Phase 17 adds quick local benchmarks for evaluator machines without requiring a GPU. Benchmarks use bundled sample packets, local OCR fixtures/calibrated OCR estimates, and measured deterministic validation timing.

They are useful for comparing Browser Only, local backend, and cluster plumbing. They are not a substitute for a full live OCR production benchmark.

## Run Locally

```bash
./scripts/bench-local.sh
```

This records Browser Only and backend-local runs for:

- 1 image
- 10 images
- 50 images

## Run Cluster Mode

```bash
./scripts/bench-cluster.sh
```

The script looks at `TTB_BENCH_BACKEND_URL` or `TTB_WORKER_COORDINATOR`, defaulting to `http://127.0.0.1:8000`. If no eligible workers are visible, cluster runs are saved as `skipped` and the script still exits successfully.

## Results

Results are written to:

```text
benchmarks/results/
```

Each run writes a timestamped JSON file and updates:

```text
benchmarks/results/latest.json
```

Tracked metrics:

- total time
- p50 per image
- p95 per image
- images per minute
- OCR ms
- validation ms
- queue ms
- worker chosen
- engine used
- failures
- skipped reason when applicable

## Admin Page

Open `Admin Portal` -> `Benchmarks`.

What to click:

1. Click `1 image run`, `10 image run`, or `50 image run`.
2. Confirm the result appears in `Benchmark Results`.
3. In Backend or Cluster mode, confirm the admin page can read latest benchmark JSON through the backend provider.

Expected outcome:

- Quick benchmark runs do not require GPU.
- The dashboard can show the latest benchmark.
- Cluster runs are explicit about skipped worker availability.

## Useful Environment Variables

```bash
TTB_BENCHMARK_RESULTS_DIR=/tmp/ttb-benchmarks
TTB_BENCH_BACKEND_URL=http://127.0.0.1:8000
TTB_WORKER_COORDINATOR=http://127.0.0.1:8000
TTB_BENCH_LABEL="local assessment run"
```

## Verification

```bash
./scripts/bench-local.sh
./scripts/bench-cluster.sh
python -m pytest apps/api/app/tests/test_phase17_benchmarks.py -q
```
