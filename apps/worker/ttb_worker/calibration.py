from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from time import monotonic
from typing import Any

from .engines.base import OcrEngine


CALIBRATION_VERSION = 1


def load_calibration(data_dir: Path) -> dict[str, Any] | None:
    path = calibration_path(data_dir)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_calibration(data_dir: Path, calibration: dict[str, Any]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    calibration_path(data_dir).write_text(json.dumps(calibration, indent=2, sort_keys=True), encoding="utf-8")


def calibrate_engines(engines: list[OcrEngine], data_dir: Path, capabilities: dict[str, Any]) -> dict[str, Any]:
    image_bytes = calibration_image_bytes()
    payload = {
        "fixture_ocr_text": "HOLLOW RIDGE\nBOURBON WHISKEY\n45% ALC/VOL\n750 ML\nGOVERNMENT WARNING",
        "expected_fields": {
            "brandName": "Hollow Ridge",
            "classType": "Bourbon Whiskey",
            "alcoholContent": "45% alc/vol",
            "netContents": "750 mL",
            "governmentWarningRequired": True,
        },
    }
    results: dict[str, Any] = {
        "version": CALIBRATION_VERSION,
        "engines": {},
    }
    for engine in engines:
        health = engine.healthcheck()
        engine_result: dict[str, Any] = {
            "available": health.available,
            "status": health.status,
            "detail": health.detail,
            "version": health.version,
        }
        if health.available:
            try:
                warmup_started = monotonic()
                engine.warmup()
                warmup_ms = int((monotonic() - warmup_started) * 1000)
                first = engine.recognize(image_bytes, {"payload": payload, "capabilities": capabilities})
                second_started = monotonic()
                second = engine.recognize(image_bytes, {"payload": payload, "capabilities": capabilities})
                steady_state_ms = int((monotonic() - second_started) * 1000)
                chars_per_second = len(second.text) / max(second.elapsed_ms / 1000, 0.001)
                engine_result.update(
                    {
                        "warmupMs": warmup_ms,
                        "firstRunMs": first.elapsed_ms,
                        "steadyStateMs": steady_state_ms,
                        "charsPerSecond": chars_per_second,
                        "confidence": second.confidence,
                    }
                )
            except Exception as error:
                engine_result.update({"available": False, "status": "calibration_failed", "detail": str(error)})
        results["engines"][engine.id] = engine_result
    save_calibration(data_dir, results)
    return results


def calibration_path(data_dir: Path) -> Path:
    return data_dir / "calibration.json"


def calibration_image_bytes() -> bytes:
    try:
        from PIL import Image, ImageDraw
        from io import BytesIO

        image = Image.new("RGB", (640, 240), color="white")
        draw = ImageDraw.Draw(image)
        draw.text((24, 24), "HOLLOW RIDGE", fill="black")
        draw.text((24, 72), "BOURBON WHISKEY", fill="black")
        draw.text((24, 120), "45% ALC/VOL 750 ML", fill="black")
        draw.text((24, 168), "GOVERNMENT WARNING", fill="black")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()
    except Exception:
        return b"\x89PNG\r\n\x1a\nworker-calibration"
