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

ReviewStatus = Literal[
    "PASS",
    "FAIL",
    "WARNING",
    "NEEDS_REVIEW",
    "NOT_FOUND",
    "NOT_APPLICABLE",
    "PASS_WITH_WARNINGS",
]


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
        "REVIEW_COMPLETED": "APPROVED",
        "PASS": "APPROVED",
        "REVIEW_FAILED": "REJECTED",
        "FAIL": "REJECTED",
        "FAILED": "REJECTED",
    }.get(normalized, "DRAFT")  # type: ignore[return-value]


def canonical_review_status(status: str | None) -> ReviewStatus:
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
    if normalized in {"COMPLETED", "APPROVED"}:
        return "PASS"
    if normalized in {"FAILED", "REJECTED"}:
        return "FAIL"
    if normalized == "PASS_WITH_WARNING":
        return "PASS_WITH_WARNINGS"
    return "NEEDS_REVIEW"
