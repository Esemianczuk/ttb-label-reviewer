# Benchmarks

Benchmarks compare browser fallback and local backend processing with bundled sample packets, calibrated OCR estimates, and measured deterministic validation timing. They run quickly on CPU-only evaluator machines and write JSON artifacts for Admin display.

## Hosted Reviewer Snapshot

Use this when you need an evaluator-facing measurement of the live reviewer automation path:

```bash
node scripts/benchmark-hosted-reviewer.mjs --singleCount 5 --batchCount 5
node scripts/benchmark-parallel-batch.mjs --base https://demo.sherpa-map.com --count 10 --parallelConcurrency 2
```

The scripts use isolated `console-*` sessions, create backend reviews, poll until stored review results are available, and report median, p95, max, backend review POST count, browser fallback count, fields evaluated, evidence crops generated, engine ids, and worker ids. The parallel benchmark also compares field statuses for the same application ids so batch concurrency does not silently change review outcomes.

Latest recorded hosted snapshot, measured against `https://demo.sherpa-map.com`. The single-reviewer row is from the June 15 hosted snapshot; the batch comparison rows are from the June 16 concurrent-batch run.

| Run mode | Applications | Concurrency | Total wall time | Median app completion | p95 app completion | Backend OCR path | Browser fallback |
|---|---:|---:|---:|---:|---:|---|---:|
| Single reviewer automation | 5 | 1 | n/a | 4.15 sec | 4.43 sec | PaddleOCR CUDA worker | 0 |
| Sequential batch baseline | 10 | 1 | 35.37 sec | 3.00 sec | 5.61 sec | PaddleOCR CUDA worker | 0 |
| Concurrent batch review | 10 | 2 | 23.57 sec | 4.95 sec | 6.33 sec | PaddleOCR CUDA worker | 0 |

The concurrent batch run saved 11.80 seconds versus the sequential baseline, a 1.50x hosted wall-clock throughput gain. The implementation uses two bounded worker slots, so the ideal upper bound is 2x; the measured result is lower because real label packets have uneven processing times and the final slot cannot always stay full. The run completed 10 of 10 concurrent-batch applications, used 0 browser fallbacks, and reported 0 field-status mismatches against the sequential baseline.

The JSON artifact for the current concurrent hosted snapshot is `benchmarks/results/latest-hosted-parallel-batch.json`. These numbers are for the tested seeded public COLA examples, not a guarantee for every possible label.

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
