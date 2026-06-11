# Pull Real Public COLA Test Fixtures

This runbook describes exactly how to pull the small real TTB Public COLA Registry fixture set used by this project.

Scope: small curated testing data only. Do not bulk scrape. Use public registry pages, low request rates, cache results, and approved public records.

## 1. Install Dependencies

From the project root:

```bash
python3 -m pip install --user -r tools/ttb_collector/requirements.txt
```

## 2. Prepare TLS CA Bundle

During the initial pull, `www.ttbonline.gov` did not send the full intermediate certificate chain, so `requests` and `curl` failed normal certificate verification. Do not disable TLS verification. Add the public intermediate certificate to a temporary ignored CA bundle:

```bash
mkdir -p tools/ttb_collector/cache/certs

curl --max-time 20 -fsSL \
  http://crt.sectigo.com/EntrustOVTLSIssuingRSACA2.crt \
  -o tools/ttb_collector/cache/certs/EntrustOVTLSIssuingRSACA2.crt

openssl x509 -inform DER \
  -in tools/ttb_collector/cache/certs/EntrustOVTLSIssuingRSACA2.crt \
  -out tools/ttb_collector/cache/certs/EntrustOVTLSIssuingRSACA2.pem

python3 - <<'PY'
import certifi
from pathlib import Path

out = Path("tools/ttb_collector/cache/certs/ttb-ca-bundle.pem")
out.write_bytes(
    Path(certifi.where()).read_bytes()
    + b"\n"
    + Path("tools/ttb_collector/cache/certs/EntrustOVTLSIssuingRSACA2.pem").read_bytes()
)
print(out)
PY
```

Use that bundle for TTB requests:

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem
```

Optional connectivity check:

```bash
curl --cacert "$REQUESTS_CA_BUNDLE" -I --max-time 20 \
  "https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do?action=search"
```

## 3. Use the Approved Fixture Seed

The curated real-test seed is:

```text
tools/ttb_collector/fixtures.testing.yaml
```

Current approved public records:

```text
20010001000803  CUTWATER                         distilled_spirits
20016001000598  MONACO                           distilled_spirits
20014001001179  WHAT THE PHOQUE                  wine
20010001000197  SUNSTONE WINERY                  wine
19344001000769  BEER DRINKING IS NOT A CRIME     malt_beverage
20041001000838  NATURAL LIGHT                    malt_beverage
```

Each record is pulled from the public detail endpoint:

```text
https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid=<TTB_ID>
```

The collector also fetches the public printable page when present:

```text
https://www.ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=<TTB_ID>
```

Actual label images are discovered from printable pages via public `publicViewAttachment.do` URLs.

## 4. Pull the Fixtures

To pull or refresh the six-record real test set:

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem

python3 tools/ttb_collector/collect_by_ttb_ids.py \
  --input tools/ttb_collector/fixtures.testing.yaml \
  --out fixtures/public-cola-registry \
  --limit 6 \
  --delay-seconds 2.0 \
  --respect-cache \
  --refresh \
  --base-url https://www.ttbonline.gov/colasonline/viewColaDetails.do
```

Use `--refresh` when intentionally rebuilding existing records. Omit `--refresh` to skip already-collected records.

If you want a clean rebuild, remove only the curated records directory first:

```bash
rm -rf fixtures/public-cola-registry/records
```

Then rerun the collection command above.

## 5. Expected Output

The collector writes:

```text
fixtures/public-cola-registry/
  manifest.json
  manifest.csv
  records/
    <ttb_id>/
      metadata.raw.html
      metadata.json
      expected.json
      source.txt
      notes.md
      assets/
        printable_cola.html
        label_01.jpg
        label_02.jpg
```

The current six-record set should contain:

```text
6 records
8 JPEG label images
6 printable COLA HTML files
about 2.3 MB total
```

## 6. Verify the Pull

Run tests:

```bash
python3 -m pytest -q
```

Check the manifest:

```bash
python3 - <<'PY'
import json
from pathlib import Path

root = Path("fixtures/public-cola-registry")
manifest = json.loads((root / "manifest.json").read_text())
print("records_count", manifest["records_count"])
for record in manifest["records"]:
    print(
        record["ttb_id"],
        record["brand_name"],
        record["class_type"],
        record["product_type"],
        "assets=" + str(record["asset_count"]),
    )
PY
```

Check that downloaded label files are actual JPEGs:

```bash
file fixtures/public-cola-registry/records/*/assets/*.jpg
```

Expected result: each `label_*.jpg` should report `JPEG image data`, not HTML.

Check total size:

```bash
du -sh fixtures/public-cola-registry
```

## 7. Optional Discovery Workflow

Discovery is not required for the current seed set. If you need replacement candidates, use the public search form conservatively.

The public basic search page is:

```text
https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do?action=search
```

Its form posts to:

```text
https://www.ttbonline.gov/colasonline/publicSearchColasBasicProcess.do?action=search
```

Useful form fields observed during the fixture pull:

```text
searchCriteria.dateCompletedFrom
searchCriteria.dateCompletedTo
searchCriteria.productOrFancifulName
searchCriteria.productNameSearchType
searchCriteria.classTypeFrom
searchCriteria.classTypeTo
searchCriteria.originCode
```

Prefer narrow wildcard searches such as `chardonnay%`, `cabernet%`, `seltzer%`, or `tequila%`, and inspect only a few candidates.

The static discovery helper can parse saved or simple search-result pages:

```bash
export REQUESTS_CA_BUNDLE=tools/ttb_collector/cache/certs/ttb-ca-bundle.pem

python3 tools/ttb_collector/discover_ttb_ids.py \
  --commodity wine \
  --class-type "Cabernet Sauvignon" \
  --status approved \
  --max-results 20 \
  --out tools/ttb_collector/candidate_ids_wine.json
```

If automatic discovery cannot parse the registry page, use manual browser inspection or `manual_capture_helper.py` for a tiny curated sample.

## 8. Important Gotchas

- The detail page uses legacy HTML shaped like `<strong>Brand Name:</strong> value`; the parser handles that.
- Do not treat every `<img>` on the detail page as a label. Many are page chrome GIFs.
- Real label images were found on printable public pages as `publicViewAttachment.do` URLs.
- Signature images are intentionally excluded from label assets.
- Some public records are `SURRENDERED`; this seed intentionally uses `APPROVED` records.
- `tools/ttb_collector/cache/` is ignored and may contain temporary search HTML and the temporary CA bundle.
- `fixtures/public-cola-registry/bulk/` is ignored for accidental large pulls.
