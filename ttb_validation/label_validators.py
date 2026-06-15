from __future__ import annotations

import re
from typing import Any


STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_WARNING = "WARNING"
STATUS_NEEDS_REVIEW = "NEEDS_REVIEW"
STATUS_NOT_FOUND = "NOT_FOUND"
STATUS_NOT_APPLICABLE = "NOT_APPLICABLE"
STATUS_PASS_WITH_WARNINGS = "PASS_WITH_WARNINGS"

SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"

GOVERNMENT_WARNING_TEXT = (
    "GOVERNMENT WARNING:\n"
    "(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy "
    "because of the risk of birth defects.\n"
    "(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, "
    "and may cause health problems."
)

REQUIRED_WARNING_SEGMENTS = [
    "GOVERNMENT WARNING",
    "According to the Surgeon General",
    "women should not drink alcoholic beverages during pregnancy",
    "risk of birth defects",
    "Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery",
    "may cause health problems",
]

FIELD_LABELS = {
    "brandName": "Brand Name",
    "fancifulName": "Fanciful Name",
    "classType": "Class/Type",
    "alcoholContent": "Alcohol Content",
    "netContents": "Net Contents",
    "governmentWarningRequired": "Government Warning",
    "producerName": "Producer / Bottler / Importer",
    "countryOfOrigin": "Country of Origin",
}

WARNING_EVIDENCE_MAX_LENGTH = 520
GENERIC_CLASS_MODIFIERS = {
    "OTHER",
    "FOREIGN",
    "TABLE",
    "COCKTAILS",
    "COCKTAIL",
    "48",
    "PROOF",
    "UP",
}
SPECIALTY_CLASS_TERMS = {"SPECIALTIES", "SPECIALTY", "SPECIALITIES", "SPECIALITY", "SPECIAL"}
SPIRITS_EVIDENCE_TERMS = {"SPIRITS", "SPIRIT"}
SPECIALTY_EVIDENCE_TERMS = {
    *SPECIALTY_CLASS_TERMS,
    *SPIRITS_EVIDENCE_TERMS,
    "COCKTAIL",
    "COCKTAILS",
    "FLAVOR",
    "FLAVORS",
    "FLAVORED",
    "FLAVOURED",
    "NATURAL",
    "SODA",
    "WATER",
    "LIME",
    "MIXED",
    "CARBONATED",
    "CARBONATION",
    "GINGER",
    "COCONUT",
    "BARREL",
    "AGED",
}
BASE_SPIRIT_TERMS = [
    {"expected": {"GIN"}, "evidence": {"GIN"}},
    {"expected": {"VODKA"}, "evidence": {"VODKA"}},
    {"expected": {"RUM"}, "evidence": {"RUM"}},
    {"expected": {"TEQUILA"}, "evidence": {"TEQUILA"}},
    {"expected": {"BRANDY"}, "evidence": {"BRANDY"}},
    {"expected": {"WHISKY", "WHISKEY"}, "evidence": {"WHISKY", "WHISKEY"}},
    {"expected": {"BOURBON"}, "evidence": {"BOURBON"}},
]
COCKTAIL_PAIRINGS = [
    {"GIN", "TONIC"},
    {"VODKA", "MULE"},
    {"RUM", "COLA"},
    {"WHISKEY", "COLA"},
    {"WHISKY", "COLA"},
]
WHITE_WINE_VARIETALS = [
    {"evidence": {"SAUVIGNON", "BLANC"}, "label": "SAUVIGNON BLANC", "score": 0.92},
    {"evidence": {"CHARDONNAY"}, "label": "CHARDONNAY", "score": 0.9},
    {"evidence": {"RIESLING"}, "label": "RIESLING", "score": 0.9},
    {"evidence": {"PINOT", "GRIGIO"}, "label": "PINOT GRIGIO", "score": 0.9},
    {"evidence": {"PINOT", "GRIS"}, "label": "PINOT GRIS", "score": 0.9},
    {"evidence": {"MOSCATO"}, "label": "MOSCATO", "score": 0.88},
    {"evidence": {"WHITE", "WINE"}, "label": "WHITE WINE", "score": 0.94},
]
RED_WINE_VARIETALS = [
    {"evidence": {"CABERNET"}, "label": "CABERNET", "score": 0.9},
    {"evidence": {"MERLOT"}, "label": "MERLOT", "score": 0.9},
    {"evidence": {"PINOT", "NOIR"}, "label": "PINOT NOIR", "score": 0.9},
    {"evidence": {"SYRAH"}, "label": "SYRAH", "score": 0.88},
    {"evidence": {"SHIRAZ"}, "label": "SHIRAZ", "score": 0.88},
    {"evidence": {"MALBEC"}, "label": "MALBEC", "score": 0.88},
    {"evidence": {"RED", "WINE"}, "label": "RED WINE", "score": 0.94},
]

ALCOHOL_CANDIDATE_PATTERN = re.compile(
    r"(?:ALC(?:OHOL)?\.?(?:\s+|[,;:]\s*)[0-9I1|lOBH%]{1,5}\s*(?:%\s*)?(?:(?:BY|B[YV]|RY)\s*)?V[O0C]?[L1I]?|"
    r"\d{1,3}(?:[.,]\d+)?\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ABV)?|"
    r"\d{1,3}(?:[.,]\d+)?\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ALC\s*[/I1|]?\s*V[O0]L|ALCIV[O0]L|ABV)|"
    r"\d{2,3}(?:\.\d+)?\s*PROOF)",
    re.IGNORECASE,
)
ABV_PATTERNS = [
    re.compile(r"ALC(?:OHOL)?\.?(?:\s+|[,;:]\s*)([0-9I1|lOBH%]{1,5})\s*(?:%\s*)?(?:(?:BY|B[YV]|RY)\s*)?V[O0C]?[L1I]?", re.IGNORECASE),
    re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ABV)?", re.IGNORECASE),
    re.compile(r"(\d{1,3}(?:[.,]\d+)?)\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?(?:VOL(?:UME)?\.?|[/I1|]?\s*V[O0]L(?:UME)?\.?)|ALC\s*[/I1|]?\s*V[O0]L|ALCIV[O0]L|ABV)", re.IGNORECASE),
]
PROOF_PATTERN = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*PROOF", re.IGNORECASE)

NET_CONTENTS_PATTERN = re.compile(
    r"(?:\d{1,5}(?:\.\d+)?\s*M\s*L\b|"
    r"(?:7\s*/?\s*[5S]\s*[0O]|/\s*[5S]\s*[0O]|T\s*[5S]\s*[0O])\s*M?\s*L\b|"
    r"[1I|l]\s*P(?:IN)?T(?:\s+\d{1,3}(?:\.\d+)?\s*FL\.?\s*[O0]Z\.?)?|"
    r"\d{1,3}(?:\.\d+)?\s*P(?:IN)?T(?:\s+\d{1,3}(?:\.\d+)?\s*FL\.?\s*[O0]Z\.?)?|"
    r"\d{1,3}(?:\.\d+)?\s*FL\.?\s*[O0]Z\.?|"
    r"\d{1,4}(?:\.\d+)?\s*(?:L|LITER|LITRE|LITERS|LITRES)\b)",
    re.IGNORECASE,
)
ML_PATTERN = re.compile(r"(\d{1,5}(?:\.\d+)?)\s*M\s*L\b", re.IGNORECASE)
LITER_PATTERN = re.compile(r"(\d{1,4}(?:\.\d+)?)\s*(?:L|LITER|LITRE|LITERS|LITRES)\b", re.IGNORECASE)
PINT_FL_OZ_PATTERN = re.compile(r"([0-9I|l]{1,3}(?:\.\d+)?)\s*P(?:IN)?T(?:\s+(\d{1,3}(?:\.\d+)?)\s*FL\.?\s*[O0]Z\.?)?", re.IGNORECASE)
FL_OZ_PATTERN = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*FL\.?\s*[O0]Z\.?", re.IGNORECASE)
COMMON_OCR_750_ML_PATTERN = re.compile(r"(?:750|75O|7S0|7SO|T50|TS0|7/50|/50)M?L", re.IGNORECASE)
AMBIGUOUS_ML_PATTERN = re.compile(r"\bM\s*L\b", re.IGNORECASE)


def validate_label_packet(expected: dict[str, Any], ocr_results: list[dict[str, Any]]) -> dict[str, Any]:
    combined_ocr = combine_ocr_results(ocr_results)
    fields = [
        validate_brand(expected.get("brandName"), combined_ocr),
        validate_class_type(expected.get("classType"), combined_ocr),
        validate_alcohol(expected.get("alcoholContent"), combined_ocr),
        validate_net_contents(expected.get("netContents"), combined_ocr),
        validate_government_warning(bool(expected.get("governmentWarningRequired")), combined_ocr),
    ]
    optional = [
        validate_optional_text_field("fancifulName", expected.get("fancifulName"), combined_ocr),
        validate_optional_text_field("producerName", expected.get("producerName"), combined_ocr),
        validate_optional_text_field("countryOfOrigin", expected.get("countryOfOrigin"), combined_ocr, pass_threshold=0.82, review_threshold=0.62),
    ]
    fields.extend(field for field in optional if field is not None)
    return {
        "overallStatus": compute_overall_status(fields),
        "fields": fields,
        "combinedOcr": combined_ocr,
    }


def validate_brand(expected: Any, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "brandName"
    if not expected:
        return make_review(key, expected, STATUS_WARNING, SEVERITY_WARNING, "No expected brand was entered.")

    candidate = find_best_text_candidate(str(expected), ocr_result, field_key=key)
    token_coverage = score_expected_token_coverage(str(expected), ocr_result)
    best_evidence = token_coverage if token_coverage and (not candidate or token_coverage["score"] > candidate["score"]) else candidate

    if not best_evidence or (best_evidence["score"] < 0.45 and (not token_coverage or token_coverage["coverage"] < 0.5)):
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "Expected brand name was not found in the label text.")

    ambiguous_expected_brand = has_embedded_ambiguous_glyph(str(expected))
    if (candidate and candidate["score"] >= 0.94) or (ambiguous_expected_brand and candidate and candidate["score"] >= 0.84):
        reason = (
            "Expected brand name matches label evidence after treating the embedded punctuation mark as a stylized brand glyph."
            if ambiguous_expected_brand and candidate["score"] < 0.94
            else "Expected brand name appears on the label."
        )
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, reason, candidate["evidence"], candidate["score"], candidate)

    compound = find_joined_token_evidence(str(expected), ocr_result)
    if compound and compound["score"] >= 0.9:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected brand appears as joined label text.", compound["value"], compound["score"], compound)

    if token_coverage and token_coverage["coverage"] == 1 and token_coverage["score"] >= 0.9 and brand_tokens_appear_in_order(str(expected), ocr_result):
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected brand tokens appear on the label.", token_coverage["value"], token_coverage["score"], token_coverage)

    if (candidate and candidate["score"] >= 0.7) or (token_coverage and token_coverage["coverage"] >= 0.8):
        evidence = candidate if candidate and candidate["score"] >= 0.7 else token_coverage
        reason = (
            "Expected brand tokens were found across the OCR output, but not as one clean phrase."
            if evidence["method"] == "expected-token-coverage"
            else "A close brand match was found, but OCR or spelling differences should be reviewed."
        )
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, reason, evidence.get("value") or evidence.get("evidence"), evidence["score"], evidence)

    return make_review(key, expected, STATUS_FAIL, SEVERITY_CRITICAL, "The closest detected brand text does not match the expected brand.", best_evidence.get("evidence"), best_evidence["score"], best_evidence)


def brand_tokens_appear_in_order(expected_value: str, ocr_result: dict[str, Any]) -> bool:
    expected_tokens = significant_tokens(expected_value)
    ocr_tokens = significant_tokens(ocr_result.get("rawText") or "")
    if not expected_tokens or not ocr_tokens:
        return False
    cursor = 0
    for token in ocr_tokens:
        if token == expected_tokens[cursor]:
            cursor += 1
            if cursor == len(expected_tokens):
                return True
    return False


def validate_class_type(expected: Any, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "classType"
    if not expected:
        return make_review(key, expected, STATUS_WARNING, SEVERITY_WARNING, "No expected class/type was entered.")

    candidate = find_best_text_candidate(str(expected), ocr_result, slack=4, field_key=key)
    token_coverage = score_expected_token_coverage(str(expected), ocr_result)
    semantic_evidence = find_semantic_class_evidence(str(expected), ocr_result, token_coverage)
    best_evidence = token_coverage if token_coverage and (not candidate or token_coverage["score"] > candidate["score"]) else candidate

    if not semantic_evidence and (not best_evidence or (best_evidence["score"] < 0.42 and (not token_coverage or token_coverage["coverage"] < 0.5))):
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "Expected class/type was not found in the label text.")

    if semantic_evidence or (candidate and candidate["score"] >= 0.9) or (token_coverage and token_coverage["coverage"] == 1 and token_coverage["score"] >= 0.92):
        evidence = candidate if candidate and candidate["score"] >= 0.9 else semantic_evidence or token_coverage
        reason = (
            "Expected class/type is corroborated by base beverage terms and registry wording on the label."
            if evidence and evidence.get("method", "").startswith("semantic-class")
            else "Expected class/type appears on the label."
        )
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, reason, evidence.get("value") or evidence.get("evidence"), evidence["score"], evidence)

    if (candidate and candidate["score"] >= 0.68) or (token_coverage and token_coverage["coverage"] >= 0.75):
        evidence = candidate if candidate and candidate["score"] >= 0.68 else token_coverage
        reason = (
            "Expected class/type tokens were found across the OCR output, but should be reviewed for OCR substitutions."
            if evidence["method"] == "expected-token-coverage"
            else "A related class/type phrase was found, but it is not a confident exact match."
        )
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, reason, evidence.get("value") or evidence.get("evidence"), evidence["score"], evidence)

    return make_review(key, expected, STATUS_FAIL, SEVERITY_CRITICAL, "The closest detected class/type text does not match the expected value.", best_evidence.get("evidence"), best_evidence["score"], best_evidence)


def validate_alcohol(expected: Any, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "alcoholContent"
    expected_parsed = parse_alcohol_content(str(expected or ""))
    if not expected_parsed:
        return make_review(key, expected, STATUS_WARNING, SEVERITY_WARNING, "Expected alcohol content could not be parsed.")

    candidates = []
    for candidate in find_regex_candidates(ALCOHOL_CANDIDATE_PATTERN, ocr_result, method="regex-alcohol-candidate"):
        parsed = parse_alcohol_content(candidate.get("value") or "") or parse_alcohol_content(candidate["evidence"])
        if parsed:
            candidate["parsed"] = parsed
            candidates.append(candidate)

    if not candidates:
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "No alcohol content evidence was found on the label.")

    for candidate in candidates:
        if alcohol_values_equivalent(expected_parsed, candidate["parsed"]):
            return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected alcohol content matches the label evidence.", candidate["evidence"], candidate.get("confidence"), candidate)

    first = candidates[0]
    reason = f"Expected ABV {expected_parsed['abvPercent']}%, but label evidence appears to show {first['parsed']['abvPercent']}%."
    return make_review(key, expected, STATUS_FAIL, SEVERITY_CRITICAL, reason, first["evidence"], first.get("confidence"), first)


def validate_net_contents(expected: Any, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "netContents"
    expected_parsed = parse_net_contents(str(expected or ""))
    if not expected_parsed:
        return make_review(key, expected, STATUS_WARNING, SEVERITY_WARNING, "Expected net contents could not be parsed.")

    candidates = []
    for candidate in find_regex_candidates(NET_CONTENTS_PATTERN, ocr_result, method="regex-net-contents-candidate"):
        parsed = parse_net_contents(candidate["evidence"])
        if parsed:
            candidate["parsed"] = parsed
            candidates.append(candidate)

    if not candidates:
        ambiguous = find_regex_candidates(AMBIGUOUS_ML_PATTERN, ocr_result, method="ambiguous-net-contents-candidate")
        if ambiguous:
            evidence = ambiguous[0]
            return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, "OCR found milliliter evidence, but the amount could not be read confidently.", evidence["evidence"], evidence.get("confidence"), evidence)
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "No net contents evidence was found on the label.")

    for candidate in candidates:
        if net_contents_equivalent(expected_parsed, candidate["parsed"]):
            return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected net contents match the label evidence.", candidate["evidence"], candidate.get("confidence"), candidate)

    first = candidates[0]
    reason = f"Expected {expected_parsed['amountMl']} mL, but label evidence appears to show {first['parsed']['amountMl']} mL."
    return make_review(key, expected, STATUS_FAIL, SEVERITY_CRITICAL, reason, first["evidence"], first.get("confidence"), first)


def validate_government_warning(required: bool, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "governmentWarningRequired"
    if not required:
        return make_review(key, "Not required for this review", STATUS_WARNING, SEVERITY_WARNING, "Government warning was marked as not required in the expected fields.")

    warning_entities = field_entities(ocr_result, key)
    entity_text = " ".join(entity.get("text") or "" for entity in warning_entities)
    raw_text = "\n".join(part for part in [entity_text, ocr_result.get("rawText") or ""] if part)
    normalized_text = normalize_for_strict_warning(raw_text)
    segment_results = []
    for segment in REQUIRED_WARNING_SEGMENTS:
        normalized_segment = normalize_for_strict_warning(segment)
        if normalized_segment in normalized_text:
            segment_results.append({"segment": segment, "score": 1.0, "evidence": segment})
        else:
            best = best_window_similarity(segment, raw_text, slack=4)
            segment_results.append({"segment": segment, "score": best["score"], "evidence": best["text"]})

    strong_segments = [segment for segment in segment_results if segment["score"] >= 0.9]
    review_segments = [segment for segment in segment_results if segment["score"] >= 0.75]
    lowest = min(segment_results, key=lambda segment: segment["score"])
    heading_score = segment_results[0]["score"] if segment_results else 0
    evidence_text = government_warning_evidence_text(raw_text, segment_results, review_segments)
    geometry = entity_geometry_evidence(warning_entities) or warning_text_geometry_evidence(ocr_result)
    evidence = {
        "text": evidence_text,
        "method": "required-segment-check",
        "confidence": min(1.0, max(0.0, len(review_segments) / len(REQUIRED_WARNING_SEGMENTS))),
        **geometry,
    }

    if len(strong_segments) == len(REQUIRED_WARNING_SEGMENTS):
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_PASS, SEVERITY_INFO, "Required government warning text appears to be present.", evidence_text or "Required warning text appears present", min(segment["score"] for segment in segment_results), evidence)

    if len(review_segments) == len(REQUIRED_WARNING_SEGMENTS):
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_PASS, SEVERITY_INFO, "All required government warning segments appear to be present, with OCR noise.", evidence_text or "Required warning text appears present", min(segment["score"] for segment in segment_results), evidence)

    if len(review_segments) >= 4:
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, "Warning heading and several required phrases were found, but OCR did not confidently detect the full text.", evidence_text, len(review_segments) / len(REQUIRED_WARNING_SEGMENTS), evidence)

    if "GOVERNMENT WARNING" in normalized_text or heading_score >= 0.86:
        confidence = max(0.35, len(review_segments) / len(REQUIRED_WARNING_SEGMENTS))
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, "Government warning heading was found, but OCR did not confidently detect enough of the small legal text.", evidence_text or "Government warning heading detected", confidence, evidence)

    return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_FAIL, SEVERITY_CRITICAL, "Required government warning was not found or major required phrases are missing.", evidence_text, lowest["score"], evidence)


def validate_optional_text_field(
    key: str,
    expected: Any,
    ocr_result: dict[str, Any],
    *,
    pass_threshold: float = 0.88,
    review_threshold: float = 0.68,
) -> dict[str, Any] | None:
    if not expected:
        return None
    candidate = find_best_text_candidate(str(expected), ocr_result, slack=4, field_key=key)
    token_coverage = score_expected_token_coverage(str(expected), ocr_result)
    country_evidence = find_country_origin_evidence(str(expected), ocr_result) if key == "countryOfOrigin" else None
    label = FIELD_LABELS[key]
    best_evidence = token_coverage if token_coverage and (not candidate or token_coverage["score"] > candidate["score"]) else candidate

    if country_evidence:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Country of origin is corroborated by label evidence.", country_evidence["value"], country_evidence["score"], country_evidence)

    if not best_evidence or best_evidence["score"] < 0.42:
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_WARNING, f"{label} was entered but not found in the label text.")
    if candidate and candidate["score"] >= pass_threshold:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, f"{label} appears on the label.", candidate["evidence"], candidate["score"], candidate)
    if token_coverage and token_coverage["coverage"] == 1 and token_coverage["score"] >= pass_threshold:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, f"{label} tokens appear on the label.", token_coverage["value"], token_coverage["score"], token_coverage)
    if candidate and candidate["score"] >= review_threshold:
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, f"{label} may appear on the label, but it needs review.", candidate["evidence"], candidate["score"], candidate)
    if token_coverage and token_coverage["coverage"] >= 0.65 and token_coverage["score"] >= review_threshold:
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, f"{label} tokens may appear on the label, but they need review.", token_coverage["value"], token_coverage["score"], token_coverage)
    return make_review(key, expected, STATUS_FAIL, SEVERITY_WARNING, f"{label} evidence does not match the expected value.", best_evidence["evidence"], best_evidence["score"], best_evidence)


def compute_overall_status(fields: list[dict[str, Any]]) -> str:
    if any(field["severity"] == SEVERITY_CRITICAL and field["status"] in {STATUS_FAIL, STATUS_NOT_FOUND} for field in fields):
        return STATUS_FAIL
    if any(field["status"] in {STATUS_NEEDS_REVIEW, STATUS_NOT_FOUND} for field in fields):
        return STATUS_NEEDS_REVIEW
    if any(field["status"] == STATUS_WARNING for field in fields):
        return STATUS_PASS_WITH_WARNINGS
    return STATUS_PASS


def make_review(
    field_key: str,
    expected: Any,
    status: str,
    severity: str,
    reason: str,
    extracted: Any = None,
    confidence: float | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "fieldKey": field_key,
        "field": FIELD_LABELS[field_key],
        "expected": "" if expected is None else str(expected),
        "extracted": None if extracted in (None, "") else str(extracted),
        "status": status,
        "severity": severity,
        "confidence": clamp_confidence(confidence),
        "reason": reason,
        "evidence": [evidence_candidate(evidence)] if evidence else [],
    }


def evidence_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    block = candidate.get("block") if isinstance(candidate.get("block"), dict) else {}
    text = str(candidate.get("text") or candidate.get("evidence") or candidate.get("value") or "")
    output = {
        "text": text,
        "normalizedText": normalize_for_fuzzy_match(text),
        "method": str(candidate.get("method") or "validator-candidate"),
    }
    confidence = candidate.get("confidence")
    if confidence is None:
        confidence = candidate.get("score")
    confidence = clamp_confidence(confidence)
    if confidence is not None:
        output["confidence"] = confidence
    for key in ("imageId", "assetId", "engine", "workerId"):
        value = candidate.get(key) or block.get(key)
        if value:
            output[key] = str(value)
    bbox = candidate.get("bbox") or block.get("bbox")
    if isinstance(bbox, dict) and {"x", "y", "width", "height"}.issubset(bbox):
        output["bbox"] = {key: float(bbox[key]) for key in ("x", "y", "width", "height")}
    return output


def combine_ocr_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    raw_chunks = []
    blocks = []
    field_entities = []
    processing_ms = 0
    for index, result in enumerate(results):
        raw_text = str(result.get("rawText") or result.get("text") or "")
        if raw_text:
            raw_chunks.append(raw_text)
        processing_ms += int(result.get("processingTimeMs") or result.get("elapsedMs") or 0)
        source_blocks = result.get("blocks") or result.get("lines") or []
        for block in source_blocks:
            if isinstance(block, dict):
                blocks.append({**block, "imageIndex": index})
        for word in result.get("words") or []:
            if isinstance(word, dict):
                blocks.append({**word, "imageIndex": index})
        for entity in result.get("fieldEntities") or []:
            if isinstance(entity, dict):
                field_entities.append({**entity, "imageIndex": index})
    return {
        "rawText": "\n\n--- next label image ---\n\n".join(raw_chunks),
        "blocks": blocks,
        "fieldEntities": field_entities,
        "processingTimeMs": processing_ms,
    }


def flatten_ocr_blocks(ocr_result: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        text = normalize_whitespace(str(node.get("text") or ""))
        if text:
            output.append(
                {
                    "text": text,
                    "confidence": node.get("confidence"),
                    "bbox": node.get("bbox"),
                    "imageId": node.get("imageId") or node.get("assetId") or "",
                    "assetId": node.get("assetId") or "",
                    "engine": node.get("engine") or "",
                    "workerId": node.get("workerId") or "",
                    "imageIndex": node.get("imageIndex"),
                }
            )
        for key in ("blocks", "paragraphs", "lines", "words", "symbols"):
            for child in node.get(key) or []:
                visit(child)

    for block in ocr_result.get("blocks") or []:
        visit(block)
    return output


def get_candidate_texts(ocr_result: dict[str, Any]) -> list[dict[str, Any]]:
    blocks = flatten_ocr_blocks(ocr_result)
    lines = [{"text": text, "confidence": None, "bbox": None} for text in split_lines(ocr_result.get("rawText") or "")]
    entities = []
    for entity in ocr_result.get("fieldEntities") or []:
        if isinstance(entity, dict) and entity.get("text"):
            entities.append(
                {
                    "text": entity["text"],
                    "confidence": entity.get("confidence"),
                    "bbox": entity.get("bbox"),
                    "fieldKey": entity.get("fieldKey"),
                    "imageId": entity.get("imageId"),
                    "assetId": entity.get("assetId"),
                    "engine": entity.get("engine"),
                    "workerId": entity.get("workerId"),
                    "method": entity.get("method") or "layoutlmv3-token-classifier",
                }
            )
    seen = set()
    candidates = []
    for candidate in [*entities, *blocks, *lines]:
        key = normalize_for_fuzzy_match(candidate["text"])
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append(candidate)
    return candidates


def field_entities(ocr_result: dict[str, Any], field_key: str) -> list[dict[str, Any]]:
    return [
        entity
        for entity in ocr_result.get("fieldEntities") or []
        if isinstance(entity, dict) and entity.get("fieldKey") == field_key and entity.get("text")
    ]


def entity_geometry_evidence(entities: list[dict[str, Any]]) -> dict[str, Any]:
    boxes = [entity.get("bbox") for entity in entities if isinstance(entity.get("bbox"), dict)]
    output: dict[str, Any] = {}
    bbox = union_candidate_bboxes(boxes)
    if bbox:
        output["bbox"] = bbox
    for key in ("imageId", "assetId", "engine", "workerId"):
        values = [str(entity.get(key)) for entity in entities if entity.get(key)]
        if values:
            output[key] = values[0]
    confidences = [float(entity["confidence"]) for entity in entities if isinstance(entity.get("confidence"), (int, float))]
    if confidences:
        output["confidence"] = sum(confidences) / len(confidences)
    methods = sorted({str(entity.get("method")) for entity in entities if entity.get("method")})
    if methods:
        output["entityMethods"] = methods
    return output


def warning_text_geometry_evidence(ocr_result: dict[str, Any]) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    best_rank: tuple[int, float, float] = (-1, 0.0, 0.0)
    for block in flatten_ocr_blocks(ocr_result):
        if not candidate_has_geometry(block):
            continue
        text = str(block.get("text") or "")
        score = warning_text_score(text)
        if score <= 0:
            continue
        confidence = float(block.get("confidence") or 0.0)
        area = float(block["bbox"]["width"]) * float(block["bbox"]["height"])
        rank = (score, confidence, area)
        if rank > best_rank:
            best = block
            best_rank = rank
    if not best:
        return {}
    return {
        "bbox": {key: float(best["bbox"][key]) for key in ("x", "y", "width", "height")},
        "imageId": best.get("imageId") or best.get("assetId") or "",
        "assetId": best.get("assetId") or "",
        "engine": best.get("engine") or "",
        "workerId": best.get("workerId") or "",
    }


def union_candidate_bboxes(boxes: list[Any]) -> dict[str, float] | None:
    normalized = [
        {key: float(box[key]) for key in ("x", "y", "width", "height")}
        for box in boxes
        if isinstance(box, dict) and {"x", "y", "width", "height"}.issubset(box)
    ]
    if not normalized:
        return None
    left = min(box["x"] for box in normalized)
    top = min(box["y"] for box in normalized)
    right = max(box["x"] + box["width"] for box in normalized)
    bottom = max(box["y"] + box["height"] for box in normalized)
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def candidate_has_geometry(candidate: Any) -> bool:
    if not isinstance(candidate, dict):
        return False
    bbox = candidate.get("bbox")
    return isinstance(bbox, dict) and {"x", "y", "width", "height"}.issubset(bbox)


def with_match_geometry(candidate: dict[str, Any] | None, ocr_result: dict[str, Any]) -> dict[str, Any] | None:
    if not candidate or candidate.get("block"):
        return candidate
    return {**candidate, **match_geometry_evidence(candidate.get("matches") or [], ocr_result)}


def match_geometry_evidence(matches: list[dict[str, Any]], ocr_result: dict[str, Any]) -> dict[str, Any]:
    matched_blocks = []
    for match in matches:
        detected = str(match.get("detected") or "").strip()
        if not detected or detected.lower() == "missing":
            continue
        block = best_block_for_detected_token(detected, ocr_result)
        if block:
            matched_blocks.append(block)
    if not matched_blocks:
        return {"block": None}
    boxes = [block.get("bbox") for block in matched_blocks]
    bbox = union_candidate_bboxes(boxes)
    if not bbox:
        return {"block": None}
    text = " ".join(str(block.get("text") or "").strip() for block in matched_blocks if block.get("text"))
    confidences = [float(block["confidence"]) for block in matched_blocks if isinstance(block.get("confidence"), (int, float))]
    block = {
        "text": normalize_whitespace(text),
        "bbox": bbox,
        "method": "matched-token-geometry",
    }
    for key in ("imageId", "assetId", "engine", "workerId"):
        values = [str(candidate.get(key)) for candidate in matched_blocks if candidate.get(key)]
        if values:
            block[key] = values[0]
    if confidences:
        block["confidence"] = sum(confidences) / len(confidences)
    return {
        "block": block,
        "bbox": bbox,
        "confidence": block.get("confidence"),
    }


def best_block_for_detected_token(detected: str, ocr_result: dict[str, Any]) -> dict[str, Any] | None:
    normalized_detected = normalize_for_fuzzy_match(detected)
    if not normalized_detected:
        return None
    best_score = -1.0
    best_area = float("inf")
    best_block: dict[str, Any] | None = None
    for block in flatten_ocr_blocks(ocr_result):
        if not candidate_has_geometry(block):
            continue
        tokens = tokenize_for_match(block.get("text") or "")
        if not tokens:
            continue
        score = max(similarity_score(normalized_detected, token) for token in tokens)
        if score < 0.78 and normalized_detected not in normalize_for_fuzzy_match(block.get("text") or ""):
            continue
        area = float(block["bbox"]["width"]) * float(block["bbox"]["height"])
        if score > best_score or (score == best_score and area < best_area):
            best_score = score
            best_area = area
            best_block = block
    return best_block


def find_best_text_candidate(expected_value: str, ocr_result: dict[str, Any], *, slack: int = 3, field_key: str | None = None) -> dict[str, Any] | None:
    expected = normalize_whitespace(expected_value)
    if not expected:
        return None
    raw_text = normalize_whitespace(ocr_result.get("rawText") or "")
    raw_score = best_window_similarity(expected, raw_text, slack=slack)
    best = {
        "value": raw_score["text"] or expected,
        "evidence": raw_score["text"] or expected,
        "score": raw_score["score"],
        "confidence": None,
        "block": None,
        "method": "raw-text-contained-match" if raw_score["score"] == 1 else "raw-text-window-match",
    } if raw_score["score"] else None

    if field_key:
        for entity in field_entities(ocr_result, field_key):
            score = similarity_score(expected, entity["text"])
            if not best or score >= best["score"]:
                best = {
                    "value": entity["text"],
                    "evidence": entity["text"],
                    "score": score,
                    "confidence": entity.get("confidence"),
                    "block": entity,
                    "method": entity.get("method") or "layoutlmv3-token-classifier",
                }

    candidates = get_candidate_texts(ocr_result)
    expected_token_count = len(tokenize_for_match(expected))
    windows: list[dict[str, Any]] = []
    for candidate in candidates:
        windows.append(candidate)
        tokens = tokenize_for_match(candidate["text"])
        min_size = max(1, expected_token_count - 1)
        max_size = min(len(tokens), expected_token_count + 2)
        for start in range(len(tokens)):
            for size in range(min_size, max_size + 1):
                window_text = " ".join(tokens[start : start + size])
                if window_text:
                    windows.append({**candidate, "text": window_text})

    for candidate in windows:
        score = similarity_score(expected, candidate["text"])
        if not best or score > best["score"] or (score == best["score"] and candidate_has_geometry(candidate) and not candidate_has_geometry(best.get("block"))):
            best = {
                "value": candidate["text"],
                "evidence": candidate["text"],
                "score": score,
                "confidence": candidate.get("confidence"),
                "block": candidate,
                "method": "fuzzy-expected-match",
            }
    return best


def score_expected_token_coverage(expected_value: str, ocr_result: dict[str, Any]) -> dict[str, Any] | None:
    expected_tokens = significant_tokens(expected_value)
    ocr_tokens = significant_tokens(ocr_result.get("rawText") or "")
    if not expected_tokens or not ocr_tokens:
        return None

    matches = []
    for expected_token in expected_tokens:
        best = {"expected": expected_token, "detected": "", "score": 0.0}
        for ocr_token in ocr_tokens:
            score = similarity_score(expected_token, ocr_token)
            if score > best["score"]:
                best = {"expected": expected_token, "detected": ocr_token, "score": score}
        matches.append(best)

    matched = [match for match in matches if match["score"] >= minimum_token_score(match["expected"])]
    score = sum(match["score"] for match in matches) / len(matches)
    coverage = len(matched) / len(expected_tokens)
    if not coverage:
        return None
    return {
        "value": " ".join(match["detected"] for match in matched),
        "evidence": ", ".join(f"{match['expected']}:{match['detected'] or 'missing'}" for match in matches),
        "score": min(1.0, (score * 0.7) + (coverage * 0.3)),
        "coverage": coverage,
        "confidence": None,
        "method": "expected-token-coverage",
        "matches": matches,
        **match_geometry_evidence(matched, ocr_result),
    }


def find_semantic_class_evidence(expected_value: str, ocr_result: dict[str, Any], token_coverage: dict[str, Any] | None = None) -> dict[str, Any] | None:
    expected_tokens = tokenize_for_match(expected_value)
    ocr_tokens = significant_tokens(ocr_result.get("rawText") or "")
    if not expected_tokens or not ocr_tokens:
        return None

    cocktail = with_match_geometry(find_cocktail_class_evidence(expected_tokens, ocr_tokens, token_coverage), ocr_result)
    if cocktail:
        return cocktail

    honey_wine = with_match_geometry(find_honey_wine_class_evidence(expected_tokens, ocr_tokens, token_coverage), ocr_result)
    if honey_wine:
        return honey_wine

    table_wine = with_match_geometry(find_table_wine_class_evidence(expected_tokens, ocr_tokens, token_coverage), ocr_result)
    if table_wine:
        return table_wine

    specialty = with_match_geometry(find_specialty_class_evidence(expected_tokens, ocr_tokens, token_coverage), ocr_result)
    if specialty:
        return specialty

    meaningful_tokens = [token for token in expected_tokens if token not in GENERIC_CLASS_MODIFIERS]
    if not meaningful_tokens:
        return None

    matches = [best_token_match(token, ocr_tokens) for token in meaningful_tokens]
    matched = [match for match in matches if match and match["score"] >= minimum_token_score(match["expected"])]
    coverage = len(matched) / len(meaningful_tokens)
    if coverage < 1:
        return None

    score = sum(match["score"] for match in matched) / len(matched)
    evidence_text = ", ".join(f"{match['expected']}:{match['detected']}" for match in matched)
    return {
        "value": evidence_text,
        "evidence": evidence_text,
        "score": min(1.0, score),
        "coverage": coverage,
        "confidence": None,
        "method": "semantic-class-core-token-match",
        "matches": matched,
        **match_geometry_evidence(matched, ocr_result),
    }


def find_cocktail_class_evidence(expected_tokens: list[str], ocr_tokens: list[str], token_coverage: dict[str, Any] | None) -> dict[str, Any] | None:
    if "COCKTAILS" not in expected_tokens and "COCKTAIL" not in expected_tokens:
        return None
    token_set = set(ocr_tokens)
    for pairing in COCKTAIL_PAIRINGS:
        if pairing.issubset(token_set):
            evidence_text = ", ".join(f"{token}:{token}" for token in sorted(pairing))
            return {
                "value": evidence_text,
                "evidence": evidence_text,
                "score": max(float(token_coverage.get("score", 0)) if token_coverage else 0, 0.92),
                "coverage": 1,
                "confidence": None,
                "block": None,
                "method": "semantic-class-cocktail-pairing",
                "matches": [{"expected": token, "detected": token, "score": 1.0} for token in sorted(pairing)],
            }
    if "READY" in token_set and "DRINK" in token_set:
        return {
            "value": "COCKTAILS:READY TO DRINK",
            "evidence": "COCKTAILS:READY TO DRINK",
            "score": 0.86,
            "coverage": 1,
            "confidence": None,
            "block": None,
            "method": "semantic-class-cocktail-ready-to-drink",
            "matches": [{"expected": "COCKTAILS", "detected": "READY TO DRINK", "score": 0.86}],
        }
    return None


def find_honey_wine_class_evidence(expected_tokens: list[str], ocr_tokens: list[str], token_coverage: dict[str, Any] | None) -> dict[str, Any] | None:
    if "HONEY" not in expected_tokens or "WINE" not in expected_tokens:
        return None
    token_set = set(ocr_tokens)
    honey_match = "HONEY" in token_set
    mead_terms = [token for token in ocr_tokens if token in {"MEAD", "MEADERY"} or similarity_score("MEAD", token) >= 0.82]
    if not honey_match or not mead_terms:
        return None
    evidence_text = f"HONEY:HONEY, WINE:{mead_terms[0]}"
    return {
        "value": evidence_text,
        "evidence": evidence_text,
        "score": max(float(token_coverage.get("score", 0)) if token_coverage else 0, 0.92),
        "coverage": 1,
        "confidence": None,
        "block": None,
        "method": "semantic-class-honey-mead-wine",
        "matches": [
            {"expected": "HONEY", "detected": "HONEY", "score": 1.0},
            {"expected": "WINE", "detected": mead_terms[0], "score": 0.9},
        ],
    }


def find_table_wine_class_evidence(expected_tokens: list[str], ocr_tokens: list[str], token_coverage: dict[str, Any] | None) -> dict[str, Any] | None:
    if "WINE" not in expected_tokens:
        return None
    token_set = set(ocr_tokens)
    varietals = None
    expected_color = None
    if "WHITE" in expected_tokens:
        varietals = WHITE_WINE_VARIETALS
        expected_color = "WHITE"
    elif "RED" in expected_tokens:
        varietals = RED_WINE_VARIETALS
        expected_color = "RED"
    if not varietals or not expected_color:
        return None

    best = None
    for varietal in varietals:
        if not varietal["evidence"].issubset(token_set):
            continue
        if best is None or varietal["score"] > best["score"]:
            best = varietal
    if not best:
        return None

    evidence_text = f"{expected_color}:{best['label']}, WINE:{best['label']}"
    score = max(float(token_coverage.get("score", 0)) if token_coverage else 0, float(best["score"]))
    return {
        "value": evidence_text,
        "evidence": evidence_text,
        "score": min(1.0, score),
        "coverage": 1,
        "confidence": None,
        "block": None,
        "method": "semantic-class-table-wine-varietal",
        "matches": [
            {"expected": expected_color, "detected": best["label"], "score": best["score"]},
            {"expected": "WINE", "detected": best["label"], "score": best["score"]},
        ],
    }


def find_specialty_class_evidence(expected_tokens: list[str], ocr_tokens: list[str], token_coverage: dict[str, Any] | None) -> dict[str, Any] | None:
    if not any(token in SPECIALTY_CLASS_TERMS for token in expected_tokens):
        return None

    base_match = find_base_spirit_match(expected_tokens, ocr_tokens)
    if not base_match and has_generic_specialty_class(expected_tokens):
        base_match = find_any_base_spirit_match(ocr_tokens)
    malt_match = find_malt_beverage_match(expected_tokens, ocr_tokens)
    if not base_match and not malt_match:
        return None

    specialty_match = find_specialty_evidence_token(ocr_tokens)
    if not specialty_match:
        return None

    base = base_match or malt_match
    assert base is not None
    semantic_score = max(base["score"], specialty_match["score"])
    if specialty_match["detected"] in SPIRITS_EVIDENCE_TERMS:
        semantic_score = min(semantic_score, 0.66)
    score = max(float(token_coverage.get("score", 0)) if token_coverage else 0, semantic_score)
    evidence_text = f"{base['expected']}:{base['detected']}, SPECIALTIES:{specialty_match['detected']}"
    return {
        "value": evidence_text,
        "evidence": evidence_text,
        "score": min(1.0, score),
        "coverage": max(float(token_coverage.get("coverage", 0)) if token_coverage else 0, 1.0),
        "confidence": None,
        "block": None,
        "method": "semantic-class-specialty-base-match",
        "matches": [base, {"expected": "SPECIALTIES", "detected": specialty_match["detected"], "score": specialty_match["score"]}],
    }


def find_base_spirit_match(expected_tokens: list[str], ocr_tokens: list[str]) -> dict[str, Any] | None:
    for term in BASE_SPIRIT_TERMS:
        expected = next((token for token in term["expected"] if token in expected_tokens), None)
        if not expected:
            continue
        best = None
        for detected in ocr_tokens:
            score = max(similarity_score(evidence_term, detected) for evidence_term in term["evidence"])
            if score >= 0.86 and (best is None or score > best["score"]):
                best = {"expected": expected, "detected": detected, "score": score}
        if best:
            return best
    return None


def has_generic_specialty_class(expected_tokens: list[str]) -> bool:
    return any(token in expected_tokens for token in ("OTHER", "PROPRIETARY", "PROPRIETARIES", "PROPRIETORS"))


def find_any_base_spirit_match(ocr_tokens: list[str]) -> dict[str, Any] | None:
    best = None
    for term in BASE_SPIRIT_TERMS:
        expected = sorted(term["expected"])[0]
        for detected in ocr_tokens:
            score = max(similarity_score(evidence_term, detected) for evidence_term in term["evidence"])
            if score >= 0.86 and (best is None or score > best["score"]):
                best = {"expected": expected, "detected": detected, "score": score}
    return best


def find_malt_beverage_match(expected_tokens: list[str], ocr_tokens: list[str]) -> dict[str, Any] | None:
    if "MALT" not in expected_tokens and "BEER" not in expected_tokens:
        return None
    candidates = {"MALT", "BEER", "BEVERAGE", "BEVERAGES", "ALE", "LAGER", "PORTER", "STOUT"}
    best = None
    for expected in ("MALT", "BEER"):
        if expected not in expected_tokens:
            continue
        for detected in ocr_tokens:
            score = max(similarity_score(candidate, detected) for candidate in candidates)
            if score >= 0.78 and (best is None or score > best["score"]):
                best = {"expected": expected, "detected": detected, "score": score}
    return best


def find_specialty_evidence_token(ocr_tokens: list[str]) -> dict[str, Any] | None:
    best = None
    for detected in ocr_tokens:
        score = 0.0
        if detected in SPECIALTY_CLASS_TERMS:
            score = 1.0
        elif detected in SPIRITS_EVIDENCE_TERMS:
            score = 0.66
        elif detected in SPECIALTY_EVIDENCE_TERMS:
            score = 0.82
        if score and (best is None or score > best["score"]):
            best = {"detected": detected, "score": score}
    return best


def best_token_match(expected_token: str, ocr_tokens: list[str]) -> dict[str, Any] | None:
    best = None
    for detected in ocr_tokens:
        score = similarity_score(expected_token, detected)
        if best is None or score > best["score"]:
            best = {"expected": expected_token, "detected": detected, "score": score}
    return best


def find_joined_token_evidence(expected_value: str, ocr_result: dict[str, Any]) -> dict[str, Any] | None:
    expected_tokens = significant_tokens(expected_value)
    if len(expected_tokens) < 2:
        return None
    joined_expected = "".join(expected_tokens)
    if len(joined_expected) < 5:
        return None
    ocr_tokens = significant_tokens(ocr_result.get("rawText") or "")
    matches = [token for token in ocr_tokens if joined_expected in token]
    if not matches:
        return None
    evidence = matches[0]
    return {
        "value": evidence,
        "evidence": evidence,
        "score": 0.94 if evidence == joined_expected else 0.9,
        "confidence": None,
        "method": "joined-token-brand-match",
        "matches": [{"expected": joined_expected, "detected": evidence, "score": 0.94 if evidence == joined_expected else 0.9}],
        **match_geometry_evidence([{"expected": joined_expected, "detected": evidence, "score": 0.94 if evidence == joined_expected else 0.9}], ocr_result),
    }


def find_country_origin_evidence(expected_value: str, ocr_result: dict[str, Any]) -> dict[str, Any] | None:
    expected_tokens = [token for token in significant_tokens(expected_value) if len(token) >= 4 and token not in {"UNITED", "STATES"}]
    if not expected_tokens:
        expected_tokens = [token for token in significant_tokens(expected_value) if len(token) >= 4]
    ocr_tokens = significant_tokens(ocr_result.get("rawText") or "")
    if not expected_tokens or not ocr_tokens:
        return None
    matches = [best_token_match(token, ocr_tokens) for token in expected_tokens]
    matched = [match for match in matches if match and match["score"] >= 0.88]
    if not matched:
        return None
    coverage = len(matched) / len(expected_tokens)
    if coverage < 0.5:
        return None
    score = sum(match["score"] for match in matched) / len(matched)
    evidence_text = ", ".join(f"{match['expected']}:{match['detected']}" for match in matched)
    return {
        "value": evidence_text,
        "evidence": evidence_text,
        "score": min(1.0, max(score, 0.86)),
        "coverage": coverage,
        "confidence": None,
        "method": "country-origin-token-match",
        "matches": matched,
        **match_geometry_evidence(matched, ocr_result),
    }


def government_warning_evidence_text(
    raw_text: str,
    segment_results: list[dict[str, Any]],
    review_segments: list[dict[str, Any]],
) -> str:
    return limit_evidence_text(
        warning_excerpt_from_raw_text(raw_text)
        or " / ".join(segment["evidence"] for segment in review_segments if segment.get("evidence"))
        or " / ".join(segment["evidence"] for segment in segment_results if segment.get("evidence") and segment["score"] > 0.45)
    )


def warning_excerpt_from_raw_text(raw_text: str) -> str:
    lines = split_lines(raw_text)
    heading_index = next((index for index, line in enumerate(lines) if "GOVERNMENT WARNING" in normalize_for_strict_warning(line)), -1)
    if heading_index >= 0:
        heading_line = normalize_whitespace(lines[heading_index])
        normalized_heading_line = normalize_for_strict_warning(heading_line)
        if "HEALTH PROBLEMS" in normalized_heading_line or len(normalized_heading_line.split()) >= 28:
            return heading_line
        return normalize_whitespace(" ".join(lines[heading_index : heading_index + 6]))

    normalized_raw = normalize_for_strict_warning(raw_text)
    heading_at = normalized_raw.find("GOVERNMENT WARNING")
    if heading_at < 0:
        return ""
    return normalize_whitespace(normalized_raw[heading_at : heading_at + WARNING_EVIDENCE_MAX_LENGTH])


def limit_evidence_text(text: str) -> str:
    normalized = normalize_whitespace(text)
    if len(normalized) <= WARNING_EVIDENCE_MAX_LENGTH:
        return normalized
    return f"{normalized[: WARNING_EVIDENCE_MAX_LENGTH - 3].strip()}..."


def find_regex_candidates(pattern: re.Pattern[str], ocr_result: dict[str, Any], *, method: str) -> list[dict[str, Any]]:
    sources = [*({**candidate, "source": "block"} for candidate in get_candidate_texts(ocr_result)), {"text": ocr_result.get("rawText") or "", "confidence": None, "bbox": None, "source": "rawText"}]
    seen = set()
    results = []
    for source in sources:
        for line in split_lines(source["text"]):
            for match in pattern.finditer(line):
                evidence = normalize_whitespace(line)
                key = normalize_for_fuzzy_match(evidence)
                if not key or key in seen:
                    continue
                seen.add(key)
                results.append(
                    {
                        "value": normalize_whitespace(match.group(0)),
                        "evidence": evidence,
                        "score": 1.0,
                        "confidence": source.get("confidence"),
                        "block": source,
                        "method": method,
                    }
                )
    return results


def parse_alcohol_content(text: str) -> dict[str, Any] | None:
    source = normalize_whitespace(str(text).replace("\u00a0", " "))
    abv_values: list[float] = []
    proof_values: list[float] = []
    for pattern in ABV_PATTERNS:
        for match in pattern.finditer(source):
            value = normalize_ocr_abv_number(match.group(1))
            if value is not None and 0 < value <= 100:
                abv_values.append(value)
    for match in PROOF_PATTERN.finditer(source):
        value = float(match.group(1))
        if 0 < value <= 200:
            proof_values.append(value)
    proof = proof_values[0] if proof_values else None
    abv_percent = abv_values[0] if abv_values else (proof / 2 if proof is not None else None)
    if abv_percent is None and proof is None:
        return None
    return {"abvPercent": abv_percent, "proof": proof if proof is not None else abv_percent * 2, "original": source}


def normalize_ocr_abv_number(value: str) -> float | None:
    source = normalize_whitespace(str(value).upper())
    cleaned = (
        source.replace("I", "1")
        .replace("|", "1")
        .replace("L", "1")
        .replace("O", "0")
        .replace("Q", "0")
        .replace("B", "3")
        .replace("S", "5")
        .replace("%", "")
    )
    cleaned = re.sub(r"[^0-9.,]", "", cleaned)
    if not cleaned:
        return None
    try:
        numeric = float(cleaned.replace(",", "."))
    except ValueError:
        return None
    if numeric > 100 and "." not in cleaned and "," not in cleaned:
        if len(cleaned) == 4 and cleaned[-2:] in {"60", "66", "68", "69", "80", "86", "88", "89"}:
            numeric = float(cleaned[:2])
        elif numeric <= 999:
            last_digit = cleaned[-1]
            if last_digit in {"0", "6", "8", "9"}:
                numeric = float(cleaned[:-1])
            elif len(cleaned) == 3:
                numeric = numeric / 10
    return numeric


def alcohol_values_equivalent(left: dict[str, Any], right: dict[str, Any], tolerance: float = 0.25) -> bool:
    return abs(float(left["abvPercent"]) - float(right["abvPercent"])) <= tolerance


def parse_net_contents(text: str) -> dict[str, Any] | None:
    source = normalize_whitespace(str(text).replace("\u00a0", " "))
    compact = re.sub(r"\s+", "", source.upper())
    if COMMON_OCR_750_ML_PATTERN.search(compact):
        return {"amountMl": 750.0, "original": source}
    match = ML_PATTERN.search(source)
    if match:
        return {"amountMl": float(match.group(1)), "original": source}
    match = PINT_FL_OZ_PATTERN.search(source)
    if match:
        pints = ocr_number_to_float(match.group(1))
        fluid_ounces = float(match.group(2) or 0)
        return {"amountMl": (pints * 16 + fluid_ounces) * 29.5735295625, "original": source}
    match = FL_OZ_PATTERN.search(source)
    if match:
        return {"amountMl": float(match.group(1)) * 29.5735295625, "original": source}
    match = LITER_PATTERN.search(source)
    if match:
        return {"amountMl": float(match.group(1)) * 1000, "original": source}
    return None


def net_contents_equivalent(left: dict[str, Any], right: dict[str, Any], tolerance_ml: float = 1) -> bool:
    return abs(float(left["amountMl"]) - float(right["amountMl"])) <= tolerance_ml


def ocr_number_to_float(value: str) -> float:
    normalized = (
        str(value)
        .upper()
        .replace("I", "1")
        .replace("L", "1")
        .replace("|", "1")
        .replace("O", "0")
        .replace(",", ".")
    )
    return float(normalized)


def significant_tokens(text: str) -> list[str]:
    ignored = {"A", "AN", "AND", "BY", "FOR", "OF", "THE", "WITH"}
    return [token for token in tokenize_for_match(text) if len(token) > 1 and token not in ignored]


def minimum_token_score(token: str) -> float:
    if len(token) <= 3:
        return 0.85
    if len(token) <= 5:
        return 0.72
    return 0.68


def best_window_similarity(needle: str, haystack: str, *, slack: int = 2) -> dict[str, Any]:
    needle_tokens = tokenize_for_match(needle)
    haystack_tokens = tokenize_for_match(haystack)
    if not needle_tokens or not haystack_tokens:
        return {"score": 0.0, "text": ""}
    normalized_needle = " ".join(needle_tokens)
    normalized_haystack = " ".join(haystack_tokens)
    if normalized_needle in normalized_haystack:
        return {"score": 1.0, "text": needle}
    best = {"score": 0.0, "text": ""}
    min_size = max(1, len(needle_tokens) - slack)
    max_size = min(len(haystack_tokens), len(needle_tokens) + slack)
    for start in range(len(haystack_tokens)):
        for size in range(min_size, max_size + 1):
            window_tokens = haystack_tokens[start : start + size]
            if len(window_tokens) < min_size:
                continue
            candidate = " ".join(window_tokens)
            score = similarity_score(normalized_needle, candidate)
            if score > best["score"]:
                best = {"score": score, "text": candidate}
    return best


def similarity_score(left_value: str, right_value: str) -> float:
    left = normalize_for_fuzzy_match(left_value)
    right = normalize_for_fuzzy_match(right_value)
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return min(0.98, min(len(left), len(right)) / max(len(left), len(right)) + 0.12)
    distance = levenshtein_distance(left, right)
    return max(0.0, 1 - distance / max(len(left), len(right)))


def levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, start=1):
        current = [i]
        for j, right_char in enumerate(right, start=1):
            current.append(min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left_char != right_char)))
        previous = current
    return previous[-1]


def tokenize_for_match(text: str) -> list[str]:
    return [token for token in normalize_for_fuzzy_match(text).split(" ") if token]


def normalize_for_fuzzy_match(text: str) -> str:
    return normalize_whitespace(remove_decorative_punctuation(normalize_case(text)))


def normalize_for_strict_warning(text: str) -> str:
    value = normalize_quotes(str(text)).replace("\u00a0", " ")
    value = re.sub(r"[^A-Za-z0-9().,:;'%/ -]+", " ", value)
    return normalize_whitespace(value.upper())


def warning_text_score(text: str) -> int:
    normalized = normalize_for_strict_warning(text)
    if not normalized:
        return 0
    return sum(1 for segment in REQUIRED_WARNING_SEGMENTS if normalize_for_strict_warning(segment) in normalized)


def remove_decorative_punctuation(text: str) -> str:
    value = normalize_quotes(text)
    value = re.sub(r"([A-Za-z0-9])\?([A-Za-z0-9])", r"\1\2", value)
    value = re.sub(r"[^A-Za-z0-9%./&+ -]+", " ", value)
    value = re.sub(r"[._:;,()[\]{}\"']", " ", value)
    value = re.sub(r"[-/]", " ", value)
    return value


def has_embedded_ambiguous_glyph(text: str) -> bool:
    return re.search(r"[A-Za-z0-9]\?[A-Za-z0-9]", normalize_case(text)) is not None


def normalize_quotes(text: str) -> str:
    return (
        str(text)
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201a", "'")
        .replace("\u201b", "'")
        .replace("\u2032", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u201e", '"')
        .replace("\u201f", '"')
        .replace("\u2033", '"')
    )


def normalize_case(text: str) -> str:
    return str(text).upper()


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def split_lines(text: str) -> list[str]:
    return [normalize_whitespace(line) for line in str(text).splitlines() if normalize_whitespace(line)]


def clamp_confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return None
