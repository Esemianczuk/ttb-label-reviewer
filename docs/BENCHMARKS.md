# Benchmarks

Benchmarks compare browser fallback and local backend processing with bundled sample packets, calibrated OCR estimates, and measured deterministic validation timing. They run quickly on CPU-only evaluator machines and write JSON artifacts for Admin display.

## Hosted Reviewer Snapshot

Use this when you need an evaluator-facing measurement of the live reviewer automation path:

```bash
node scripts/benchmark-hosted-reviewer.mjs --singleCount 5 --batchCount 5
```

The script uses isolated `console-*` sessions, creates backend reviews, polls until stored review results are available, and reports median, p95, max, backend review POST count, browser fallback count, fields evaluated, evidence crops generated, engine ids, and worker ids.

Latest recorded hosted snapshot, measured June 15, 2026 against `https://demo.sherpa-map.com`:

| Run mode | Applications | Median review time | p95 review time | Max review time | Backend OCR path | Browser fallback |
|---|---:|---:|---:|---:|---|---:|
| Single reviewer automation | 5 | 4.15 sec | 4.43 sec | 4.43 sec | PaddleOCR CUDA worker | 0 |
| Batch review workflow | 5 | 3.57 sec/app | 4.73 sec/app | 4.73 sec/app | PaddleOCR CUDA worker | 0 |

These numbers are for the tested seeded public COLA examples, not a guarantee for every possible label.

## Run

```bash
./scripts/bench-local.sh
```

The script records:

- 1 image
- 10 images
- 50 images
- browser mode
- backend mode

## Results

Results are written to:

```text
benchmarks/results/
benchmarks/results/latest.json
```

Tracked metrics:

- total time
- p50/p95 per image
- images per minute
- OCR ms
- validation ms
- queue ms
- worker chosen
- engine used
- failures

## Admin Page

Open **Admin** -> **Benchmarks**.

Expected outcome:

- Latest JSON loads without refresh.
- New 1/10/50-image runs can be started from the page.
- The dashboard shows the newest completed benchmark.

## Verification

```bash
./scripts/bench-local.sh
python -m pytest apps/api/app/tests/test_phase17_benchmarks.py -q
```
