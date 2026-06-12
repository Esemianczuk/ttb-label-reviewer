import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export type GovSummaryRow = {
  label: ReactNode;
  value: ReactNode;
};

export function GovSummaryBox({
  title,
  rows,
  status,
  actions
}: {
  title: string;
  rows: GovSummaryRow[];
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="gov-summary-box" aria-label={title}>
      <Space orientation="vertical" className="full-width" size={10}>
        <Space className="full-width" align="start" style={{ justifyContent: "space-between" }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {status}
        </Space>
        <div>
          {rows.map((row, index) => (
            <div className="gov-summary-row" key={index}>
              <Typography.Text type="secondary">{row.label}</Typography.Text>
              <Typography.Text strong>{row.value}</Typography.Text>
            </div>
          ))}
        </div>
        {actions}
      </Space>
    </section>
  );
}
