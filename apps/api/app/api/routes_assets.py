from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import bearer_token, get_current_user, get_session_id, require_permission
from ..api.serializers import asset_to_read
from ..core.auth import verify_secret
from ..db import get_session
from ..schemas import AssetRead

router = APIRouter(prefix="/api/assets", tags=["assets"])


def require_asset(session: Session, asset_id: str, session_id: str, current_user: models.User | None = None) -> models.Asset:
    asset = session.get(models.Asset, asset_id)
    if not asset or not asset.application:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if current_user:
        require_permission(
            session,
            current_user,
            resource="assets",
            action="read",
            entity=asset,
            entity_id=asset_id,
            not_found_for_applicant=True,
        )
    elif asset.application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return asset


@router.get("/{asset_id}", response_model=AssetRead)
def get_asset_metadata(
    asset_id: str,
    session: Session = Depends(get_session),
    session_id: str = Depends(get_session_id),
    current_user: models.User = Depends(get_current_user),
):
    return asset_to_read(require_asset(session, asset_id, session_id, current_user))


@router.get("/{asset_id}/content")
def get_asset_content(asset_id: str, request: Request, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    asset = session.get(models.Asset, asset_id)
    if not asset or not asset.application:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not worker_authorized_for_asset(request, asset, session):
        current_user = get_current_user(request, session)
        require_permission(
            session,
            current_user,
            resource="assets",
            action="read",
            entity=asset,
            entity_id=asset_id,
            not_found_for_applicant=True,
        )
    path = Path(asset.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file is missing.")
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_filename)


def worker_authorized_for_asset(request: Request, asset: models.Asset, session: Session) -> bool:
    token = bearer_token(request)
    if not token or not asset.application:
        return False
    session_id = request.headers.get("X-Session-Id") or "local-dev-session"
    if asset.application.session_id != session_id:
        return False
    workers = session.scalars(select(models.Worker).where(models.Worker.worker_secret_hash.is_not(None))).all()
    worker = next((candidate for candidate in workers if verify_secret(token, candidate.worker_secret_hash)), None)
    if not worker:
        return False
    job = session.scalars(
        select(models.Job).where(
            models.Job.assigned_worker_id == worker.id,
            models.Job.application_id == asset.application_id,
            models.Job.status.in_(["leased", "running"]),
        )
    ).first()
    return job is not None
