import { Alert } from "antd";
import type { ReactNode } from "react";

export type GovAlertType = "info" | "success" | "warning" | "error" | "emergency" | "prototype";

const defaultHeading: Record<GovAlertType, string> = {
  info: "Review required",
  success: "Ready to submit",
  warning: "Action needed",
  error: "Critical mismatch",
  emergency: "Critical mismatch",
  prototype: "Demo notice"
};

const antType: Record<GovAlertType, "info" | "success" | "warning" | "error"> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
  emergency: "error",
  prototype: "info"
};

export function GovAlert({
  type = "info",
  title,
  children,
  action
}: {
  type?: GovAlertType;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Alert
      className={`gov-alert gov-alert-${type}`}
      type={antType[type]}
      showIcon
      title={title || defaultHeading[type]}
      description={children}
      action={action}
    />
  );
}
