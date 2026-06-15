from __future__ import annotations

import argparse
import json
import platform
import socket
import statistics
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..validation import validate_label_packet


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_RESULTS_DIR = REPO_ROOT / "benchmarks" / "results"
PACKET_MANIFEST = REPO_ROOT / "browser-demo" / "public" / "label-packets" / "manifest.json"
PACKET_PUBLIC_ROOT = PACKET_MANIFEST.parent.parent
DEFAULT_COUNTS = (1, 10, 50)
DEFAULT_LOCAL_MODES = ("browser", "backend")
MODE_ALIASES = {"local-backend": "backend"}


def run_benchmark_suite(
    *,
    results_dir: Path = DEFAULT_RESULTS_DIR,
    modes: list[str] | tuple[str, ...] = DEFAULT_LOCAL_MODES,
    counts: list[int] | tuple[int, ...] = DEFAULT_COUNTS,
    label: str = "local benchmark",
    backend_url: str | None = None,
    workers: list[dict[str, Any]] | None = None,
    write: bool = True,
) -> dict[str, Any]:
    packets = load_packets()
    _ = backend_url
    workers = workers or []
    created_at = utc_now()
    runs = [
        run_single_benchmark(
            packets=packets,
            mode=normalize_mode(mode),
            image_count=count,
            workers=workers,
            suite_created_at=created_at,
            label=label,
        )
        for mode in modes
        for count in counts
    ]
    suite = {
        "schemaVersion": 1,
        "id": f"benchmark-suite-{created_at.replace(':', '').replace('.', '-')}-{uuid.uuid4().hex[:8]}",
        "label": label,
        "createdAt": created_at,
        "source": "fixture_ocr_python_validator",
        "counts": list(counts),
        "modes": [normalize_mode(mode) for mode in modes],
        "host": {
            "hostname": socket.gethostname(),
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "workersDetected": len(workers or []),
        "runs": runs,
        "summary": summarize_runs(runs),
    }
    if write:
        write_benchmark_suite(suite, results_dir)
    return suite


def run_single_benchmark(
    *,
    packets: list[dict[str, Any]],
    mode: str,
    image_count: int,
    workers: list[dict[str, Any]] | None,
    suite_created_at: str,
    label: str,
) -> dict[str, Any]:
    if image_count <= 0:
        raise ValueError("image_count must be positive")
    selected_workers = workers or []
    per_image: list[dict[str, Any]] = []
    failures = 0
    failed_validations = 0
    run_start = time.perf_counter()

    for index in range(image_count):
        packet = packets[index % len(packets)]
        worker = choose_worker(mode, selected_workers, index)
        worker_id = worker_id_for(mode, worker)
        engine_id = engine_for(mode, worker)
        queue_ms = queue_estimate_ms(mode, worker)
        ocr_ms = ocr_estimate_ms(mode, packet, worker)
        validation_start = time.perf_counter()
        try:
            review = validate_label_packet(packet["expectedFields"], [{"rawText": packet["ocrText"], "blocks": []}])
            validation_error = None
            overall_status = review["overallStatus"]
            if overall_status == "FAIL":
                failed_validations += 1
        except Exception as error:  # pragma: no cover - defensive path, covered by failure counters in script use
            failures += 1
            validation_error = f"{type(error).__name__}: {error}"
            overall_status = "ERROR"
        validation_ms = elapsed_ms(validation_start)
        total_ms = queue_ms + ocr_ms + validation_ms
        per_image.append(
            {
                "sampleId": packet["id"],
                "sampleTitle": packet["title"],
                "mode": mode,
                "workerChosen": worker_id,
                "workerId": worker_id,
                "engineUsed": engine_id,
                "queueMs": round(queue_ms, 3),
                "ocrMs": round(ocr_ms, 3),
                "validationMs": round(validation_ms, 3),
                "totalMs": round(total_ms, 3),
                "overallStatus": overall_status,
                "error": validation_error,
            }
        )

    wall_clock_ms = elapsed_ms(run_start)
    concurrency = min(image_count, concurrency_for(mode, selected_workers))
    total_modeled_ms = sum(item["queueMs"] for item in per_image) + (
        sum(item["ocrMs"] + item["validationMs"] for item in per_image) / max(1, concurrency)
    )
    total_values = [item["totalMs"] for item in per_image]
    ocr_values = [item["ocrMs"] for item in per_image]
    validation_values = [item["validationMs"] for item in per_image]
    queue_values = [item["queueMs"] for item in per_image]
    primary_worker = per_image[0]["workerChosen"] if per_image else worker_id_for(mode, None)
    primary_engine = per_image[0]["engineUsed"] if per_image else engine_for(mode, None)

    return {
        "id": f"benchmark-{mode}-{image_count}-{suite_created_at.replace(':', '').replace('.', '-')}",
        "label": f"{image_count} image {mode} benchmark",
        "imageCount": image_count,
        "mode": mode,
        "status": "completed",
        "workerId": primary_worker,
        "workerChosen": primary_worker,
        "engineUsed": primary_engine,
        "concurrency": concurrency,
        "totalMs": round(total_modeled_ms, 3),
        "wallClockMs": round(wall_clock_ms, 3),
        "averageMsPerImage": round(total_modeled_ms / image_count, 3),
        "p50MsPerImage": round(percentile(total_values, 0.5), 3),
        "p95MsPerImage": round(percentile(total_values, 0.95), 3),
        "imagesPerMinute": round((image_count / total_modeled_ms) * 60_000, 3) if total_modeled_ms else 0,
        "ocrMs": round(sum(ocr_values), 3),
        "validationMs": round(sum(validation_values), 3),
        "queueMs": round(sum(queue_values), 3),
        "p50OcrMs": round(percentile(ocr_values, 0.5), 3),
        "p95OcrMs": round(percentile(ocr_values, 0.95), 3),
        "p50ValidationMs": round(percentile(validation_values, 0.5), 3),
        "p95ValidationMs": round(percentile(validation_values, 0.95), 3),
        "failures": failures,
        "failedValidations": failed_validations,
        "createdAt": suite_created_at,
        "samples": per_image,
        "notes": "Fixture OCR benchmark: OCR timings are calibrated estimates; validation timings are measured locally.",
    }


def load_packets() -> list[dict[str, Any]]:
    manifest = json.loads(PACKET_MANIFEST.read_text(encoding="utf-8"))
    packets = []
    for packet in manifest.get("packets", []):
        expected_path = PACKET_PUBLIC_ROOT / packet["expectedPath"]
        ocr_path = PACKET_PUBLIC_ROOT / packet["ocrFixturePath"]
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        fixture = json.loads(ocr_path.read_text(encoding="utf-8"))
        image_paths = [PACKET_PUBLIC_ROOT / image["path"] for image in packet.get("images", [])]
        packets.append(
            {
                "id": packet["id"],
                "title": packet.get("title", packet["id"]),
                "expectedFields": expected,
                "ocrText": ocr_fixture_text(fixture),
                "imageBytes": sum(path.stat().st_size for path in image_paths if path.exists()),
            }
        )
    if not packets:
        raise RuntimeError(f"No label packets found in {PACKET_MANIFEST}.")
    return packets


def ocr_fixture_text(fixture: dict[str, Any]) -> str:
    images = fixture.get("images") or {}
    if isinstance(images, dict):
        return "\n".join(str(value.get("rawText", "")) for _, value in sorted(images.items()))
    if isinstance(images, list):
        return "\n".join(str(value.get("rawText", "")) for value in images)
    return str(fixture.get("rawText", ""))


def write_benchmark_suite(suite: dict[str, Any], results_dir: Path) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{suite['createdAt'].replace(':', '').replace('.', '-')}-{suite['id']}.json"
    path = results_dir / filename
    payload = json.dumps(suite, indent=2, sort_keys=True)
    path.write_text(payload + "\n", encoding="utf-8")
    (results_dir / "latest.json").write_text(payload + "\n", encoding="utf-8")
    return path


def list_benchmark_runs(results_dir: Path, *, limit: int = 100) -> list[dict[str, Any]]:
    suites = list_benchmark_suites(results_dir)
    runs = [run for suite in suites for run in suite.get("runs", [])]
    return sorted(runs, key=lambda run: run.get("createdAt", ""), reverse=True)[:limit]


def list_benchmark_suites(results_dir: Path, *, limit: int = 25) -> list[dict[str, Any]]:
    if not results_dir.exists():
        return []
    suites: list[dict[str, Any]] = []
    for path in sorted(results_dir.glob("*.json"), reverse=True):
        if path.name == "latest.json":
            continue
        try:
            suite = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if isinstance(suite, dict) and isinstance(suite.get("runs"), list):
            suites.append(suite)
    return sorted(suites, key=lambda suite: suite.get("createdAt", ""), reverse=True)[:limit]


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    completed = [run for run in runs if run.get("status") == "completed"]
    return {
        "completedRuns": len(completed),
        "skippedRuns": len([run for run in runs if run.get("status") == "skipped"]),
        "bestImagesPerMinute": max((run.get("imagesPerMinute", 0) for run in completed), default=0),
        "totalFailures": sum(int(run.get("failures") or 0) for run in runs),
    }


def choose_worker(mode: str, workers: list[dict[str, Any]], index: int) -> dict[str, Any] | None:
    if mode != "backend" or not workers:
        return None
    ordered = sorted(workers, key=lambda worker: (worker.get("activeJobs", 0) / max(1, worker.get("maxConcurrency", 1)), worker.get("id", "")))
    return ordered[index % len(ordered)]


def worker_available_for_benchmark(worker: dict[str, Any]) -> bool:
    calibration = worker.get("calibration") or {}
    return worker.get("status") in {"online", "busy", "calibrating"} and not calibration.get("disabled")


def worker_id_for(mode: str, worker: dict[str, Any] | None) -> str:
    if worker:
        return str(worker.get("id") or worker.get("hostname") or "backend-worker")
    if mode == "browser":
        return "browser-worker-pool"
    return "backend-local"


def engine_for(mode: str, worker: dict[str, Any] | None) -> str:
    if worker:
        engines = (worker.get("calibration") or {}).get("engines") or {}
        available = [engine_id for engine_id, meta in engines.items() if not isinstance(meta, dict) or meta.get("available", True)]
        if available:
            return "paddleocr" if "paddleocr" in available else sorted(available)[0]
        caps_engines = (worker.get("capabilities") or {}).get("engines") or {}
        if isinstance(caps_engines, dict) and caps_engines:
            return "paddleocr" if "paddleocr" in caps_engines else sorted(caps_engines.keys())[0]
    if mode == "browser":
        return "browser-local-ocr-fixture"
    return "python-validator-fixture"


def queue_estimate_ms(mode: str, worker: dict[str, Any] | None) -> float:
    if mode == "browser":
        return 1.0
    if mode == "backend":
        return 8.0
    active = float(worker.get("activeJobs") or 0)
    capacity = max(1.0, float(worker.get("maxConcurrency") or 1))
    return 12.0 + (active / capacity) * 25.0


def ocr_estimate_ms(mode: str, packet: dict[str, Any], worker: dict[str, Any] | None) -> float:
    if worker:
        engines = (worker.get("calibration") or {}).get("engines") or {}
        calibrated = [
            float(meta.get("steadyStateMs") or meta.get("ocrMs") or 0)
            for meta in engines.values()
            if isinstance(meta, dict) and (meta.get("steadyStateMs") or meta.get("ocrMs"))
        ]
        if calibrated:
            base = min(calibrated)
        else:
            base = 520.0
    else:
        base = {"browser": 720.0, "backend": 410.0}.get(mode, 520.0)
    size_factor = min(1.8, max(0.75, float(packet.get("imageBytes") or 250_000) / 350_000))
    jitter = 0.94 + ((sum(ord(char) for char in packet["id"]) % 13) / 100.0)
    return base * size_factor * jitter


def concurrency_for(mode: str, workers: list[dict[str, Any]]) -> int:
    if mode == "browser":
        return 4
    if mode == "backend" and not workers:
        return 2
    return max(1, sum(int(worker.get("maxConcurrency") or 1) for worker in workers))


def normalize_mode(mode: str) -> str:
    normalized = MODE_ALIASES.get(mode, mode)
    if normalized not in {"browser", "backend"}:
        raise ValueError(f"Unsupported benchmark mode {mode!r}.")
    return normalized


def percentile(values: list[float], target: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(sorted(values), n=100, method="inclusive")[max(0, min(99, int(target * 100) - 1))]


def elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local fixture-based TTB label-review benchmarks.")
    parser.add_argument("--mode", dest="modes", action="append", help="Mode to benchmark: browser or backend. Repeatable.")
    parser.add_argument("--modes", nargs="+", help="Modes to benchmark: browser backend.")
    parser.add_argument("--count", dest="counts", action="append", type=int, help="Image count to benchmark. Repeatable.")
    parser.add_argument("--counts", nargs="+", type=int, help="Image counts to benchmark.")
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--backend-url", default=None)
    parser.add_argument("--label", default="local benchmark")
    parser.add_argument("--no-write", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    modes = args.modes or list(DEFAULT_LOCAL_MODES)
    counts = args.counts or list(DEFAULT_COUNTS)
    suite = run_benchmark_suite(
        results_dir=args.results_dir,
        modes=modes,
        counts=counts,
        label=args.label,
        backend_url=args.backend_url,
        write=not args.no_write,
    )
    print(json.dumps(suite, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
