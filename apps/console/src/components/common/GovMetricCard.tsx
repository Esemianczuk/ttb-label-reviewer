import { Typography } from "antd";
import type { ReactNode } from "react";

export function GovMetricCard({
  title,
  value,
  summary,
  icon,
  danger = false,
  onClick,
  ariaLabel
}: {
  title: string;
  value: ReactNode;
  summary?: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <Typography.Text type="secondary">
        {icon ? <span aria-hidden="true">{icon} </span> : null}
        {title}
      </Typography.Text>
      <strong style={{ color: danger ? "var(--gov-error)" : undefined }}>{value}</strong>
      {summary ? <Typography.Text type="secondary">{summary}</Typography.Text> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="gov-metric-card gov-metric-card-clickable" aria-label={ariaLabel || `${title}: ${value}. Open details`} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <section className="gov-metric-card" aria-label={title}>
      {content}
    </section>
  );
}
