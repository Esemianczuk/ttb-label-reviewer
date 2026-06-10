from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_session_id
from ..api.serializers import application_to_read, asset_to_read, review_to_read
from ..core.object_store import ObjectStore
from ..db import get_session
from ..schemas import ApplicationCreate, ApplicationRead, AssetRead, ReviewCreate, ReviewRead

router = APIRouter(prefix="/api/applications", tags=["applications"])


REVIEW_JOB_TYPES = ("ocr", "evidence_crop", "validation")


def require_application(session: Session, application_id: str, session_id: str) -> models.Application:
    application = session.get(models.Application, application_id)
    if not application or application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Application not found.")
    return application


def create_review_jobs(application: models.Application, review: models.Review, assets: list[models.Asset], priority: int) -> list[models.Job]:
    jobs: list[models.Job] = []
    for asset in assets:
        asset_payload = {
            "application_id": application.id,
            "review_id": review.id,
            "asset_id": asset.id,
            "filename": asset.original_filename,
            "mime_type": asset.mime_type,
            "storage_path": asset.storage_path,
            "expected_fields": application.expected_fields,
        }
        jobs.append(
            models.Job(
                application_id=application.id,
                review_id=review.id,
                session_id=application.session_id,
                job_type="ocr",
                status="queued",
                priority=priority,
                payload_json=asset_payload,
                required_capabilities={"ocr": True},
            )
        )
        jobs.append(
            models.Job(
                application_id=application.id,
                review_id=review.id,
                session_id=application.session_id,
                job_type="evidence_crop",
                status="queued",
                priority=priority + 10,
                payload_json={**asset_payload, "depends_on": "ocr"},
                required_capabilities={"evidence_crop": True},
            )
        )
    jobs.append(
        models.Job(
            application_id=application.id,
            review_id=review.id,
            session_id=application.session_id,
            job_type="validation",
            status="queued",
            priority=priority + 20,
            payload_json={
                "application_id": application.id,
                "review_id": review.id,
                "asset_ids": [asset.id for asset in assets],
                "expected_fields": application.expected_fields,
                "depends_on": ["ocr", "evidence_crop"],
            },
            required_capabilities={"validation": True},
        )
    )
    return jobs


@router.post("", response_model=ApplicationRead, status_code=201)
def create_application(
    payload: ApplicationCreate,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
):
    metadata = payload.metadata.model_dump(mode="json", exclude_none=True)
    if payload.applicationId:
        metadata.setdefault("applicationId", payload.applicationId)
    application = models.Application(
        id=payload.id or models.new_uuid(),
        session_id=session_id,
        source=payload.source,
        status="created",
        expected_fields=payload.expectedFields.model_dump(mode="json", exclude_none=True),
        metadata_json=metadata,
    )
    session.add(application)
    session.commit()
    session.refresh(application)
    return application_to_read(application)


@router.get("", response_model=list[ApplicationRead])
def list_applications(session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    applications = session.scalars(
        select(models.Application).where(models.Application.session_id == session_id).order_by(models.Application.created_at.desc())
    ).all()
    return [application_to_read(application) for application in applications]


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(application_id: str, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    return application_to_read(require_application(session, application_id, session_id))


@router.post("/{application_id}/images", response_model=AssetRead, status_code=201)
async def upload_image(
    application_id: str,
    request: Request,
    file: UploadFile = File(...),
    role: str = Form("unknown"),
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
):
    application = require_application(session, application_id, session_id)
    store = ObjectStore(request.app.state.settings.asset_root, request.app.state.settings.max_upload_bytes)
    try:
        stored = await store.store_upload(file)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    existing = session.scalars(select(models.Asset).where(models.Asset.sha256 == stored["sha256"])).first()
    if existing:
        if existing.application_id is None:
            existing.application_id = application.id
        elif existing.application_id != application.id:
            raise HTTPException(status_code=409, detail="Image already belongs to another application.")
        existing.role = role
        asset = existing
    else:
        asset = models.Asset(
            application_id=application.id,
            sha256=stored["sha256"],
            original_filename=stored["original_filename"],
            mime_type=stored["mime_type"],
            size_bytes=stored["size_bytes"],
            storage_path=stored["storage_path"],
            role=role,
        )
        session.add(asset)
    application.status = "assets_uploaded"
    session.commit()
    session.refresh(asset)
    return asset_to_read(asset)


@router.post("/{application_id}/review", response_model=ReviewRead, status_code=201)
def create_review(
    application_id: str,
    payload: ReviewCreate,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
):
    application = require_application(session, application_id, session_id)
    assets = list(application.assets)
    if not assets:
        raise HTTPException(status_code=400, detail="Application has no uploaded images.")
    review = models.Review(application_id=application.id, mode=payload.mode, status="queued")
    session.add(review)
    session.flush()
    for job in create_review_jobs(application, review, assets, payload.priority):
        session.add(job)
    application.status = "review_queued"
    session.commit()
    session.refresh(review)
    return review_to_read(review)
