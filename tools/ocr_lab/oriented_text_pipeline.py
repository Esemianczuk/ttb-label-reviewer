#!/usr/bin/env python3
"""Extract oriented text regions and OCR comparison evidence from label images."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from tools.ttb_collector.common import normalize_space, read_json, write_json

_EASYOCR_READER: Any | None = None


def load_fixture_images(fixture_root: Path, limit: int) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = []
    for expected_path in sorted(fixture_root.glob("records/*/expected.json")):
        record_dir = expected_path.parent
        metadata_path = record_dir / "metadata.json"
        if not metadata_path.exists():
            continue
        expected = read_json(expected_path)
        if expected.get("demo_ready") is False:
            continue
        metadata = read_json(metadata_path)
        for asset in metadata.get("assets") or []:
            if not isinstance(asset, dict) or asset.get("kind") != "label_image":
                continue
            local_path = normalize_space(asset.get("local_path"))
            image_path = record_dir / local_path
            if image_path.exists():
                images.append({"recordId": record_dir.name, "path": image_path, "expected": expected})
                if limit and len(images) >= limit:
                    return images
    return images


def easyocr_reader() -> Any:
    global _EASYOCR_READER
    if _EASYOCR_READER is None:
        import easyocr

        _EASYOCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _EASYOCR_READER


def detect_with_easyocr(image: Any) -> list[dict[str, Any]]:
    import numpy as np

    reader = easyocr_reader()
    results = reader.readtext(np.array(image), detail=1, paragraph=False, rotation_info=[90, 180, 270])
    regions: list[dict[str, Any]] = []
    for index, (bbox, text, confidence) in enumerate(results):
        points = [[float(x), float(y)] for x, y in bbox]
        if len(points) != 4:
            continue
        regions.append(
            {
                "id": f"easyocr-{index + 1:04d}",
                "detector": "easyocr",
                "text": normalize_space(text),
                "confidence": float(confidence),
                "points": points,
                "angle": polygon_angle(points),
            }
        )
    return regions


def detect_with_opencv(image_path: Path, max_regions: int = 180) -> list[dict[str, Any]]:
    import cv2

    image = cv2.imread(str(image_path))
    if image is None:
        return []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    grad = cv2.morphologyEx(blurred, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    _, thresh = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 5)))
    contours, _hierarchy = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions: list[dict[str, Any]] = []
    image_area = image.shape[0] * image.shape[1]
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 80 or area > image_area * 0.4:
            continue
        rect = cv2.minAreaRect(contour)
        width, height = rect[1]
        if width < 8 or height < 8:
            continue
        aspect = max(width, height) / max(1.0, min(width, height))
        if aspect < 1.2 and area < 500:
            continue
        box = cv2.boxPoints(rect)
        points = [[float(x), float(y)] for x, y in box]
        regions.append(
            {
                "id": f"opencv-{len(regions) + 1:04d}",
                "detector": "opencv-gradient",
                "text": "",
                "confidence": None,
                "points": points,
                "angle": float(rect[2]),
                "area": float(area),
            }
        )
    regions.sort(key=lambda item: float(item.get("area") or 0), reverse=True)
    return regions[:max_regions]


def polygon_angle(points: list[list[float]]) -> float:
    ordered = order_points(points)
    dx = ordered[1][0] - ordered[0][0]
    dy = ordered[1][1] - ordered[0][1]
    return math.degrees(math.atan2(dy, dx))


def order_points(points: list[list[float]]) -> list[list[float]]:
    ordered = sorted(points, key=lambda point: (point[1], point[0]))
    top = sorted(ordered[:2], key=lambda point: point[0])
    bottom = sorted(ordered[2:], key=lambda point: point[0], reverse=True)
    return [top[0], top[1], bottom[0], bottom[1]]


def crop_region(image_path: Path, points: list[list[float]], out_path: Path) -> dict[str, Any] | None:
    import cv2
    import numpy as np

    image = cv2.imread(str(image_path))
    if image is None:
        return None
    ordered = np.array(order_points(points), dtype="float32")
    width_a = np.linalg.norm(ordered[2] - ordered[3])
    width_b = np.linalg.norm(ordered[1] - ordered[0])
    height_a = np.linalg.norm(ordered[1] - ordered[2])
    height_b = np.linalg.norm(ordered[0] - ordered[3])
    width = max(1, int(max(width_a, width_b)))
    height = max(1, int(max(height_a, height_b)))
    if width < height:
        width, height = height, width
    destination = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(ordered, destination)
    warped = cv2.warpPerspective(image, matrix, (width, height))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), warped)
    return {"path": out_path.as_posix(), "width": width, "height": height}


def ocr_crop(crop_path: Path, engines: set[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if "easyocr" in engines:
        try:
            import cv2

            image = cv2.imread(str(crop_path))
            reader = easyocr_reader()
            easy_results = reader.readtext(image, detail=1, paragraph=False)
            result["easyocr"] = {
                "text": " ".join(normalize_space(item[1]) for item in easy_results if normalize_space(item[1])),
                "confidence": sum(float(item[2]) for item in easy_results) / len(easy_results) if easy_results else 0.0,
            }
        except Exception as error:
            result["easyocr"] = {"error": str(error)}
    if "tesseract" in engines:
        try:
            from PIL import Image
            import pytesseract

            result["tesseract"] = {"text": normalize_space(pytesseract.image_to_string(Image.open(crop_path), config="--psm 7"))}
        except Exception as error:
            result["tesseract"] = {"error": str(error)}
    return result


def match_expected_fields(text: str, expected: dict[str, Any]) -> list[str]:
    upper = normalize_for_match(text)
    fields = expected.get("expected_fields") or {}
    responsible = fields.get("responsibleParty") or {}
    candidates = {
        "brandName": fields.get("brandName"),
        "classType": fields.get("classType"),
        "alcoholContent": fields.get("alcoholContent"),
        "netContents": fields.get("netContents"),
        "producerName": responsible.get("name") if isinstance(responsible, dict) else None,
        "countryOfOrigin": fields.get("countryOfOrigin"),
    }
    matches = []
    for field, value in candidates.items():
        needle = normalize_for_match(value)
        if needle and (needle in upper or any(token in upper for token in needle.split() if len(token) >= 5)):
            matches.append(field)
    if "GOVERNMENT" in upper and ("WARNING" in upper or "SURGEON" in upper or "PREGNANCY" in upper):
        matches.append("governmentWarning")
    return sorted(set(matches))


def normalize_for_match(value: Any) -> str:
    return "".join(character if character.isalnum() else " " for character in str(value or "").upper()).strip()


def process_image(item: dict[str, Any], out_dir: Path, engines: set[str], include_opencv: bool) -> list[dict[str, Any]]:
    from PIL import Image

    image_path = Path(item["path"])
    image = Image.open(image_path).convert("RGB")
    image.thumbnail((1800, 1800))
    regions = detect_with_easyocr(image)
    if include_opencv:
        regions.extend(detect_with_opencv(image_path))
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for region in regions:
        key = rounded_points_key(region["points"])
        if key in seen:
            continue
        seen.add(key)
        crop_path = out_dir / "crops" / item["recordId"] / f"{image_path.stem}-{region['id']}.jpg"
        crop = crop_region(image_path, region["points"], crop_path)
        crop_ocr = ocr_crop(crop_path, engines) if crop else {}
        text = region.get("text") or " ".join(str(value.get("text") or "") for value in crop_ocr.values() if isinstance(value, dict))
        output.append(
            {
                "recordId": item["recordId"],
                "image": image_path.as_posix(),
                "region": region,
                "crop": crop,
                "cropOcr": crop_ocr,
                "matchedFields": match_expected_fields(text, item["expected"]),
            }
        )
    return output


def rounded_points_key(points: list[list[float]]) -> str:
    return ";".join(f"{round(x / 8) * 8},{round(y / 8) * 8}" for x, y in order_points(points))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-root", type=Path, default=Path("fixtures/public-cola-registry"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/ocr-lab/oriented-text"))
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--engines", default="easyocr,tesseract")
    parser.add_argument("--opencv", action="store_true", help="Also add OpenCV gradient text-region candidates")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    engines = {engine.strip().lower() for engine in args.engines.split(",") if engine.strip()}
    items = load_fixture_images(args.fixture_root, args.limit)
    rows: list[dict[str, Any]] = []
    for item in items:
        rows.extend(process_image(item, args.out, engines, args.opencv))
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "regions.jsonl").open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=False) + "\n")
    summary = {
        "images": len(items),
        "regions": len(rows),
        "matchedRegions": sum(1 for row in rows if row["matchedFields"]),
        "engines": sorted(engines),
    }
    write_json(args.out / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
