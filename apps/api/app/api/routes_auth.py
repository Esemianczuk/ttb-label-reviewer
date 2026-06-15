from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..api.deps import get_current_user
from ..api.serializers import user_to_read
from ..core.auth import issue_signed_token
from ..core.demo_identity import DEMO_USERS
from ..core.rbac import AccessDecision, can_access, log_audit_event
from ..db import get_session
from ..schemas import AuthzCanRequest, AuthzCanResponse, DemoLoginRequest, DemoLoginResponse, LogoutResponse, UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])
authz_router = APIRouter(prefix="/api/authz", tags=["authz"])


@router.post("/demo-login", response_model=DemoLoginResponse)
def demo_login(payload: DemoLoginRequest, request: Request, session: Session = Depends(get_session)):
    seed = DEMO_USERS[payload.role]
    user = session.scalar(select(models.User).where(models.User.email == seed["email"]))
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail="Demo user is unavailable.")
    token, expires_at = issue_signed_token(
        {"sub": user.id, "role": user.role, "email": user.email},
        secret=request.app.state.settings.demo_token_secret,
        ttl_seconds=request.app.state.settings.demo_token_ttl_seconds,
    )
    log_audit_event(
        session,
        actor=user,
        actor_role=user.role,
        event_type="auth.demo_login",
        entity_type="users",
        entity_id=user.id,
        summary=f"{user.display_name} started a demo session.",
        metadata={"role": user.role, "sessionId": request.headers.get("X-Session-Id") or "local-dev-session"},
    )
    session.commit()
    return {"user": user_to_read(user), "token": token, "expiresAt": expires_at}


@router.get("/me", response_model=UserRead)
def me(request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request, session)
    return user_to_read(user)


@router.post("/logout", response_model=LogoutResponse)
def logout(request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request, session)
    log_audit_event(
        session,
        actor=user,
        actor_role=user.role,
        event_type="auth.logout",
        entity_type="users",
        entity_id=user.id,
        summary=f"{user.display_name} ended a demo session.",
    )
    session.commit()
    return {"ok": True}


@authz_router.post("/can", response_model=AuthzCanResponse)
def can(payload: AuthzCanRequest, request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request, session)
    entity = resolve_entity(payload, session)
    if payload.entityId and entity is None:
        decision = AccessDecision(False, "Resource not found.")
    else:
        decision = can_access(user, payload.resource, payload.action, entity)
    log_audit_event(
        session,
        actor=user,
        actor_role=user.role,
        event_type="authz.checked",
        entity_type=payload.resource,
        entity_id=payload.entityId or "*",
        summary=decision.reason or f"{user.role} can {payload.action} {payload.resource}.",
        metadata={"resource": payload.resource, "action": payload.action, "can": decision.can},
    )
    session.commit()
    return {"can": decision.can, "reason": decision.reason}


def resolve_entity(payload: AuthzCanRequest, session: Session):
    if not payload.entityId:
        return None
    resource = payload.resource.strip().lower()
    if resource == "applications":
        return session.get(models.Application, payload.entityId)
    if resource == "reviews":
        return session.get(models.Review, payload.entityId)
    if resource == "assets":
        return session.get(models.Asset, payload.entityId)
    if resource == "jobs":
        return session.get(models.Job, payload.entityId)
    return None
