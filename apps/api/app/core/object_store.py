from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from .fingerprints import sha256_bytes
from .security import extension_for_mime_type, sanitize_filename, validate_image_mime_type


class ObjectStore:
    def __init__(self, root: Path, max_upload_bytes: int):
        self.root = root
        self.max_upload_bytes = max_upload_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    async def store_upload(self, upload: UploadFile) -> dict:
        original_filename = sanitize_filename(upload.filename or "upload")
        mime_type = validate_image_mime_type(upload.content_type, original_filename)
        data = await upload.read()
        size = len(data)
        if size <= 0:
            raise ValueError("Uploaded image is empty.")
        if size > self.max_upload_bytes:
            raise ValueError(f"Uploaded image exceeds {self.max_upload_bytes} byte limit.")
        sha256 = sha256_bytes(data)
        suffix = extension_for_mime_type(mime_type, original_filename)
        relative_path = Path(sha256[:2]) / f"{sha256}{suffix}"
        storage_path = self.root / relative_path
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not storage_path.exists():
            storage_path.write_bytes(data)
        return {
            "sha256": sha256,
            "size_bytes": size,
            "mime_type": mime_type,
            "original_filename": original_filename,
            "storage_path": str(storage_path),
        }

