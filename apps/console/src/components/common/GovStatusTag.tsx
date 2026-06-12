import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import type { ApplicationStatus, FieldStatus } from "../../domain/application/types";
import { statusMeta } from "../../theme/statusTokens";

const toneIcon = {
  neutral: MinusCircleOutlined,
  info: InfoCircleOutlined,
  success: CheckCircleOutlined,
  warning: ExclamationCircleOutlined,
  error: CloseCircleOutlined,
  disabled: MinusCircleOutlined
};

export function GovStatusTag({ status, label }: { status: ApplicationStatus | FieldStatus; label?: string }) {
  const meta = statusMeta(status);
  const Icon = toneIcon[meta.tone];
  return (
    <span className={`gov-status-tag gov-status-${meta.tone}`} data-status={status}>
      <Icon aria-hidden="true" />
      <span>{label || meta.label}</span>
    </span>
  );
}
