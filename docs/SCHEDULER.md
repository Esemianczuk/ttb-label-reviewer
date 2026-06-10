# Hardware-Aware Scheduler

Phase 5 upgrades `apps/api/app/core/scheduler.py` from FIFO leasing to scored assignment decisions.

## Claim Model

Workers still use the existing pull API:

```http
POST /api/workers/{worker_id}/claim
```

On every claim, the coordinator evaluates queued eligible jobs against all online eligible backend workers. The requesting worker receives a job only when it is the best candidate for that job. This preserves the simple worker API while avoiding accidental assignment to a slower or network-constrained worker.

Browser local workers are never backend workers and are not part of this scheduler.

## Eligibility

A worker is eligible only when:

- it is `online`
- its heartbeat is fresh
- active jobs are below `max_concurrency`
- required job capabilities are present
- its registered `supportedJobTypes` includes the job type when that list is supplied

Jobs with `depends_on` payload metadata are not scored until predecessor review-stage jobs complete. OCR runs first, evidence-crop jobs wait for OCR, and validation waits for OCR plus evidence.

## Score

For each candidate worker and engine, the scheduler computes:

```text
estimated_total_ms =
  queue_penalty_ms
  + network_transfer_ms
  + disk_penalty_ms
  + model_warmup_penalty_ms
  + ocr_estimate_ms
  + reliability_penalty_ms
  + session_fairness_penalty_ms
```

The assignment response follows `packages/shared/schemas/assignment-decision.schema.json`:

```json
{
  "worker_id": "worker-1",
  "engine_id": "null",
  "score_ms": 351.2,
  "reason_codes": ["queued_job", "available_worker", "asset_cached", "low_queue_depth"],
  "estimated_components": {
    "queue_penalty_ms": 100,
    "network_transfer_ms": 0,
    "disk_penalty_ms": 0,
    "model_warmup_penalty_ms": 0,
    "ocr_estimate_ms": 250,
    "reliability_penalty_ms": 0,
    "session_fairness_penalty_ms": 1.2
  }
}
```

## Signals

- Network cost uses worker-reported latency and download throughput.
- Cached assets have zero transfer cost.
- Disk penalty uses worker cache write throughput for uncached assets.
- Warm engines avoid model warmup cost.
- OCR estimate uses worker calibration metrics, then image pixels, then asset-size fallback.
- Reliability penalty increases after `job_failed` or `lease_expired` worker events.
- Session fairness penalizes sessions already consuming more active/queued work.

The Phase 4 worker reports `warmEngines`, `assetCache.assetIds`, network metrics, disk metrics, capabilities, and calibration during registration and heartbeat.

## Tests

`apps/api/app/tests/test_phase5_scheduler.py` covers:

- cached large asset beats a faster remote worker when network transfer is slow
- queue depth and reliability penalties
- session fairness penalty
- stale and incapable worker rejection
- OCR/evidence/validation dependency ordering

