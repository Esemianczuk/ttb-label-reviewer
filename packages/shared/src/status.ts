export const REVIEW_STATUSES = [
  "PASS",
  "FAIL",
  "WARNING",
  "NEEDS_REVIEW",
  "NOT_FOUND",
  "NOT_APPLICABLE",
  "PASS_WITH_WARNINGS"
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const APPLICATION_STATUSES = [
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
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const PRODUCT_TYPES = ["distilled_spirits", "wine", "malt_beverage", "unknown"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const IMAGE_ROLES = ["front", "back", "neck", "carton", "other", "cola_sheet", "unknown"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];
