# Benchmarks

Benchmarks compare browser fallback and local backend processing with bundled sample packets, calibrated OCR estimates, and measured deterministic validation timing. They run quickly on CPU-only evaluator machines and write JSON artifacts for Admin display.

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
