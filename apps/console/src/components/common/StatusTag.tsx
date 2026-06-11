import { Badge, Tag } from "antd";
import type { ApplicationStatus, FieldStatus, ProcessingMode } from "../../domain/application/types";
import { displayStatus } from "../../domain/application/status";

const statusMeta: Record<ApplicationStatus | FieldStatus, { color: string; text: string; badge: "success" | "processing" | "error" | "warning" | "default" }> = {
  DRAFT: { color: "default", text: "Draft", badge: "default" },
  PRECHECK_RUNNING: { color: "blue", text: "Precheck Running", badge: "processing" },
  APPLICANT_FIX_REQUIRED: { color: "warning", text: "Fix Required", badge: "warning" },
  READY_TO_SUBMIT: { color: "cyan", text: "Ready To Submit", badge: "processing" },
  SUBMITTED: { color: "cyan", text: "Submitted", badge: "processing" },
  IN_REVIEW: { color: "blue", text: "In Review", badge: "processing" },
  NEEDS_CORRECTION: { color: "warning", text: "Needs Correction", badge: "warning" },
  RESUBMITTED: { color: "blue", text: "Resubmitted", badge: "processing" },
  CONDITIONALLY_APPROVED: { color: "lime", text: "Conditionally Approved", badge: "success" },
  APPROVED: { color: "success", text: "Approved", badge: "success" },
  REJECTED: { color: "error", text: "Rejected", badge: "error" },
  WITHDRAWN: { color: "default", text: "Withdrawn", badge: "default" },
  ARCHIVED: { color: "default", text: "Archived", badge: "default" },
  PASS: { color: "success", text: "Pass", badge: "success" },
  FAIL: { color: "error", text: "Fail", badge: "error" },
  WARNING: { color: "warning", text: "Warning", badge: "warning" },
  NEEDS_REVIEW: { color: "warning", text: "Needs Review", badge: "warning" },
  NOT_FOUND: { color: "error", text: "Not Found", badge: "error" },
  NOT_APPLICABLE: { color: "default", text: "N/A", badge: "default" },
  PASS_WITH_WARNINGS: { color: "warning", text: "Pass With Warnings", badge: "warning" }
};

const modeMeta: Record<ProcessingMode, { color: string; text: string }> = {
  browser: { color: "green", text: "Browser Only" },
  backend: { color: "blue", text: "FastAPI Backend" },
  cluster: { color: "purple", text: "Distributed Cluster" }
};

export function StatusTag({ status }: { status: ApplicationStatus | FieldStatus }) {
  const meta = statusMeta[status] || { color: "default", text: displayStatus(status), badge: "default" as const };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

export function StatusBadge({ status }: { status: ApplicationStatus | FieldStatus }) {
  const meta = statusMeta[status] || { color: "default", text: displayStatus(status), badge: "default" as const };
  return <Badge status={meta.badge} text={meta.text} />;
}

export function ModeTag({ mode }: { mode: ProcessingMode }) {
  const meta = modeMeta[mode];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}
