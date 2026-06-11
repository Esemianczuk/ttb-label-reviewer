import { AppstoreOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { processReviewerBatch } from "../../providers/data/browserStore";
import { StatusTag } from "../../components/common/StatusTag";
import { queuePriority, reviewerAiSummary, reviewerQueueApplications } from "./reviewerUtils";

export function ReviewerBatchesPage() {
  const { snapshot } = useConsoleStore();
  const [messageApi, contextHolder] = message.useMessage();
  const data = reviewerQueueApplications(snapshot.applications);
  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Batch Priority",
      render: (_, application) => {
        const priority = queuePriority(application);
        return <Tag color={priority.tone}>{priority.label}</Tag>;
      }
    },
    {
      title: "Application",
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{application.expectedFields.applicationId || application.id}</strong>
          <Typography.Text type="secondary">{application.expectedFields.brandName}</Typography.Text>
        </Space>
      )
    },
    { title: "Status", render: (_, application) => <StatusTag status={application.status} /> },
    { title: "AI Summary", render: (_, application) => reviewerAiSummary(application) },
    {
      title: "Actions",
      render: (_, application) => (
        <Space>
          <Button>
            <Link to={`/reviewer/applications/${application.id}`}>Open</Link>
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={() => {
              processReviewerBatch({ applicationIds: [application.id], mode: snapshot.processingMode });
              messageApi.success("Application processed.");
            }}
          >
            Process
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      {contextHolder}
      <Card
        size="small"
        title="Batch Review"
        extra={
          <Button
            type="primary"
            icon={<AppstoreOutlined />}
            onClick={() => {
              processReviewerBatch({ mode: snapshot.processingMode });
              messageApi.success("Visible review batch processed.");
            }}
          >
            Process Open Batch
          </Button>
        }
      >
        <Table rowKey="id" dataSource={data} columns={columns} pagination={{ pageSize: 8 }} scroll={{ x: 980 }} />
      </Card>
    </Space>
  );
}
