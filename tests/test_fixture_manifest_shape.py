import json
from pathlib import Path

from tools.ttb_collector.build_manifest import build_manifest, write_manifest_files
from tools.ttb_collector.collect_by_ttb_ids import collect_one_record, collect_records
from tools.ttb_collector.common import write_json
from tools.ttb_collector.manual_capture_helper import create_manual_record


FIXTURE_HTML = (
    Path(__file__).resolve().parents[1]
    / "tools"
    / "ttb_collector"
    / "tests"
    / "fixtures"
    / "cola_detail_fake_distilled_spirits.html"
)


def test_manifest_generation_shape(tmp_path):
    fixture_root = tmp_path / "public-cola-registry"
    record_dir = fixture_root / "records" / "ABC12345678901"
    write_json(
        record_dir / "expected.json",
        {
            "fixture_id": "ttb_ABC12345678901_hollow-ridge",
            "ttb_id": "ABC12345678901",
            "expected_fields": {
                "brandName": "Hollow Ridge",
                "classType": "Bourbon Whiskey",
                "productType": "distilled_spirits",
            },
            "assets": [{"file": "assets/label_01.jpg"}],
        },
    )
    manifest = build_manifest(fixture_root, generated_at="2026-06-10T00:00:00Z")
    assert manifest["records_count"] == 1
    assert manifest["records"][0] == {
        "fixture_id": "ttb_ABC12345678901_hollow-ridge",
        "ttb_id": "ABC12345678901",
        "brand_name": "Hollow Ridge",
        "class_type": "Bourbon Whiskey",
        "product_type": "distilled_spirits",
        "asset_count": 1,
        "record_dir": "records/ABC12345678901",
        "expected_json": "records/ABC12345678901/expected.json",
    }
    write_manifest_files(fixture_root, manifest)
    assert (fixture_root / "manifest.json").exists()
    assert "fixture_id,ttb_id,brand_name" in (fixture_root / "manifest.csv").read_text(encoding="utf-8")


def test_collect_by_ttb_ids_with_local_html(tmp_path):
    out_dir = tmp_path / "public-cola-registry"
    results = collect_records(
        [{"ttb_id": "ABC12345678901", "expected_group": "distilled_spirits", "notes": "fake local"}],
        out_dir=out_dir,
        limit=1,
        delay_seconds=0,
        respect_cache=True,
        refresh=False,
        base_url="https://example.test/publicSearchColasBasic.do",
        local_html=FIXTURE_HTML,
        skip_assets=True,
    )
    assert results[0].status == "collected"
    metadata = json.loads((out_dir / "records" / "ABC12345678901" / "metadata.json").read_text(encoding="utf-8"))
    expected = json.loads((out_dir / "records" / "ABC12345678901" / "expected.json").read_text(encoding="utf-8"))
    assert metadata["application"]["brand_name"] == "Hollow Ridge"
    assert expected["expected_fields"]["productType"] == "distilled_spirits"
    assert (out_dir / "manifest.json").exists()


def test_collect_local_html_skip_assets_never_uses_network(tmp_path):
    class NoNetworkSession:
        def get(self, *_args, **_kwargs):
            raise AssertionError("skip-assets local HTML collection must not make network requests")

    out_dir = tmp_path / "public-cola-registry"
    result = collect_one_record(
        {"ttb_id": "ABC12345678901", "expected_group": "distilled_spirits"},
        out_dir=out_dir,
        respect_cache=True,
        refresh=False,
        base_url="https://example.test/publicSearchColasBasic.do",
        local_html=FIXTURE_HTML,
        session=NoNetworkSession(),
        skip_assets=True,
    )

    assert result.status == "collected"
    metadata = json.loads((out_dir / "records" / "ABC12345678901" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["assets"] == []
    assert {asset["kind"] for asset in metadata["discovered_assets"]} == {"printable_cola", "label_image"}


def test_manual_capture_helper_builds_record_and_manifest_without_network(tmp_path):
    public_asset = tmp_path / "front label.JPG"
    public_asset.write_bytes(b"public label bytes")
    out_dir = tmp_path / "public-cola-registry"

    record_dir = create_manual_record(
        ttb_id="ABC12345678901",
        detail_url="https://example.test/publicSearchColasBasic.do?action=publicDisplaySearchBasic&ttbid=ABC12345678901",
        html_file=FIXTURE_HTML,
        assets=[public_asset],
        out_dir=out_dir,
    )

    expected = json.loads((record_dir / "expected.json").read_text(encoding="utf-8"))
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert expected["assets"][0]["file"] == "assets/label_01.jpg"
    assert manifest["records_count"] == 1
    assert "manual_capture" in (record_dir / "source.txt").read_text(encoding="utf-8")
