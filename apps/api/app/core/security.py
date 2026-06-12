from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import mimetypes
import re
from pathlib import Path

from PIL import Image, UnidentifiedImageError

ALLOWED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass(frozen=True)
class ValidatedImage:
    mime_type: str
    extension: str
    width: int
    height: int


def sanitize_filename(filename: str) -> str:
    name = Path(filename or "upload").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return name or "upload"


def normalize_image_mime_type(mime_type: str | None) -> str | None:
    if not mime_type:
        return None
    normalized = mime_type.split(";", 1)[0].strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    return normalized


def validate_image_mime_type(mime_type: str | None, filename: str = "") -> str:
    guessed = normalize_image_mime_type(mime_type) or normalize_image_mime_type(mimetypes.guess_type(filename)[0]) or ""
    if guessed not in ALLOWED_IMAGE_MIME_TYPES:
        raise ValueError(f"Unsupported image MIME type: {mime_type or 'unknown'}")
    return guessed


def validate_image_upload(data: bytes, declared_mime_type: str | None, filename: str) -> ValidatedImage:
    declared = normalize_image_mime_type(declared_mime_type)
    if declared and declared not in ALLOWED_IMAGE_MIME_TYPES:
        raise ValueError(f"Unsupported image MIME type: {declared_mime_type or 'unknown'}")

    filename_mime = normalize_image_mime_type(mimetypes.guess_type(filename)[0])
    if filename_mime and filename_mime not in ALLOWED_IMAGE_MIME_TYPES:
        filename_mime = None

    try:
        with Image.open(BytesIO(data)) as image:
            detected = normalize_image_mime_type(Image.MIME.get(image.format or ""))
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError("Uploaded file content is not a decodable PNG, JPEG, or WebP image.") from error

    if not detected or detected not in ALLOWED_IMAGE_MIME_TYPES:
        raise ValueError("Uploaded file content is not a supported PNG, JPEG, or WebP image.")
    if width <= 0 or height <= 0:
        raise ValueError("Uploaded image dimensions are invalid.")
    if declared and declared != detected:
        raise ValueError(f"Declared MIME type {declared} does not match detected image type {detected}.")
    if filename_mime and filename_mime != detected:
        raise ValueError(f"File extension does not match detected image type {detected}.")

    return ValidatedImage(mime_type=detected, extension=extension_for_mime_type(detected), width=width, height=height)


def ensure_path_within_root(path: Path | str, root: Path | str) -> Path:
    resolved_root = Path(root).resolve()
    resolved_path = Path(path).resolve()
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError("Storage path is outside the configured asset root.") from error
    return resolved_path


def safe_unlink_asset_path(storage_path: str | None, asset_root: Path) -> bool:
    if not storage_path or storage_path.startswith("purged:"):
        return False
    try:
        path = ensure_path_within_root(storage_path, asset_root)
    except ValueError:
        return False
    try:
        if path.exists():
            path.unlink()
    except OSError:
        return False
    return True


def extension_for_mime_type(mime_type: str, fallback_name: str = "") -> str:
    if mime_type == "image/png":
        return ".png"
    if mime_type == "image/jpeg":
        return ".jpg"
    if mime_type == "image/webp":
        return ".webp"
    suffix = Path(fallback_name).suffix.lower()
    return suffix if suffix in {".png", ".jpg", ".jpeg", ".webp"} else ".bin"
