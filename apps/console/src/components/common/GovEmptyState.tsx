import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export function GovEmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gov-empty-state">
      <Space orientation="vertical" size={10}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
        {action}
      </Space>
    </div>
  );
}
