from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
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
from ..core.demo_fixtures import ensure_demo_session, resolve_application_for_session
from ..core.security import safe_unlink_asset_path
from ..db import get_session
from ..schemas import AuditEventRead, BenchmarkRunRead, BenchmarkRunRequest, OperationResult, SettingRead, SettingUpdate

router = APIRouter(prefix="/api", tags=["admin"])

ADMIN_SETTINGS_KEY = "admin.operations"
DEFAULT_ADMIN_SETTINGS = {
    "preferredOcrEngine": "paddleocr",
    "browserOcrAllowed": True,
    "backendCpuOcrAllowed": True,
    "gpuOcrAllowed": False,
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
def list_application_versions(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="applications", action="list")
    ensure_demo_session(session, session_id)
    versions = session.scalars(
        select(models.ApplicationVersion)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.ApplicationVersion.created_at.desc())
    ).all()
    return [application_version_to_read(version) for version in versions]


@router.get("/admin/assets")
def list_assets(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="assets", action="read")
    ensure_demo_session(session, session_id)
    assets = session.scalars(
        select(models.Asset)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.Asset.created_at.desc())
    ).all()
    return [asset_to_read(asset) for asset in assets]


@router.get("/admin/review-decisions")
def list_review_decisions(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="reviews", action="read")
    decisions = session.scalars(
        select(models.ReviewDecision)
        .join(models.Review)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.ReviewDecision.created_at.desc())
    ).all()
    return [review_decision_to_read(decision) for decision in decisions]


@router.get("/admin/correction-requests")
def list_correction_requests(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="reviews", action="request_correction")
    corrections = session.scalars(
        select(models.CorrectionRequest)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.CorrectionRequest.created_at.desc())
    ).all()
    return [correction_request_to_read(correction) for correction in corrections]


@router.get("/admin/reports")
def list_reports(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="reports", action="read")
    reviews = session.scalars(
        select(models.Review)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
        .order_by(models.Review.created_at.desc())
        .limit(250)
    ).all()
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


@router.get("/admin/ocr-model-status")
def ocr_model_status(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="read")
    repo_root = Path(__file__).resolve().parents[4]
    worker_path = repo_root / "apps" / "worker"
    if str(worker_path) not in sys.path:
        sys.path.append(str(worker_path))
    try:
        from ttb_worker.extraction.model_status import paddleocr_field_extractor_status

        return [paddleocr_field_extractor_status()]
    except Exception as error:
        return [
            {
                "id": "paddleocr-field-alignment",
                "status": "unavailable",
                "trainedModelLoaded": False,
                "mode": "paddleocr-weak-field-alignment",
                "modelDir": None,
                "message": f"Unable to inspect field extractor model status: {error}",
                "modelCard": None,
                "metrics": None,
                "failureReport": None,
            }
        ]


@router.get("/audit-events", response_model=list[AuditEventRead])
def list_audit_events(
    limit: int = 100,
    actor_role: str | None = None,
    event_type: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="auditEvents", action="manage")
    safe_limit = max(1, min(limit, 250))
    ensure_demo_session(session, session_id)
    query = select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(max(safe_limit * 4, 250))
    if actor_role:
        query = query.where(models.AuditEvent.actor_role == actor_role)
    if event_type:
        query = query.where(models.AuditEvent.event_type == event_type)
    if entity_type:
        query = query.where(models.AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.where(models.AuditEvent.entity_id == entity_id)
    events = [
        event
        for event in session.scalars(query).all()
        if audit_event_visible_in_session(session, event, session_id)
    ][:safe_limit]
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
def purge_old_jobs(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    jobs = session.scalars(
        select(models.Job).where(
            models.Job.session_id == session_id,
            models.Job.status.in_(["completed", "failed", "cancelled"]),
        )
    ).all()
    for job in jobs:
        session.delete(job)
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.purge_old_jobs",
            entity_type="jobs",
            entity_id="bulk",
            summary=f"Purged {len(jobs)} completed, failed, and cancelled jobs for the active demo session.",
            metadata_json={"count": len(jobs), "sessionId": session_id},
        )
    )
    session.commit()
    return {"ok": True, "count": len(jobs)}


@router.post("/admin/retention/purge-raw-images", response_model=OperationResult)
def purge_raw_images(
    request: Request,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    assets = session.scalars(
        select(models.Asset)
        .join(models.Application)
        .where(models.Application.session_id == session_id)
    ).all()
    purged = 0
    for asset in assets:
        if asset.storage_path and not asset.storage_path.startswith("purged:"):
            unlink_asset_if_not_referenced(session, asset, request.app.state.settings.asset_root)
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
            summary=f"Purged raw storage for {purged} assets in the active demo session.",
            metadata_json={"count": purged, "sessionId": session_id},
        )
    )
    session.commit()
    return {"ok": True, "count": purged}


@router.post("/admin/retention/delete-application/{application_id}", response_model=OperationResult)
def delete_application_packet(
    application_id: str,
    request: Request,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    application = resolve_application_for_session(session, application_id, session_id)
    if not application:
        return {"ok": True, "count": 0}
    application_id = application.id
    application_number = application_number_for(application)
    for asset in list(application.assets):
        unlink_asset_if_not_referenced(session, asset, request.app.state.settings.asset_root)
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
            metadata_json={"applicationId": application_id, "applicationNumber": application_number, "sessionId": session_id},
        )
    )
    session.commit()
    return {"ok": True, "count": 1}


@router.post("/admin/retention/purge-all-demo-data", response_model=OperationResult)
def purge_all_demo_data(
    request: Request,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    application_ids = list(session.scalars(select(models.Application.id).where(models.Application.session_id == session_id)).all())
    if not application_ids:
        return {"ok": True, "count": 0}
    assets = session.scalars(select(models.Asset).where(models.Asset.application_id.in_(application_ids))).all()
    for asset in assets:
        unlink_asset_if_not_referenced(session, asset, request.app.state.settings.asset_root)

    review_ids = list(session.scalars(select(models.Review.id).where(models.Review.application_id.in_(application_ids))).all())
    asset_ids = [asset.id for asset in assets]
    deleted_counts = {
        "applications": len(application_ids),
        "assets": len(assets),
        "reviews": len(review_ids),
        "jobs": len(session.scalars(select(models.Job.id).where(models.Job.session_id == session_id)).all()),
        "correctionRequests": len(session.scalars(select(models.CorrectionRequest.id).where(models.CorrectionRequest.application_id.in_(application_ids))).all()),
        "applicationVersions": len(session.scalars(select(models.ApplicationVersion.id).where(models.ApplicationVersion.application_id.in_(application_ids))).all()),
        "reviewDecisions": len(session.scalars(select(models.ReviewDecision.id).where(models.ReviewDecision.review_id.in_(review_ids))).all()) if review_ids else 0,
    }

    if review_ids:
        session.execute(delete(models.ReviewDecision).where(models.ReviewDecision.review_id.in_(review_ids)))
    session.execute(delete(models.CorrectionRequest).where(models.CorrectionRequest.application_id.in_(application_ids)))
    session.execute(delete(models.Job).where(models.Job.session_id == session_id))
    session.execute(delete(models.Review).where(models.Review.application_id.in_(application_ids)))
    session.execute(delete(models.ApplicationVersion).where(models.ApplicationVersion.application_id.in_(application_ids)))
    if asset_ids:
        session.execute(delete(models.Asset).where(models.Asset.id.in_(asset_ids)))
    session.execute(delete(models.Application).where(models.Application.id.in_(application_ids)))
    total = sum(deleted_counts.values())
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="retention.purge_all_demo_data",
            entity_type="demo",
            entity_id="bulk",
            summary=f"Purged demo application data for the active session ({total} records).",
            metadata_json={"counts": deleted_counts, "count": total, "sessionId": session_id},
        )
    )
    session.commit()
    return {"ok": True, "count": total}


def audit_event_visible_in_session(session: Session, event: models.AuditEvent, session_id: str) -> bool:
    metadata = event.metadata_json if isinstance(event.metadata_json, dict) else {}
    if metadata.get("sessionId") == session_id:
        return True

    entity_type = str(event.entity_type or "").lower()
    if entity_type in {"settings", "workers", "benchmarks"}:
        return True
    if str(event.event_type or "").startswith("authz."):
        return True
    entity_id = str(event.entity_id or "")
    if entity_type.startswith("application") or entity_type == "applications":
        return bool(session.get(models.Application, entity_id) and session.get(models.Application, entity_id).session_id == session_id)
    if entity_type.startswith("review") or entity_type == "reviews":
        review = session.get(models.Review, entity_id)
        return bool(review and review.application and review.application.session_id == session_id)
    if entity_type.startswith("job") or entity_type == "jobs":
        job = session.get(models.Job, entity_id)
        return bool(job and job.session_id == session_id)

    application_id = metadata.get("applicationId")
    if isinstance(application_id, str):
        application = session.get(models.Application, application_id)
        return bool(application and application.session_id == session_id)
    review_id = metadata.get("reviewId")
    if isinstance(review_id, str):
        review = session.get(models.Review, review_id)
        return bool(review and review.application and review.application.session_id == session_id)
    return False


def unlink_asset_if_not_referenced(session: Session, asset: models.Asset, asset_root: Path) -> None:
    if not asset.storage_path or asset.storage_path.startswith("purged:"):
        return
    other_reference = session.scalar(
        select(models.Asset.id).where(
            models.Asset.id != asset.id,
            models.Asset.storage_path == asset.storage_path,
        )
    )
    if not other_reference:
        safe_unlink_asset_path(asset.storage_path, asset_root)


def ensure_admin_settings(session: Session) -> models.Setting:
    setting = session.get(models.Setting, ADMIN_SETTINGS_KEY)
    if setting:
        return setting
    setting = models.Setting(key=ADMIN_SETTINGS_KEY, value_json=dict(DEFAULT_ADMIN_SETTINGS))
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
