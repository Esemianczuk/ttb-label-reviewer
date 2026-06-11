from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .. import models


@dataclass(frozen=True)
class AccessDecision:
    can: bool
    reason: str | None = None


def can_access(user: models.User, resource: str, action: str, entity: Any | None = None) -> AccessDecision:
    resource = resource.strip().lower()
    action = action.strip().lower()

    if user.status != "active":
        return AccessDecision(False, "User is not active.")
    if user.role == "admin":
        return AccessDecision(True)

    if user.role == "applicant":
        return applicant_can_access(user, resource, action, entity)
    if user.role == "reviewer":
        return reviewer_can_access(resource, action)
    return AccessDecision(False, f"Role {user.role!r} is not allowed.")


def applicant_can_access(user: models.User, resource: str, action: str, entity: Any | None) -> AccessDecision:
    if resource == "applications":
        if action == "create":
            return AccessDecision(True)
        if action in {"list", "read", "upload", "run_precheck", "submit", "withdraw"}:
            return owned_application_decision(user, entity)
    if resource in {"assets", "reviews", "reports", "jobs"} and action in {"read", "export", "cancel"}:
        application = application_from_entity(entity)
        return owned_application_decision(user, application)
    return AccessDecision(False, f"Applicants cannot {action} {resource}.")


def reviewer_can_access(resource: str, action: str) -> AccessDecision:
    allowed = {
        "applications": {"list", "read"},
        "assets": {"read"},
        "reviews": {"create", "read", "override", "request_correction", "approve", "reject", "conditionally_approve"},
        "reports": {"read", "export"},
        "jobs": {"read"},
        "authz": {"read"},
    }
    if action in allowed.get(resource, set()):
        return AccessDecision(True)
    return AccessDecision(False, f"Reviewers cannot {action} {resource}.")


def owned_application_decision(user: models.User, application: Any | None) -> AccessDecision:
    if application is None:
        return AccessDecision(True)
    owner_user_id = getattr(application, "owner_user_id", None)
    if owner_user_id == user.id:
        return AccessDecision(True)
    return AccessDecision(False, "Applicants can only access their own applications.")


def application_from_entity(entity: Any | None) -> models.Application | None:
    if entity is None:
        return None
    if isinstance(entity, models.Application):
        return entity
    if hasattr(entity, "application"):
        return entity.application
    if isinstance(entity, models.Review):
        return entity.application
    if isinstance(entity, models.Job):
        return entity.application
    return None


def log_audit_event(
    session: Session,
    *,
    actor: models.User | None,
    actor_role: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> models.AuditEvent:
    event = models.AuditEvent(
        actor_user_id=actor.id if actor else None,
        actor_role=actor.role if actor else actor_role,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        before_json=before,
        after_json=after,
        metadata_json=metadata or {},
    )
    session.add(event)
    return event
