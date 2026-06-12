from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .. import models
from ..schemas import ApplicationTransitionRequest
from .application_numbers import application_number_for, metadata_with_existing_application_number
from .rbac import can_access, log_audit_event
from .statuses import canonical_application_status


TERMINAL_FAILURE_STATUSES = {"FAIL", "NOT_FOUND", "REJECTED", "FAILED"}


@dataclass(frozen=True)
class TransitionRule:
    from_statuses: set[str]
    to_status: str
    resource: str
    action: str


class TransitionError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


TRANSITION_RULES: dict[str, TransitionRule] = {
    "run_precheck": TransitionRule({"DRAFT", "APPLICANT_FIX_REQUIRED"}, "PRECHECK_RUNNING", "applications", "run_precheck"),
    "precheck_pass": TransitionRule({"PRECHECK_RUNNING"}, "READY_TO_SUBMIT", "applications", "run_precheck"),
    "precheck_fail": TransitionRule({"PRECHECK_RUNNING"}, "APPLICANT_FIX_REQUIRED", "applications", "run_precheck"),
    "submit": TransitionRule({"READY_TO_SUBMIT"}, "SUBMITTED", "applications", "submit"),
    "start_review": TransitionRule({"SUBMITTED", "RESUBMITTED"}, "IN_REVIEW", "reviews", "create"),
    "request_correction": TransitionRule({"IN_REVIEW"}, "NEEDS_CORRECTION", "reviews", "request_correction"),
    "resubmit": TransitionRule({"NEEDS_CORRECTION"}, "RESUBMITTED", "applications", "resubmit"),
    "approve": TransitionRule({"IN_REVIEW"}, "APPROVED", "reviews", "approve"),
    "reject": TransitionRule({"IN_REVIEW"}, "REJECTED", "reviews", "reject"),
    "conditionally_approve": TransitionRule({"IN_REVIEW"}, "CONDITIONALLY_APPROVED", "reviews", "conditionally_approve"),
    "withdraw": TransitionRule({"DRAFT", "SUBMITTED"}, "WITHDRAWN", "applications", "withdraw"),
    "archive": TransitionRule({"APPROVED", "REJECTED"}, "ARCHIVED", "applications", "archive"),
}


def transition_application(
    session: Session,
    *,
    application: models.Application,
    actor: models.User,
    payload: ApplicationTransitionRequest,
) -> models.Application:
    rule = TRANSITION_RULES[payload.transition]
    before_status = canonical_application_status(application.status)
    before_json = application_snapshot(application, before_status)

    authorize_transition(session, application, actor, payload.transition, rule)
    if before_status not in rule.from_statuses:
        raise TransitionError(
            400,
            f"Cannot {payload.transition} application from {before_status}. Allowed from: {', '.join(sorted(rule.from_statuses))}.",
        )

    run_transition_guards(session, application, actor, payload, before_status)
    apply_transition_side_effects(session, application, actor, payload)
    application.status = rule.to_status

    application_number = application_number_for(application)
    event = log_audit_event(
        session,
        actor=actor,
        actor_role=actor.role,
        event_type="application.transition",
        entity_type="applications",
        entity_id=application.id,
        summary=transition_summary(application_number, payload.transition, before_status, rule.to_status, payload.note),
        before=before_json,
        after={"status": rule.to_status, "transition": payload.transition},
        metadata={
            "transition": payload.transition,
            "applicationId": application.id,
            "applicationNumber": application_number,
            "note": payload.note,
            "fieldKeys": payload.fieldKeys,
            "reviewerOverride": payload.reviewerOverride,
            "acknowledgedNoChangeCorrection": payload.acknowledgedNoChangeCorrection,
        },
    )
    session.flush()
    session.refresh(application)
    session.refresh(event)
    return application


def authorize_transition(
    session: Session,
    application: models.Application,
    actor: models.User,
    transition: str,
    rule: TransitionRule,
) -> None:
    if transition == "archive" and actor.role != "admin":
        decision_reason = "Only admins can archive applications."
    else:
        decision = can_access(actor, rule.resource, rule.action, application)
        if decision.can:
            return
        decision_reason = decision.reason or f"{actor.role} cannot {transition} applications."

    log_audit_event(
        session,
        actor=actor,
        actor_role=actor.role,
        event_type="authz.denied",
        entity_type="applications",
        entity_id=application.id,
        summary=decision_reason,
        metadata={
            "resource": rule.resource,
            "action": rule.action,
            "transition": transition,
            "applicationId": application.id,
            "applicationNumber": application_number_for(application),
        },
    )
    session.commit()
    raise TransitionError(403, decision_reason)


def run_transition_guards(
    session: Session,
    application: models.Application,
    actor: models.User,
    payload: ApplicationTransitionRequest,
    before_status: str,
) -> None:
    transition = payload.transition
    note = (payload.note or "").strip()

    if transition in {"run_precheck", "submit"} and not application.assets:
        raise TransitionError(400, f"Cannot {transition} application without at least one uploaded image.")
    if transition == "request_correction" and not note:
        raise TransitionError(400, "Requesting corrections requires a note for the applicant.")
    if transition == "reject" and not note:
        raise TransitionError(400, "Rejecting an application requires a reason.")
    if transition == "approve":
        failures = unresolved_critical_failures(application)
        if failures and not payload.reviewerOverride:
            raise TransitionError(
                400,
                f"Approval blocked by unresolved critical failures: {', '.join(failures)}. Use reviewerOverride with a note to proceed.",
            )
        if failures and not note:
            raise TransitionError(400, "Approving with reviewerOverride requires an override note.")
    if transition == "resubmit":
        has_new_version = payload.expectedFields is not None
        if not has_new_version and not payload.acknowledgedNoChangeCorrection:
            raise TransitionError(400, "Resubmission requires updated application fields or acknowledgedNoChangeCorrection=true.")
    if transition == "precheck_fail" and not payload.fieldKeys and not note:
        raise TransitionError(400, "A failed precheck requires fieldKeys or a note.")
    if transition == "withdraw" and before_status == "SUBMITTED" and actor.role == "reviewer":
        raise TransitionError(403, "Reviewers cannot withdraw applicant submissions.")

    # Touch the session so direct unit tests can assert no pending implicit work was skipped.
    session.flush()


def apply_transition_side_effects(
    session: Session,
    application: models.Application,
    actor: models.User,
    payload: ApplicationTransitionRequest,
) -> None:
    if payload.transition == "request_correction":
        latest_review = latest_application_review(application)
        session.add(
            models.CorrectionRequest(
                application_id=application.id,
                review_id=latest_review.id if latest_review else None,
                requested_by_user_id=actor.id,
                status="open",
                message=(payload.note or "").strip(),
                field_keys=payload.fieldKeys,
            )
        )
        return

    if payload.transition == "resubmit":
        if payload.expectedFields is not None:
            expected_fields = payload.expectedFields.model_dump(mode="json", exclude_none=True)
            metadata = metadata_with_existing_application_number(application)
            if payload.metadata is not None:
                metadata.update(payload.metadata.model_dump(mode="json", exclude_none=True))
            application.expected_fields = expected_fields
            application.metadata_json = metadata
            application.versions.append(
                models.ApplicationVersion(
                    version_number=next_version_number(application),
                    expected_fields=expected_fields,
                    metadata_json=metadata,
                    created_by_user_id=actor.id,
                    submitted_at=models.now_utc(),
                )
            )
        for correction in open_corrections(application):
            correction.status = "resolved"
            correction.resolved_at = models.now_utc()


def unresolved_critical_failures(application: models.Application) -> list[str]:
    review = latest_application_review(application)
    if not review or not review.result_json:
        return []
    failures: list[str] = []
    for field in review.result_json.get("fields", []):
        if not isinstance(field, dict):
            continue
        severity = str(field.get("severity") or "").lower()
        effective_status = str(
            field.get("reviewerStatus")
            or field.get("reviewer_status")
            or field.get("effectiveStatus")
            or field.get("effective_status")
            or field.get("status")
            or ""
        ).upper()
        if severity == "critical" and effective_status in TERMINAL_FAILURE_STATUSES:
            failures.append(str(field.get("fieldKey") or field.get("field") or "critical_field"))
    return failures


def latest_application_review(application: models.Application) -> models.Review | None:
    reviews = sorted(application.reviews or [], key=lambda review: review.created_at, reverse=True)
    return reviews[0] if reviews else None


def open_corrections(application: models.Application) -> list[models.CorrectionRequest]:
    return [correction for correction in application.correction_requests or [] if correction.status == "open"]


def next_version_number(application: models.Application) -> int:
    if not application.versions:
        return 1
    return max(version.version_number for version in application.versions) + 1


def application_snapshot(application: models.Application, status: str) -> dict[str, Any]:
    return {
        "id": application.id,
        "applicationNumber": application_number_for(application),
        "status": status,
        "versionCount": len(application.versions or []),
        "assetCount": len(application.assets or []),
    }


def transition_summary(application_number: str, transition: str, before_status: str, after_status: str, note: str | None) -> str:
    summary = f"{application_number} transitioned via {transition}: {before_status} -> {after_status}."
    if note:
        return f"{summary} Note: {note}"
    return summary
