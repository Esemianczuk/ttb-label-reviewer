import type { ApplicationStatus, FieldStatus, ProcessingMode, ReviewStatus } from "./types";

const REVIEW_STATUS_VALUES: ReviewStatus[] = [
  "PASS",
  "FAIL",
  "WARNING",
  "NEEDS_REVIEW",
  "NOT_FOUND",
  "NOT_APPLICABLE",
  "PASS_WITH_WARNINGS"
];

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

export function normalizeReviewStatus(status: string | undefined | null): ReviewStatus {
  const candidate = String(status || "").trim().toUpperCase();
  if (candidate === "PASS_WITH_WARNING") return "PASS_WITH_WARNINGS";
  if (candidate === "COMPLETED") return "PASS";
  if (REVIEW_STATUS_VALUES.includes(candidate as ReviewStatus)) return candidate as ReviewStatus;
  if (candidate === "PASS" || candidate === "APPROVED") return "PASS";
  if (candidate === "FAIL" || candidate === "FAILED" || candidate === "REJECTED") return "FAIL";
  return "NEEDS_REVIEW";
}

export function normalizeApplicationStatus(status: string | undefined | null): ApplicationStatus {
  const candidate = String(status || "").trim().toUpperCase();
  if (APPLICATION_STATUS_VALUES.includes(candidate as ApplicationStatus)) return candidate as ApplicationStatus;
  if (candidate === "CREATED") return "DRAFT";
  if (candidate === "ASSETS_UPLOADED" || candidate === "READY") return "READY_TO_SUBMIT";
  if (candidate === "REVIEW_QUEUED" || candidate === "PROCESSING") return "IN_REVIEW";
  if (candidate === "REVIEW_COMPLETED" || candidate === "PASS") return "APPROVED";
  if (candidate === "FAIL" || candidate === "REVIEW_FAILED") return "REJECTED";
  if (candidate === "NEEDS_REVIEW") return "IN_REVIEW";
  return "DRAFT";
}

export function applicationStatusFromReviewStatus(status: ReviewStatus): ApplicationStatus {
  if (status === "PASS" || status === "PASS_WITH_WARNINGS" || status === "NOT_APPLICABLE") return "APPROVED";
  if (status === "FAIL" || status === "NOT_FOUND") return "REJECTED";
  return "IN_REVIEW";
}

export function displayStatus(status: ApplicationStatus | FieldStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function backendModeFromProcessingMode(mode: ProcessingMode): "backend" | "distributed" {
  return mode === "cluster" ? "distributed" : "backend";
}
