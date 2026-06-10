from pathlib import Path

import pytest

from tools.ttb_collector.common import is_valid_ttb_id, validate_ttb_id
from tools.ttb_collector.download_assets import duplicate_sha256_assets, sanitize_asset_filename
from tools.ttb_collector.normalize_metadata import map_product_type, normalize_metadata, parse_abv_percent
from tools.ttb_collector.parse_cola_detail import parse_detail_file


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "tools" / "ttb_collector" / "tests" / "fixtures"


def test_ttb_id_validation():
    assert is_valid_ttb_id("ABC12345678901")
    assert validate_ttb_id("ABC12345678901") == "ABC12345678901"
    assert not is_valid_ttb_id("too-short")
    with pytest.raises(ValueError):
        validate_ttb_id("ABC123")


def test_parse_fake_distilled_spirits_detail():
    metadata = parse_detail_file(
        FIXTURE_DIR / "cola_detail_fake_distilled_spirits.html",
        detail_url="https://example.test/publicSearchColasBasic.do?action=publicDisplaySearchBasic&ttbid=ABC12345678901",
    )
    assert metadata["ttb_id"] == "ABC12345678901"
    assert metadata["status"] == "Approved"
    assert metadata["application"]["brand_name"] == "Hollow Ridge"
    assert metadata["application"]["class_type"] == "Bourbon Whiskey"
    assert len(metadata["raw_fields"]) >= 10
    assert {asset["kind"] for asset in metadata["assets"]} == {"printable_cola", "label_image"}


def test_parse_fake_wine_and_malt_product_types():
    wine = parse_detail_file(FIXTURE_DIR / "cola_detail_fake_wine.html", ttb_id_hint="DEF12345678901")
    malt = parse_detail_file(FIXTURE_DIR / "cola_detail_fake_malt.html", ttb_id_hint="GHI12345678901")
    assert map_product_type(wine) == "wine"
    assert map_product_type(malt) == "malt_beverage"


def test_normalize_expected_fields_from_metadata():
    metadata = parse_detail_file(FIXTURE_DIR / "cola_detail_fake_distilled_spirits.html", ttb_id_hint="ABC12345678901")
    metadata["assets"] = [
        {
            "kind": "label_image",
            "local_path": "assets/label_01.jpg",
            "url": "https://example.test/front.jpg",
            "sha256": "abc",
        }
    ]
    expected = normalize_metadata(metadata)
    assert expected["fixture_id"] == "ttb_ABC12345678901_hollow-ridge"
    assert expected["expected_fields"]["productType"] == "distilled_spirits"
    assert expected["expected_fields"]["governmentWarningRequired"] is True
    assert expected["assets"][0]["file"] == "assets/label_01.jpg"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("45% Alc./Vol. (90 Proof)", 45.0),
        ("90 Proof", 45.0),
        ("13.5% ABV", 13.5),
        ("0.4% alc/vol", 0.4),
    ],
)
def test_abv_and_proof_parsing(text, expected):
    assert parse_abv_percent(text) == expected


def test_asset_filename_sanitization():
    assert sanitize_asset_filename("label_image", 1, "https://example.test/../../front label.JPG") == "label_01.jpg"
    assert sanitize_asset_filename("printable_cola", 1, "https://example.test/print?id=1", "application/pdf") == "printable_cola.pdf"


def test_duplicate_sha256_detection():
    duplicates = duplicate_sha256_assets(
        [
            {"local_path": "assets/a.jpg", "sha256": "same"},
            {"local_path": "assets/b.jpg", "sha256": "same"},
            {"local_path": "assets/c.jpg", "sha256": "different"},
        ]
    )
    assert duplicates == [{"sha256": "same", "files": ["assets/a.jpg", "assets/b.jpg"]}]
