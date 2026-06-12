from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from .fingerprints import sha256_bytes
from .security import ensure_path_within_root, sanitize_filename, validate_image_upload


class ObjectStore:
    def __init__(self, root: Path, max_upload_bytes: int):
        self.root = root
        self.max_upload_bytes = max_upload_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    async def store_upload(self, upload: UploadFile) -> dict:
        original_filename = sanitize_filename(upload.filename or "upload")
        data = await upload.read()
        size = len(data)
        if size <= 0:
            raise ValueError("Uploaded image is empty.")
        if size > self.max_upload_bytes:
            raise ValueError(f"Uploaded image exceeds {self.max_upload_bytes} byte limit.")
        image = validate_image_upload(data, upload.content_type, original_filename)
        sha256 = sha256_bytes(data)
        relative_path = Path(sha256[:2]) / f"{sha256}{image.extension}"
        storage_path = ensure_path_within_root(self.root / relative_path, self.root)
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        if not storage_path.exists():
            storage_path.write_bytes(data)
        return {
            "sha256": sha256,
            "size_bytes": size,
            "mime_type": image.mime_type,
            "original_filename": original_filename,
            "storage_path": str(storage_path),
            "width": image.width,
            "height": image.height,
        }
