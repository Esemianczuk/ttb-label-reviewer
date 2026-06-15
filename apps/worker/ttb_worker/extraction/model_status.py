from __future__ import annotations

from typing import Any


def paddleocr_field_extractor_status() -> dict[str, Any]:
    """Report the active backend field extraction policy.

    The hardened demo uses PaddleOCR full-image recognition followed by
    conservative field alignment. The validators, not the OCR/extractor, remain
    the authority for pass/fail decisions.
    """

    return {
        "id": "paddleocr-field-alignment",
        "status": "active",
        "trainedModelLoaded": False,
        "mode": "paddleocr-weak-field-alignment",
        "modelDir": None,
        "message": (
            "Backend review uses PaddleOCR full-image OCR, then aligns expected fields "
            "to OCR token spans for evidence crops. Browser Tesseract is used only if "
            "the backend is unavailable."
        ),
        "modelCard": {
            "name": "PaddleOCR full-image field alignment",
            "runtimePolicy": "PaddleOCR recognition plus deterministic validators",
        },
        "metrics": None,
        "failureReport": None,
    }
