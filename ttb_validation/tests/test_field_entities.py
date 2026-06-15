from __future__ import annotations

from ttb_validation import GOVERNMENT_WARNING_TEXT, validate_label_packet
from ttb_validation.field_entities import attach_weak_field_entities


def test_weak_field_entities_attach_conservative_ocr_token_boxes():
    payloads = attach_weak_field_entities(
        {
            "brandName": "Devils Backbone",
            "alcoholContent": "7.5% alc/vol",
            "netContents": "12 fl oz",
            "governmentWarningRequired": True,
        },
        [_ocr_payload()],
    )

    entities = {entity["fieldKey"]: entity for entity in payloads[0]["fieldEntities"]}

    assert entities["brandName"]["text"] == "DEVILS BACKBONE"
    assert entities["brandName"]["method"] == "paddleocr-weak-field-alignment"
    assert entities["brandName"]["bbox"] == {"x": 100.0, "y": 90.0, "width": 134.0, "height": 28.0}
    assert entities["alcoholContent"]["text"] == "7.5% ALC/VOL"
    assert entities["netContents"]["text"] == "12 FL OZ"
    assert entities["governmentWarningRequired"]["text"].startswith("GOVERNMENT WARNING")


def test_validators_consume_field_entities_as_evidence_authority():
    expected = {
        "brandName": "Devils Backbone",
        "classType": "Gin Specialties",
        "alcoholContent": "7.5% alc/vol",
        "netContents": "12 fl oz",
        "governmentWarningRequired": True,
    }
    payloads = attach_weak_field_entities(expected, [_ocr_payload()])

    validation = validate_label_packet(expected, payloads)
    by_field = {field["fieldKey"]: field for field in validation["fields"]}

    assert by_field["brandName"]["status"] == "PASS"
    assert by_field["brandName"]["evidence"][0]["method"].startswith("paddleocr-weak-field-alignment")
    assert by_field["brandName"]["evidence"][0]["bbox"]["x"] == 100.0
    assert by_field["governmentWarningRequired"]["status"] == "PASS"


def _ocr_payload() -> dict:
    words = [
        _word("DEVILS", 100, 90, 52, 28),
        _word("BACKBONE", 156, 90, 78, 28),
        _word("GIN", 100, 140, 32, 24),
        _word("SPECIALTIES", 138, 140, 98, 24),
        _word("7.5%", 100, 190, 36, 22),
        _word("ALC/VOL", 142, 190, 58, 22),
        _word("12", 100, 235, 18, 22),
        _word("FL", 124, 235, 16, 22),
        _word("OZ", 146, 235, 18, 22),
        _word("GOVERNMENT", 20, 300, 120, 18),
        _word("WARNING:", 146, 300, 88, 18),
        _word("SURGEON", 240, 300, 80, 18),
        _word("PREGNANCY", 326, 300, 96, 18),
        _word("MACHINERY", 428, 300, 94, 18),
        _word("HEALTH", 528, 300, 64, 18),
        _word("PROBLEMS.", 598, 300, 86, 18),
    ]
    return {
        "rawText": "\n".join(
            [
                "DEVILS BACKBONE",
                "GIN SPECIALTIES",
                "7.5% ALC/VOL",
                "12 FL OZ",
                GOVERNMENT_WARNING_TEXT,
            ]
        ),
        "assetId": "asset-devils-backbone",
        "imageId": "asset-devils-backbone",
        "blocks": words,
    }


def _word(text: str, x: int, y: int, width: int, height: int) -> dict:
    return {
        "kind": "word",
        "text": text,
        "confidence": 0.98,
        "bbox": {"x": x, "y": y, "width": width, "height": height},
        "assetId": "asset-devils-backbone",
        "imageId": "asset-devils-backbone",
        "engine": "paddleocr",
    }
