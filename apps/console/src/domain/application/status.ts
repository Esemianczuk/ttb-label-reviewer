import type { ApplicationStatus, ComplianceStatus, FieldStatus, ProcessingMode, ReviewRunStatus } from "./types";

const COMPLIANCE_STATUS_VALUES: ComplianceStatus[] = [
  "PASS",
  "FAIL",
  "WARNING",
  "NEEDS_REVIEW",
  "NOT_FOUND",
  "NOT_APPLICABLE",
  "PASS_WITH_WARNINGS"
];

const REVIEW_RUN_STATUS_VALUES: ReviewRunStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];

const APPLICATION_STATUS_VALUES: ApplicationStatus[] = [
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
  "ARCHIVED"
];

export function normalizeReviewStatus(status: string | undefined | null): ComplianceStatus {
  const candidate = String(status || "").trim().toUpperCase();
  if (candidate === "PASS_WITH_WARNING") return "PASS_WITH_WARNINGS";
  if (COMPLIANCE_STATUS_VALUES.includes(candidate as ComplianceStatus)) return candidate as ComplianceStatus;
  return "NEEDS_REVIEW";
}

export function normalizeReviewRunStatus(status: string | undefined | null): ReviewRunStatus {
  const candidate = String(status || "").trim().toUpperCase();
  if (candidate === "PROCESSING" || candidate === "STARTED") return "RUNNING";
  if (candidate === "QUEUED" || candidate === "PENDING") return "QUEUED";
  if (REVIEW_RUN_STATUS_VALUES.includes(candidate as ReviewRunStatus)) return candidate as ReviewRunStatus;
  return "QUEUED";
}

export function normalizeApplicationStatus(status: string | undefined | null): ApplicationStatus {
  const candidate = String(status || "").trim().toUpperCase();
  if (APPLICATION_STATUS_VALUES.includes(candidate as ApplicationStatus)) return candidate as ApplicationStatus;
  if (candidate === "CREATED") return "DRAFT";
  if (candidate === "ASSETS_UPLOADED" || candidate === "READY") return "READY_TO_SUBMIT";
  if (candidate === "REVIEW_QUEUED" || candidate === "PROCESSING") return "IN_REVIEW";
  if (candidate === "REVIEW_COMPLETED" || candidate === "REVIEW_FAILED") return "IN_REVIEW";
  if (candidate === "PASS" || candidate === "PASS_WITH_WARNINGS") return "READY_TO_SUBMIT";
  if (candidate === "FAIL" || candidate === "NOT_FOUND") return "APPLICANT_FIX_REQUIRED";
  if (candidate === "NEEDS_REVIEW") return "IN_REVIEW";
  return "DRAFT";
}

export function applicantReadinessStatusFromCompliance(status: ComplianceStatus): ApplicationStatus {
  if (status === "PASS" || status === "PASS_WITH_WARNINGS" || status === "NOT_APPLICABLE") return "READY_TO_SUBMIT";
  if (status === "FAIL" || status === "NOT_FOUND") return "APPLICANT_FIX_REQUIRED";
  return "APPLICANT_FIX_REQUIRED";
}

export function reviewerWorkflowStatusFromCompliance(_status: ComplianceStatus): ApplicationStatus {
  return "IN_REVIEW";
}

export function displayStatus(status: ApplicationStatus | FieldStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function backendModeFromProcessingMode(_mode: ProcessingMode): "backend" {
  return "backend";
}
