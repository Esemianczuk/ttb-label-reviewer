import { Button, Card, Input, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import type { ReviewApplication } from "../../domain/application/types";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { autoReviewApplication, setActiveApplication } from "../../providers/data/browserStore";
import { StatusTag } from "../common/StatusTag";

export function ReviewQueue() {
  const { snapshot } = useConsoleStore();
  const [search, setSearch] = useState("");
  const data = useMemo(
    () =>
      snapshot.applications.filter((application) =>
        `${application.title} ${application.expectedFields.brandName} ${application.status}`.toLowerCase().includes(search.toLowerCase())
      ),
    [search, snapshot.applications]
  );

  const columns: ColumnsType<ReviewApplication> = [
    {
      title: "Application",
      dataIndex: "title",
      render: (_, application) => (
        <Space orientation="vertical" size={1}>
          <strong>{application.title}</strong>
          <Typography.Text type="secondary">{application.expectedFields.applicationId}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Brand",
      render: (_, application) => application.expectedFields.brandName
    },
    {
      title: "Status",
      render: (_, application) => <StatusTag status={application.status} />
    },
    {
      title: "Assigned",
      dataIndex: "assignedTo"
    },
    {
      title: "",
      width: 210,
      render: (_, application) => (
        <Space>
          <Button
            onClick={() => {
              setActiveApplication(application.id);
              if (!application.review) autoReviewApplication(application.id, snapshot.processingMode);
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
      title="Review Queue"
      size="small"
      extra={<Input.Search aria-label="Search review queue" placeholder="Search applications" allowClear onSearch={setSearch} onChange={(event) => setSearch(event.target.value)} />}
    >
      <Table rowKey="id" dataSource={data} columns={columns} pagination={{ pageSize: 6 }} />
    </Card>
  );
}
