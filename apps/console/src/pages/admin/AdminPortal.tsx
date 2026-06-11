import { ApiOutlined, ClusterOutlined, DatabaseOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Card, Col, Descriptions, Progress, Row, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useConsoleStore } from "../../hooks/useConsoleStore";
import { useBackendHealth } from "../../hooks/useBackendHealth";
import type { AuditEvent, ReviewApplication, WorkerSnapshot } from "../../domain/application/types";
import { permissionMatrix } from "../../providers/access/permissionMatrix";
import { PdfExportButton } from "../../components/common/PdfExportButton";
import { StatusTag } from "../../components/common/StatusTag";

export function AdminPortal() {
  const { snapshot, activeApplication } = useConsoleStore();
  const { health } = useBackendHealth();
  const completed = snapshot.applications.filter((application) => application.review).length;
  const failures = snapshot.applications.filter((application) => application.status === "REJECTED").length;

  return (
    <Space orientation="vertical" className="full-width" size={16}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card size="small">
            <Statistic title="Applications" value={snapshot.applications.length} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Statistic title="Processed" value={completed} prefix={<SafetyCertificateOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Statistic title="Failures" value={failures} valueStyle={{ color: failures ? "#b42318" : undefined }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Statistic title="Workers" value={snapshot.workers.length} prefix={<ClusterOutlined />} />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: "ops",
            label: "Operations",
            children: <OperationsTab healthStatus={health.status} healthMessage={health.message} activeApplication={activeApplication} />
          },
          {
            key: "workers",
            label: "Workers",
            children: <WorkerDashboard workers={snapshot.workers} />
          },
          {
            key: "fixtures",
            label: "Fixtures",
            children: <FixtureRegistry applications={snapshot.applications} />
          },
          {
            key: "audit",
            label: "Audit",
            children: <AuditLogTable events={snapshot.auditEvents} />
          },
          {
            key: "access",
            label: "Access",
            children: <AccessMatrix />
          }
        ]}
      />
    </Space>
  );
}

function OperationsTab({
  healthStatus,
  healthMessage,
  activeApplication
}: {
  healthStatus: string;
  healthMessage: string;
  activeApplication?: ReviewApplication;
}) {
  return (
    <Card size="small" title="Coordinator Health" extra={<ApiOutlined />}>
      <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
        <Descriptions.Item label="Backend">{healthStatus}</Descriptions.Item>
        <Descriptions.Item label="Message">{healthMessage}</Descriptions.Item>
        <Descriptions.Item label="Active Packet">{activeApplication?.title || "None"}</Descriptions.Item>
        <Descriptions.Item label="Export">
          <PdfExportButton application={activeApplication} pageName="Admin Operations" />
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function WorkerDashboard({ workers }: { workers: WorkerSnapshot[] }) {
  const columns: ColumnsType<WorkerSnapshot> = [
    { title: "Worker", dataIndex: "hostname" },
    { title: "Platform", dataIndex: "platform" },
    {
      title: "Status",
      render: (_, worker) => <Tag color={worker.status === "online" ? "green" : worker.status === "busy" ? "blue" : "orange"}>{worker.status}</Tag>
    },
    {
      title: "Load",
      render: (_, worker) => <Progress percent={Math.round((worker.activeJobs / Math.max(worker.maxConcurrency, 1)) * 100)} size="small" />
    },
    { title: "Latency", render: (_, worker) => `${worker.latencyMs} ms` },
    { title: "Capabilities", render: (_, worker) => worker.capabilities.map((capability) => <Tag key={capability}>{capability}</Tag>) }
  ];

  return <Table rowKey="id" dataSource={workers} columns={columns} pagination={false} />;
}

function FixtureRegistry({ applications }: { applications: ReviewApplication[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={applications}
      pagination={{ pageSize: 7 }}
      columns={[
        { title: "Fixture", render: (_, application) => application.metadata.fixtureId || application.id },
        { title: "Brand", render: (_, application) => application.expectedFields.brandName },
        { title: "One Image", render: (_, application) => application.images.length === 1 ? "Yes" : application.images.length },
        { title: "Expected", render: (_, application) => application.expectedOutcome },
        { title: "Status", render: (_, application) => <StatusTag status={application.status} /> }
      ]}
    />
  );
}

function AuditLogTable({ events }: { events: AuditEvent[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={events}
      pagination={{ pageSize: 8 }}
      columns={[
        { title: "Time", dataIndex: "createdAt", width: 220 },
        { title: "Actor", dataIndex: "actor" },
        { title: "Action", dataIndex: "action" },
        { title: "Resource", dataIndex: "resource" },
        { title: "Summary", dataIndex: "summary" }
      ]}
    />
  );
}

function AccessMatrix() {
  return (
    <Row gutter={[16, 16]}>
      {Object.entries(permissionMatrix).map(([role, rules]) => (
        <Col xs={24} md={8} key={role}>
          <Card size="small" title={role}>
            {rules.map((rule) => (
              <div key={`${role}-${rule.resource}`} className="permission-row">
                <Typography.Text strong>{rule.resource}</Typography.Text>
                <div>{rule.actions.map((action) => <Tag key={action}>{action}</Tag>)}</div>
              </div>
            ))}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
