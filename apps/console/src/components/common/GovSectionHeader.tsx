import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export function GovSectionHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="gov-section-header">
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {description ? <Typography.Paragraph type="secondary">{description}</Typography.Paragraph> : null}
      </div>
      {actions ? <Space wrap>{actions}</Space> : null}
    </div>
  );
}
