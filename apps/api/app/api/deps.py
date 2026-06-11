from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models
from ..core.auth import verify_signed_token
from ..core.rbac import can_access, log_audit_event
from ..db import get_session


def get_session_id(x_session_id: str | None = Header(default=None, alias="X-Session-Id")) -> str:
    return x_session_id or "local-dev-session"


def bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def get_current_user(request: Request, session: Session = Depends(get_session)) -> models.User:
    token = bearer_token(request)
    payload = verify_signed_token(token, secret=request.app.state.settings.demo_token_secret)
    if not payload:
        raise HTTPException(status_code=401, detail="A valid demo bearer token is required.")
    user_id = payload.get("sub")
    user = session.get(models.User, user_id) if isinstance(user_id, str) else None
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="Demo user is not active.")
    return user


def require_permission(
    session: Session,
    user: models.User,
    *,
    resource: str,
    action: str,
    entity=None,
    entity_id: str | None = None,
    not_found_for_applicant: bool = False,
) -> None:
    decision = can_access(user, resource, action, entity)
    if decision.can:
        return
    log_audit_event(
        session,
        actor=user,
        actor_role=user.role,
        event_type="authz.denied",
        entity_type=resource,
        entity_id=entity_id or getattr(entity, "id", "*"),
        summary=decision.reason or f"{user.role} cannot {action} {resource}.",
        metadata={"resource": resource, "action": action},
    )
    session.commit()
    if not_found_for_applicant and user.role == "applicant":
        raise HTTPException(status_code=404, detail="Resource not found.")
    raise HTTPException(status_code=403, detail=decision.reason or "Forbidden.")
