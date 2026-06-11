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

ALCOHOL_CANDIDATE_PATTERN = re.compile(
    r"(?:\d{1,3}(?:\.\d+)?\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)?|"
    r"\d{1,3}(?:\.\d+)?\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)|"
    r"\d{2,3}(?:\.\d+)?\s*PROOF)",
    re.IGNORECASE,
)
ABV_PATTERNS = [
    re.compile(r"(\d{1,3}(?:\.\d+)?)\s*%\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)?", re.IGNORECASE),
    re.compile(r"(\d{1,3}(?:\.\d+)?)\s*(?:ALC(?:OHOL)?\.?\s*(?:BY\s*)?VOL(?:UME)?\.?|ABV)", re.IGNORECASE),
]
PROOF_PATTERN = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*PROOF", re.IGNORECASE)

NET_CONTENTS_PATTERN = re.compile(
    r"(?:\d{1,5}(?:\.\d+)?\s*M\s*L\b|"
    r"(?:7\s*/?\s*[5S]\s*[0O]|/\s*[5S]\s*[0O]|T\s*[5S]\s*[0O])\s*M?\s*L\b|"
    r"\d{1,4}(?:\.\d+)?\s*(?:L|LITER|LITRE|LITERS|LITRES)\b)",
    re.IGNORECASE,
)
ML_PATTERN = re.compile(r"(\d{1,5}(?:\.\d+)?)\s*M\s*L\b", re.IGNORECASE)
LITER_PATTERN = re.compile(r"(\d{1,4}(?:\.\d+)?)\s*(?:L|LITER|LITRE|LITERS|LITRES)\b", re.IGNORECASE)
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

    candidate = find_best_text_candidate(str(expected), ocr_result)
    token_coverage = score_expected_token_coverage(str(expected), ocr_result)
    best_evidence = token_coverage if token_coverage and (not candidate or token_coverage["score"] > candidate["score"]) else candidate

    if not best_evidence or (best_evidence["score"] < 0.45 and (not token_coverage or token_coverage["coverage"] < 0.5)):
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "Expected brand name was not found in the label text.")

    if candidate and candidate["score"] >= 0.94:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected brand name appears on the label.", candidate["evidence"], candidate["score"], candidate)

    if (candidate and candidate["score"] >= 0.7) or (token_coverage and token_coverage["coverage"] >= 0.8):
        evidence = candidate if candidate and candidate["score"] >= 0.7 else token_coverage
        reason = (
            "Expected brand tokens were found across the OCR output, but not as one clean phrase."
            if evidence["method"] == "expected-token-coverage"
            else "A close brand match was found, but OCR or spelling differences should be reviewed."
        )
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, reason, evidence.get("value") or evidence.get("evidence"), evidence["score"], evidence)

    return make_review(key, expected, STATUS_FAIL, SEVERITY_CRITICAL, "The closest detected brand text does not match the expected brand.", best_evidence.get("evidence"), best_evidence["score"], best_evidence)


def validate_class_type(expected: Any, ocr_result: dict[str, Any]) -> dict[str, Any]:
    key = "classType"
    if not expected:
        return make_review(key, expected, STATUS_WARNING, SEVERITY_WARNING, "No expected class/type was entered.")

    candidate = find_best_text_candidate(str(expected), ocr_result, slack=4)
    token_coverage = score_expected_token_coverage(str(expected), ocr_result)
    best_evidence = token_coverage if token_coverage and (not candidate or token_coverage["score"] > candidate["score"]) else candidate

    if not best_evidence or (best_evidence["score"] < 0.42 and (not token_coverage or token_coverage["coverage"] < 0.5)):
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_CRITICAL, "Expected class/type was not found in the label text.")

    if (candidate and candidate["score"] >= 0.9) or (token_coverage and token_coverage["coverage"] == 1 and token_coverage["score"] >= 0.92):
        evidence = candidate if candidate and candidate["score"] >= 0.9 else token_coverage
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, "Expected class/type appears on the label.", evidence.get("value") or evidence.get("evidence"), evidence["score"], evidence)

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
        parsed = parse_alcohol_content(candidate["evidence"])
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

    raw_text = ocr_result.get("rawText") or ""
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
    review_segments = [segment for segment in segment_results if segment["score"] >= 0.76]
    lowest = min(segment_results, key=lambda segment: segment["score"])
    evidence_text = "Government warning text detected" if "GOVERNMENT WARNING" in normalized_text else " / ".join(segment["evidence"] for segment in review_segments if segment.get("evidence"))
    evidence = {
        "text": evidence_text,
        "method": "required-segment-check",
        "confidence": min(1.0, max(0.0, len(review_segments) / len(REQUIRED_WARNING_SEGMENTS))),
    }

    if len(strong_segments) == len(REQUIRED_WARNING_SEGMENTS):
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_PASS, SEVERITY_INFO, "Required government warning text appears to be present.", evidence_text or "Required warning text appears present", min(segment["score"] for segment in segment_results), evidence)

    if len(review_segments) >= 4:
        return make_review(key, GOVERNMENT_WARNING_TEXT, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, "Warning heading and several required phrases were found, but OCR did not confidently detect the full text.", evidence_text, len(review_segments) / len(REQUIRED_WARNING_SEGMENTS), evidence)

    if "GOVERNMENT WARNING" in normalized_text:
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
    candidate = find_best_text_candidate(str(expected), ocr_result, slack=4)
    label = FIELD_LABELS[key]
    if not candidate or candidate["score"] < 0.42:
        return make_review(key, expected, STATUS_NOT_FOUND, SEVERITY_WARNING, f"{label} was entered but not found in the label text.")
    if candidate["score"] >= pass_threshold:
        return make_review(key, expected, STATUS_PASS, SEVERITY_INFO, f"{label} appears on the label.", candidate["evidence"], candidate["score"], candidate)
    if candidate["score"] >= review_threshold:
        return make_review(key, expected, STATUS_NEEDS_REVIEW, SEVERITY_WARNING, f"{label} may appear on the label, but it needs review.", candidate["evidence"], candidate["score"], candidate)
    return make_review(key, expected, STATUS_FAIL, SEVERITY_WARNING, f"{label} evidence does not match the expected value.", candidate["evidence"], candidate["score"], candidate)


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
    return {
        "rawText": "\n\n--- next label image ---\n\n".join(raw_chunks),
        "blocks": blocks,
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
    seen = set()
    candidates = []
    for candidate in [*blocks, *lines]:
        key = normalize_for_fuzzy_match(candidate["text"])
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append(candidate)
    return candidates


def find_best_text_candidate(expected_value: str, ocr_result: dict[str, Any], *, slack: int = 3) -> dict[str, Any] | None:
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
        if not best or score > best["score"]:
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
        "block": None,
        "method": "expected-token-coverage",
        "matches": matches,
    }


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
            value = float(match.group(1))
            if 0 < value <= 100:
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
    match = LITER_PATTERN.search(source)
    if match:
        return {"amountMl": float(match.group(1)) * 1000, "original": source}
    return None


def net_contents_equivalent(left: dict[str, Any], right: dict[str, Any], tolerance_ml: float = 1) -> bool:
    return abs(float(left["amountMl"]) - float(right["amountMl"])) <= tolerance_ml


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


def remove_decorative_punctuation(text: str) -> str:
    value = normalize_quotes(text)
    value = re.sub(r"[^A-Za-z0-9%./&+ -]+", " ", value)
    value = re.sub(r"[._:;,()[\]{}\"']", " ", value)
    value = re.sub(r"[-/]", " ", value)
    return value


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
