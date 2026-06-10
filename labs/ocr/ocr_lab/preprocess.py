from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps


@dataclass(frozen=True)
class Variant:
    variant_id: str
    label: str
    image: Image.Image
    source_box: tuple[int, int, int, int] | None = None
    source_size: tuple[int, int] | None = None


def _crop_fraction_box(image: Image.Image, x: float, y: float, width: float, height: float) -> tuple[int, int, int, int]:
    w, h = image.size
    left = max(0, min(w - 1, round(x * w)))
    top = max(0, min(h - 1, round(y * h)))
    right = max(left + 1, min(w, left + round(width * w)))
    bottom = max(top + 1, min(h, top + round(height * h)))
    return left, top, right, bottom


def _crop_fraction(image: Image.Image, x: float, y: float, width: float, height: float) -> Image.Image:
    left, top, right, bottom = _crop_fraction_box(image, x, y, width, height)
    return image.crop((left, top, right, bottom))


def _target_width(image: Image.Image, target_width: int) -> Image.Image:
    width, height = image.size
    if width == target_width:
        return image
    scale = target_width / width
    return image.resize((target_width, max(1, round(height * scale))), Image.Resampling.LANCZOS)


def _gray_contrast(image: Image.Image, target_width: int, invert: bool = False, sharpen: float = 1.0) -> Image.Image:
    result = _target_width(image, target_width).convert("L")
    result = ImageOps.autocontrast(result, cutoff=1)
    if invert:
        result = ImageOps.invert(result)
    if sharpen:
        result = result.filter(ImageFilter.UnsharpMask(radius=1.2, percent=int(120 * sharpen), threshold=2))
    return result.convert("RGB")


def _adaptive_threshold(image: Image.Image, target_width: int) -> Image.Image:
    gray = np.array(_target_width(image, target_width).convert("L"))
    thresholded = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        7,
    )
    return Image.fromarray(thresholded).convert("RGB")


def make_variants(path: Path, preset: str = "core") -> list[Variant]:
    source = Image.open(path).convert("RGB")
    source_size = source.size
    full_source_box = (0, 0, source.width, source.height)
    if preset == "native":
        return [Variant("native", "Original image", source, full_source_box, source_size)]

    leading_variants = []
    if preset == "targeted":
        leading_variants.append(Variant("native", "Original image", source, full_source_box, source_size))

    label_wide_box = _crop_fraction_box(source, 0.08, 0.02, 0.84, 0.96)
    center_label_box = _crop_fraction_box(source, 0.18, 0.03, 0.66, 0.92)
    upper_label_box = _crop_fraction_box(source, 0.18, 0.03, 0.66, 0.48)
    lower_label_box = _crop_fraction_box(source, 0.18, 0.55, 0.68, 0.31)
    warning_band_box = _crop_fraction_box(source, 0.16, 0.50, 0.72, 0.32)
    upper_band_wide_box = _crop_fraction_box(source, 0.08, 0.00, 0.84, 0.38)
    middle_band_wide_box = _crop_fraction_box(source, 0.08, 0.28, 0.84, 0.42)
    lower_band_wide_box = _crop_fraction_box(source, 0.08, 0.58, 0.84, 0.36)
    left_overlap_box = _crop_fraction_box(source, 0.00, 0.05, 0.58, 0.90)
    right_overlap_box = _crop_fraction_box(source, 0.42, 0.05, 0.58, 0.90)
    upper_left_tile_box = _crop_fraction_box(source, 0.00, 0.00, 0.58, 0.58)
    upper_right_tile_box = _crop_fraction_box(source, 0.42, 0.00, 0.58, 0.58)
    lower_left_tile_box = _crop_fraction_box(source, 0.00, 0.42, 0.58, 0.58)
    lower_right_tile_box = _crop_fraction_box(source, 0.42, 0.42, 0.58, 0.58)

    definitions = [
        ("full-gray", "Full image gray", source, full_source_box, 2600, False, 1.0, False),
        ("full-sparse", "Full image high contrast", source, full_source_box, 3000, False, 1.2, False),
        ("label-wide", "Wide label crop", source.crop(label_wide_box), label_wide_box, 3200, False, 1.2, False),
        ("center-label", "Central label crop", source.crop(center_label_box), center_label_box, 2600, False, 1.2, False),
        ("upper-label", "Upper label crop", source.crop(upper_label_box), upper_label_box, 2600, False, 1.2, False),
        ("lower-label", "Lower label crop", source.crop(lower_label_box), lower_label_box, 3600, False, 1.4, False),
        ("lower-inverted", "Lower label inverted crop", source.crop(lower_label_box), lower_label_box, 3600, True, 1.4, False),
        ("warning-band", "Warning/detail band crop", source.crop(warning_band_box), warning_band_box, 3200, False, 1.2, False),
        ("upper-band-wide", "Upper wide band", source.crop(upper_band_wide_box), upper_band_wide_box, 3200, False, 1.2, False),
        ("middle-band-wide", "Middle wide band", source.crop(middle_band_wide_box), middle_band_wide_box, 3400, False, 1.25, False),
        ("lower-band-wide", "Lower wide band", source.crop(lower_band_wide_box), lower_band_wide_box, 3600, False, 1.35, False),
        ("left-overlap", "Left overlap tile", source.crop(left_overlap_box), left_overlap_box, 2800, False, 1.15, False),
        ("right-overlap", "Right overlap tile", source.crop(right_overlap_box), right_overlap_box, 2800, False, 1.15, False),
        ("upper-left-tile", "Upper left tile", source.crop(upper_left_tile_box), upper_left_tile_box, 2800, False, 1.15, False),
        ("upper-right-tile", "Upper right tile", source.crop(upper_right_tile_box), upper_right_tile_box, 2800, False, 1.15, False),
        ("lower-left-tile", "Lower left tile", source.crop(lower_left_tile_box), lower_left_tile_box, 3200, False, 1.2, False),
        ("lower-right-tile", "Lower right tile", source.crop(lower_right_tile_box), lower_right_tile_box, 3200, False, 1.2, False),
        ("adaptive-threshold", "Adaptive threshold", source, full_source_box, 2800, False, 0.0, True),
    ]

    if preset == "minimal":
        definitions = [definitions[0]]
    elif preset == "detail":
        definitions = [definitions[index] for index in [5, 6, 7]]
    elif preset == "targeted":
        definitions = [definitions[index] for index in [5, 6, 7]]
    elif preset == "core":
        definitions = [definitions[index] for index in [0, 3, 5, 6, 7]]
    elif preset == "multiscale":
        definitions = [definitions[index] for index in [0, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]]
    elif preset != "wide":
        raise ValueError(f"Unknown variant preset: {preset}")

    variants: list[Variant] = list(leading_variants)
    for variant_id, label, image, source_box, target_width, invert, sharpen, threshold in definitions:
        processed = _adaptive_threshold(image, target_width) if threshold else _gray_contrast(image, target_width, invert, sharpen)
        variants.append(Variant(variant_id, label, processed, source_box, source_size))
    return variants
