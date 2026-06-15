from tools.ocr_lab.build_layoutlmv3_ner_dataset import build_examples
from tools.ocr_lab.build_field_annotation_queue import build_queue
from tools.ocr_lab.apply_field_annotations import apply_annotations
from tools.ocr_lab.field_extractor_metrics import summarize_label_predictions
from tools.ocr_lab.generate_layoutlm_synthetic_corpus import generate_rows
from tools.ocr_lab.train_layoutlmv3_token_classifier import dataset_summary
from ttb_validation import validate_label_packet
from ttb_validation.layoutlm_fields import attach_layoutlmv3_field_entities


def test_layoutlmv3_dataset_builder_creates_bio_labels_from_full_image_ocr():
    rows = [
        {
            "id": "record-1-front",
            "recordId": "record-1",
            "split": "train",
            "image": "front.png",
            "expectedFields": {
                "brandName": "Hollow Ridge",
                "classType": "Bourbon Whiskey",
                "alcoholContent": "45% ALC/VOL",
                "netContents": "750 mL",
                "governmentWarningRequired": True,
            },
            "text": "HOLLOW RIDGE\nBOURBON WHISKEY\n45% ALC/VOL\n750 ML\nGOVERNMENT WARNING",
            "metadata": {"imageWidth": 1000, "imageHeight": 1000},
            "words": [
                word("HOLLOW", 100, 100),
                word("RIDGE", 180, 100),
                word("BOURBON", 100, 160),
                word("WHISKEY", 210, 160),
                word("45%", 100, 220),
                word("ALC/VOL", 150, 220),
                word("750", 100, 280),
                word("ML", 150, 280),
                word("GOVERNMENT", 100, 340),
                word("WARNING", 240, 340),
            ],
        }
    ]

    examples, summary = build_examples(rows)

    labels = examples[0]["ner_labels"]
    assert summary["examples"] == 1
    assert "B-BRAND_NAME" in labels
    assert "B-ALCOHOL_CONTENT" in labels
    assert "B-NET_CONTENTS" in labels
    assert examples[0]["weak_ner_labels"] == labels
    assert examples[0]["bboxes"][0] == [100, 100, 160, 130]
    assert examples[0]["requiresHumanReview"] is True


def test_annotation_queue_and_apply_reviewed_labels_preserve_weak_baseline():
    rows = [
        {
            "id": "record-1-front",
            "recordId": "record-1",
            "split": "train",
            "words": ["HOLLOW", "RIDGE"],
            "bboxes": [[100, 100, 160, 130], [180, 100, 240, 130]],
            "ner_labels": ["B-BRAND_NAME", "I-BRAND_NAME"],
            "weak_ner_labels": ["B-BRAND_NAME", "I-BRAND_NAME"],
        }
    ]

    queue, summary = build_queue(rows)
    queue[0]["reviewedNerLabels"] = ["O", "B-BRAND_NAME"]
    reviewed, apply_summary = apply_annotations(rows, queue)

    assert summary["examples"] == 1
    assert reviewed[0]["weak_ner_labels"] == ["B-BRAND_NAME", "I-BRAND_NAME"]
    assert reviewed[0]["ner_labels"] == ["O", "B-BRAND_NAME"]
    assert reviewed[0]["requiresHumanReview"] is False
    assert apply_summary["reviewed"] == 1


def test_field_extractor_metrics_detect_false_pass_and_miss():
    rows = [
        {
            "id": "record-1-front",
            "words": ["HOLLOW", "RIDGE", "750", "ML"],
            "ner_labels": ["B-BRAND_NAME", "I-BRAND_NAME", "B-NET_CONTENTS", "I-NET_CONTENTS"],
        }
    ]
    predicted = {"record-1-front": ["B-BRAND_NAME", "O", "O", "B-CLASS_TYPE"]}

    metrics = summarize_label_predictions(rows, predicted)

    assert metrics["fieldRecall"] < 1
    assert metrics["falsePassRate"] > 0
    assert metrics["perField"]["BRAND_NAME"]["fn"] == 1


def test_layoutlmv3_predictions_are_plausibility_guarded_with_weak_backfill():
    payload = {
        "rawText": "HOLLOW RIDGE BOURBON WHISKEY 45% ALC/VOL 750 ML",
        "assetId": "front",
        "imageId": "front",
        "blocks": [
            {**word("HOLLOW", 100, 100), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("RIDGE", 180, 100), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("BOURBON", 100, 160), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("WHISKEY", 210, 160), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("45%", 100, 220), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("ALC/VOL", 150, 220), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("750", 100, 280), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("ML", 150, 280), "kind": "word", "assetId": "front", "imageId": "front"},
        ],
    }
    expected = {
        "brandName": "Hollow Ridge",
        "classType": "Bourbon Whiskey",
        "alcoholContent": "45% ALC/VOL",
        "netContents": "750 mL",
    }
    attached = attach_layoutlmv3_field_entities(
        expected,
        [payload],
        predictions=[
            {"entity": "BRAND_NAME", "fieldKey": "brandName", "tokenIndexes": [6], "confidence": 0.99},
            {"entity": "ALCOHOL_CONTENT", "fieldKey": "alcoholContent", "tokenIndexes": [4, 5], "confidence": 0.98},
        ],
    )

    entities = attached[0]["fieldEntities"]
    by_field = {entity["fieldKey"]: entity for entity in entities}
    assert by_field["brandName"]["text"] == "HOLLOW RIDGE"
    assert by_field["brandName"]["method"].endswith(":weak-backfill")
    assert by_field["alcoholContent"]["text"] == "45% ALC/VOL"
    assert by_field["alcoholContent"]["method"] == "layoutlmv3-token-classifier"


def test_empty_layoutlmv3_predictions_still_use_guarded_backfill_source():
    payload = {
        "rawText": "HOLLOW RIDGE BOURBON WHISKEY",
        "assetId": "front",
        "imageId": "front",
        "blocks": [
            {**word("HOLLOW", 100, 100), "kind": "word", "assetId": "front", "imageId": "front"},
            {**word("RIDGE", 180, 100), "kind": "word", "assetId": "front", "imageId": "front"},
        ],
    }
    attached = attach_layoutlmv3_field_entities(
        {"brandName": "Hollow Ridge"},
        [payload],
        predictions=[],
        source="layoutlmv3-token-classifier",
    )

    assert attached[0]["fieldEntities"][0]["method"] == "layoutlmv3-token-classifier:weak-backfill"


def test_government_warning_validation_preserves_entity_bbox():
    warning_text = (
        "GOVERNMENT WARNING According to the Surgeon General women should not drink alcoholic beverages during "
        "pregnancy because of the risk of birth defects Consumption of alcoholic beverages impairs your ability "
        "to drive a car or operate machinery and may cause health problems"
    )
    payload = {
        "rawText": warning_text,
        "assetId": "back",
        "imageId": "back",
        "blocks": [
            {**word("GOVERNMENT", 700, 100), "kind": "word", "assetId": "back", "imageId": "back"},
            {**word("WARNING", 700, 140), "kind": "word", "assetId": "back", "imageId": "back"},
            {**word("SURGEON", 700, 180), "kind": "word", "assetId": "back", "imageId": "back"},
            {**word("PREGNANCY", 700, 220), "kind": "word", "assetId": "back", "imageId": "back"},
            {**word("MACHINERY", 700, 260), "kind": "word", "assetId": "back", "imageId": "back"},
            {**word("HEALTH", 700, 300), "kind": "word", "assetId": "back", "imageId": "back"},
        ],
    }
    attached = attach_layoutlmv3_field_entities(
        {"governmentWarningRequired": True},
        [payload],
        predictions=[],
        source="layoutlmv3-token-classifier",
    )

    warning = next(field for field in validate_label_packet({"governmentWarningRequired": True}, attached)["fields"] if field["fieldKey"] == "governmentWarningRequired")

    assert warning["evidence"][0]["bbox"]["x"] == 700.0
    assert warning["evidence"][0]["bbox"]["height"] >= 230


def test_layoutlmv3_dry_run_summary_counts_labels():
    rows = [{"split": "train", "words": ["HOLLOW"], "ner_labels": ["B-BRAND_NAME"]}]

    summary = dataset_summary(rows)

    assert summary["splits"] == {"train": 1}
    assert summary["labels"]["B-BRAND_NAME"] == 1


def test_synthetic_generator_emits_full_image_ocr_contract():
    rows = generate_rows(
        [
            {
                "recordId": "record-1",
                "fields": {
                    "brandName": "Hollow Ridge",
                    "classType": "Bourbon Whiskey",
                    "alcoholContent": "45% ALC/VOL",
                    "netContents": "750 mL",
                    "governmentWarningRequired": True,
                },
            }
        ],
        model="deepseek-r1:1.5b",
        host="http://127.0.0.1:9",
        use_ollama=False,
        seed=1,
    )

    assert rows[0]["metadata"]["synthetic"] is True
    assert rows[0]["words"]
    assert "Hollow Ridge".upper() in rows[0]["text"].upper()


def word(text: str, x: int, y: int) -> dict:
    return {"text": text, "confidence": 0.95, "bbox": {"x": x, "y": y, "width": 60, "height": 30}}
