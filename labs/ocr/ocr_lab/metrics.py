from __future__ import annotations

from difflib import SequenceMatcher
import re
from typing import Any


TOKEN_RE = re.compile(r"[A-Z0-9%]+")


def normalize_text(text: str) -> str:
    expanded = re.sub(r"(?<=\d)(?=[A-Z%])|(?<=[A-Z%])(?=\d)", " ", text.upper())
    return " ".join(TOKEN_RE.findall(expanded))


def tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(normalize_text(text))


def similarity(left: str, right: str) -> float:
    left_norm = normalize_text(left)
    right_norm = normalize_text(right)
    if not left_norm and not right_norm:
        return 1.0
    if not left_norm or not right_norm:
        return 0.0
    if left_norm in right_norm or right_norm in left_norm:
        return min(1.0, min(len(left_norm), len(right_norm)) / max(len(left_norm), len(right_norm)) + 0.15)
    return SequenceMatcher(None, left_norm, right_norm).ratio()


def token_coverage(expected: str, observed: str) -> float:
    expected_tokens = [token for token in tokens(expected) if len(token) > 1]
    observed_tokens = tokens(observed)
    if not expected_tokens:
        return 1.0
    if not observed_tokens:
        return 0.0

    matched = 0
    for expected_token in expected_tokens:
        threshold = 0.86 if len(expected_token) <= 3 else 0.72
        best = max(similarity(expected_token, observed_token) for observed_token in observed_tokens)
        if best >= threshold:
            matched += 1
    return matched / len(expected_tokens)


def best_window_similarity(expected: str, observed: str, slack: int = 3) -> float:
    expected_tokens = tokens(expected)
    observed_tokens = tokens(observed)
    if not expected_tokens or not observed_tokens:
        return 0.0

    expected_len = len(expected_tokens)
    best = 0.0
    min_size = max(1, expected_len - slack)
    max_size = min(len(observed_tokens), expected_len + slack)
    for start in range(len(observed_tokens)):
        for size in range(min_size, max_size + 1):
            window = " ".join(observed_tokens[start : start + size])
            if window:
                best = max(best, similarity(expected, window))
    return best


def score_fields(expected_fields: dict[str, str], observed_text: str) -> dict[str, Any]:
    field_scores = {}
    for field, expected in expected_fields.items():
        coverage = token_coverage(expected, observed_text)
        phrase = best_window_similarity(expected, observed_text)
        field_scores[field] = {
            "token_coverage": round(coverage, 4),
            "phrase_similarity": round(phrase, 4),
            "score": round((coverage * 0.65) + (phrase * 0.35), 4),
        }

    if not field_scores:
        mean_score = 0.0
    else:
        mean_score = sum(item["score"] for item in field_scores.values()) / len(field_scores)

    return {
        "score": round(mean_score, 4),
        "field_scores": field_scores,
        "char_count": len(observed_text),
        "token_count": len(tokens(observed_text)),
    }
