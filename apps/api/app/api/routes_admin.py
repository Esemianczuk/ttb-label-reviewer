from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, require_permission
from ..api.serializers import audit_event_to_read, setting_to_read
from ..db import get_session
from ..schemas import AuditEventRead, OperationResult, SettingRead, SettingUpdate

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
def purge_raw_images(session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="settings", action="purge")
    assets = session.scalars(select(models.Asset)).all()
    purged = 0
    for asset in assets:
        if asset.storage_path and not asset.storage_path.startswith("purged:"):
            path = Path(asset.storage_path)
            try:
                if path.exists():
                    path.unlink()
            except OSError:
                pass
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
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="settings", action="purge")
    application = session.get(models.Application, application_id)
    if not application:
        return {"ok": True, "count": 0}
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
            summary=f"Deleted application packet {application_id}.",
            metadata_json={"applicationId": application_id},
        )
    )
    session.commit()
    return {"ok": True, "count": 1}


def ensure_admin_settings(session: Session) -> models.Setting:
    setting = session.get(models.Setting, ADMIN_SETTINGS_KEY)
    if setting:
        return setting
    setting = models.Setting(key=ADMIN_SETTINGS_KEY, value_json=dict(DEFAULT_ADMIN_SETTINGS))
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
