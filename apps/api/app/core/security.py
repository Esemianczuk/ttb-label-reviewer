from __future__ import annotations

import mimetypes
import re
from pathlib import Path

ALLOWED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def sanitize_filename(filename: str) -> str:
    name = Path(filename or "upload").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return name or "upload"


def validate_image_mime_type(mime_type: str | None, filename: str = "") -> str:
    guessed = mime_type or mimetypes.guess_type(filename)[0] or ""
    normalized = guessed.lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    if normalized not in ALLOWED_IMAGE_MIME_TYPES:
        raise ValueError(f"Unsupported image MIME type: {mime_type or 'unknown'}")
    return normalized


def extension_for_mime_type(mime_type: str, fallback_name: str = "") -> str:
    if mime_type == "image/png":
        return ".png"
    if mime_type in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if mime_type == "image/webp":
        return ".webp"
    suffix = Path(fallback_name).suffix.lower()
    return suffix if suffix in {".png", ".jpg", ".jpeg", ".webp"} else ".bin"

