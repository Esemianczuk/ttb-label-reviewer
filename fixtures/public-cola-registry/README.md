# Public COLA Registry Fixtures

This directory contains a curated sample of public TTB Public COLA Registry records used by OCR and validation tests.

Public COLA Registry fixtures are included only as a small curated sample for testing. All bundled records are derived from publicly available approved COLA records. Pending, private, rejected, or in-process applications are not used.

The current checked fixture set contains 75 approved public record directories with source metadata, retrieval timestamps, normalized expected fields, manifest rows, downloaded printable COLA HTML when available, and public label image assets. The console demo loads 66 records whose `expected.json` has `demo_ready: true`; 9 records marked `demo_ready: false` stay in the corpus for provenance and collector testing.

The collector tooling is intentionally small and curated rather than a bulk scraper. Candidate records are discovered or selected from known public TTB identifiers, cached locally, and manually promoted into `records/` only when the downloaded image/form evidence supports the expected reviewer fields.

Run the collector from the project root for local experiments. The command below writes into the ignored `bulk/` area; promote records into `records/` only after reviewing their source material and expected fields.

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem

python tools/ttb_collector/collect_by_ttb_ids.py \
  --input tools/ttb_collector/fixtures.real50.yaml \
  --out fixtures/public-cola-registry/bulk/manual-records \
  --limit 50 \
  --delay-seconds 2.0 \
  --respect-cache
```

Do not commit bulk downloads. Keep curated records under `records/`, and put experiments or large pulls under `bulk/` so they are ignored.
