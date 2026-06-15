from __future__ import annotations

import importlib.util
import os
import platform
import shutil
import socket
import sys
from pathlib import Path
from time import monotonic
from typing import Any

import httpx


def probe_capabilities(coordinator_url: str, data_dir: Path) -> dict[str, Any]:
    data_dir.mkdir(parents=True, exist_ok=True)
    accelerators = probe_accelerators()
    ocr = probe_ocr_dependencies()
    return {
        "hostname": socket.gethostname(),
        "platform": platform.system().lower(),
        "platformRelease": platform.release(),
        "arch": platform.machine() or "unknown",
        "pythonVersion": platform.python_version(),
        "cpuCount": os.cpu_count() or 1,
        "memory": probe_memory(),
        "disk": probe_disk(data_dir),
        "network": probe_network(coordinator_url),
        "accelerators": accelerators,
        "ocr": ocr,
        "engineProfile": engine_profile(accelerators, ocr),
        "modelCacheBytes": directory_size(data_dir / "models"),
        "supportedImageFormats": supported_image_formats(),
    }


def probe_memory() -> dict[str, int | None]:
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        values: dict[str, int] = {}
        for line in meminfo.read_text(encoding="utf-8").splitlines():
            key, _, rest = line.partition(":")
            parts = rest.strip().split()
            if parts and parts[0].isdigit():
                values[key] = int(parts[0]) * 1024
        return {"totalBytes": values.get("MemTotal"), "availableBytes": values.get("MemAvailable")}
    if hasattr(os, "sysconf"):
        try:
            page_size = os.sysconf("SC_PAGE_SIZE")
            page_count = os.sysconf("SC_PHYS_PAGES")
            available_pages = os.sysconf("SC_AVPHYS_PAGES")
            return {
                "totalBytes": int(page_size * page_count),
                "availableBytes": int(page_size * available_pages),
            }
        except (OSError, ValueError):
            pass
    return {"totalBytes": None, "availableBytes": None}


def probe_disk(data_dir: Path) -> dict[str, float | str | None]:
    probe_file = data_dir / ".disk-probe.bin"
    payload = b"0" * (1024 * 1024)
    try:
        started = monotonic()
        probe_file.write_bytes(payload)
        write_ms = max((monotonic() - started) * 1000, 0.001)
        started = monotonic()
        read_size = len(probe_file.read_bytes())
        read_ms = max((monotonic() - started) * 1000, 0.001)
        usage = shutil.disk_usage(data_dir)
        return {
            "path": str(data_dir),
            "writeBytesPerSecond": len(payload) / (write_ms / 1000),
            "readBytesPerSecond": read_size / (read_ms / 1000),
            "freeBytes": usage.free,
            "totalBytes": usage.total,
        }
    except Exception as error:
        return {"path": str(data_dir), "error": str(error)}
    finally:
        try:
            probe_file.unlink()
        except FileNotFoundError:
            pass


def probe_network(coordinator_url: str) -> dict[str, float | int | str | None]:
    health_url = coordinator_url.rstrip("/") + "/api/health"
    try:
        started = monotonic()
        response = httpx.get(health_url, timeout=2.0)
        elapsed = max((monotonic() - started) * 1000, 0.001)
        response.raise_for_status()
        byte_count = len(response.content)
        return {
            "latencyMs": elapsed,
            "downloadBytesPerSecond": byte_count / (elapsed / 1000),
            "uploadBytesPerSecond": None,
            "uploadProbe": "not_measured_without_upload_endpoint",
            "status": "ok",
        }
    except Exception as error:
        return {
            "latencyMs": None,
            "downloadBytesPerSecond": None,
            "uploadBytesPerSecond": None,
            "status": "unreachable",
            "error": str(error),
        }


def probe_accelerators() -> dict[str, Any]:
    accelerators: dict[str, Any] = {
        "cuda": {"available": False, "devices": []},
        "appleMps": {"available": False},
    }
    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
        devices = []
        if cuda_available:
            for index in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(index)
                devices.append({"index": index, "name": props.name, "vramBytes": props.total_memory})
        accelerators["cuda"] = {"available": cuda_available, "devices": devices}
        accelerators["appleMps"] = {
            "available": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
        }
    except Exception:
        pass
    try:
        import paddle

        paddle_cuda_available = bool(
            getattr(paddle.device, "is_compiled_with_cuda", lambda: False)()
            and getattr(paddle.device.cuda, "device_count", lambda: 0)()
        )
        if paddle_cuda_available and not accelerators["cuda"]["available"]:
            devices = []
            for index in range(paddle.device.cuda.device_count()):
                try:
                    name = paddle.device.cuda.get_device_name(index)
                except Exception:
                    name = f"cuda:{index}"
                devices.append({"index": index, "name": name, "vramBytes": None, "source": "paddle"})
            accelerators["cuda"] = {"available": True, "devices": devices}
    except Exception:
        pass
    return accelerators


def probe_ocr_dependencies() -> dict[str, Any]:
    try:
        from .engines.paddleocr_engine import resolve_model_config
        from .extraction.model_status import layoutlmv3_model_status

        paddle_model = resolve_model_config()
        paddle_model_info = {
            "customModel": paddle_model.custom,
            "customRecognition": paddle_model.custom_recognition,
            "modelRoot": str(paddle_model.root) if paddle_model.root else None,
            "requireCustom": paddle_model.require_custom,
            "modelDirs": paddle_model.kwargs,
        }
        field_extractor = layoutlmv3_model_status()
    except Exception as error:
        paddle_model_info = {"customModel": False, "customRecognition": False, "error": str(error)}
        field_extractor = {"status": "unavailable", "trainedModelLoaded": False, "error": str(error)}
    return {
        "paddleocr": {"available": importlib.util.find_spec("paddleocr") is not None, **paddle_model_info},
        "fieldExtractor": field_extractor,
    }


def engine_profile(accelerators: dict[str, Any], ocr: dict[str, Any]) -> dict[str, Any]:
    cuda = bool((accelerators.get("cuda") or {}).get("available"))
    mps = bool((accelerators.get("appleMps") or {}).get("available"))
    paddle = bool((ocr.get("paddleocr") or {}).get("available"))
    paddle_custom = bool((ocr.get("paddleocr") or {}).get("customRecognition") or (ocr.get("paddleocr") or {}).get("customModel"))
    field_extractor_trained = bool((ocr.get("fieldExtractor") or {}).get("trainedModelLoaded"))
    if paddle and paddle_custom and cuda:
        tier = "custom_paddleocr_cuda"
        preferred = "paddleocr"
    elif paddle and paddle_custom:
        tier = "custom_paddleocr_cpu"
        preferred = "paddleocr"
    elif paddle and cuda:
        tier = "paddleocr_cuda_pretrained"
        preferred = "paddleocr"
    elif paddle:
        tier = "paddleocr_cpu_pretrained"
        preferred = "paddleocr"
    else:
        tier = "paddleocr_unavailable"
        preferred = "paddleocr"
    return {
        "tier": tier,
        "preferredEngine": preferred,
        "cuda": cuda,
        "appleMps": mps,
        "paddleocr": paddle,
        "paddleocrCustom": paddle_custom,
        "fieldExtractorTrained": field_extractor_trained,
        "fieldExtractorMode": (ocr.get("fieldExtractor") or {}).get("mode"),
    }


def supported_image_formats() -> list[str]:
    try:
        from PIL import Image

        Image.init()
        return sorted(format_name.lower() for format_name in Image.OPEN)
    except Exception:
        return ["jpeg", "jpg", "png", "webp"]


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for file_path in path.rglob("*"):
        if file_path.is_file():
            try:
                total += file_path.stat().st_size
            except OSError:
                continue
    return total


def platform_for_registration(capabilities: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(capabilities.get("hostname") or socket.gethostname()),
        str(capabilities.get("platform") or sys.platform),
        str(capabilities.get("arch") or platform.machine() or "unknown"),
    )
