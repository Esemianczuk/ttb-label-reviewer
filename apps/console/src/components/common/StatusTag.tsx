import { Badge, Tag } from "antd";
import type { ApplicationStatus, FieldStatus, ProcessingMode } from "../../domain/application/types";

const statusMeta: Record<ApplicationStatus | FieldStatus, { color: string; text: string; badge: "success" | "processing" | "error" | "warning" | "default" }> = {
  draft: { color: "default", text: "Draft", badge: "default" },
  queued: { color: "processing", text: "Queued", badge: "processing" },
  processing: { color: "blue", text: "Processing", badge: "processing" },
  submitted: { color: "cyan", text: "Submitted", badge: "processing" },
  pass: { color: "success", text: "Pass", badge: "success" },
  fail: { color: "error", text: "Fail", badge: "error" },
  needs_review: { color: "warning", text: "Needs Review", badge: "warning" },
  not_applicable: { color: "default", text: "N/A", badge: "default" }
};

const modeMeta: Record<ProcessingMode, { color: string; text: string }> = {
  browser: { color: "green", text: "Browser Only" },
  backend: { color: "blue", text: "FastAPI Backend" },
  cluster: { color: "purple", text: "Distributed Cluster" }
};

export function StatusTag({ status }: { status: ApplicationStatus | FieldStatus }) {
  const meta = statusMeta[status] || statusMeta.needs_review;
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

export function StatusBadge({ status }: { status: ApplicationStatus | FieldStatus }) {
  const meta = statusMeta[status] || statusMeta.needs_review;
  return <Badge status={meta.badge} text={meta.text} />;
}

export function ModeTag({ mode }: { mode: ProcessingMode }) {
  const meta = modeMeta[mode];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}
