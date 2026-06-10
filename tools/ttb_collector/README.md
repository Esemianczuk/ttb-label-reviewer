# TTB Public COLA Registry Fixture Collector

This tool builds a small, legally clean fixture set from public TTB Public COLA Registry records for the local label-review prototype. It fetches known public detail pages, saves raw HTML, extracts field/value metadata, downloads available public label or printable assets, normalizes expected fields, and writes dataset manifests for tests.

“This collector is intended to build a small test fixture set from public TTB COLA Registry records. It is not intended for bulk scraping. Use low request rates, cache results, and prefer manual capture for small curated samples.”

“Approved COLA records and label images are public through the TTB Public COLA Registry. Pending applications are not public and must not be accessed.”

## Public-Only Scope

- Use public registry pages and public downloadable/printable resources only.
- Do not use authenticated systems, private endpoints, or controls bypasses.
- Keep submitted fixtures small and curated. A practical take-home sample is 25-50 records, not a mirror of the registry.

## Install

```bash
python3 -m pip install -r tools/ttb_collector/requirements.txt
```

The collector targets Python 3.11+, but the implementation avoids newer syntax where possible for local development compatibility.

## Known TTB IDs

Create or edit a seed file:

```yaml
records:
  - ttb_id: "XXXXXXXXXXXXXX"
    expected_group: "distilled_spirits"
    notes: "Known bourbon fixture"
```

Then collect slowly:

```bash
python tools/ttb_collector/collect_by_ttb_ids.py \
  --input tools/ttb_collector/fixtures.example.yaml \
  --out fixtures/public-cola-registry \
  --limit 25 \
  --delay-seconds 2.0 \
  --respect-cache
```

The collector validates that IDs are exactly 14 alphanumeric characters. Existing records are skipped unless `--refresh` is supplied.

## Endpoint Configuration

Data.gov documents the public detail query pattern:

```text
?action=publicDisplaySearchBasic&ttbid=<TTB_ID>
```

The default base endpoint is defined in `tools/ttb_collector/config/constants.py`:

```python
PUBLIC_DETAIL_BASE_URL = "https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do"
```

If TTB changes routing, verify the detail URL manually through the Public COLA Registry, update that constant or pass `--base-url`, and rerun with `--refresh` only for the records you want rebuilt.

## Manual Capture Fallback

Government sites may use sessions, JavaScript, redirects, or link shapes that static requests cannot reliably parse. For a small curated dataset, manual capture is acceptable and often preferable:

```bash
python tools/ttb_collector/manual_capture_helper.py \
  --ttb-id XXXXXXXXXXXXXX \
  --detail-url "https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do?action=publicDisplaySearchBasic&ttbid=XXXXXXXXXXXXXX" \
  --html-file ~/Downloads/cola_detail.html \
  --assets ~/Downloads/front.jpg ~/Downloads/back.jpg \
  --out fixtures/public-cola-registry
```

This copies the supplied public HTML/assets into `fixtures/public-cola-registry/records/<ttb_id>/`, runs the same parser and normalizer, and rebuilds the manifest.

## Optional Discovery

Discovery is a helper, not a crawler. It makes a best-effort static request and caches the search page under `tools/ttb_collector/cache/search/`:

```bash
python tools/ttb_collector/discover_ttb_ids.py \
  --commodity distilled_spirits \
  --brand vodka \
  --status approved \
  --max-results 20 \
  --out tools/ttb_collector/candidate_ids_distilled_spirits.json
```

If the public search form requires JavaScript or session state, try `--use-browser` after installing Playwright browsers. Browser fallback is never used by default. If discovery cannot parse results, provide known IDs or use `manual_capture_helper.py`.

## Caching and Rate Limiting

- `collect_by_ttb_ids.py` sleeps between records with `--delay-seconds` and defaults to 2 seconds.
- `--respect-cache` reuses saved `metadata.raw.html` when a record is incomplete.
- Existing completed records are skipped unless `--refresh` is passed.
- Search discovery caches HTML under `tools/ttb_collector/cache/search/`.
- Asset downloads have a conservative size guard and never overwrite files unless refreshed.

## Outputs

Each record directory is shaped like:

```text
fixtures/public-cola-registry/records/<ttb_id>/
  metadata.raw.html
  metadata.json
  expected.json
  source.txt
  assets/
  notes.md
```

Dataset-level files:

```text
fixtures/public-cola-registry/manifest.json
fixtures/public-cola-registry/manifest.csv
```

`source.txt` records exact public URLs used and retrieval timestamps. `metadata.json` preserves raw field/value rows in `raw_fields` so parser gaps remain reviewable.

## Attribution

When using these fixtures in reports or demos, cite them as records retrieved from the TTB Public COLA Registry, include the retrieval timestamp from each `source.txt`, and keep the source URL with the fixture metadata.

## Tests

Unit tests use fake local HTML and do not make live TTB requests:

```bash
pytest
```

Useful local smoke test with fake HTML:

```bash
python tools/ttb_collector/collect_by_ttb_ids.py \
  --ttb-id ABC12345678901 \
  --local-html tools/ttb_collector/tests/fixtures/cola_detail_fake_distilled_spirits.html \
  --out /tmp/public-cola-registry-smoke \
  --limit 1 \
  --delay-seconds 0 \
  --skip-assets
```
