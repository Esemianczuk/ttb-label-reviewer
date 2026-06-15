from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any


GOVERNMENT_WARNING_TEXT = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during "
    "pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability "
    "to drive a car or operate machinery, and may cause health problems."
)

FIELD_TO_ENTITY = {
    "brandName": "BRAND_NAME",
    "classType": "CLASS_TYPE",
    "alcoholContent": "ALCOHOL_CONTENT",
    "netContents": "NET_CONTENTS",
    "producerName": "PRODUCER_NAME",
    "countryOfOrigin": "COUNTRY_OF_ORIGIN",
    "governmentWarningRequired": "GOVERNMENT_WARNING",
}

ENTITY_TO_FIELD = {value: key for key, value in FIELD_TO_ENTITY.items()}

ALCOHOL_HINT = re.compile(r"(?:\d{1,3}(?:[.,]\d+)?\s*%|\bABV\b|\bALC\b|\bVOL\b|\bPROOF\b)", re.IGNORECASE)
NET_HINT = re.compile(r"(?:\d{1,5}(?:\.\d+)?\s*(?:ML|M\s*L|L|OZ|FL|PINT|PT)\b)", re.IGNORECASE)
NON_ALNUM = re.compile(r"[^A-Z0-9]+")


@dataclass(frozen=True)
class OcrToken:
    text: str
    normalized: str
    confidence: float | None
    bbox: dict[str, float] | None
    image_id: str
    asset_id: str
    block: dict[str, Any]
    index: int


def attach_layoutlmv3_field_entities(
    expected_fields: dict[str, Any],
    ocr_payloads: list[dict[str, Any]],
    *,
    predictions: list[dict[str, Any]] | None = None,
    source: str = "layoutlmv3-token-classifier",
) -> list[dict[str, Any]]:
    """Attach field entities to OCR payloads.

    `predictions` is the trained-model path: BIO/entity spans predicted by a
    LayoutLMv3 token classifier. When predictions are absent, this function uses
    conservative weak alignment so the rest of the pipeline can be exercised and
    reviewed without pretending that a trained model is installed.
    """

    tokens = ocr_tokens_from_payloads(ocr_payloads)
    entities = (
        hybrid_entities_from_predictions(expected_fields, tokens, predictions, source=source)
        if predictions is not None
        else weak_entities_from_expected(expected_fields, tokens, source=f"{source}:weak-align")
    )
    entities_by_image: dict[str, list[dict[str, Any]]] = {}
    for entity in entities:
        image_id = str(entity.get("imageId") or "")
        entities_by_image.setdefault(image_id, []).append(entity)

    output: list[dict[str, Any]] = []
    for payload in ocr_payloads:
        image_id = str(payload.get("imageId") or payload.get("assetId") or "")
        payload_entities = entities_by_image.get(image_id, [])
        output.append({**payload, "fieldEntities": payload_entities})
    return output


def hybrid_entities_from_predictions(
    expected_fields: dict[str, Any],
    tokens: list[OcrToken],
    predictions: list[dict[str, Any]] | None,
    *,
    source: str,
) -> list[dict[str, Any]]:
    predicted = [
        entity
        for entity in entities_from_predictions(tokens, predictions or [], source=source)
        if entity_plausible_for_expected(expected_fields, entity)
    ]
    covered_fields = {str(entity.get("fieldKey") or "") for entity in predicted}
    backfill = []
    for entity in weak_entities_from_expected(expected_fields, tokens, source=f"{source}:weak-backfill"):
        if str(entity.get("fieldKey") or "") not in covered_fields:
            backfill.append(entity)
    return [*predicted, *backfill]


def ocr_tokens_from_payloads(ocr_payloads: list[dict[str, Any]]) -> list[OcrToken]:
    tokens: list[OcrToken] = []
    for payload in ocr_payloads:
        image_id = str(payload.get("imageId") or payload.get("assetId") or f"image-{len(tokens)}")
        asset_id = str(payload.get("assetId") or image_id)
        blocks = [block for block in payload.get("blocks") or [] if isinstance(block, dict)]
        word_blocks = [block for block in blocks if str(block.get("kind") or "").lower() == "word"]
        source_blocks = word_blocks or blocks
        for block in source_blocks:
            for text in split_token_text(block.get("text")):
                normalized = normalize_for_entity(text)
                if not normalized:
                    continue
                tokens.append(
                    OcrToken(
                        text=text,
                        normalized=normalized,
                        confidence=float_or_none(block.get("confidence")),
                        bbox=normalize_bbox(block.get("bbox")),
                        image_id=str(block.get("imageId") or block.get("assetId") or image_id),
                        asset_id=str(block.get("assetId") or asset_id),
                        block=block,
                        index=len(tokens),
                    )
                )
    return tokens


def weak_entities_from_expected(expected_fields: dict[str, Any], tokens: list[OcrToken], *, source: str) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    for field_key, entity_label in FIELD_TO_ENTITY.items():
        expected_value = expected_value_for_field(field_key, expected_fields)
        if not expected_value:
            continue
        best = best_token_window(field_key, str(expected_value), tokens)
        if not best:
            continue
        min_score = 0.72 if field_key in {"brandName", "classType", "producerName"} else 0.84
        if best["score"] < min_score:
            continue
        entities.append(entity_from_tokens(field_key, entity_label, best["tokens"], score=best["score"], method=source))
    return entities


def entities_from_predictions(tokens: list[OcrToken], predictions: list[dict[str, Any]], *, source: str) -> list[dict[str, Any]]:
    by_index = {token.index: token for token in tokens}
    entities: list[dict[str, Any]] = []
    for prediction in predictions:
        if not isinstance(prediction, dict):
            continue
        entity_label = str(prediction.get("entity") or prediction.get("label") or "").upper()
        field_key = str(prediction.get("fieldKey") or ENTITY_TO_FIELD.get(entity_label) or "")
        if field_key not in FIELD_TO_ENTITY:
            continue
        indexes = prediction.get("tokenIndexes") or prediction.get("token_indices") or []
        span_tokens = [by_index[index] for index in indexes if isinstance(index, int) and index in by_index]
        if not span_tokens and prediction.get("text"):
            span_tokens = best_text_span(str(prediction["text"]), tokens)
        if not span_tokens:
            continue
        score = float_or_none(prediction.get("score")) or float_or_none(prediction.get("confidence")) or 0.75
        entities.append(entity_from_tokens(field_key, FIELD_TO_ENTITY[field_key], span_tokens, score=score, method=source))
    return entities


def entity_plausible_for_expected(expected_fields: dict[str, Any], entity: dict[str, Any]) -> bool:
    field_key = str(entity.get("fieldKey") or "")
    text = str(entity.get("text") or "")
    expected = expected_value_for_field(field_key, expected_fields)
    if not field_key or not text or not expected:
        return False
    normalized_text = normalize_for_entity(text)
    normalized_expected = normalize_for_entity(expected)
    if field_key == "governmentWarningRequired":
        terms = set(normalized_text.split())
        return len(terms & {"GOVERNMENT", "WARNING", "SURGEON", "PREGNANCY", "MACHINERY", "HEALTH"}) >= 3
    if field_key == "alcoholContent":
        return bool(ALCOHOL_HINT.search(text)) and entity_similarity(normalized_expected, normalized_text) >= 0.52
    if field_key == "netContents":
        return bool(NET_HINT.search(text)) and entity_similarity(normalized_expected, normalized_text) >= 0.52
    expected_tokens = meaningful_tokens(expected)
    if not expected_tokens:
        return False
    coverage = token_coverage(expected_tokens, normalized_text.split())
    similarity = entity_similarity(" ".join(expected_tokens), normalized_text)
    threshold = 0.5 if field_key == "countryOfOrigin" else 0.62
    return ((coverage * 0.65) + (similarity * 0.35)) >= threshold


def best_text_span(text: str, tokens: list[OcrToken]) -> list[OcrToken]:
    normalized = normalize_for_entity(text)
    if not normalized:
        return []
    best = None
    for size in range(1, min(14, len(tokens)) + 1):
        for start in range(0, len(tokens) - size + 1):
            window = tokens[start : start + size]
            score = SequenceMatcher(a=normalized, b=" ".join(token.normalized for token in window)).ratio()
            if best is None or score > best["score"]:
                best = {"score": score, "tokens": window}
    return list(best["tokens"]) if best and best["score"] >= 0.82 else []


def best_token_window(field_key: str, expected: str, tokens: list[OcrToken]) -> dict[str, Any] | None:
    if field_key == "alcoholContent":
        return best_regex_window(tokens, ALCOHOL_HINT, expected, max_size=7)
    if field_key == "netContents":
        return best_regex_window(tokens, NET_HINT, expected, max_size=6)
    if field_key == "governmentWarningRequired":
        return best_warning_window(tokens)

    expected_tokens = meaningful_tokens(expected)
    if not expected_tokens:
        return None
    max_size = min(max(len(expected_tokens) + 3, 3), 14)
    best = None
    for size in range(1, max_size + 1):
        for start in range(0, len(tokens) - size + 1):
            window = tokens[start : start + size]
            window_norm = " ".join(token.normalized for token in window)
            score = entity_similarity(" ".join(expected_tokens), window_norm)
            coverage = token_coverage(expected_tokens, window_norm.split())
            if coverage < min(1.0, 1 / max(len(expected_tokens), 1)):
                continue
            combined = (score * 0.4) + (coverage * 0.6)
            if best is None or combined > best["score"]:
                best = {"score": combined, "tokens": window}
    return best


def best_regex_window(tokens: list[OcrToken], pattern: re.Pattern[str], expected: str, *, max_size: int) -> dict[str, Any] | None:
    best = None
    expected_norm = normalize_for_entity(expected)
    for size in range(1, max_size + 1):
        for start in range(0, len(tokens) - size + 1):
            window = tokens[start : start + size]
            text = " ".join(token.text for token in window)
            if not pattern.search(text):
                continue
            score = max(0.82, entity_similarity(expected_norm, normalize_for_entity(text)))
            if best is None or score > best["score"]:
                best = {"score": score, "tokens": window}
    return best


def best_warning_window(tokens: list[OcrToken]) -> dict[str, Any] | None:
    warning_indexes = [index for index, token in enumerate(tokens) if token.normalized in {"GOVERNMENT", "WARNING", "SURGEON", "PREGNANCY", "MACHINERY", "HEALTH"}]
    if not warning_indexes:
        return None
    start = max(0, min(warning_indexes) - 2)
    for index in range(0, len(tokens) - 1):
        if tokens[index].normalized == "GOVERNMENT" and tokens[index + 1].normalized == "WARNING":
            start = index
            break
    end = min(len(tokens), max(warning_indexes) + 22)
    window = tokens[start:end]
    terms = {token.normalized for token in window}
    score = min(1.0, len(terms & {"GOVERNMENT", "WARNING", "SURGEON", "PREGNANCY", "MACHINERY", "HEALTH"}) / 5)
    return {"score": max(0.76, score), "tokens": window}


def entity_from_tokens(field_key: str, entity_label: str, tokens: list[OcrToken], *, score: float, method: str) -> dict[str, Any]:
    confidences = [token.confidence for token in tokens if token.confidence is not None]
    confidence = sum(confidences) / len(confidences) if confidences else score
    return {
        "fieldKey": field_key,
        "entity": entity_label,
        "text": normalize_display_text(" ".join(token.text for token in tokens)),
        "confidence": round(max(0.0, min(1.0, confidence * score)), 4),
        "score": round(max(0.0, min(1.0, score)), 4),
        "method": method,
        "imageId": tokens[0].image_id if tokens else "",
        "assetId": tokens[0].asset_id if tokens else "",
        "bbox": union_bbox([token.bbox for token in tokens if token.bbox]),
        "tokenIndexes": [token.index for token in tokens],
    }


def expected_value_for_field(field_key: str, expected_fields: dict[str, Any]) -> str:
    if field_key == "governmentWarningRequired":
        return GOVERNMENT_WARNING_TEXT if expected_fields.get("governmentWarningRequired") else ""
    return str(expected_fields.get(field_key) or "")


def split_token_text(value: Any) -> list[str]:
    text = normalize_display_text(value)
    if not text:
        return []
    return [token for token in re.split(r"\s+", text) if token]


def meaningful_tokens(value: str) -> list[str]:
    return [token for token in normalize_for_entity(value).split() if len(token) >= 2]


def entity_similarity(expected: str, observed: str) -> float:
    if not expected or not observed:
        return 0.0
    if expected == observed:
        return 1.0
    if expected in observed or observed in expected:
        return 0.96
    return SequenceMatcher(a=expected, b=observed).ratio()


def token_coverage(expected_tokens: list[str], observed_tokens: list[str]) -> float:
    if not expected_tokens or not observed_tokens:
        return 0.0
    matched = 0
    for expected in expected_tokens:
        if any(entity_similarity(expected, observed) >= 0.82 for observed in observed_tokens):
            matched += 1
    return matched / len(expected_tokens)


def normalize_for_entity(value: Any) -> str:
    return NON_ALNUM.sub(" ", str(value or "").upper()).strip()


def normalize_display_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split())


def normalize_bbox(value: Any) -> dict[str, float] | None:
    if isinstance(value, dict) and {"x", "y", "width", "height"}.issubset(value):
        return {key: float(value[key]) for key in ("x", "y", "width", "height")}
    return None


def union_bbox(boxes: list[dict[str, float]]) -> dict[str, float] | None:
    if not boxes:
        return None
    left = min(box["x"] for box in boxes)
    top = min(box["y"] for box in boxes)
    right = max(box["x"] + box["width"] for box in boxes)
    bottom = max(box["y"] + box["height"] for box in boxes)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
