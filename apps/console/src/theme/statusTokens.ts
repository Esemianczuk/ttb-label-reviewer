import type { ApplicationStatus, FieldStatus } from "../domain/application/types";

export type GovStatusTone = "neutral" | "info" | "success" | "warning" | "error" | "disabled";

export type GovStatusMeta = {
  label: string;
  tone: GovStatusTone;
};

export const applicationStatusTokens: Record<ApplicationStatus, GovStatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PRECHECK_RUNNING: { label: "Preparing submission", tone: "info" },
  APPLICANT_FIX_REQUIRED: { label: "Applicant fix required", tone: "warning" },
  READY_TO_SUBMIT: { label: "Ready to submit", tone: "info" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  IN_REVIEW: { label: "In review", tone: "info" },
  NEEDS_CORRECTION: { label: "Needs correction", tone: "warning" },
  RESUBMITTED: { label: "Resubmitted", tone: "info" },
  CONDITIONALLY_APPROVED: { label: "Conditionally approved", tone: "success" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "error" },
  WITHDRAWN: { label: "Withdrawn", tone: "disabled" },
  ARCHIVED: { label: "Archived", tone: "disabled" }
};

export const reviewStatusTokens: Record<FieldStatus, GovStatusMeta> = {
  PASS: { label: "Pass", tone: "success" },
  FAIL: { label: "Fail", tone: "error" },
  WARNING: { label: "Warning", tone: "warning" },
  NEEDS_REVIEW: { label: "Needs review", tone: "warning" },
  NOT_FOUND: { label: "Not found", tone: "error" },
  NOT_APPLICABLE: { label: "Not applicable", tone: "neutral" },
  PASS_WITH_WARNINGS: { label: "Pass with warnings", tone: "warning" }
};

export const govToneColors: Record<GovStatusTone, { color: string; background: string; border: string }> = {
  neutral: { color: "#1B1B1B", background: "#F7F9FA", border: "#DFE1E2" },
  info: { color: "#005EA8", background: "#E7F6FF", border: "#97D4EA" },
  success: { color: "#245C2D", background: "#EAF4DD", border: "#B4D0A4" },
  warning: { color: "#7D4900", background: "#FFF5C2", border: "#FFBE2E" },
  error: { color: "#B50909", background: "#F8DFE2", border: "#F2938C" },
  disabled: { color: "#565C65", background: "#F0F0F0", border: "#C9C9C9" }
};

export function statusMeta(status: ApplicationStatus | FieldStatus): GovStatusMeta {
  return applicationStatusTokens[status as ApplicationStatus] || reviewStatusTokens[status as FieldStatus] || { label: String(status), tone: "neutral" };
}
