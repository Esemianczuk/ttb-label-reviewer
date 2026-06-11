from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
from ..api.routes_applications import require_application
from ..api.serializers import job_to_read
from ..db import get_session
from ..schemas import JobRead

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def require_job(session: Session, job_id: str, session_id: str, current_user: models.User | None = None) -> models.Job:
    job = session.get(models.Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    require_application(session, job.application_id, session_id, current_user)
    return job


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


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(
    job_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    job = require_job(session, job_id, session_id, current_user)
    require_permission(session, current_user, resource="jobs", action="manage", entity=job, entity_id=job_id)
    if job.status not in {"completed", "failed"}:
        if job.assigned_worker_id:
            worker = session.get(models.Worker, job.assigned_worker_id)
            if worker:
                worker.active_jobs = max(0, worker.active_jobs - 1)
        job.status = "cancelled"
        job.error = "Cancelled by requester."
        job.assigned_worker_id = None
        job.lease_expires_at = None
        session.commit()
        session.refresh(job)
    return job_to_read(job)
