from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, get_session_id, require_permission
from ..api.serializers import application_to_read, asset_to_read, review_to_read
from ..core.application_numbers import metadata_with_application_number
from ..core.application_workflow import TransitionError, transition_application
from ..core.object_store import ObjectStore
from ..db import get_session
from ..schemas import ApplicationCreate, ApplicationRead, ApplicationTransitionRequest, AssetRead, ReviewCreate, ReviewRead

router = APIRouter(prefix="/api/applications", tags=["applications"])


REVIEW_JOB_TYPES = ("ocr", "evidence_crop", "validation")
REVIEW_FIELD_LABELS = {
    "brandName": "Brand Name",
    "fancifulName": "Fanciful Name",
    "classType": "Class/Type",
    "alcoholContent": "Alcohol Content",
    "netContents": "Net Contents",
    "producerName": "Producer / Bottler / Importer",
    "countryOfOrigin": "Country of Origin",
    "governmentWarning": "Government Warning",
}
CRITICAL_FIELD_KEYS = {"brandName", "classType", "alcoholContent", "netContents", "governmentWarning"}


def require_application(
    session: Session,
    application_id: str,
    session_id: str,
    current_user: models.User | None = None,
    *,
    action: str = "read",
) -> models.Application:
    application = session.get(models.Application, application_id)
    if not application:
        raise HTTPException(status_code=404, detail="Application not found.")
    if current_user:
        require_permission(
            session,
            current_user,
            resource="applications",
            action=action,
            entity=application,
            entity_id=application_id,
            not_found_for_applicant=True,
        )
    elif application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Application not found.")
    return application


def create_review_jobs(application: models.Application, review: models.Review, assets: list[models.Asset], payload: ReviewCreate) -> list[models.Job]:
    jobs: list[models.Job] = []
    field_targets = review_field_targets(application.expected_fields, preferred_engine=payload.primaryEngine)
    for asset in assets:
        asset_payload = {
            "application_id": application.id,
            "review_id": review.id,
            "asset_id": asset.id,
            "filename": asset.original_filename,
            "mime_type": asset.mime_type,
            "storage_path": asset.storage_path,
            "expected_fields": application.expected_fields,
            "image_pixels": (asset.width or 0) * (asset.height or 0),
        }
        jobs.append(
            models.Job(
                application_id=application.id,
                review_id=review.id,
                session_id=application.session_id,
                job_type="ocr",
                status="queued",
                priority=payload.priority,
                payload_json={
                    **asset_payload,
                    "field_key": "label",
                    "field_label": "Label evidence",
                    "field_expected": "",
                    "field_critical": True,
                    "field_ocr": False,
                    "field_targets": field_targets,
                    "engine": "auto",
                    "preferred_engine": payload.primaryEngine,
                    "ocr_strategy": payload.ocrStrategy,
                    "target_latency_ms": payload.targetLatencyMs,
                },
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
                priority=payload.priority + 10,
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
            priority=payload.priority + 20,
            payload_json={
                "application_id": application.id,
                "review_id": review.id,
                "asset_ids": [asset.id for asset in assets],
                "field_targets": field_targets,
                "completed_ocr_results": [],
                "expected_fields": application.expected_fields,
                "depends_on": ["ocr", "evidence_crop"],
                "ocr_strategy": payload.ocrStrategy,
                "primary_engine": payload.primaryEngine,
                "fallback_engine": payload.fallbackEngine,
                "fallback_min_confidence": payload.fallbackMinConfidence,
                "target_latency_ms": payload.targetLatencyMs,
            },
            required_capabilities={"validation": True},
        )
    )
    return jobs


def review_field_targets(expected_fields: dict, *, preferred_engine: str = "paddleocr") -> list[dict]:
    targets: list[dict] = []
    for key, label in REVIEW_FIELD_LABELS.items():
        if key == "governmentWarning":
            if not expected_fields.get("governmentWarningRequired"):
                continue
            expected = "Government warning statement required"
        else:
            expected = expected_fields.get(key)
            if expected in (None, ""):
                continue
        targets.append(
            {
                "fieldKey": key,
                "label": label,
                "expected": expected,
                "critical": key in CRITICAL_FIELD_KEYS,
                "engine": preferred_engine,
            }
        )
    return targets or [{"fieldKey": "label", "label": "Label evidence", "expected": "", "critical": False, "engine": preferred_engine}]


@router.post("", response_model=ApplicationRead, status_code=201)
def create_application(
    payload: ApplicationCreate,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="applications", action="create")
    metadata = payload.metadata.model_dump(mode="json", exclude_none=True)
    if payload.applicationId:
        metadata.setdefault("applicationId", payload.applicationId)
    metadata = metadata_with_application_number(session, metadata)
    expected_fields = payload.expectedFields.model_dump(mode="json", exclude_none=True)
    application = models.Application(
        id=payload.id or models.new_uuid(),
        session_id=session_id,
        source=payload.source,
        status="DRAFT",
        owner_user_id=current_user.id,
        organization_id=current_user.organization_id,
        expected_fields=expected_fields,
        metadata_json=metadata,
    )
    application.versions.append(
        models.ApplicationVersion(
            version_number=1,
            expected_fields=expected_fields,
            metadata_json=metadata,
            created_by_user_id=current_user.id,
        )
    )
    session.add(application)
    session.commit()
    session.refresh(application)
    return application_to_read(application)


@router.get("", response_model=list[ApplicationRead])
def list_applications(
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    require_permission(session, current_user, resource="applications", action="list")
    query = select(models.Application).order_by(models.Application.created_at.desc())
    if current_user.role == "applicant":
        query = query.where(models.Application.owner_user_id == current_user.id)
    elif current_user.role != "admin":
        query = query.where(models.Application.session_id == session_id)
    applications = session.scalars(query).all()
    return [application_to_read(application) for application in applications]


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(
    application_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    return application_to_read(require_application(session, application_id, session_id, current_user))


@router.post("/{application_id}/images", response_model=AssetRead, status_code=201)
async def upload_image(
    application_id: str,
    request: Request,
    file: UploadFile = File(...),
    role: str = Form("unknown"),
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    application = require_application(session, application_id, session_id, current_user, action="upload")
    store = ObjectStore(request.app.state.settings.asset_root, request.app.state.settings.max_upload_bytes)
    try:
        stored = await store.store_upload(file)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    existing = session.scalars(
        select(models.Asset).where(models.Asset.sha256 == stored["sha256"], models.Asset.application_id == application.id)
    ).first()
    if existing:
        existing.original_filename = stored["original_filename"]
        existing.mime_type = stored["mime_type"]
        existing.size_bytes = stored["size_bytes"]
        existing.storage_path = stored["storage_path"]
        existing.role = role
        existing.width = stored["width"]
        existing.height = stored["height"]
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
            width=stored["width"],
            height=stored["height"],
        )
        session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset_to_read(asset)


@router.post("/{application_id}/transition", response_model=ApplicationRead)
def transition(
    application_id: str,
    payload: ApplicationTransitionRequest,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    application = require_application(session, application_id, session_id, current_user, action="read")
    try:
        transition_application(session, application=application, actor=current_user, payload=payload)
    except TransitionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    session.commit()
    session.refresh(application)
    return application_to_read(application)


@router.post("/{application_id}/review", response_model=ReviewRead, status_code=201)
def create_review(
    application_id: str,
    payload: ReviewCreate,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    application = require_application(
        session,
        application_id,
        session_id,
        current_user,
        action="run_precheck" if current_user.role == "applicant" else "read",
    )
    if current_user.role != "applicant":
        require_permission(session, current_user, resource="reviews", action="create", entity=application, entity_id=application_id)
    assets = list(application.assets)
    if not assets:
        raise HTTPException(status_code=400, detail="Application has no uploaded images.")
    review = models.Review(application_id=application.id, mode=payload.mode, status="queued")
    session.add(review)
    session.flush()
    for job in create_review_jobs(application, review, assets, payload):
        session.add(job)
    application.status = "IN_REVIEW"
    session.commit()
    session.refresh(review)
    return review_to_read(review)
