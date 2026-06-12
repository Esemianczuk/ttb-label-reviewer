# Public COLA Registry Fixtures

This directory contains a curated sample of public TTB Public COLA Registry records used by OCR and validation tests.

Public COLA Registry fixtures are included only as a small curated sample for testing. Each record includes source metadata and retrieval timestamp.

The current checked fixture set is built from `tools/ttb_collector/fixtures.real50.yaml` and contains 50 approved public records with downloaded printable COLA HTML and label image assets. The console demo loads only records whose `expected.json` has `demo_ready: true`; records marked `demo_ready: false` stay in the corpus for provenance and collector testing.

Run the collector from the project root:

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem

python tools/ttb_collector/collect_by_ttb_ids.py \
  --input tools/ttb_collector/fixtures.real50.yaml \
  --out fixtures/public-cola-registry \
  --limit 50 \
  --delay-seconds 2.0 \
  --respect-cache
```

Do not commit bulk downloads. Keep curated records under `records/`, and put experiments or large pulls under `bulk/` so they are ignored.
