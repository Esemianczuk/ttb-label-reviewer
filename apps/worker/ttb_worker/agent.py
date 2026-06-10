from __future__ import annotations

import os
import socket
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .calibration import calibrate_engines, load_calibration
from .capabilities import platform_for_registration, probe_capabilities
from .engines import build_engines, inspect_engines
from .engines.base import OcrEngine
from .heartbeat import HeartbeatCadence
from .tasks import process_evidence_job, process_ocr_job, process_validation_job
from .transport import CoordinatorClient


@dataclass
class WorkerConfig:
    coordinator: str = "http://127.0.0.1:8000"
    name: str = "auto"
    concurrency: str | int = "auto"
    engines: str = "auto"
    data_dir: Path = Path(".worker-cache")
    session_id: str | None = None
    join_token: str | None = None
    worker_secret: str | None = None
    secret_file: Path | None = None
    poll_interval_seconds: float = 1.0
    heartbeat_interval_seconds: float = 5.0
    recalibrate: bool = False


class WorkerAgent:
    def __init__(
        self,
        config: WorkerConfig,
        *,
        client: CoordinatorClient | None = None,
        engines: list[OcrEngine] | None = None,
        capabilities: dict[str, Any] | None = None,
    ):
        self.config = config
        self.config.data_dir.mkdir(parents=True, exist_ok=True)
        loaded_secret = config.worker_secret or load_worker_secret(config.secret_file)
        self.client = client or CoordinatorClient(
            config.coordinator,
            session_id=config.session_id,
            join_token=config.join_token,
            worker_secret=loaded_secret,
        )
        self.capabilities = capabilities or probe_capabilities(config.coordinator, config.data_dir)
        self.engines = engines or build_engines(config.engines, self.capabilities)
        self.capabilities["engines"] = inspect_engines(config.engines, self.capabilities)
        self.worker_id = worker_id(config.name)
        self.max_concurrency = resolve_concurrency(config.concurrency)
        self.asset_cache_dir = self.config.data_dir / "asset-cache"
        self.asset_cache_dir.mkdir(parents=True, exist_ok=True)
        self.active_jobs = 0
        self.registered = False
        self.heartbeat = HeartbeatCadence(config.heartbeat_interval_seconds)
        self.calibration = self._load_or_calibrate()

    def register(self) -> dict[str, Any]:
        hostname, platform_name, arch = platform_for_registration(self.capabilities)
        payload = {
            "id": self.worker_id,
            "hostname": hostname,
            "platform": platform_name,
            "arch": arch,
            "version": "0.1.0",
            "joinToken": self.config.join_token,
            "capabilities": self._registration_capabilities(),
            "calibration": self.calibration,
            "maxConcurrency": self.max_concurrency,
        }
        response = self.client.register_worker(payload)
        if response.get("workerSecret"):
            save_worker_secret(self.config.secret_file, response["workerSecret"])
        self.registered = True
        self.heartbeat.mark_sent()
        return response

    def send_heartbeat(self, force: bool = False) -> dict[str, Any] | None:
        if not self.registered:
            return None
        if not force and not self.heartbeat.due():
            return None
        response = self.client.heartbeat(
            self.worker_id,
            {
                "activeJobs": self.active_jobs,
                "status": "online",
                "capabilities": self._registration_capabilities(),
                "calibration": self.calibration,
            },
        )
        self.heartbeat.mark_sent()
        return response

    def run_once(self) -> bool:
        if not self.registered:
            self.register()
        self.send_heartbeat(force=True)
        claim = self.client.claim_job(
            self.worker_id,
            {
                "sessionId": self.config.session_id,
                "supportedJobTypes": self.supported_job_types(),
            },
        )
        job = claim.get("job")
        if not job:
            return False
        self.active_jobs += 1
        self.send_heartbeat(force=True)
        try:
            result = self.process_job(job)
            self.client.complete_job(self.worker_id, job["id"], result)
            return True
        except Exception as error:
            self.client.fail_job(self.worker_id, job["id"], structured_error(error), retryable=True)
            return False
        finally:
            self.active_jobs = max(0, self.active_jobs - 1)
            self.send_heartbeat(force=True)

    def run_forever(self, max_jobs: int | None = None) -> None:
        completed = 0
        if not self.registered:
            self.register()
        while True:
            processed = self.run_once()
            if processed:
                completed += 1
                if max_jobs is not None and completed >= max_jobs:
                    return
            else:
                self.send_heartbeat()
                time.sleep(self.config.poll_interval_seconds)

    def process_job(self, job: dict[str, Any]) -> dict[str, Any]:
        job_type = job.get("jobType") or job.get("job_type")
        if job_type == "ocr":
            return process_ocr_job(job, self.client, self.engines, cache_dir=self.asset_cache_dir)
        if job_type == "evidence_crop":
            return process_evidence_job(job)
        if job_type == "validation":
            return process_validation_job(job, self.client, self.engines, self.worker_id, cache_dir=self.asset_cache_dir)
        raise RuntimeError(f"Unsupported job type: {job_type}")

    def supported_job_types(self) -> list[str]:
        return ["ocr", "evidence_crop", "validation"]

    def close(self) -> None:
        self.client.close()

    def _load_or_calibrate(self) -> dict[str, Any]:
        if not self.config.recalibrate:
            cached = load_calibration(self.config.data_dir)
            if cached:
                return cached
        return calibrate_engines(self.engines, self.config.data_dir, self.capabilities)

    def _registration_capabilities(self) -> dict[str, Any]:
        capabilities = dict(self.capabilities)
        capabilities["supportedJobTypes"] = self.supported_job_types()
        capabilities["ocr"] = True
        capabilities["evidence_crop"] = True
        capabilities["validation"] = True
        capabilities["warmEngines"] = [engine.id for engine in self.engines if engine.healthcheck().available]
        capabilities["assetCache"] = {"assetIds": cached_asset_ids(self.asset_cache_dir)}
        capabilities["cachedAssetIds"] = capabilities["assetCache"]["assetIds"]
        capabilities["workerPid"] = os.getpid()
        return capabilities


def resolve_concurrency(value: str | int) -> int:
    if isinstance(value, int):
        return max(1, value)
    if str(value).lower() == "auto":
        return max(1, min(2, os.cpu_count() or 1))
    return max(1, int(value))


def worker_id(name: str) -> str:
    if name != "auto":
        return name
    host = socket.gethostname().split(".")[0] or "host"
    return f"{host}-{uuid.uuid4().hex[:8]}"


def structured_error(error: Exception) -> str:
    return f"{error.__class__.__name__}: {error}"


def cached_asset_ids(cache_dir: Path) -> list[str]:
    if not cache_dir.exists():
        return []
    return sorted(path.stem for path in cache_dir.glob("*.bin") if path.is_file())


def load_worker_secret(secret_file: Path | None) -> str | None:
    if not secret_file or not secret_file.exists():
        return None
    value = secret_file.read_text(encoding="utf-8").strip()
    return value or None


def save_worker_secret(secret_file: Path | None, secret: str) -> None:
    if not secret_file:
        return
    secret_file.parent.mkdir(parents=True, exist_ok=True)
    secret_file.write_text(secret + "\n", encoding="utf-8")
    try:
        secret_file.chmod(0o600)
    except OSError:
        pass
