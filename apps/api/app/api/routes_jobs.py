from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
from ..api.routes_applications import require_application
from ..api.serializers import job_to_read
from ..core.application_numbers import application_number_for
from ..db import get_session
from ..schemas import JobRead

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def require_job(session: Session, job_id: str, session_id: str, current_user: models.User | None = None) -> models.Job:
    job = session.get(models.Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    require_application(session, job.application_id, session_id, current_user)
    return job


@router.get("", response_model=list[JobRead])
def list_jobs(
    limit: int = 100,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="jobs", action="manage")
    safe_limit = max(1, min(limit, 250))
    jobs = session.scalars(select(models.Job).order_by(models.Job.created_at.desc()).limit(safe_limit)).all()
    return [job_to_read(job) for job in jobs]


@router.get("/{job_id}", response_model=JobRead)
def get_job(
    job_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    job = require_job(session, job_id, session_id, current_user)
    require_permission(session, current_user, resource="jobs", action="read", entity=job, entity_id=job_id, not_found_for_applicant=True)
    return job_to_read(job)


@router.post("/{job_id}/retry", response_model=JobRead)
def retry_job(
    job_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    job = require_job(session, job_id, session_id, current_user)
    require_permission(session, current_user, resource="jobs", action="manage", entity=job, entity_id=job_id)
    application_number = application_number_for(job.application)
    before = {"status": job.status, "assignedWorkerId": job.assigned_worker_id, "error": job.error}
    if job.assigned_worker_id:
        worker = session.get(models.Worker, job.assigned_worker_id)
        if worker:
            worker.active_jobs = max(0, worker.active_jobs - 1)
    job.status = "queued"
    job.error = None
    job.assigned_worker_id = None
    job.lease_expires_at = None
    job.started_at = None
    job.completed_at = None
    job.updated_at = models.now_utc()
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="job.retry",
            entity_type="jobs",
            entity_id=job.id,
            summary=f"Retried job {job.id} for {application_number}.",
            before_json=before,
            after_json={"status": job.status, "priority": job.priority},
            metadata_json={"applicationId": job.application_id, "applicationNumber": application_number},
        )
    )
    session.commit()
    session.refresh(job)
    return job_to_read(job)


@router.post("/{job_id}/raise-priority", response_model=JobRead)
def raise_job_priority(
    job_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    job = require_job(session, job_id, session_id, current_user)
    require_permission(session, current_user, resource="jobs", action="manage", entity=job, entity_id=job_id)
    before_priority = job.priority
    application_number = application_number_for(job.application)
    job.priority = max(job.priority + 10, 110)
    job.updated_at = models.now_utc()
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="job.raise_priority",
            entity_type="jobs",
            entity_id=job.id,
            summary=f"Raised priority for job {job.id} for {application_number}.",
            before_json={"priority": before_priority},
            after_json={"priority": job.priority},
            metadata_json={"applicationId": job.application_id, "applicationNumber": application_number},
        )
    )
    session.commit()
    session.refresh(job)
    return job_to_read(job)


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(
    job_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    job = require_job(session, job_id, session_id, current_user)
    require_permission(session, current_user, resource="jobs", action="manage", entity=job, entity_id=job_id)
    application_number = application_number_for(job.application)
    if job.status not in {"completed", "failed"}:
        if job.assigned_worker_id:
            worker = session.get(models.Worker, job.assigned_worker_id)
            if worker:
                worker.active_jobs = max(0, worker.active_jobs - 1)
        job.status = "cancelled"
        job.error = "Cancelled by requester."
        job.assigned_worker_id = None
        job.lease_expires_at = None
        job.updated_at = models.now_utc()
        session.add(
            models.AuditEvent(
                actor_user_id=current_user.id,
                actor_role=current_user.role,
                event_type="job.cancel",
                entity_type="jobs",
                entity_id=job.id,
                summary=f"Cancelled job {job.id} for {application_number}.",
                metadata_json={"applicationId": job.application_id, "applicationNumber": application_number},
            )
        )
        session.commit()
        session.refresh(job)
    return job_to_read(job)
