from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_session_id
from ..api.serializers import asset_to_read
from ..db import get_session
from ..schemas import AssetRead

router = APIRouter(prefix="/api/assets", tags=["assets"])


def require_asset(session: Session, asset_id: str, session_id: str) -> models.Asset:
    asset = session.get(models.Asset, asset_id)
    if not asset or not asset.application or asset.application.session_id != session_id:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return asset


@router.get("/{asset_id}", response_model=AssetRead)
def get_asset_metadata(asset_id: str, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    return asset_to_read(require_asset(session, asset_id, session_id))


@router.get("/{asset_id}/content")
def get_asset_content(asset_id: str, session: Session = Depends(get_session), session_id: str = Depends(get_session_id)):
    asset = require_asset(session, asset_id, session_id)
    path = Path(asset.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file is missing.")
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_filename)
