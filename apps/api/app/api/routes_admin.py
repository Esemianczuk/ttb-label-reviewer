from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, require_permission
from ..api.serializers import (
    application_version_to_read,
    asset_to_read,
    audit_event_to_read,
    correction_request_to_read,
    review_decision_to_read,
    review_to_read,
    setting_to_read,
    user_to_read,
    worker_to_read,
)
from ..core.benchmarking import list_benchmark_runs, run_benchmark_suite, worker_available_for_benchmark
from ..core.application_numbers import application_number_for
from ..core.security import safe_unlink_asset_path
from ..db import get_session
from ..schemas import AuditEventRead, BenchmarkRunRead, BenchmarkRunRequest, OperationResult, SettingRead, SettingUpdate

router = APIRouter(prefix="/api", tags=["admin"])

ADMIN_SETTINGS_KEY = "admin.operations"
DEFAULT_ADMIN_SETTINGS = {
    "preferredOcrEngine": "browser-fixture",
    "browserOcrAllowed": True,
    "backendCpuOcrAllowed": True,
    "gpuOcrAllowed": False,
    "distributedWorkersAllowed": True,
    "maxConcurrency": 4,
    "validatorThreshold": 0.88,
    "warningStrictness": "standard",
    "retentionRawImagesDays": 30,
    "retentionJobsDays": 14,
    "keepReportsOnly": False,
}


@router.get("/admin/users")
def list_admin_users(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="users", action="list")
    users = session.scalars(select(models.User).order_by(models.User.created_at.desc())).all()
    return [user_to_read(user) for user in users]


@router.get("/admin/application-versions")
def list_application_versions(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="applications", action="list")
    versions = session.scalars(select(models.ApplicationVersion).order_by(models.ApplicationVersion.created_at.desc())).all()
    return [application_version_to_read(version) for version in versions]


@router.get("/admin/assets")
def list_assets(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="assets", action="read")
    assets = session.scalars(select(models.Asset).order_by(models.Asset.created_at.desc())).all()
    return [asset_to_read(asset) for asset in assets]


@router.get("/admin/review-decisions")
def list_review_decisions(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="reviews", action="read")
    decisions = session.scalars(select(models.ReviewDecision).order_by(models.ReviewDecision.created_at.desc())).all()
    return [review_decision_to_read(decision) for decision in decisions]


@router.get("/admin/correction-requests")
def list_correction_requests(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="reviews", action="request_correction")
    corrections = session.scalars(select(models.CorrectionRequest).order_by(models.CorrectionRequest.created_at.desc())).all()
    return [correction_request_to_read(correction) for correction in corrections]


@router.get("/admin/reports")
def list_reports(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="reports", action="read")
    reviews = session.scalars(select(models.Review).order_by(models.Review.created_at.desc()).limit(250)).all()
    return [
        {
            "id": f"{review.id}.json",
            "reviewId": review.id,
            "applicationId": review.application_id,
            "format": "json",
            "status": review.status,
            "available": bool(review.result_json),
            "downloadUrl": f"/api/reports/{review.id}.json",
            "createdAt": review.created_at,
            "completedAt": review.completed_at,
        }
        for review in reviews
    ]


@router.get("/admin/fixtures")
def list_fixtures(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        # Fixtures are an evaluator/admin surface, not reviewer/applicant data.
        raise HTTPException(status_code=403, detail="Only admins can inspect fixture manifests.")
    repo_root = Path(__file__).resolve().parents[4]
    manifests = [
        repo_root / "browser-demo" / "public" / "label-packets" / "manifest.json",
        repo_root / "fixtures" / "public-cola-registry" / "manifest.json",
    ]
    rows: list[dict] = []
    for manifest in manifests:
        if not manifest.exists():
            continue
        payload = json.loads(manifest.read_text())
        entries = payload.get("packets") or payload.get("records") or payload.get("fixtures") or []
        if isinstance(entries, dict):
            entries = entries.values()
        for entry in entries:
            if isinstance(entry, dict):
                rows.append({"id": entry.get("id") or entry.get("ttbId") or entry.get("name"), "manifest": str(manifest.relative_to(repo_root)), **entry})
    return rows


@router.get("/audit-events", response_model=list[AuditEventRead])
def list_audit_events(
    limit: int = 100,
    actor_role: str | None = None,
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="auditEvents", action="manage")
    safe_limit = max(1, min(limit, 250))
    query = select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(safe_limit)
    if actor_role:
        query = query.where(models.AuditEvent.actor_role == actor_role)
    if event_type:
        query = query.where(models.AuditEvent.event_type == event_type)
    if entity_type:
        query = query.where(models.AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.where(models.AuditEvent.entity_id == entity_id)
    events = session.scalars(query).all()
    return [audit_event_to_read(event) for event in events]


@router.get("/settings", response_model=list[SettingRead])
def list_settings(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="read")
    setting = ensure_admin_settings(session)
    settings = session.scalars(select(models.Setting).order_by(models.Setting.key)).all()
    if setting not in settings:
        settings = [setting, *settings]
    return [setting_to_read(item) for item in settings]


@router.patch("/settings/{key:path}", response_model=SettingRead)
def update_setting(
    key: str,
    payload: SettingUpdate,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="manage")
    setting = session.get(models.Setting, key)
    before = dict(setting.value_json) if setting else None
    next_value = dict(payload.value)
    if key == ADMIN_SETTINGS_KEY:
        next_value = {**DEFAULT_ADMIN_SETTINGS, **(before or {}), **payload.value}
    if setting:
        setting.value_json = next_value
        setting.updated_at = models.now_utc()
    else:
        setting = models.Setting(key=key, value_json=next_value)
        session.add(setting)
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="settings.update",
            entity_type="settings",
            entity_id=key,
            summary=f"Updated setting {key}.",
            before_json=before,
            after_json=next_value,
            metadata_json={"key": key},
        )
    )
    session.commit()
    session.refresh(setting)
    return setting_to_read(setting)


@router.get("/admin/benchmarks/results", response_model=list[BenchmarkRunRead])
def list_benchmark_results(request: Request, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="benchmarks", action="list")
    return list_benchmark_runs(request.app.state.settings.benchmark_results_dir)


@router.post("/admin/benchmarks/run", response_model=list[BenchmarkRunRead])
def run_benchmark(
    payload: BenchmarkRunRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="benchmarks", action="run")
    workers = [
        worker_read
        for worker_read in (worker_to_read(worker) for worker in session.scalars(select(models.Worker).order_by(models.Worker.last_seen_at.desc())).all())
        if worker_available_for_benchmark(worker_read)
    ]
    suite = run_benchmark_suite(
        results_dir=request.app.state.settings.benchmark_results_dir,
        modes=[payload.mode],
        counts=[payload.imageCount],
        label=payload.label or f"{payload.imageCount} image {payload.mode} admin run",
        workers=workers,
    )
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="benchmark.run",
            entity_type="benchmarks",
            entity_id=suite["id"],
            summary=f"Ran {payload.imageCount} image {payload.mode} benchmark.",
            metadata_json={"benchmarkId": suite["id"], "imageCount": payload.imageCount, "mode": payload.mode},
        )
    )
    session.commit()
    return suite["runs"]


@router.post("/admin/retention/purge-old-jobs", response_model=OperationResult)
def purge_old_jobs(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="purge")
    jobs = session.scalars(select(models.Job).where(models.Job.status.in_(["completed", "failed", "cancelled"]))).all()
    for job in jobs:
        session.delete(job)
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.purge_old_jobs",
            entity_type="jobs",
            entity_id="bulk",
            summary=f"Purged {len(jobs)} completed, failed, and cancelled jobs.",
            metadata_json={"count": len(jobs)},
        )
    )
    session.commit()
    return {"ok": True, "count": len(jobs)}


@router.post("/admin/retention/purge-raw-images", response_model=OperationResult)
def purge_raw_images(request: Request, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="purge")
    assets = session.scalars(select(models.Asset)).all()
    purged = 0
    for asset in assets:
        if asset.storage_path and not asset.storage_path.startswith("purged:"):
            safe_unlink_asset_path(asset.storage_path, request.app.state.settings.asset_root)
            asset.storage_path = f"purged:{asset.id}"
            asset.size_bytes = 0
            purged += 1
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.purge_raw_images",
            entity_type="assets",
            entity_id="bulk",
            summary=f"Purged raw storage for {purged} assets.",
            metadata_json={"count": purged},
        )
    )
    session.commit()
    return {"ok": True, "count": purged}


@router.post("/admin/retention/delete-application/{application_id}", response_model=OperationResult)
def delete_application_packet(
    application_id: str,
    request: Request,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    application = session.get(models.Application, application_id)
    if not application:
        return {"ok": True, "count": 0}
    application_number = application_number_for(application)
    for asset in list(application.assets):
        safe_unlink_asset_path(asset.storage_path, request.app.state.settings.asset_root)
    review_ids = [review.id for review in application.reviews]
    if review_ids:
        session.execute(delete(models.ReviewDecision).where(models.ReviewDecision.review_id.in_(review_ids)))
    session.execute(delete(models.CorrectionRequest).where(models.CorrectionRequest.application_id == application_id))
    session.execute(delete(models.Job).where(models.Job.application_id == application_id))
    session.execute(delete(models.Review).where(models.Review.application_id == application_id))
    session.execute(delete(models.ApplicationVersion).where(models.ApplicationVersion.application_id == application_id))
    session.execute(delete(models.Asset).where(models.Asset.application_id == application_id))
    session.delete(application)
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.delete_packet",
            entity_type="applications",
            entity_id=application_id,
            summary=f"Deleted application packet {application_number}.",
            metadata_json={"applicationId": application_id, "applicationNumber": application_number},
        )
    )
    session.commit()
    return {"ok": True, "count": 1}


@router.post("/admin/retention/purge-all-demo-data", response_model=OperationResult)
def purge_all_demo_data(request: Request, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="purge")
    assets = session.scalars(select(models.Asset)).all()
    for asset in assets:
        safe_unlink_asset_path(asset.storage_path, request.app.state.settings.asset_root)

    review_ids = list(session.scalars(select(models.Review.id)).all())
    deleted_counts = {
        "applications": len(session.scalars(select(models.Application.id)).all()),
        "assets": len(assets),
        "reviews": len(review_ids),
        "jobs": len(session.scalars(select(models.Job.id)).all()),
        "correctionRequests": len(session.scalars(select(models.CorrectionRequest.id)).all()),
        "applicationVersions": len(session.scalars(select(models.ApplicationVersion.id)).all()),
        "reviewDecisions": len(session.scalars(select(models.ReviewDecision.id)).all()),
        "auditEvents": len(session.scalars(select(models.AuditEvent.id)).all()),
    }

    session.execute(delete(models.ReviewDecision))
    session.execute(delete(models.CorrectionRequest))
    session.execute(delete(models.Job))
    session.execute(delete(models.Review))
    session.execute(delete(models.ApplicationVersion))
    session.execute(delete(models.Asset))
    session.execute(delete(models.Application))
    session.execute(delete(models.AuditEvent))
    total = sum(deleted_counts.values())
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.purge_all_demo_data",
            entity_type="demo",
            entity_id="bulk",
            summary=f"Purged all demo application data ({total} records).",
            metadata_json={"counts": deleted_counts, "count": total},
        )
    )
    session.commit()
    return {"ok": True, "count": total}


def ensure_admin_settings(session: Session) -> models.Setting:
    setting = session.get(models.Setting, ADMIN_SETTINGS_KEY)
    if setting:
        return setting
    setting = models.Setting(key=ADMIN_SETTINGS_KEY, value_json=dict(DEFAULT_ADMIN_SETTINGS))
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
