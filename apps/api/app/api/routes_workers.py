from __future__ import annotations

from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, require_permission
from ..api.serializers import job_to_read, worker_event_to_read, worker_to_read
from ..core.auth import generate_secret, hash_secret, verify_secret
from ..core.join_tokens import consume_join_token, create_join_token, token_expired
from ..core.scheduler import claim_next_job
from ..db import get_session
from ..schemas import (
    JobClaimRequest,
    JobClaimResponse,
    JobCompleteRequest,
    JobFailRequest,
    JobRead,
    JoinTokenCreate,
    JoinTokenRead,
    WorkerEventRead,
    WorkerHeartbeat,
    WorkerRead,
    WorkerRegister,
    WorkerRegisterResponse,
)

router = APIRouter(prefix="/api/workers", tags=["workers"])


def require_worker(session: Session, worker_id: str) -> models.Worker:
    worker = session.get(models.Worker, worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found.")
    return worker


def mark_stale_workers(session: Session, *, stale_seconds: int) -> int:
    if stale_seconds <= 0:
        return 0
    stale_count = 0
    workers = session.scalars(select(models.Worker).where(~models.Worker.status.in_(["disabled", "lost", "offline"]))).all()
    for worker in workers:
        if worker_is_stale(worker, stale_seconds):
            mark_worker_lost(session, worker, stale_seconds=stale_seconds)
            stale_count += 1
    if stale_count:
        session.commit()
    return stale_count


def require_worker_fresh(session: Session, worker: models.Worker, *, stale_seconds: int) -> None:
    if stale_seconds <= 0 or not worker_is_stale(worker, stale_seconds):
        return
    mark_worker_lost(session, worker, stale_seconds=stale_seconds)
    session.commit()
    raise HTTPException(status_code=409, detail="Worker heartbeat is stale; send a heartbeat before claiming jobs.")


def worker_is_stale(worker: models.Worker, stale_seconds: int) -> bool:
    last_seen_at = worker.last_seen_at
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    return models.now_utc() - last_seen_at > timedelta(seconds=stale_seconds)


def mark_worker_lost(session: Session, worker: models.Worker, *, stale_seconds: int) -> None:
    before_status = worker.status
    lost_jobs = session.scalars(
        select(models.Job).where(models.Job.assigned_worker_id == worker.id, models.Job.status.in_(["leased", "running"]))
    ).all()
    for job in lost_jobs:
        job.status = "queued"
        job.assigned_worker_id = None
        job.lease_expires_at = None
        job.error = "Worker heartbeat timed out; job returned to queue."
    worker.status = "lost"
    worker.active_jobs = 0
    session.add(
        models.WorkerEvent(
            worker_id=worker.id,
            event_type="worker_lost",
            payload_json={
                "worker_id": worker.id,
                "previous_status": before_status,
                "stale_seconds": stale_seconds,
                "requeued_job_ids": [job.id for job in lost_jobs],
            },
        )
    )


@router.get("", response_model=list[WorkerRead])
def list_workers(request: Request, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage")
    mark_stale_workers(session, stale_seconds=request.app.state.settings.worker_stale_seconds)
    workers = session.scalars(select(models.Worker).order_by(models.Worker.last_seen_at.desc())).all()
    return [worker_to_read(worker) for worker in workers]


@router.get("/events", response_model=list[WorkerEventRead])
def list_worker_events(limit: int = 25, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage")
    safe_limit = max(1, min(limit, 100))
    events = session.scalars(select(models.WorkerEvent).order_by(models.WorkerEvent.created_at.desc()).limit(safe_limit)).all()
    return [worker_event_to_read(event) for event in events]


@router.post("/join-token", response_model=JoinTokenRead, status_code=201)
def issue_worker_join_token(
    payload: JoinTokenCreate,
    request: Request,
    session: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="workers", action="manage")
    settings = request.app.state.settings
    ttl_seconds = payload.ttlSeconds or settings.join_token_ttl_seconds
    coordinator_url = payload.coordinatorUrl or coordinator_url_for(request)
    token, record = create_join_token(session, ttl_seconds)
    session.commit()
    command = f"python -m ttb_worker --coordinator {coordinator_url} --join-token {token}"
    return {
        "token": token,
        "expiresAt": record.expires_at,
        "coordinatorUrl": coordinator_url,
        "command": command,
        "mdnsService": None,
        "warning": settings.lan_warning,
    }


@router.get("/{worker_id}", response_model=WorkerRead)
def get_worker(worker_id: str, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage", entity_id=worker_id)
    return worker_to_read(require_worker(session, worker_id))


@router.post("/register", response_model=WorkerRegisterResponse, status_code=201)
def register_worker(payload: WorkerRegister, request: Request, session: Session = Depends(get_session)):
    worker = session.get(models.Worker, payload.id)
    existing_secret_valid = bool(worker and worker_secret_authorized(request, worker, session))
    joined = False
    if payload.joinToken:
        joined = consume_join_token(session, payload.joinToken, payload.id)
    if request.app.state.settings.require_worker_join_token and not existing_secret_valid and not joined:
        session.add(
            models.AuditEvent(
                actor_user_id=None,
                actor_role="worker",
                event_type="authz.denied",
                entity_type="workers",
                entity_id=payload.id,
                summary="Worker registration rejected because a valid join token is required.",
                metadata_json={"resource": "workers", "action": "register"},
            )
        )
        session.commit()
        raise HTTPException(status_code=401, detail="A valid worker join token is required.")

    worker_secret = None
    if not existing_secret_valid:
        worker_secret = generate_secret("ttb_worker")
        worker_secret_hash = hash_secret(worker_secret)
    else:
        worker_secret_hash = worker.worker_secret_hash if worker else None

    if worker:
        worker.hostname = payload.hostname
        worker.platform = payload.platform
        worker.arch = payload.arch
        worker.version = payload.version
        worker.status = "online"
        worker.capabilities = payload.capabilities
        worker.calibration = payload.calibration
        worker.max_concurrency = payload.maxConcurrency
        worker.worker_secret_hash = worker_secret_hash
        worker.last_seen_at = models.now_utc()
    else:
        worker = models.Worker(
            id=payload.id,
            hostname=payload.hostname,
            platform=payload.platform,
            arch=payload.arch,
            version=payload.version,
            status="online",
            capabilities=payload.capabilities,
            calibration=payload.calibration,
            max_concurrency=payload.maxConcurrency,
            worker_secret_hash=worker_secret_hash,
            last_seen_at=models.now_utc(),
        )
        session.add(worker)
    session.add(
        models.WorkerEvent(
            worker_id=worker.id,
            event_type="worker_registered",
            payload_json=payload.model_dump(mode="json", exclude={"joinToken"}),
        )
    )
    session.commit()
    session.refresh(worker)
    response = worker_to_read(worker)
    response["workerSecret"] = worker_secret
    return response


@router.post("/{worker_id}/heartbeat", response_model=WorkerRead)
def heartbeat(worker_id: str, payload: WorkerHeartbeat, request: Request, session: Session = Depends(get_session)):
    worker = require_worker(session, worker_id)
    require_worker_auth(request, worker, session)
    now = models.now_utc()
    worker.status = payload.status
    worker.active_jobs = payload.activeJobs
    worker.last_seen_at = now
    if payload.capabilities is not None:
        worker.capabilities = payload.capabilities
    if payload.calibration is not None:
        worker.calibration = payload.calibration
    lease_expires_at = now + timedelta(seconds=request.app.state.settings.default_lease_seconds)
    leased_jobs = session.scalars(
        select(models.Job).where(
            models.Job.assigned_worker_id == worker.id,
            models.Job.status.in_(["leased", "running"]),
            models.Job.lease_expires_at.is_not(None),
        )
    ).all()
    for job in leased_jobs:
        job.lease_expires_at = lease_expires_at
    session.commit()
    session.refresh(worker)
    return worker_to_read(worker)


@router.post("/{worker_id}/recalibrate", response_model=WorkerRead)
def recalibrate(
    worker_id: str,
    request: Request,
    session: Session = Depends(get_session),
):
    worker = require_worker(session, worker_id)
    if not worker_secret_authorized(request, worker, session):
        current_user = get_current_user(request, session)
        require_permission(session, current_user, resource="workers", action="manage", entity_id=worker_id)
    calibration = dict(worker.calibration or {})
    calibration["recalibrationRequestedAt"] = models.now_utc().isoformat()
    calibration["recalibrationStatus"] = "requested"
    worker.calibration = calibration
    worker.last_seen_at = models.now_utc()
    session.add(
        models.WorkerEvent(
            worker_id=worker.id,
            event_type="worker_recalibration_requested",
            payload_json={"worker_id": worker.id},
        )
    )
    session.commit()
    session.refresh(worker)
    return worker_to_read(worker)


@router.post("/{worker_id}/drain", response_model=WorkerRead)
def drain_worker(worker_id: str, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage", entity_id=worker_id)
    worker = require_worker(session, worker_id)
    calibration = dict(worker.calibration or {})
    calibration["drainMode"] = True
    calibration["drainRequestedAt"] = models.now_utc().isoformat()
    worker.calibration = calibration
    worker.status = "draining"
    worker.last_seen_at = models.now_utc()
    session.add(models.WorkerEvent(worker_id=worker.id, event_type="worker_drain_requested", payload_json={"worker_id": worker.id}))
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="worker.drain",
            entity_type="workers",
            entity_id=worker.id,
            summary=f"Requested drain for worker {worker.id}.",
            metadata_json={"workerId": worker.id},
        )
    )
    session.commit()
    session.refresh(worker)
    return worker_to_read(worker)


@router.post("/{worker_id}/disable", response_model=WorkerRead)
def disable_worker(worker_id: str, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage", entity_id=worker_id)
    worker = require_worker(session, worker_id)
    calibration = dict(worker.calibration or {})
    calibration["disabled"] = True
    calibration["disabledAt"] = models.now_utc().isoformat()
    worker.calibration = calibration
    worker.status = "disabled"
    worker.last_seen_at = models.now_utc()
    session.add(models.WorkerEvent(worker_id=worker.id, event_type="worker_disabled", payload_json={"worker_id": worker.id}))
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="worker.disable",
            entity_type="workers",
            entity_id=worker.id,
            summary=f"Disabled worker {worker.id}.",
            metadata_json={"workerId": worker.id},
        )
    )
    session.commit()
    session.refresh(worker)
    return worker_to_read(worker)


@router.post("/{worker_id}/enable", response_model=WorkerRead)
def enable_worker(worker_id: str, session: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    require_permission(session, current_user, resource="workers", action="manage", entity_id=worker_id)
    worker = require_worker(session, worker_id)
    calibration = dict(worker.calibration or {})
    calibration["disabled"] = False
    calibration["drainMode"] = False
    calibration["enabledAt"] = models.now_utc().isoformat()
    worker.calibration = calibration
    worker.status = "online"
    worker.last_seen_at = models.now_utc()
    session.add(models.WorkerEvent(worker_id=worker.id, event_type="worker_enabled", payload_json={"worker_id": worker.id}))
    session.add(
        models.AuditEvent(
            actor_user_id=current_user.id,
            actor_role=current_user.role,
            event_type="worker.enable",
            entity_type="workers",
            entity_id=worker.id,
            summary=f"Enabled worker {worker.id}.",
            metadata_json={"workerId": worker.id},
        )
    )
    session.commit()
    session.refresh(worker)
    return worker_to_read(worker)


@router.post("/{worker_id}/claim", response_model=JobClaimResponse)
def claim(worker_id: str, payload: JobClaimRequest, request: Request, session: Session = Depends(get_session)):
    worker = require_worker(session, worker_id)
    require_worker_auth(request, worker, session)
    require_worker_fresh(session, worker, stale_seconds=request.app.state.settings.worker_stale_seconds)
    job, assignment = claim_next_job(
        session,
        worker=worker,
        supported_job_types=payload.supportedJobTypes,
        lease_seconds=request.app.state.settings.default_lease_seconds,
        session_id=payload.sessionId,
    )
    if job:
        session.add(models.WorkerEvent(worker_id=worker.id, event_type="job_claimed", payload_json={"job_id": job.id, "assignment": assignment}))
    session.commit()
    if not job:
        return {"job": None, "assignment": None}
    session.refresh(job)
    return {"job": job_to_read(job), "assignment": assignment}


@router.post("/{worker_id}/complete", response_model=JobRead)
def complete(worker_id: str, payload: JobCompleteRequest, request: Request, session: Session = Depends(get_session)):
    worker = require_worker(session, worker_id)
    require_worker_auth(request, worker, session)
    job = session.get(models.Job, payload.jobId)
    if not job or job.assigned_worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Assigned job not found.")
    if job.status == "completed":
        return job_to_read(job)
    now = models.now_utc()
    job.status = "completed"
    job.completed_at = now
    job.lease_expires_at = None
    job.result_json = payload.result
    if job.job_type == "ocr" and job.review_id:
        append_ocr_result_to_validation_jobs(session, job, payload.result)
    worker.active_jobs = max(0, worker.active_jobs - 1)
    worker.last_seen_at = now
    if job.review_id:
        review = session.get(models.Review, job.review_id)
        if review:
            is_review_result = job.job_type == "validation" or "review_result" in payload.result or "overallStatus" in payload.result
            if is_review_result:
                review_status = payload.result.get("overallStatus", payload.result.get("status", "completed"))
                review.status = str(review_status).lower()
                review.result_json = payload.result.get("review_result", payload.result)
                review.completed_at = now
                if review.application:
                    review.application.status = "IN_REVIEW"
            elif review.status == "queued":
                review.status = "processing"
    session.add(models.WorkerEvent(worker_id=worker.id, event_type="job_completed", payload_json={"job_id": job.id}))
    session.commit()
    session.refresh(job)
    return job_to_read(job)


def append_ocr_result_to_validation_jobs(session: Session, job: models.Job, result: dict) -> None:
    if not job.review_id:
        return
    payload = job.payload_json or {}
    result_entry = {
        "jobId": job.id,
        "assetId": result.get("assetId") or payload.get("asset_id") or payload.get("assetId"),
        "fieldKey": payload.get("field_key") or payload.get("fieldKey"),
        "fieldLabel": payload.get("field_label") or payload.get("fieldLabel"),
        "fieldExpected": payload.get("field_expected") or payload.get("fieldExpected"),
        "engine": result.get("engine"),
        "workerId": job.assigned_worker_id,
        "result": result,
    }
    validation_jobs = session.scalars(
        select(models.Job).where(
            models.Job.review_id == job.review_id,
            models.Job.job_type == "validation",
            models.Job.status.in_(["queued", "leased", "running"]),
        )
    ).all()
    for validation_job in validation_jobs:
        validation_payload = dict(validation_job.payload_json or {})
        completed_results = list(validation_payload.get("completed_ocr_results") or validation_payload.get("completedOcrResults") or [])
        if any(existing.get("jobId") == job.id for existing in completed_results if isinstance(existing, dict)):
            continue
        completed_results.append(result_entry)
        validation_payload["completed_ocr_results"] = completed_results
        validation_job.payload_json = validation_payload
        validation_job.updated_at = models.now_utc()


@router.post("/{worker_id}/fail", response_model=JobRead)
def fail(worker_id: str, payload: JobFailRequest, request: Request, session: Session = Depends(get_session)):
    worker = require_worker(session, worker_id)
    require_worker_auth(request, worker, session)
    job = session.get(models.Job, payload.jobId)
    if not job or job.assigned_worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Assigned job not found.")
    job.status = "queued" if payload.retryable else "failed"
    job.error = payload.error
    job.assigned_worker_id = None if payload.retryable else worker.id
    job.lease_expires_at = None
    worker.active_jobs = max(0, worker.active_jobs - 1)
    worker.last_seen_at = models.now_utc()
    if not payload.retryable and job.review_id and job.job_type == "validation":
        review = session.get(models.Review, job.review_id)
        if review:
            review.status = "failed"
            review.completed_at = models.now_utc()
            if review.application:
                review.application.status = "IN_REVIEW"
    session.add(models.WorkerEvent(worker_id=worker.id, event_type="job_failed", payload_json=payload.model_dump(mode="json")))
    session.commit()
    session.refresh(job)
    return job_to_read(job)


def require_worker_auth(request: Request, worker: models.Worker, session: Session) -> None:
    if worker_secret_authorized(request, worker, session):
        return
    session.add(
        models.AuditEvent(
            actor_user_id=None,
            actor_role="worker",
            event_type="authz.denied",
            entity_type="workers",
            entity_id=worker.id,
            summary="Worker authentication failed for a protected worker action.",
            metadata_json={"resource": "workers", "action": request.url.path},
        )
    )
    session.commit()
    raise HTTPException(status_code=401, detail="A valid worker secret or join token is required.")


def worker_secret_authorized(request: Request, worker: models.Worker, session: Session) -> bool:
    bearer = bearer_token(request)
    if verify_secret(bearer, worker.worker_secret_hash):
        return True
    join_token = request.headers.get("X-Join-Token")
    if not join_token:
        return False
    now = models.now_utc()
    for record in session.scalars(select(models.WorkerJoinToken).where(models.WorkerJoinToken.worker_id == worker.id)).all():
        if not token_expired(record.expires_at, now) and verify_secret(join_token, record.token_hash):
            return True
    return False


def bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def coordinator_url_for(request: Request) -> str:
    settings = request.app.state.settings
    if settings.coordinator_public_url:
        return settings.coordinator_public_url.rstrip("/")
    return str(request.base_url).rstrip("/")
