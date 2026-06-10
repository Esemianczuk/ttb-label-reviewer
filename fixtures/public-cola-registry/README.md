# Public COLA Registry Fixtures

This directory is reserved for a small curated sample of public TTB Public COLA Registry records used by OCR and validation tests.

Public COLA Registry fixtures are included only as a small curated sample for testing. Each record includes source metadata and retrieval timestamp.

Run the collector from the project root:

```bash
python tools/ttb_collector/collect_by_ttb_ids.py \
  --input tools/ttb_collector/fixtures.example.yaml \
  --out fixtures/public-cola-registry \
  --limit 25 \
  --delay-seconds 2.0 \
  --respect-cache
```

Do not commit bulk downloads. Keep curated records under `records/`, and put experiments or large pulls under `bulk/` so they are ignored.
