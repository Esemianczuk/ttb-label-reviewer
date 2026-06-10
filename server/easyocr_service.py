#!/usr/bin/env python3
from __future__ import annotations

import cgi
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "labs" / "ocr"))

from ocr_lab.preprocess import make_variants  # noqa: E402

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_VARIANT_SET = "fast"
DEFAULT_GPU_MODE = "cpu"

reader = None
reader_lock = threading.Lock()
reader_gpu = False


def json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def response_headers(handler: BaseHTTPRequestHandler, status: int, content_type: str = "application/json") -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()


def resolve_gpu() -> bool:
    configured = os.environ.get("EASYOCR_GPU", DEFAULT_GPU_MODE).strip().lower()
    if configured in {"0", "false", "no", "cpu"}:
        return False
    if configured in {"1", "true", "yes", "cuda", "gpu"}:
        return torch.cuda.is_available()
    if configured == "auto":
        return torch.cuda.is_available()
    return False


def gpu_mode() -> str:
    return os.environ.get("EASYOCR_GPU", DEFAULT_GPU_MODE).strip().lower() or DEFAULT_GPU_MODE


def effective_variant_set(requested_variant_set: str) -> str:
    requested = (requested_variant_set or DEFAULT_VARIANT_SET).strip().lower()
    if requested == "fast":
        return "targeted" if reader_gpu else "native"
    return requested


def get_reader():
    global reader, reader_gpu
    with reader_lock:
        if reader is None:
            import easyocr

            reader_gpu = resolve_gpu()
            reader = easyocr.Reader(["en"], gpu=reader_gpu, verbose=False)
        return reader


def useful_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if any(character.isalnum() for character in line)]


def score_text(text: str) -> int:
    normalized = text.upper()
    keywords = [
        "GOVERNMENT",
        "WARNING",
        "SURGEON",
        "PREGNANCY",
        "BIRTH",
        "DEFECT",
        "CONSUMPTION",
        "ALCOHOL",
        "BEVERAGE",
        "MACHINERY",
        "HEALTH",
        "PROOF",
        "ALC",
        "VOL",
        "ML",
        "TEQUILA",
        "CUERVO",
        "ESPECIAL",
        "AGAVE",
        "BOURBON",
        "WHISKEY",
        "DISTILL",
        "MEXICO",
        "UNITED",
    ]
    keyword_matches = sum(1 for keyword in keywords if keyword in normalized)
    alphanumeric_count = sum(1 for character in normalized if character.isalnum())
    return (keyword_matches * 80) + min(alphanumeric_count, 900)


def bbox_from_easyocr(points: list[list[float]]) -> dict[str, float] | None:
    if not points:
        return None
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    left = min(xs)
    top = min(ys)
    return {
        "x": round(left, 2),
        "y": round(top, 2),
        "width": round(max(xs) - left, 2),
        "height": round(max(ys) - top, 2),
    }


def source_bbox_from_variant(variant, bbox: dict[str, float] | None) -> dict[str, float] | None:
    if not bbox or not variant.source_box:
        return bbox
    left, top, right, bottom = variant.source_box
    variant_width, variant_height = variant.image.size
    if not variant_width or not variant_height:
        return bbox
    x_scale = (right - left) / variant_width
    y_scale = (bottom - top) / variant_height
    return {
        "x": round(left + (bbox["x"] * x_scale), 2),
        "y": round(top + (bbox["y"] * y_scale), 2),
        "width": round(bbox["width"] * x_scale, 2),
        "height": round(bbox["height"] * y_scale, 2),
    }


def merge_variant_texts(variant_results: list[dict[str, Any]]) -> str:
    seen = set()
    lines: list[str] = []
    for variant in sorted(variant_results, key=lambda item: item["score"], reverse=True):
        for line in useful_lines(variant["rawText"]):
            key = "".join(character if character.isalnum() else " " for character in line.upper())
            key = " ".join(key.split())
            if not key or key in seen:
                continue
            seen.add(key)
            lines.append(line)
    return "\n".join(lines)


def recognize_image(image_path: Path, variant_set: str) -> dict[str, Any]:
    engine = get_reader()
    actual_variant_set = effective_variant_set(variant_set)
    started = time.perf_counter()
    variant_results = []
    blocks = []

    with reader_lock:
        for variant in make_variants(image_path, actual_variant_set):
            rows = engine.readtext(np.array(variant.image), detail=1, paragraph=False)
            lines = []
            for row in rows:
                if len(row) < 2:
                    continue
                text = str(row[1]).strip()
                if not text:
                    continue
                confidence = float(row[2]) if len(row) >= 3 else None
                variant_bbox = bbox_from_easyocr(row[0] if row else [])
                source_bbox = source_bbox_from_variant(variant, variant_bbox)
                lines.append(text)
                blocks.append(
                    {
                        "text": text,
                        "confidence": confidence,
                        "bbox": source_bbox,
                        "variantBbox": variant_bbox,
                        "variantId": variant.variant_id,
                    }
                )

            raw_text = "\n".join(lines)
            variant_results.append(
                {
                    "id": variant.variant_id,
                    "label": variant.label,
                    "rawText": raw_text,
                    "score": score_text(raw_text),
                    "textLength": len(raw_text.strip()),
                    "lineCount": len(lines),
                    "sourceBox": variant.source_box,
                    "sourceSize": variant.source_size,
                    "variantSize": variant.image.size,
                }
            )

    raw_text = merge_variant_texts(variant_results)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
        "engine": "easyocr-local",
        "variantSet": actual_variant_set,
        "requestedVariantSet": variant_set,
        "rawText": raw_text,
        "blocks": blocks,
        "imageSize": variant.source_size if variant_results else None,
        "processingTimeMs": elapsed_ms,
        "preprocessingNotes": [
            f"EasyOCR local service used {actual_variant_set} crop variants",
            f"Requested variant set: {variant_set}",
            f"Acceleration: {'CUDA' if reader_gpu else 'CPU'}",
        ],
        "warnings": [] if raw_text.strip() else ["EasyOCR returned no text for this image."],
        "variants": variant_results,
    }


class EasyOcrHandler(BaseHTTPRequestHandler):
    server_version = "EasyOCRLocal/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), format % args))

    def do_OPTIONS(self) -> None:
        response_headers(self, 204)

    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            response_headers(self, 200)
            payload = {
                "ok": True,
                "engine": "easyocr-local",
                "readerLoaded": reader is not None,
                "gpuAvailable": torch.cuda.is_available(),
                "gpuEnabled": reader_gpu,
                "gpuMode": gpu_mode(),
                "defaultVariantSet": os.environ.get("EASYOCR_VARIANT_SET", DEFAULT_VARIANT_SET),
            }
            self.wfile.write(json_bytes(payload))
            return

        response_headers(self, 404)
        self.wfile.write(json_bytes({"error": "Not found"}))

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/ocr":
            response_headers(self, 404)
            self.wfile.write(json_bytes({"error": "Not found"}))
            return

        try:
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data"):
                raise ValueError("Expected multipart/form-data with an image field.")

            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": content_type,
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            image_field = form["image"] if "image" in form else None
            if image_field is None or not getattr(image_field, "file", None):
                raise ValueError("Missing image upload.")

            variant_set = form.getfirst("variant_set", os.environ.get("EASYOCR_VARIANT_SET", DEFAULT_VARIANT_SET))
            suffix = Path(getattr(image_field, "filename", "") or "label-image.jpg").suffix or ".jpg"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_path = Path(temp_file.name)
                temp_file.write(image_field.file.read())

            try:
                result = recognize_image(temp_path, variant_set)
            finally:
                temp_path.unlink(missing_ok=True)

            response_headers(self, 200)
            self.wfile.write(json_bytes(result))
        except Exception as exc:
            response_headers(self, 500)
            self.wfile.write(json_bytes({"error": f"{type(exc).__name__}: {exc}"}))


def main() -> int:
    host = os.environ.get("EASYOCR_HOST", DEFAULT_HOST)
    port = int(os.environ.get("EASYOCR_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), EasyOcrHandler)
    print(f"EasyOCR service listening on http://{host}:{port}")
    print(f"Variant set: {os.environ.get('EASYOCR_VARIANT_SET', DEFAULT_VARIANT_SET)}")
    print(f"Acceleration request: {gpu_mode()}")
    print("Model loads on first OCR request.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
