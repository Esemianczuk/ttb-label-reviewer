import { Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { autoReviewApplication, setActiveApplication } from "../../providers/data/browserStore";
import { ModeTag, StatusTag } from "../common/StatusTag";
import {
  REVIEWER_QUEUE_FILTERS,
  type ReviewerQueueFilter,
  criticalFieldLabels,
  matchesReviewerFilter,
  queuePriority,
  reviewerAiSummary,
  reviewerQueueApplications
} from "../../pages/reviewer/reviewerUtils";

export function ReviewQueue({ title = "Review Queue", compact = false }: { title?: string; compact?: boolean }) {
  const { snapshot } = useConsoleStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReviewerQueueFilter>("all");
  const data = useMemo(
    () =>
      reviewerQueueApplications(snapshot.applications).filter((application) => {
        const haystack =
          `${application.title} ${application.expectedFields.brandName} ${application.expectedFields.classType} ${application.submitter} ${application.status}`.toLowerCase();
        return haystack.includes(search.toLowerCase()) && matchesReviewerFilter(application, filter);
      }),
    [filter, search, snapshot.applications]
  );

  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Priority",
      width: 126,
      render: (_, application) => {
        const priority = queuePriority(application);
        return <Tag color={priority.tone}>{priority.label}</Tag>;
      }
    },
    {
      title: "Application ID",
      width: 220,
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{application.expectedFields.applicationId || application.id}</strong>
          <Typography.Text type="secondary">{application.title}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Brand",
      render: (_, application) => application.expectedFields.brandName
    },
    {
      title: "Product Type",
      responsive: ["lg"],
      render: (_, application) => application.expectedFields.productType.replaceAll("_", " ")
    },
    {
      title: "Class / Type",
      responsive: ["xl"],
      render: (_, application) => application.expectedFields.classType
    },
    {
      title: "Applicant",
      responsive: ["lg"],
      render: (_, application) => application.submitter
    },
    {
      title: "Status",
      render: (_, application) => <StatusTag status={application.status} />
    },
    {
      title: "AI Summary",
      width: compact ? 240 : 320,
      render: (_, application) => reviewerAiSummary(application)
    },
    {
      title: "Critical Fields",
      responsive: ["xl"],
      render: (_, application) => criticalFieldLabels(application)
    },
    {
      title: "Submitted",
      responsive: ["lg"],
      render: (_, application) => new Date(application.updatedAt).toLocaleString()
    },
    {
      title: "Assigned Reviewer",
      responsive: ["lg"],
      render: (_, application) => application.assignedTo || "Unassigned"
    },
    {
      title: "Processing Mode",
      responsive: ["xl"],
      render: (_, application) => <ModeTag mode={application.review?.mode || snapshot.processingMode} />
    },
    {
      title: "Actions",
      width: 190,
      fixed: compact ? undefined : "right",
      render: (_, application) => (
        <Space>
          <Button
            onClick={() => {
              setActiveApplication(application.id);
              if (!application.review) autoReviewApplication(application.id, snapshot.processingMode);
              navigate(`/reviewer/applications/${application.id}`);
            }}
          >
            Open
          </Button>
          <Button onClick={() => autoReviewApplication(application.id, snapshot.processingMode)}>Process</Button>
        </Space>
      )
    }
  ];

  return (
    <Card
      title={title}
      size="small"
      extra={
        <Space wrap>
          <Select
            aria-label="Queue filter"
            value={filter}
            onChange={(value) => setFilter(value)}
            options={REVIEWER_QUEUE_FILTERS}
            style={{ minWidth: 220 }}
          />
          <Input.Search
            aria-label="Search review queue"
            placeholder="Search applications"
            allowClear
            onSearch={setSearch}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Space>
      }
    >
      <Table rowKey="id" dataSource={data} columns={columns} pagination={{ pageSize: compact ? 5 : 8 }} scroll={{ x: compact ? 1180 : 1620 }} />
    </Card>
  );
}
