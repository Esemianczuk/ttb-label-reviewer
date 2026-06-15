from pathlib import Path

from tools.ocr_lab.auto_label_regions import auto_label
from tools.ocr_lab.auto_label_regions import target_similarity
from tools.ocr_lab.export_paddleocr_manifests import export
from tools.ocr_lab.promote_paddleocr_model import promotion_allowed
from tools.ocr_lab.train_region_ranker import build_examples, train_and_evaluate


def test_auto_label_marks_only_high_confidence_expected_matches():
    rows = [
        {
            "recordId": "record-1",
            "region": {"text": "HOLLOW RIDGE", "confidence": 0.96},
            "crop": {"path": "crops/hollow.jpg"},
            "matchedFields": ["brandName"],
        },
        {
            "recordId": "record-1",
            "region": {"text": "random", "confidence": 0.99},
            "crop": {"path": "crops/random.jpg"},
            "matchedFields": [],
        },
    ]
    labeled, summary = auto_label(
        rows,
        {"record-1": {"brandName": "Hollow Ridge Bourbon"}},
        min_confidence=0.9,
        min_similarity=0.92,
    )

    assert summary["weakAccepted"] == 1
    assert labeled[0]["weakLabel"]["fieldKey"] == "brandName"
    assert labeled[0]["weakLabel"]["requiresHumanReview"] is True
    assert "weakLabel" not in labeled[1]


def test_export_requires_review_or_explicit_weak_acceptance(tmp_path: Path):
    rows = [
        {
            "recordId": "record-1",
            "image": "label.png",
            "region": {"points": [[0, 0], [10, 0], [10, 4], [0, 4]], "text": "UNREVIEWED"},
            "crop": {"path": "crops/unreviewed.jpg"},
        },
        {
            "recordId": "record-1",
            "image": "label.png",
            "region": {"points": [[0, 5], [10, 5], [10, 9], [0, 9]], "text": "WEAK"},
            "crop": {"path": "crops/weak.jpg"},
            "weakLabel": {"accepted": True, "text": "WEAK"},
        },
        {
            "recordId": "record-1",
            "image": "label.png",
            "region": {"points": [[0, 10], [10, 10], [10, 14], [0, 14]], "text": "REVIEWED"},
            "crop": {"path": "crops/reviewed.jpg"},
            "review": {"accepted": True, "text": "REVIEWED"},
        },
    ]

    strict_summary = export(rows, {"record-1": "train"}, tmp_path / "strict", accept_weak=False, accept_all_ocr=False)
    weak_summary = export(rows, {"record-1": "train"}, tmp_path / "weak", accept_weak=True, accept_all_ocr=False)

    assert strict_summary["recognitionRows"]["train"] == 1
    assert (tmp_path / "strict" / "rec" / "train.txt").read_text(encoding="utf-8").strip() == "crops/reviewed.jpg\tREVIEWED"
    assert weak_summary["recognitionRows"]["train"] == 2
    assert "crops/weak.jpg\tWEAK" in (tmp_path / "weak" / "rec" / "train.txt").read_text(encoding="utf-8")


def test_numeric_field_weak_matching_requires_numbers_and_units():
    assert target_similarity("7.59 ALCIVOL", "7.5% ALC/VOL", "alcoholContent") >= 0.9
    assert target_similarity("ALCOHOL", "12.5% ALCOHOL BY VOL. (25 PROOF)", "alcoholContent") == 0
    assert target_similarity("750ML", "750 mL", "netContents") >= 0.9
    assert target_similarity("750", "750 mL", "netContents") == 0


def test_promotion_guard_requires_recall_gain_without_false_pass_regression():
    allowed, reasons = promotion_allowed(
        {
            "baseline": {"fieldRecall": 0.82, "falsePassRate": 0.01},
            "candidate": {"fieldRecall": 0.86, "falsePassRate": 0.01},
        },
        min_recall_gain=0.01,
        max_false_pass_delta=0.0,
    )
    assert allowed is True
    assert reasons == []

    blocked, reasons = promotion_allowed(
        {
            "baseline": {"fieldRecall": 0.82, "falsePassRate": 0.01},
            "candidate": {"fieldRecall": 0.821, "falsePassRate": 0.02},
        },
        min_recall_gain=0.01,
        max_false_pass_delta=0.0,
    )
    assert blocked is False
    assert any("fieldRecall" in reason for reason in reasons)
    assert any("falsePassRate" in reason for reason in reasons)


def test_region_ranker_trains_from_weak_labels(tmp_path: Path):
    rows = [
        {
            "recordId": "train-1",
            "region": {"text": "HOLLOW RIDGE", "confidence": 0.98, "points": [[0, 0], [20, 0], [20, 4], [0, 4]]},
            "crop": {"path": "crops/brand.jpg", "width": 20, "height": 4},
            "weakLabel": {"accepted": True, "fieldKey": "brandName", "text": "HOLLOW RIDGE"},
        },
        {
            "recordId": "train-1",
            "region": {"text": "750 ML", "confidence": 0.98, "points": [[0, 5], [20, 5], [20, 9], [0, 9]]},
            "crop": {"path": "crops/net.jpg", "width": 20, "height": 4},
            "weakLabel": {"accepted": True, "fieldKey": "netContents", "text": "750 ML"},
        },
        {
            "recordId": "val-1",
            "region": {"text": "HOLLOW HILL", "confidence": 0.98, "points": [[0, 0], [20, 0], [20, 4], [0, 4]]},
            "crop": {"path": "crops/brand-val.jpg", "width": 20, "height": 4},
            "weakLabel": {"accepted": True, "fieldKey": "brandName", "text": "HOLLOW HILL"},
        },
        {
            "recordId": "val-1",
            "region": {"text": "375 ML", "confidence": 0.98, "points": [[0, 5], [20, 5], [20, 9], [0, 9]]},
            "crop": {"path": "crops/net-val.jpg", "width": 20, "height": 4},
            "weakLabel": {"accepted": True, "fieldKey": "netContents", "text": "375 ML"},
        },
    ]
    examples = build_examples(
        rows,
        {"train-1": "train", "val-1": "val"},
        include_other=False,
        other_ratio=0,
        seed=1,
    )

    metrics = train_and_evaluate(examples, tmp_path / "ranker")

    assert (tmp_path / "ranker" / "region-ranker.joblib").exists()
    assert metrics["counts"]["train"] == 2
    assert metrics["val"]["count"] == 2
