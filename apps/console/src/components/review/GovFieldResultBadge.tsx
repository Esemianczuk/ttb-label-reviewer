import type { FieldStatus } from "../../domain/application/types";
import { GovStatusTag } from "../common/GovStatusTag";

export function GovFieldResultBadge({ status }: { status: FieldStatus }) {
  return (
    <span className="gov-field-result-badge">
      <GovStatusTag status={status} />
    </span>
  );
}
