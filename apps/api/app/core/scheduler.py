from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import inf
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

STALE_WORKER_SECONDS = 30
DEFAULT_DOWNLOAD_BYTES_PER_SECOND = 5 * 1024 * 1024
DEFAULT_DISK_WRITE_BYTES_PER_SECOND = 20 * 1024 * 1024
DEFAULT_LATENCY_MS = 50.0
DEFAULT_OCR_MS = 1200.0


@dataclass(frozen=True)
class AssignmentDecision:
    worker_id: str
    engine_id: str
    score_ms: float
    reason_codes: list[str]
    estimated_components: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "worker_id": self.worker_id,
            "engine_id": self.engine_id,
            "score_ms": round(self.score_ms, 3),
            "reason_codes": self.reason_codes,
            "estimated_components": {key: round(value, 3) for key, value in self.estimated_components.items()},
        }


@dataclass(frozen=True)
class ScoredCandidate:
    job: models.Job
    worker: models.Worker
    decision: AssignmentDecision


def reclaim_expired_leases(session: Session) -> None:
    now = models.now_utc()
    expired = session.scalars(
        select(models.Job).where(
            models.Job.status.in_(["leased", "running"]),
            models.Job.lease_expires_at.is_not(None),
            models.Job.lease_expires_at < now,
        )
    ).all()
    for job in expired:
        if job.assigned_worker_id:
            session.add(
                models.WorkerEvent(
                    worker_id=job.assigned_worker_id,
                    event_type="lease_expired",
                    payload_json={"job_id": job.id, "session_id": job.session_id},
                )
            )
            worker = session.get(models.Worker, job.assigned_worker_id)
            if worker:
                worker.active_jobs = max(0, worker.active_jobs - 1)
        job.status = "queued"
        job.assigned_worker_id = None
        job.lease_expires_at = None
        job.error = "Lease expired; job returned to queue."


def claim_next_job(
    session: Session,
    *,
    worker: models.Worker,
    supported_job_types: list[str],
    lease_seconds: int,
    session_id: str | None = None,
) -> tuple[models.Job | None, dict | None]:
    reclaim_expired_leases(session)
    candidate = choose_assignment_for_worker(
        session,
        requesting_worker=worker,
        supported_job_types=supported_job_types,
        session_id=session_id,
    )
    if not candidate:
        return None, None

    now = models.now_utc()
    job = session.scalars(
        select(models.Job)
        .where(models.Job.id == candidate.job.id, models.Job.status == "queued")
        .with_for_update(skip_locked=True)
    ).first()
    if not job:
        return None, None

    job.status = "leased"
    job.assigned_worker_id = worker.id
    job.lease_expires_at = now + timedelta(seconds=lease_seconds)
    job.started_at = job.started_at or now
    job.attempts += 1
    job.payload_json = {**(job.payload_json or {}), "_assignment": candidate.decision.to_dict()}
    worker.active_jobs += 1
    worker.last_seen_at = now
    return job, candidate.decision.to_dict()


def choose_assignment_for_worker(
    session: Session,
    *,
    requesting_worker: models.Worker,
    supported_job_types: list[str],
    session_id: str | None = None,
) -> ScoredCandidate | None:
    now = models.now_utc()
    queued_jobs = list_queued_jobs(session, supported_job_types, session_id)
    if not queued_jobs:
        return None

    workers = [
        worker
        for worker in session.scalars(select(models.Worker).where(models.Worker.status == "online")).all()
        if worker_is_eligible(worker, now)
    ]
    if requesting_worker not in workers and worker_is_eligible(requesting_worker, now):
        workers.append(requesting_worker)
    if not workers:
        return None

    active_by_session, queued_by_session = session_pressure(session, queued_jobs)
    failure_counts = recent_failure_counts(session)
    best_for_requesting_worker: list[ScoredCandidate] = []

    for job in queued_jobs:
        candidates = [
            score_candidate(session, job, candidate_worker, now, active_by_session, queued_by_session, failure_counts)
            for candidate_worker in workers
            if worker_can_run_job(candidate_worker, job)
        ]
        candidates = [candidate for candidate in candidates if candidate is not None]
        if not candidates:
            continue
        best_for_job = sorted(candidates, key=candidate_sort_key)[0]
        if best_for_job.worker.id == requesting_worker.id:
            best_for_requesting_worker.append(best_for_job)

    if not best_for_requesting_worker:
        return None
    return sorted(best_for_requesting_worker, key=candidate_sort_key)[0]


def list_queued_jobs(session: Session, supported_job_types: list[str], session_id: str | None) -> list[models.Job]:
    query = (
        select(models.Job)
        .where(
            models.Job.status == "queued",
            models.Job.job_type.in_(supported_job_types),
            models.Job.assigned_worker_id.is_(None),
        )
        .order_by(models.Job.priority.asc(), models.Job.created_at.asc())
        .with_for_update(skip_locked=True)
    )
    if session_id:
        query = query.where(models.Job.session_id == session_id)
    return [job for job in session.scalars(query).all() if dependencies_satisfied(session, job)]


def score_candidate(
    session: Session,
    job: models.Job,
    worker: models.Worker,
    now: datetime,
    active_by_session: dict[str, int],
    queued_by_session: dict[str, int],
    failure_counts: dict[str, int],
) -> ScoredCandidate | None:
    engines = candidate_engines(worker, job)
    if not engines:
        return None
    scored = [
        score_worker_engine(session, job, worker, engine_id, now, active_by_session, queued_by_session, failure_counts)
        for engine_id in engines
    ]
    return sorted(scored, key=candidate_sort_key)[0]


def score_worker_engine(
    session: Session,
    job: models.Job,
    worker: models.Worker,
    engine_id: str,
    now: datetime,
    active_by_session: dict[str, int],
    queued_by_session: dict[str, int],
    failure_counts: dict[str, int],
) -> ScoredCandidate:
    assets = job_assets(session, job)
    asset_size_bytes = total_asset_size(job, assets)
    cached = assets_cached(worker, assets, job)
    reason_codes = ["queued_job", "available_worker", "session_scoped"]

    queue_penalty_ms = queue_penalty(worker, job, reason_codes)
    network_transfer_ms = network_transfer_penalty(worker, asset_size_bytes, cached, reason_codes)
    disk_penalty_ms = disk_penalty(worker, asset_size_bytes, cached, reason_codes)
    model_warmup_penalty_ms = model_warmup_penalty(worker, engine_id, reason_codes)
    ocr_estimate_ms = ocr_estimate(job, worker, engine_id, asset_size_bytes, reason_codes)
    quality_bonus_ms = quality_engine_bonus(job, worker, engine_id, reason_codes)
    escalation_bonus_ms = escalation_bonus(job, worker, reason_codes)
    reliability_penalty_ms = reliability_penalty(worker, now, failure_counts, reason_codes)
    session_fairness_penalty_ms = session_fairness_penalty(job, active_by_session, queued_by_session, reason_codes)

    components = {
        "queue_penalty_ms": queue_penalty_ms,
        "network_transfer_ms": network_transfer_ms,
        "disk_penalty_ms": disk_penalty_ms,
        "model_warmup_penalty_ms": model_warmup_penalty_ms,
        "ocr_estimate_ms": ocr_estimate_ms,
        "quality_bonus_ms": quality_bonus_ms,
        "escalation_bonus_ms": escalation_bonus_ms,
        "reliability_penalty_ms": reliability_penalty_ms,
        "session_fairness_penalty_ms": session_fairness_penalty_ms,
    }
    score_ms = sum(components.values())
    add_accelerator_reasons(worker, reason_codes)
    if engine_id != "auto":
        reason_codes.append(f"engine_{engine_id}")

    return ScoredCandidate(
        job=job,
        worker=worker,
        decision=AssignmentDecision(
            worker_id=worker.id,
            engine_id=engine_id,
            score_ms=score_ms,
            reason_codes=dedupe(reason_codes),
            estimated_components=components,
        ),
    )


def worker_is_eligible(worker: models.Worker, now: datetime) -> bool:
    if worker.status != "online":
        return False
    if worker.active_jobs >= max(1, worker.max_concurrency):
        return False
    if seconds_since(worker.last_seen_at, now) > STALE_WORKER_SECONDS:
        return False
    return True


def worker_can_run_job(worker: models.Worker, job: models.Job) -> bool:
    capabilities = worker.capabilities or {}
    supported_job_types = set(capabilities.get("supportedJobTypes") or [])
    if supported_job_types and job.job_type not in supported_job_types:
        return False
    for name, required in (job.required_capabilities or {}).items():
        if not required:
            continue
        if capabilities.get(name):
            continue
        if name == job.job_type and job.job_type in supported_job_types:
            continue
        return False
    return True


def dependencies_satisfied(session: Session, job: models.Job) -> bool:
    payload = job.payload_json or {}
    depends_on = payload.get("depends_on") or payload.get("dependsOn")
    if not depends_on:
        return True
    dependencies = [depends_on] if isinstance(depends_on, str) else list(depends_on)
    if not job.review_id:
        return True
    for dependency in dependencies:
        dependency_jobs = session.scalars(
            select(models.Job).where(
                models.Job.review_id == job.review_id,
                models.Job.job_type == dependency,
                models.Job.id != job.id,
            )
        ).all()
        if not dependency_jobs:
            return False
        if any(dependency_job.status != "completed" for dependency_job in dependency_jobs):
            return False
    return True


def candidate_engines(worker: models.Worker, job: models.Job) -> list[str]:
    payload = job.payload_json or {}
    requested = payload.get("engine_id") or payload.get("engineId") or payload.get("engine") or "auto"
    if job.job_type == "evidence_crop":
        return ["evidence"]

    engine_health = (worker.capabilities or {}).get("engines") or {}
    available = [
        engine_id
        for engine_id, health in engine_health.items()
        if isinstance(health, dict) and (health.get("available") is True or health.get("status") == "ok")
    ]
    if not available:
        if requested and requested != "auto":
            return [requested]
        available = ["auto"]
    allow_fixture = bool(payload.get("allow_fixture_engine") or payload.get("allowFixtureEngine") or payload.get("fixture_ocr_text") or payload.get("fixtureOcrText"))
    if requested == "auto" and not allow_fixture:
        non_null = [engine_id for engine_id in available if engine_id != "null"]
        if non_null:
            available = non_null
    if requested and requested != "auto":
        return [requested] if requested in available or requested == "auto" else []
    return available


def job_assets(session: Session, job: models.Job) -> list[models.Asset]:
    payload = job.payload_json or {}
    asset_ids: list[str] = []
    if payload.get("asset_id"):
        asset_ids.append(payload["asset_id"])
    if payload.get("assetId"):
        asset_ids.append(payload["assetId"])
    asset_ids.extend(payload.get("asset_ids") or [])
    asset_ids.extend(payload.get("assetIds") or [])

    assets: list[models.Asset] = []
    seen = set()
    for asset_id in asset_ids:
        if asset_id in seen:
            continue
        seen.add(asset_id)
        asset = session.get(models.Asset, asset_id)
        if asset:
            assets.append(asset)
    return assets


def total_asset_size(job: models.Job, assets: list[models.Asset]) -> int:
    if assets:
        return sum(asset.size_bytes or 0 for asset in assets)
    payload = job.payload_json or {}
    return int(payload.get("size_bytes") or payload.get("sizeBytes") or payload.get("assetSizeBytes") or 0)


def assets_cached(worker: models.Worker, assets: list[models.Asset], job: models.Job) -> bool:
    if not assets:
        payload = job.payload_json or {}
        return bool(payload.get("asset_cached") or payload.get("assetCached"))
    capabilities = worker.capabilities or {}
    asset_cache = capabilities.get("assetCache") or {}
    cached_asset_ids = set(capabilities.get("cachedAssetIds") or asset_cache.get("assetIds") or [])
    cached_sha256 = set(capabilities.get("cachedSha256") or asset_cache.get("sha256") or [])
    return all(asset.id in cached_asset_ids or asset.sha256 in cached_sha256 for asset in assets)


def queue_penalty(worker: models.Worker, job: models.Job, reason_codes: list[str]) -> float:
    max_concurrency = max(1, worker.max_concurrency)
    load_ratio = worker.active_jobs / max_concurrency
    if worker.active_jobs == 0:
        reason_codes.append("low_queue_depth")
    else:
        reason_codes.append("worker_has_active_jobs")
    return (load_ratio * 1000.0) + float(job.priority)


def network_transfer_penalty(worker: models.Worker, asset_size_bytes: int, cached: bool, reason_codes: list[str]) -> float:
    if asset_size_bytes <= 0:
        reason_codes.append("no_asset_transfer")
        return 0.0
    if cached:
        reason_codes.append("asset_cached")
        return 0.0
    network = (worker.capabilities or {}).get("network") or {}
    latency_ms = number(network.get("latencyMs"), DEFAULT_LATENCY_MS)
    download_bps = number(network.get("downloadBytesPerSecond"), DEFAULT_DOWNLOAD_BYTES_PER_SECOND)
    bytes_per_ms = max(download_bps / 1000.0, 1.0)
    transfer_ms = (asset_size_bytes / bytes_per_ms) + latency_ms
    reason_codes.append("fast_network" if download_bps >= 20 * 1024 * 1024 else "slow_network")
    return transfer_ms


def disk_penalty(worker: models.Worker, asset_size_bytes: int, cached: bool, reason_codes: list[str]) -> float:
    if cached or asset_size_bytes <= 0:
        return 0.0
    disk = (worker.capabilities or {}).get("disk") or {}
    write_bps = number(disk.get("writeBytesPerSecond"), DEFAULT_DISK_WRITE_BYTES_PER_SECOND)
    write_ms = asset_size_bytes / max(write_bps / 1000.0, 1.0)
    penalty = max(0.0, write_ms - 100.0)
    if penalty > 0:
        reason_codes.append("slow_disk")
    return penalty


def model_warmup_penalty(worker: models.Worker, engine_id: str, reason_codes: list[str]) -> float:
    if engine_id in {"auto", "evidence"}:
        return 0.0
    warm_engines = set((worker.capabilities or {}).get("warmEngines") or [])
    if engine_id in warm_engines:
        reason_codes.append("engine_warm")
        return 0.0
    metrics = engine_metrics(worker, engine_id)
    warmup_ms = number(metrics.get("warmupMs") or metrics.get("warmup_ms"), 0.0)
    if warmup_ms > 0:
        reason_codes.append("engine_warmup_required")
    return warmup_ms


def ocr_estimate(job: models.Job, worker: models.Worker, engine_id: str, asset_size_bytes: int, reason_codes: list[str]) -> float:
    if job.job_type == "evidence_crop":
        return 250.0
    if job.job_type == "validation":
        base = 500.0
    else:
        base = DEFAULT_OCR_MS
    metrics = engine_metrics(worker, engine_id)
    calibrated = (
        metrics.get("steadyStateMs")
        or metrics.get("steady_state_ms")
        or metrics.get("firstRunMs")
        or metrics.get("ocrMs")
        or (worker.calibration or {}).get("ocrMs")
    )
    if calibrated is not None:
        reason_codes.append("calibrated_engine")
        return float(calibrated)

    pixels_per_second = metrics.get("imagePixelsPerSecond") or metrics.get("image_pixels_per_second")
    payload = job.payload_json or {}
    pixels = payload.get("imagePixels") or payload.get("pixels")
    if pixels and pixels_per_second:
        reason_codes.append("pixel_calibrated_estimate")
        return max(50.0, float(pixels) / max(float(pixels_per_second) / 1000.0, 1.0))

    size_mb = asset_size_bytes / (1024 * 1024)
    return base + (size_mb * 300.0)


def quality_engine_bonus(job: models.Job, worker: models.Worker, engine_id: str, reason_codes: list[str]) -> float:
    payload = job.payload_json or {}
    if job.job_type != "ocr":
        return 0.0
    prefer_quality = bool(
        payload.get("field_critical")
        or payload.get("fieldCritical")
        or payload.get("prefer_quality")
        or payload.get("preferQuality")
        or payload.get("ocr_strategy") in {"paddleocr_authoritative", "tesseract_first_easyocr_escalation"}
    )
    if not prefer_quality:
        return 0.0
    bonus = 0.0
    if engine_id == "paddleocr":
        reason_codes.append("quality_paddleocr_preferred")
        bonus -= 1900.0
    elif engine_id == "easyocr":
        reason_codes.append("quality_easyocr_fallback_available")
        bonus -= 700.0
    elif engine_id == "onnx":
        reason_codes.append("quality_heavy_engine_available")
        bonus -= 500.0
    if worker_has_accelerator(worker):
        reason_codes.append("accelerated_worker_preferred")
        bonus -= 450.0
    return bonus


def escalation_bonus(job: models.Job, worker: models.Worker, reason_codes: list[str]) -> float:
    if job.job_type != "validation":
        return 0.0
    payload = job.payload_json or {}
    strategy = str(payload.get("ocr_strategy") or payload.get("ocrStrategy") or "")
    fallback_engine = str(payload.get("fallback_engine") or payload.get("fallbackEngine") or "")
    if strategy in {"off", "none", "primary_only"} or not fallback_engine:
        return 0.0
    if not worker_has_engine(worker, fallback_engine):
        return 0.0
    reason_codes.append(f"{fallback_engine}_escalation_available")
    return -350.0


def worker_has_engine(worker: models.Worker, engine_id: str) -> bool:
    engine_health = (worker.capabilities or {}).get("engines") or {}
    health = engine_health.get(engine_id)
    return isinstance(health, dict) and (health.get("available") is True or health.get("status") == "ok")


def worker_has_accelerator(worker: models.Worker) -> bool:
    accelerators = (worker.capabilities or {}).get("accelerators") or {}
    return bool((accelerators.get("cuda") or {}).get("available") or (accelerators.get("appleMps") or {}).get("available"))


def reliability_penalty(worker: models.Worker, now: datetime, failure_counts: dict[str, int], reason_codes: list[str]) -> float:
    failures = failure_counts.get(worker.id, 0)
    penalty = failures * 750.0
    if failures:
        reason_codes.append("recent_failures")
    age_seconds = seconds_since(worker.last_seen_at, now)
    if age_seconds > 10:
        reason_codes.append("heartbeat_aging")
        penalty += (age_seconds - 10) * 25.0
    return penalty


def session_fairness_penalty(
    job: models.Job,
    active_by_session: dict[str, int],
    queued_by_session: dict[str, int],
    reason_codes: list[str],
) -> float:
    active_count = active_by_session.get(job.session_id, 0)
    queued_count = queued_by_session.get(job.session_id, 0)
    min_queued = min(queued_by_session.values()) if queued_by_session else 0
    penalty = (active_count * 400.0) + (max(0, queued_count - min_queued) * 20.0)
    if penalty:
        reason_codes.append("session_fairness_applied")
    return penalty


def engine_metrics(worker: models.Worker, engine_id: str) -> dict[str, Any]:
    calibration = worker.calibration or {}
    engines = calibration.get("engines") or {}
    if engine_id in engines and isinstance(engines[engine_id], dict):
        return engines[engine_id]
    if engine_id == "auto" and engines:
        for metrics in engines.values():
            if isinstance(metrics, dict) and metrics.get("available", True):
                return metrics
    return calibration if isinstance(calibration, dict) else {}


def session_pressure(session: Session, queued_jobs: list[models.Job]) -> tuple[dict[str, int], dict[str, int]]:
    active_jobs = session.scalars(select(models.Job).where(models.Job.status.in_(["leased", "running"]))).all()
    active_by_session: dict[str, int] = {}
    queued_by_session: dict[str, int] = {}
    for job in active_jobs:
        active_by_session[job.session_id] = active_by_session.get(job.session_id, 0) + 1
    for job in queued_jobs:
        queued_by_session[job.session_id] = queued_by_session.get(job.session_id, 0) + 1
    return active_by_session, queued_by_session


def recent_failure_counts(session: Session) -> dict[str, int]:
    events = session.scalars(
        select(models.WorkerEvent).where(models.WorkerEvent.event_type.in_(["job_failed", "lease_expired"]))
    ).all()
    counts: dict[str, int] = {}
    for event in events:
        counts[event.worker_id] = counts.get(event.worker_id, 0) + 1
    return counts


def candidate_sort_key(candidate: ScoredCandidate):
    return (candidate.decision.score_ms, candidate.job.priority, candidate.job.created_at, candidate.worker.id)


def add_accelerator_reasons(worker: models.Worker, reason_codes: list[str]) -> None:
    accelerators = (worker.capabilities or {}).get("accelerators") or {}
    cuda = accelerators.get("cuda") or {}
    mps = accelerators.get("appleMps") or {}
    if cuda.get("available"):
        reason_codes.append("gpu_available")
    if mps.get("available"):
        reason_codes.append("apple_mps_available")


def seconds_since(value: datetime | None, now: datetime) -> float:
    if value is None:
        return inf
    if value.tzinfo is None and now.tzinfo is not None:
        now = now.replace(tzinfo=None)
    if value.tzinfo is not None and now.tzinfo is None:
        value = value.replace(tzinfo=None)
    return max(0.0, (now - value).total_seconds())


def number(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return float(default)
    return parsed if parsed > 0 else float(default)


def dedupe(values: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped
