import { Card, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";
import { applicationNumberFor } from "../../domain/application/applicationNumber";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";

export function ReviewerReportsPage() {
  const { snapshot } = useConsoleStore();
  const data = snapshot.applications.filter((application) => application.review);
  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Report",
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <Link to={`/reviewer/applications/${application.id}`}>{application.title}</Link>
          <Typography.Text type="secondary">Application # {applicationNumberFor(application)}</Typography.Text>
          <Typography.Text type="secondary">{application.review?.id}</Typography.Text>
        </Space>
      )
    },
    { title: "Application Status", render: (_, application) => <StatusTag status={application.status} /> },
    { title: "Review Status", render: (_, application) => (application.review ? <StatusTag status={application.review.reviewerOverallStatus || application.review.status} /> : null) },
    { title: "Completed", render: (_, application) => application.review?.completedAt ? new Date(application.review.completedAt).toLocaleString() : "Processing" },
    { title: "Export", render: (_, application) => <PdfExportButton application={application} pageName="Reviewer Report" /> }
  ];

  return (
    <Card size="small" title="Reviewer Reports">
      <Table rowKey="id" dataSource={data} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />
    </Card>
  );
}
