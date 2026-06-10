from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest

from apps.api.app import models
from apps.api.app.config import Settings
from apps.api.app.db import make_session_factory, init_db
from apps.api.app.core.scheduler import (
    choose_assignment_for_worker,
    dependencies_satisfied,
    score_worker_engine,
    worker_can_run_job,
    worker_is_eligible,
)


@pytest.fixture()
def session(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'scheduler.sqlite3'}",
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "missing-dist",
    )
    session_factory = make_session_factory(settings)
    init_db(session_factory)
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


def create_application_job(session, *, session_id: str = "session-a", size_bytes: int = 50 * 1024 * 1024):
    application = models.Application(
        session_id=session_id,
        source="upload",
        status="review_queued",
        expected_fields={"brandName": "Hollow Ridge"},
        metadata_json={},
    )
    session.add(application)
    session.flush()
    asset = models.Asset(
        application_id=application.id,
        sha256=models.new_uuid().replace("-", "")[:64],
        original_filename="front.png",
        mime_type="image/png",
        size_bytes=size_bytes,
        storage_path=str(Path("/tmp/front.png")),
        role="front",
    )
    session.add(asset)
    session.flush()
    job = models.Job(
        application_id=application.id,
        session_id=session_id,
        job_type="ocr",
        status="queued",
        priority=100,
        payload_json={"asset_id": asset.id, "expected_fields": application.expected_fields},
        required_capabilities={"ocr": True},
    )
    session.add(job)
    session.commit()
    return application, asset, job


def create_worker(
    session,
    worker_id: str,
    *,
    cached_asset_ids: list[str] | None = None,
    ocr_ms: int = 500,
    download_bps: int = 20 * 1024 * 1024,
    latency_ms: int = 10,
    active_jobs: int = 0,
    max_concurrency: int = 1,
):
    cached_asset_ids = cached_asset_ids or []
    worker = models.Worker(
        id=worker_id,
        hostname=f"{worker_id}.local",
        platform="linux",
        arch="x86_64",
        version="test",
        status="online",
        active_jobs=active_jobs,
        max_concurrency=max_concurrency,
        last_seen_at=models.now_utc(),
        capabilities={
            "ocr": True,
            "supportedJobTypes": ["ocr", "evidence_crop", "validation"],
            "engines": {"null": {"available": True, "status": "ok"}},
            "warmEngines": ["null"],
            "assetCache": {"assetIds": cached_asset_ids},
            "cachedAssetIds": cached_asset_ids,
            "network": {"latencyMs": latency_ms, "downloadBytesPerSecond": download_bps},
            "disk": {"writeBytesPerSecond": 100 * 1024 * 1024},
            "accelerators": {"cuda": {"available": False, "devices": []}, "appleMps": {"available": False}},
        },
        calibration={"engines": {"null": {"available": True, "steadyStateMs": ocr_ms, "warmupMs": 0}}},
    )
    session.add(worker)
    session.commit()
    return worker


def test_cached_large_asset_beats_faster_remote_worker_when_network_is_slow(session):
    _, asset, job = create_application_job(session, size_bytes=60 * 1024 * 1024)
    cached_worker = create_worker(session, "cached-worker", cached_asset_ids=[asset.id], ocr_ms=4000, download_bps=1000, latency_ms=1000)
    remote_worker = create_worker(session, "remote-worker", cached_asset_ids=[], ocr_ms=100, download_bps=1000, latency_ms=1000)

    now = models.now_utc()
    cached_score = score_worker_engine(session, job, cached_worker, "null", now, {}, {"session-a": 1}, {})
    remote_score = score_worker_engine(session, job, remote_worker, "null", now, {}, {"session-a": 1}, {})

    assert cached_score.decision.estimated_components["network_transfer_ms"] == 0
    assert remote_score.decision.estimated_components["network_transfer_ms"] > cached_score.decision.score_ms
    assert cached_score.decision.score_ms < remote_score.decision.score_ms
    assert "asset_cached" in cached_score.decision.reason_codes

    assert choose_assignment_for_worker(
        session,
        requesting_worker=remote_worker,
        supported_job_types=["ocr"],
        session_id="session-a",
    ) is None
    assignment = choose_assignment_for_worker(
        session,
        requesting_worker=cached_worker,
        supported_job_types=["ocr"],
        session_id="session-a",
    )
    assert assignment is not None
    assert assignment.decision.worker_id == "cached-worker"


def test_scheduler_scores_queue_depth_and_reliability(session):
    _, asset, job = create_application_job(session, size_bytes=1024)
    idle = create_worker(session, "idle-worker", cached_asset_ids=[asset.id], ocr_ms=250)
    busy = create_worker(session, "busy-worker", cached_asset_ids=[asset.id], ocr_ms=250, active_jobs=1, max_concurrency=2)
    session.add(models.WorkerEvent(worker_id="busy-worker", event_type="job_failed", payload_json={"job_id": "old"}))
    session.commit()

    now = models.now_utc()
    idle_score = score_worker_engine(session, job, idle, "null", now, {}, {"session-a": 1}, {"busy-worker": 1})
    busy_score = score_worker_engine(session, job, busy, "null", now, {}, {"session-a": 1}, {"busy-worker": 1})

    assert idle_score.decision.estimated_components["queue_penalty_ms"] < busy_score.decision.estimated_components["queue_penalty_ms"]
    assert busy_score.decision.estimated_components["reliability_penalty_ms"] == 750
    assert idle_score.decision.score_ms < busy_score.decision.score_ms


def test_scheduler_applies_session_fairness_penalty(session):
    _, asset_a, job_a = create_application_job(session, session_id="session-a", size_bytes=1024)
    _, _, job_b = create_application_job(session, session_id="session-b", size_bytes=1024)
    worker = create_worker(session, "fair-worker", cached_asset_ids=[asset_a.id], ocr_ms=250)

    now = models.now_utc()
    active_by_session = {"session-a": 2, "session-b": 0}
    queued_by_session = {"session-a": 5, "session-b": 1}
    score_a = score_worker_engine(session, job_a, worker, "null", now, active_by_session, queued_by_session, {})
    score_b = score_worker_engine(session, job_b, worker, "null", now, active_by_session, queued_by_session, {})

    assert score_a.decision.estimated_components["session_fairness_penalty_ms"] > score_b.decision.estimated_components[
        "session_fairness_penalty_ms"
    ]
    assert "session_fairness_applied" in score_a.decision.reason_codes


def test_scheduler_rejects_stale_or_incapable_workers(session):
    _, _, job = create_application_job(session)
    worker = create_worker(session, "incapable-worker")
    worker.capabilities = {"supportedJobTypes": ["validation"], "validation": True}
    session.commit()

    assert not worker_can_run_job(worker, job)

    worker.status = "online"
    worker.capabilities = {"ocr": True, "supportedJobTypes": ["ocr"]}
    worker.last_seen_at = models.now_utc() - timedelta(seconds=120)
    session.commit()
    assert worker_is_eligible(worker, models.now_utc()) is False


def test_scheduler_honors_review_stage_dependencies(session):
    application, asset, _ = create_application_job(session)
    session.query(models.Job).delete()
    review = models.Review(application_id=application.id, mode="distributed", status="queued")
    session.add(review)
    session.flush()
    ocr = models.Job(
        application_id=application.id,
        review_id=review.id,
        session_id=application.session_id,
        job_type="ocr",
        status="queued",
        priority=100,
        payload_json={"asset_id": asset.id},
        required_capabilities={"ocr": True},
    )
    evidence = models.Job(
        application_id=application.id,
        review_id=review.id,
        session_id=application.session_id,
        job_type="evidence_crop",
        status="queued",
        priority=110,
        payload_json={"asset_id": asset.id, "depends_on": "ocr"},
        required_capabilities={"evidence_crop": True},
    )
    validation = models.Job(
        application_id=application.id,
        review_id=review.id,
        session_id=application.session_id,
        job_type="validation",
        status="queued",
        priority=120,
        payload_json={"asset_ids": [asset.id], "depends_on": ["ocr", "evidence_crop"]},
        required_capabilities={"validation": True},
    )
    session.add_all([ocr, evidence, validation])
    worker = create_worker(session, "stage-worker", cached_asset_ids=[asset.id], ocr_ms=1)

    assert dependencies_satisfied(session, ocr)
    assert not dependencies_satisfied(session, evidence)
    assert not dependencies_satisfied(session, validation)
    first = choose_assignment_for_worker(session, requesting_worker=worker, supported_job_types=["ocr", "evidence_crop", "validation"], session_id="session-a")
    assert first is not None
    assert first.job.job_type == "ocr"

    ocr.status = "completed"
    session.commit()
    second = choose_assignment_for_worker(session, requesting_worker=worker, supported_job_types=["ocr", "evidence_crop", "validation"], session_id="session-a")
    assert second is not None
    assert second.job.job_type == "evidence_crop"

    evidence.status = "completed"
    session.commit()
    third = choose_assignment_for_worker(session, requesting_worker=worker, supported_job_types=["ocr", "evidence_crop", "validation"], session_id="session-a")
    assert third is not None
    assert third.job.job_type == "validation"
