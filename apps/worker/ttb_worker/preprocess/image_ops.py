from __future__ import annotations

from io import BytesIO


def image_size(image_bytes: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        image = Image.open(BytesIO(image_bytes))
        return image.size
    except Exception:
        return None, None
