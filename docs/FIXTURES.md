# Fixtures

The console demo now loads real public COLA registry records from:

```text
fixtures/public-cola-registry/records/
```

Each record directory contains parsed application metadata, the original raw detail page when available, a printable COLA HTML form, and one or more downloaded label images. The reviewer queue is seeded from these records as if they were already in an application database.

## Loaded Public Records

The checked fixture corpus includes 50 public records. The console demo loads the 41 records whose common reviewer criteria could be supported from the downloaded label image(s) or official COLA form metadata. Records with no defensible alcohol content/net contents evidence are retained in the corpus for provenance but marked `demo_ready: false` and excluded from the demo queue.

Representative loaded examples:

- `app-ttb-19337001000251`: TRANSCONTINENTAL, RUM LINE, two label images.
- `app-ttb-19346001000245`: DEVILS BACKBONE, GIN AND TONIC, one label image.
- `app-ttb-19350001000429`: CHLOE, RUM BARREL AGED COCONUT BALTIC, one label image, starts in correction-needed state for applicant edit testing.

The demo does not invent match-to values. If alcohol content, net contents, responsible party, or imported country of origin could not be verified from the image/form assets, that record is not loaded as a reviewer sample.

## Applicant Import Testing

In `Applicant` -> `New Application`, the first step includes an application-data drop zone. It accepts:

- `metadata.json`
- `expected.json`
- printable COLA HTML
- XML
- plain text exports with label/value fields

Dropping or selecting one of those files fills any matching applicant fields. Required fields that cannot be found are marked `Needs attention` and highlighted in the form. The applicant can still type every field manually.

For a quick manual test:

1. Open `Applicant` -> `New Application`.
2. Select `fixtures/public-cola-registry/records/19337001000251/metadata.json`.
3. Confirm brand, class/type, TTB ID, serial number, and origin are filled.
4. Fill alcohol content and net contents.
5. Upload `label_01.jpg` and `label_02.jpg` from that same record.
6. Submit for review.

## Public Collector

The collector tooling is under:

```text
tools/ttb_collector/
```

Bulk downloads, caches, and generated datasets are ignored by git. The collector is designed for small, polite, curated pulls rather than broad crawling.

## Browser Upload Fixtures

For manual testing, use any PNG/JPG/WebP label image. Browser Only mode keeps uploaded images in the browser session. Backend mode stores decoded and validated images under the local `data/assets` object store.

## Fixture Limits

- These records are public registry examples, not an official TTB corpus.
- Public metadata can be incomplete; missing values are intentionally surfaced for applicant/reviewer handling.
- OCR output is evidence only. Deterministic validation and reviewer decisions remain the authority.
