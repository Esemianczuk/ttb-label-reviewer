import { Badge, Tag } from "antd";
import type { ApplicationStatus, FieldStatus, ProcessingMode } from "../../domain/application/types";
import { GovStatusTag } from "./GovStatusTag";
import { statusMeta } from "../../theme/statusTokens";

const modeMeta: Record<ProcessingMode, { color: string; text: string }> = {
  browser: { color: "green", text: "Browser Only" },
  backend: { color: "blue", text: "FastAPI Backend" },
  cluster: { color: "purple", text: "Distributed Cluster" }
};

export function StatusTag({ status }: { status: ApplicationStatus | FieldStatus }) {
  return <GovStatusTag status={status} />;
}

export function StatusBadge({ status }: { status: ApplicationStatus | FieldStatus }) {
  const meta = statusMeta(status);
  const badge = meta.tone === "success" ? "success" : meta.tone === "error" ? "error" : meta.tone === "warning" ? "warning" : meta.tone === "info" ? "processing" : "default";
  return <Badge status={badge} text={meta.label} />;
}

export function ModeTag({ mode }: { mode: ProcessingMode }) {
  const meta = modeMeta[mode];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}
