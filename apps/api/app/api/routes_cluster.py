from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user, require_permission
from ..core.join_tokens import create_join_token
from ..core.mdns import SERVICE_TYPE
from ..db import get_session
from ..schemas import ClusterStatusRead, JoinTokenCreate, JoinTokenRead

router = APIRouter(prefix="/api/cluster", tags=["cluster"])


@router.get("/status", response_model=ClusterStatusRead)
def cluster_status(request: Request, current_user: models.User = Depends(get_current_user), session: Session = Depends(get_session)):
    require_permission(session, current_user, resource="workers", action="manage")
    settings = request.app.state.settings
    coordinator_url = coordinator_url_for(request)
    return {
        "coordinatorUrl": coordinator_url,
        "mdnsEnabled": settings.enable_mdns,
        "mdnsService": SERVICE_TYPE,
        "lanMode": settings.lan_mode,
        "warning": settings.lan_warning,
    }


@router.post("/join-token", response_model=JoinTokenRead, status_code=201)
def issue_join_token(
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
        "mdnsService": SERVICE_TYPE if settings.enable_mdns else None,
        "warning": settings.lan_warning,
    }


def coordinator_url_for(request: Request) -> str:
    settings = request.app.state.settings
    if settings.coordinator_public_url:
        return settings.coordinator_public_url.rstrip("/")
    base_url = str(request.base_url).rstrip("/")
    return base_url
