import { Breadcrumb, Space, Typography } from "antd";
import type { ReactNode } from "react";

export function GovPageShell({
  title,
  eyebrow,
  description,
  primaryAction,
  secondaryActions,
  breadcrumbs,
  statusTag,
  children
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  breadcrumbs?: Array<{ title: ReactNode }>;
  statusTag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="gov-page-shell">
      <section className="gov-page-header" aria-labelledby="page-title">
        {breadcrumbs?.length ? <Breadcrumb items={breadcrumbs} /> : null}
        <div className="gov-page-header-main">
          <div>
            {eyebrow ? <div className="gov-eyebrow">{eyebrow}</div> : null}
            <Space wrap align="center">
              <Typography.Title id="page-title" level={1} className="gov-page-title">
                {title}
              </Typography.Title>
              {statusTag}
            </Space>
            {description ? <Typography.Paragraph className="gov-page-description">{description}</Typography.Paragraph> : null}
          </div>
          {primaryAction || secondaryActions ? (
            <Space wrap>
              {secondaryActions}
              {primaryAction}
            </Space>
          ) : null}
        </div>
      </section>
      {children}
    </div>
  );
}
