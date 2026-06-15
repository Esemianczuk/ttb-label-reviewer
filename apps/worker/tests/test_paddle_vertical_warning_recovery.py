from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ttb_validation.layoutlm_fields import attach_layoutlmv3_field_entities
from ttb_worker.engines.paddleocr_engine import (
    RecoveryRegion,
    map_recovered_items_to_original,
    vertical_warning_recovery_regions,
    warning_text_present,
    warning_text_score,
)


def test_warning_score_requires_real_warning_terms():
    warning = (
        "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK "
        "ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. "
        "(2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR "
        "OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS."
    )

    assert warning_text_present(warning) is True
    assert warning_text_score("DECADENT ALES GINGERBREAD MAPLE DONUT") < 10


def test_vertical_warning_regions_include_detected_tall_text_and_edges():
    regions = vertical_warning_recovery_regions(
        [
            {"text": "OEGES", "bbox": {"x": 66, "y": 72, "width": 14, "height": 657}},
            {"text": "1 Pint", "bbox": {"x": 1201, "y": 361, "width": 48, "height": 19}},
        ],
        image_width=1425,
        image_height=965,
    )

    assert regions[0].name == "detected-vertical-text-union"
    assert any(region.name == "left-edge-vertical-band" for region in regions)
    assert any(region.name == "right-edge-vertical-band" for region in regions)
    assert regions[0].box[0] < 66
    assert regions[0].box[3] > 700


def test_rotated_recovered_boxes_are_mapped_back_to_original_image_coordinates():
    mapped = map_recovered_items_to_original(
        [
            {
                "text": "GOVERNMENT WARNING",
                "confidence": 0.99,
                "bbox": {"x": 30, "y": 5, "width": 40, "height": 10},
                "words": [],
            }
        ],
        RecoveryRegion("test", (10, 20, 110, 220)),
        270,
        image_width=300,
        image_height=300,
    )

    assert mapped[0]["bbox"] == {"x": 15.0, "y": 150.0, "width": 10.0, "height": 40.0}
    assert mapped[0]["orientationCorrected"] is True


def test_warning_weak_entity_starts_at_government_warning_not_previous_tokens():
    payloads = attach_layoutlmv3_field_entities(
        {"governmentWarningRequired": True},
        [
            {
                "rawText": "",
                "assetId": "asset-1",
                "imageId": "asset-1",
                "blocks": [
                    _word("and", 900, 900),
                    _word("Nutmeg", 940, 900),
                    _word("GOVERNMENT", 66, 650),
                    _word("WARNING", 66, 589),
                    _word("SURGEON", 66, 411),
                    _word("PREGNANCY", 80, 623),
                    _word("MACHINERY", 93, 472),
                    _word("HEALTH", 93, 337),
                    _word("PROBLEMS", 93, 276),
                ],
            }
        ],
        predictions=None,
        source="test",
    )

    warning = next(entity for entity in payloads[0]["fieldEntities"] if entity["fieldKey"] == "governmentWarningRequired")
    assert warning["text"].startswith("GOVERNMENT WARNING")
    assert "Nutmeg" not in warning["text"]
    assert warning["bbox"]["x"] == 66.0
    assert warning["bbox"]["width"] < 60


@pytest.mark.skipif(os.environ.get("TTB_RUN_SLOW_OCR") != "1", reason="real PaddleOCR regression is opt-in")
def test_real_decedent_vertical_warning_fixture_recovers_warning_text():
    pytest.importorskip("paddleocr")

    from ttb_worker.engines.paddleocr_engine import PaddleOcrEngine
    from ttb_worker.tasks.validation_task import build_validation_candidate

    record = Path("fixtures/public-cola-registry/records/20006001000584")
    expected = json.loads((record / "expected.json").read_text(encoding="utf-8"))["expected_fields"]
    result = PaddleOcrEngine(use_gpu=False).recognize((record / "assets/label_01.jpg").read_bytes())

    assert "GOVERNMENT WARNING" in result.text
    assert result.metadata["orientationRecovery"]["applied"] is True
    recovered_boxes = [line["bbox"] for line in result.lines if line.get("orientationCorrected")]
    assert recovered_boxes
    assert min(box["x"] for box in recovered_boxes) < 120
    assert max(box["height"] for box in recovered_boxes) > 450

    candidate = build_validation_candidate(
        "paddleocr-regression",
        expected,
        [result],
        asset_jobs=[{"payload": {"asset_id": "fixture-20006001000584"}, "_image_index": 0}],
        worker_id="pytest",
        policy={"hard_statuses": {"FAIL", "NEEDS_REVIEW", "NOT_FOUND", "WARNING"}, "min_confidence": 0.86},
    )
    warning = next(field for field in candidate["validation"]["fields"] if field["fieldKey"] == "governmentWarningRequired")
    assert warning["status"] == "PASS"
    assert warning["evidence"][0]["bbox"]["width"] < 80


def _word(text: str, x: int, y: int) -> dict:
    return {
        "kind": "word",
        "text": text,
        "confidence": 0.96,
        "bbox": {"x": x, "y": y, "width": 12, "height": 40},
        "assetId": "asset-1",
        "imageId": "asset-1",
    }
