from __future__ import annotations

from typing import Literal


ApplicationStatus = Literal[
    "DRAFT",
    "PRECHECK_RUNNING",
    "APPLICANT_FIX_REQUIRED",
    "READY_TO_SUBMIT",
    "SUBMITTED",
    "IN_REVIEW",
    "NEEDS_CORRECTION",
    "RESUBMITTED",
    "CONDITIONALLY_APPROVED",
    "APPROVED",
    "REJECTED",
    "WITHDRAWN",
    "ARCHIVED",
]

ComplianceStatus = Literal[
    "PASS",
    "FAIL",
    "WARNING",
    "NEEDS_REVIEW",
    "NOT_FOUND",
    "NOT_APPLICABLE",
    "PASS_WITH_WARNINGS",
]

ReviewStatus = ComplianceStatus

ReviewRunStatus = Literal["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]

JobStatus = Literal["queued", "leased", "running", "completed", "failed", "cancelled", "retrying"]


def canonical_application_status(status: str | None) -> ApplicationStatus:
    normalized = str(status or "").strip().upper()
    if normalized in {
        "DRAFT",
        "PRECHECK_RUNNING",
        "APPLICANT_FIX_REQUIRED",
        "READY_TO_SUBMIT",
        "SUBMITTED",
        "IN_REVIEW",
        "NEEDS_CORRECTION",
        "RESUBMITTED",
        "CONDITIONALLY_APPROVED",
        "APPROVED",
        "REJECTED",
        "WITHDRAWN",
        "ARCHIVED",
    }:
        return normalized  # type: ignore[return-value]
    return {
        "CREATED": "DRAFT",
        "ASSETS_UPLOADED": "READY_TO_SUBMIT",
        "REVIEW_QUEUED": "IN_REVIEW",
        "PROCESSING": "IN_REVIEW",
        "REVIEW_COMPLETED": "IN_REVIEW",
        "REVIEW_FAILED": "IN_REVIEW",
        "PASS": "READY_TO_SUBMIT",
        "PASS_WITH_WARNINGS": "READY_TO_SUBMIT",
        "FAIL": "APPLICANT_FIX_REQUIRED",
        "NOT_FOUND": "APPLICANT_FIX_REQUIRED",
    }.get(normalized, "DRAFT")  # type: ignore[return-value]


def canonical_review_status(status: str | None) -> ComplianceStatus:
    normalized = str(status or "").strip().upper()
    if normalized in {
        "PASS",
        "FAIL",
        "WARNING",
        "NEEDS_REVIEW",
        "NOT_FOUND",
        "NOT_APPLICABLE",
        "PASS_WITH_WARNINGS",
    }:
        return normalized  # type: ignore[return-value]
    if normalized == "PASS_WITH_WARNING":
        return "PASS_WITH_WARNINGS"
    return "NEEDS_REVIEW"


def canonical_review_run_status(status: str | None) -> ReviewRunStatus:
    normalized = str(status or "").strip().upper()
    if normalized in {"PROCESSING", "STARTED"}:
        return "RUNNING"
    if normalized in {"QUEUED", "PENDING"}:
        return "QUEUED"
    if normalized in {"COMPLETE", "REVIEW_COMPLETED"}:
        return "COMPLETED"
    if normalized in {"QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"}:
        return normalized  # type: ignore[return-value]
    return "QUEUED"
